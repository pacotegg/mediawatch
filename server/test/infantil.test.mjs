/*
 * Perfiles infantiles: lo que no pueden ver tampoco lo pueden pedir por las puertas traseras
 * (listas HLS de calidad, trozos HLS, copias para descargar). Servidor real en modo portable con
 * datos temporales; los titulos y el perfil se crean en esa base temporal.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galletaNino, adulto, apta;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, { cuerpo, galleta, cabeceras = {} } = {}) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(galleta ? { Cookie: galleta } : {}), ...cabeceras },
  body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(8000),
});
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER, stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) },
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/salud')).ok) break; } catch { /* arrancando */ }
    await esperar(500);
  }
  // Titulos en la base temporal: uno para adultos (18) y uno apto (TP).
  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
  const alta = (titulo, mpaa) => {
    const it = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at, mpaa) VALUES (1,'movie',?,?,?,'x',?) RETURNING id").get(titulo, titulo, titulo, mpaa);
    return db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,5400,1) RETURNING id').get(it.id, 'C:/no/existe/' + titulo + '.mkv').id;
  };
  adulto = alta('adultos', 'ES:18');
  apta = alta('apta', 'ES:TP');
  db.close();

  // Administrador (desde localhost) y perfil infantil que solo ve TP.
  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  const login = await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } });
  const galletaAdmin = galletaDe(login);
  const nino = await (await pedir('POST', '/api/users', { cuerpo: { name: 'Peque', pin: '112233', kidRatings: ['TP'] }, galleta: galletaAdmin })).json();
  galletaNino = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: nino.id, pin: '112233' } }));
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('el perfil infantil inicio sesion', () => assert.ok(galletaNino && galletaNino.includes('='), 'sin galleta de sesion'));

for (const [nombre, ruta, metodo, cuerpo] of [
  ['lista maestra HLS', (id) => `/api/play/${id}/hls/master.m3u8`, 'GET'],
  ['lista HLS de una calidad', (id) => `/api/play/${id}/hls/1080p.m3u8`, 'GET'],
  ['trozo HLS', (id) => `/api/play/${id}/hls/1080p/0.ts`, 'GET'],
  ['copia para descargar', () => '/api/descargas', 'POST', (id) => ({ fileId: id, perfil: 'movil' })],
]) {
  test(`perfil infantil: ${nombre} de un titulo para adultos da 403`, async () => {
    const r = await pedir(metodo, ruta(adulto), { galleta: galletaNino, cuerpo: cuerpo ? cuerpo(adulto) : undefined });
    assert.equal(r.status, 403);
  });
  test(`perfil infantil: ${nombre} de un titulo apto no da 403`, async () => {
    const r = await pedir(metodo, ruta(apta), { galleta: galletaNino, cuerpo: cuerpo ? cuerpo(apta) : undefined });
    assert.notEqual(r.status, 403);
  });
}

for (const [nombre, ruta] of [
  ['subtitulo incrustado', (id) => `/api/play/${id}/subtitle/embedded-2`],
  ['subtitulo externo', (id) => `/api/play/${id}/subtitle/external-1`],
  ['desfases guardados', (id) => `/api/play/${id}/offsets`],
  ['medicion de sincronia', (id) => `/api/play/${id}/resync/embedded-2`],
]) {
  test(`perfil infantil: ${nombre} de un titulo para adultos da 403`, async () => {
    assert.equal((await pedir('GET', ruta(adulto), { galleta: galletaNino })).status, 403);
  });
  test(`perfil infantil: ${nombre} de un titulo apto no da 403`, async () => {
    assert.notEqual((await pedir('GET', ruta(apta), { galleta: galletaNino })).status, 403);
  });
}
