/*
 * Limite diario de tiempo de un perfil: agotado, no se puede empezar nada y el mando manda parar; sin
 * limite (o con tiempo de sobra) no cambia nada; y el propio perfil no se lo puede quitar.
 * Servidor real en modo portable con datos temporales.
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
let proceso, datos, base, galletaAdmin, galletaNino, nino, fileId, itemId;

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
const bd = () => { const d = new DatabaseSync(join(datos, 'tvwatch.db')); d.exec('PRAGMA busy_timeout = 10000'); return d; };

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
  const d = bd();
  d.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
  itemId = d.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at, mpaa) VALUES (1,'movie','p','t','t','x','ES:TP') RETURNING id").get().id;
  fileId = d.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,5400,1) RETURNING id').get(itemId, 'C:/no/existe/t.mkv').id;
  d.close();

  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  nino = (await (await pedir('POST', '/api/users', { cuerpo: { name: 'Peque', pin: '112233', kidRatings: ['TP'] }, galleta: galletaAdmin })).json()).id;
  galletaNino = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: nino, pin: '112233' } }));
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

const verHoy = (segundos) => {
  const d = bd();
  const ahora = new Date().toISOString();
  d.prepare('INSERT INTO playbacks (user_id, item_id, file_id, started_at, updated_at, position, seconds, duration, modo, cliente, finished) VALUES (?,?,?,?,?,?,?,?,?,?,0)')
    .run(nino, itemId, fileId, ahora, ahora, segundos, segundos, 5400, 'raw', 'Android');
  d.close();
};

test('el perfil infantil no se puede poner ni quitar su propio limite', async () => {
  const r = await pedir('PUT', `/api/users/${nino}`, { cuerpo: { limiteDiario: null }, galleta: galletaNino });
  assert.equal(r.status, 403);
});

test('un limite fuera de rango se rechaza', async () => {
  assert.equal((await pedir('PUT', `/api/users/${nino}`, { cuerpo: { limiteDiario: 0 }, galleta: galletaAdmin })).status, 400);
  assert.equal((await pedir('PUT', `/api/users/${nino}`, { cuerpo: { limiteDiario: 2.5 }, galleta: galletaAdmin })).status, 400);
});

test('con tiempo de sobra se puede empezar y el mando no manda parar', async () => {
  assert.equal((await pedir('PUT', `/api/users/${nino}`, { cuerpo: { limiteDiario: 30 }, galleta: galletaAdmin })).status, 200);
  verHoy(60);
  const info = await pedir('GET', `/api/play/${fileId}/info`, { galleta: galletaNino });
  assert.notEqual(info.status, 403);
  const mando = await (await pedir('GET', '/api/mando', { galleta: galletaNino })).json();
  assert.equal(mando.parar, false);
});

test('agotado: no se puede empezar (info, flujo, HLS) y el mando manda parar con aviso', async () => {
  verHoy(30 * 60);
  for (const ruta of [`/api/play/${fileId}/info`, `/api/play/${fileId}/stream`, `/api/play/${fileId}/hls/master.m3u8`]) {
    const r = await pedir('GET', ruta, { galleta: galletaNino });
    assert.equal(r.status, 403, ruta);
    assert.equal((await r.json()).limite, true, ruta);
  }
  const mando = await (await pedir('GET', '/api/mando', { galleta: galletaNino })).json();
  assert.equal(mando.parar, true);
  assert.match(mando.mensaje, /tiempo de hoy/);
});

test('el administrador sin limite no se ve afectado, y quitar el limite lo desbloquea', async () => {
  assert.notEqual((await pedir('GET', `/api/play/${fileId}/info`, { galleta: galletaAdmin })).status, 403);
  assert.equal((await pedir('PUT', `/api/users/${nino}`, { cuerpo: { limiteDiario: null }, galleta: galletaAdmin })).status, 200);
  assert.notEqual((await pedir('GET', `/api/play/${fileId}/info`, { galleta: galletaNino })).status, 403);
});
