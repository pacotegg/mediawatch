/*
 * Comprobar que /api/progress marca una película como vista (watched = 1) cuando
 * la posición alcanza los créditos según pelicula_creditos, incluso si el tramo
 * comienza por debajo del umbral estándar del 90 %.
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
const datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let proceso;
let base;
let galleta;
let itemId;

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
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  const loginRes = await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } });
  galleta = galletaDe(loginRes);

  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  const lib = db.prepare("INSERT INTO libraries (name, path, kind) VALUES ('Pelis', '/tmp/pelis', 'movies') RETURNING id").get();
  const it = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, added_at, scanned_at) VALUES (?, 'movie', 'pelitest', 'Pelicula Test', 'pelicula test', '2026-01-01', '2026-01-01') RETURNING id").get(lib.id);
  itemId = it.id;
  db.prepare("INSERT INTO media_files (item_id, duration, size, path) VALUES (?, 6840, 1000000, 'test.mkv')").run(itemId);
  db.prepare("INSERT INTO pelicula_creditos (item_id, rangos, escenas, metodo, created_at) VALUES (?, '[{\"start_s\":6140,\"end_s\":6840}]', '[]', 'texto-sube', 'x')").run(itemId);
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) {
    proceso.kill();
    await new Promise((r) => proceso.once('exit', r));
  }
  await esperar(200);
  try {
    rmSync(datos, { recursive: true, force: true });
  } catch { /* ignorar lock en windows */ }
});

test('posicion antes de los creditos (< 89%): watched sigue en 0', async () => {
  const res = await pedir('POST', '/api/progress', {
    galleta,
    cuerpo: { itemId, position: 5000, duration: 6840 },
  });
  assert.equal(res.status, 200);

  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  const prog = db.prepare('SELECT watched FROM progress WHERE item_id = ?').get(itemId);
  db.close();
  assert.equal(prog.watched, 0);
});

test('posicion en creditos de pelicula (6140s, 89.7% < 90%): se marca watched = 1', async () => {
  const res = await pedir('POST', '/api/progress', {
    galleta,
    cuerpo: { itemId, position: 6141, duration: 6840 },
  });
  assert.equal(res.status, 200);

  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  const prog = db.prepare('SELECT watched FROM progress WHERE item_id = ?').get(itemId);
  db.close();
  assert.equal(prog.watched, 1);
});
