/*
 * Cambiar o quitar la saga (colección) de una película desde el editor. El escáner pisa `collection` desde el .nfo en cada
 * pasada, así que «quitar» no se sostenía: hace falta una marca propia (`coleccion_fijada`). Solo el administrador, y se
 * puede deshacer con la instantánea del scraper. Servidor real en modo portable con datos temporales.
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
let proceso, datos, base, galletaAdmin, galletaNormal, id;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, { cuerpo, galleta } = {}) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(galleta ? { Cookie: galleta } : {}) },
  body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(8000),
});
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const coleccion = () => { const d = new DatabaseSync(join(datos, 'tvwatch.db'), { readOnly: true }); try { return d.prepare('SELECT collection, coleccion_fijada FROM items WHERE id = ?').get(id); } finally { d.close(); } };

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
  const host = new URL(base).host;
  await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: host, Origin: base }, body: JSON.stringify({ name: 'Admin', pin: '654321' }) });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  const normal = await (await pedir('POST', '/api/users', { cuerpo: { name: 'Normal', pin: '112233' }, galleta: galletaAdmin })).json();
  galletaNormal = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: normal.id, pin: '112233' } }));
  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
  id = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie','p','Romulus','romulus','x') RETURNING id").get().id;
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('un perfil normal no puede cambiar la saga', async () => {
  assert.equal((await pedir('POST', `/api/items/${id}/coleccion`, { galleta: galletaNormal, cuerpo: { coleccion: 'Alien - Colección' } })).status, 403);
  assert.equal(coleccion().collection, null);
});

test('el administrador asigna la saga y queda fijada', async () => {
  const r = await pedir('POST', `/api/items/${id}/coleccion`, { galleta: galletaAdmin, cuerpo: { coleccion: '  Alien - Colección  ' } });
  assert.equal(r.status, 200, await r.text());
  assert.deepEqual({ ...coleccion() }, { collection: 'Alien - Colección', coleccion_fijada: 1 });
  const ficha = await (await pedir('GET', `/api/items/${id}`, { galleta: galletaAdmin })).json();
  assert.equal(ficha.collection, 'Alien - Colección');
});

test('quitar la saga la deja en null y sigue fijada', async () => {
  const r = await pedir('POST', `/api/items/${id}/coleccion`, { galleta: galletaAdmin, cuerpo: { coleccion: null } });
  assert.equal(r.status, 200);
  assert.deepEqual({ ...coleccion() }, { collection: null, coleccion_fijada: 1 });
});

test('un nombre vacío, con caracteres de control o larguísimo se rechaza', async () => {
  for (const malo of ['   ', 'a\nb', 'x'.repeat(200), 5]) {
    const r = await pedir('POST', `/api/items/${id}/coleccion`, { galleta: galletaAdmin, cuerpo: { coleccion: malo } });
    assert.equal(r.status, 400, JSON.stringify(malo).slice(0, 20));
  }
});

test('un título que no existe da 404', async () => {
  assert.equal((await pedir('POST', '/api/items/999999/coleccion', { galleta: galletaAdmin, cuerpo: { coleccion: 'X' } })).status, 404);
});
