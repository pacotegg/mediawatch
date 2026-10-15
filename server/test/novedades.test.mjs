/*
 * Novedades desde la ultima visita: la primera vez solo se pone la marca; luego salen los titulos nuevos,
 * un perfil infantil solo ve los suyos, y marcarlas como vistas las vacia. Servidor real con datos temporales.
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

const local = (ms) => new Date(Date.now() + ms - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
const alta = (titulo, mpaa) => {
  const d = bd();
  d.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at, mpaa, added_at) VALUES (1,'movie',?,?,?,'x',?,?)").run(titulo, titulo, titulo, mpaa, local(60_000));
  d.close();
};
const novedades = async (g) => (await pedir('GET', '/api/novedades', { galleta: g })).json();

test('la primera vez no anuncia nada (solo pone la marca)', async () => {
  const n = await novedades(galletaNino);
  assert.equal(n.total, 0);
  assert.equal(n.desde, null);
  await novedades(galletaAdmin);
});

test('lo nuevo sale, y el perfil infantil solo ve lo apto', async () => {
  alta('Nueva apta', 'ES:TP');
  alta('Nueva de adultos', 'ES:18');
  const adulto = await novedades(galletaAdmin);
  assert.deepEqual(adulto.items.map((i) => i.title).sort(), ['Nueva apta', 'Nueva de adultos']);
  const peque = await novedades(galletaNino);
  assert.deepEqual(peque.items.map((i) => i.title), ['Nueva apta']);
  assert.equal(peque.total, 1);
});

test('marcarlas como vistas las vacia', async () => {
  // La marca es «ahora» y las de prueba estan un minuto en el futuro: se vuelve la marca hacia delante.
  assert.equal((await pedir('POST', '/api/novedades/vistas', { galleta: galletaAdmin })).status, 200);
  const d = bd(); d.prepare('UPDATE users SET novedades_vistas = ? WHERE id = 1').run(local(120_000)); d.close();
  assert.equal((await novedades(galletaAdmin)).total, 0);
});
