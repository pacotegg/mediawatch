/*
 * Editar el mismo dato (estudio, edad, saga) en varios títulos a la vez desde el scraper. Solo administrador, valida todo antes de
 * tocar nada, deja cada título fijado e instantáneo, y no deja cambiar otros campos. Servidor real con datos temporales.
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
let proceso, datos, base, galletaAdmin, galletaNormal, ids;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, { cuerpo, galleta } = {}) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(galleta ? { Cookie: galleta } : {}) },
  body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(8000),
});
const lote = (cuerpo, galleta = galletaAdmin) => pedir('POST', '/api/scraper/lote-datos', { galleta, cuerpo });
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const filas = () => {
  const d = new DatabaseSync(join(datos, 'tvwatch.db'), { readOnly: true });
  try { return ids.map((i) => d.prepare('SELECT title, studio, mpaa, collection, campos_fijados FROM items WHERE id = ?').get(i)); } finally { d.close(); }
};

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
  const nuevo = (t) => db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, year, studio, scanned_at) VALUES (1,'movie',?,?,?,2000,'Viejo','x') RETURNING id").get('p' + t, t, t.toLowerCase()).id;
  ids = [nuevo('Uno'), nuevo('Dos'), nuevo('Tres')];
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('un perfil normal no puede editar por lotes', async () => {
  assert.equal((await lote({ ids, cambios: { mpaa: '18' } }, galletaNormal)).status, 403);
  assert.deepEqual(filas().map((f) => f.mpaa), [null, null, null]);
});

test('el administrador cambia el mismo dato en varios títulos, sin tocar los demás', async () => {
  const r = await lote({ ids: [ids[0], ids[1]], cambios: { studio: ' Paramount ', mpaa: '16', collection: 'Saga X' } });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.hechos, 2);
  assert.deepEqual(j.fallos, []);
  const f = filas();
  for (const k of [0, 1]) {
    assert.deepEqual({ e: f[k].studio, m: f[k].mpaa, c: f[k].collection }, { e: 'Paramount', m: '16', c: 'Saga X' });
    for (const c of ['studio', 'mpaa', 'collection']) assert.ok(f[k].campos_fijados.split(',').includes(c), c);
  }
  assert.deepEqual({ e: f[2].studio, m: f[2].mpaa, c: f[2].collection, fijados: f[2].campos_fijados }, { e: 'Viejo', m: null, c: null, fijados: null }, 'el tercero queda igual');
});

test('null quita el dato en todos', async () => {
  assert.equal((await lote({ ids: [ids[0], ids[1]], cambios: { collection: null } })).status, 200);
  assert.deepEqual(filas().map((f) => f.collection), [null, null, null]);
});

test('se rechaza lo no permitido y no se cambia nada', async () => {
  const antes = JSON.stringify(filas());
  const malos = [
    { ids, cambios: { title: 'X' } }, { ids, cambios: { plot: 'x' } }, { ids, cambios: { genres: ['a'] } }, { ids, cambios: {} },
    { ids, cambios: { mpaa: 'x'.repeat(40) } }, { ids, cambios: { studio: 'a\nb' } }, { ids: [], cambios: { mpaa: '12' } },
    { ids: ['1'], cambios: { mpaa: '12' } }, { ids: Array.from({ length: 301 }, (_, i) => i + 1), cambios: { mpaa: '12' } }, { cambios: { mpaa: '12' } },
  ];
  for (const m of malos) assert.equal((await lote(m)).status, 400, JSON.stringify(m).slice(0, 60));
  assert.equal(JSON.stringify(filas()), antes);
});

test('un título que ya no existe se cuenta como fallo y el resto se aplica', async () => {
  const r = await (await lote({ ids: [ids[2], 999999, ids[2]], cambios: { mpaa: '7' } })).json();
  assert.equal(r.hechos, 1, 'el repetido cuenta una vez');
  assert.deepEqual(r.fallos.map((x) => x.id), [999999]);
  assert.equal(filas()[2].mpaa, '7');
});

test('cada título deja su instantánea y se deshace uno a uno', async () => {
  assert.equal((await pedir('POST', `/api/scraper/deshacer/${ids[2]}`, { galleta: galletaAdmin })).status, 200);
  assert.equal(filas()[2].mpaa, null);
});
