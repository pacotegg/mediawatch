/*
 * Plex entrega sus webhooks como multipart/form-data (un campo `payload` con el JSON y a veces un `thumb` con la imagen).
 * El 26/10/2026 el log de Plex mostraba que TODAS las entregas a /api/plex/webhook recibian un 400: la prueba de la funcion
 * suelta no pasa por la ruta HTTP ni por el tratamiento del multipart. Servidor real en modo portable con datos temporales.
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
let proceso, datos, base, itemId;
const RUTA = 'C:/no/existe/Plex Peli (2020)/Plex Peli (2020) 1080p AC3.mkv';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});

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
  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
  itemId = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie','p','Plex Peli','plex peli','x') RETURNING id").get().id;
  db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,5400,1)').run(itemId, RUTA);
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

const progreso = () => {
  const db = new DatabaseSync(join(datos, 'tvwatch.db'), { readOnly: true });
  try { return db.prepare('SELECT position, watched FROM progress WHERE user_id = 1 AND item_id = ? AND episode_id IS NULL').get(itemId); } finally { db.close(); }
};
const evento = (event, extra = {}) => ({ event, Account: { id: 1 }, Metadata: { ratingKey: 7, duration: 5400000, Media: [{ Part: [{ file: RUTA }] }], ...extra } });

// Como lo manda Plex: campo `payload` con el JSON y un `thumb` binario detras.
const comoPlex = (obj) => {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(obj));
  fd.append('thumb', new Blob([Buffer.alloc(4096, 7)], { type: 'image/jpeg' }), 'poster.jpg');
  return fetch(base + '/api/plex/webhook', { method: 'POST', body: fd, signal: AbortSignal.timeout(8000) });
};

test('el webhook acepta el multipart de Plex (antes: 400 en todas las entregas)', async () => {
  const r = await comoPlex(evento('media.play'));
  assert.equal(r.status, 200, await r.text());
});

test('un media.scrobble por multipart marca la pelicula como vista en Media Watch', async () => {
  const r = await comoPlex(evento('media.scrobble'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true, JSON.stringify(j));
  assert.deepEqual({ ...progreso() }, { position: 5400, watched: 1 });
});

test('un media.stop a mitad guarda la posicion; tambien con el JSON a pelo', async () => {
  const r = await fetch(base + '/api/plex/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evento('media.stop', { viewOffset: 1800000 })), signal: AbortSignal.timeout(8000) });
  assert.equal(r.status, 200);
  assert.deepEqual({ ...progreso() }, { position: 1800, watched: 0 });
});

test('desde fuera de casa el webhook sigue cerrado', async () => {
  const r = await fetch(base + '/api/plex/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '8.8.8.8' }, body: '{}', signal: AbortSignal.timeout(8000) });
  assert.ok([401, 403].includes(r.status), String(r.status));
});
