/*
 * Media Watch -> Plex: cada vez que el perfil 1 guarda progreso o marca algo como visto, se avisa a la API local de Plex
 * (/:/progress o /:/scrobble) con la clave de la pelicula que sale de la base de Plex. Todo hermetico: una base de Plex
 * falsa, un token falso y un receptor local en lugar de Plex, para no tocar el visionado real de nadie.
 * Sin las claves `plex*` en config.json (como quedo el 26/10/2026 tras sacarlas del codigo) no se avisa a nadie.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as servidorHttp } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA = 'C:/no/existe/Plex Peli (2020)/Plex Peli (2020) 1080p AC3.mkv';
const RATING_KEY = 4242;
const TOKEN = 'token-falso-de-prueba';
let proceso, receptor, datos, base, galleta, itemId;
const recibidas = [];

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const llegada = async (filtro) => {
  for (let i = 0; i < 30; i++) { const r = recibidas.find(filtro); if (r) return r; await esperar(100); }
  return null;
};

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  const puertoPlex = await puertoLibre();
  receptor = servidorHttp((req, res) => { recibidas.push({ metodo: req.method, url: new URL(req.url, 'http://x') }); res.end('ok'); });
  await new Promise((r) => receptor.listen(puertoPlex, '127.0.0.1', r));

  // Base de Plex falsa con lo minimo que consulta buscarRatingKeyPlex.
  mkdirSync(datos, { recursive: true });
  const plexDb = join(datos, 'plex-falso.db');
  const p = new DatabaseSync(plexDb);
  p.exec('CREATE TABLE metadata_items (id INTEGER PRIMARY KEY, guid TEXT); CREATE TABLE media_items (id INTEGER PRIMARY KEY, metadata_item_id INTEGER); CREATE TABLE media_parts (id INTEGER PRIMARY KEY, media_item_id INTEGER, file TEXT);');
  p.prepare("INSERT INTO metadata_items (id, guid) VALUES (?, 'plex://movie/x')").run(RATING_KEY);
  p.prepare('INSERT INTO media_items (id, metadata_item_id) VALUES (1, ?)').run(RATING_KEY);
  p.prepare('INSERT INTO media_parts (id, media_item_id, file) VALUES (1, 1, ?)').run(RUTA);
  p.close();
  writeFileSync(join(datos, 'token-falso.txt'), TOKEN + '\r\n');
  writeFileSync(join(datos, 'config.json'), JSON.stringify({ plexDb, plexTokenFile: join(datos, 'token-falso.txt'), plexBaseUrl: `http://127.0.0.1:${puertoPlex}` }));

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
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 1, pin: '654321' }) });
  galleta = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
  itemId = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie','p','Plex Peli','plex peli','x') RETURNING id").get().id;
  db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,5400,1)').run(itemId, RUTA);
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  receptor?.close();
  if (datos) rmSync(datos, { recursive: true, force: true });
});

const post = (ruta, cuerpo) => fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: galleta }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(8000) });

test('guardar progreso a mitad avisa a Plex con /:/progress, la clave de la pelicula y la posicion en ms', async () => {
  assert.equal((await post('/api/progress', { itemId, position: 1200, duration: 5400 })).status, 200);
  const r = await llegada((x) => x.url.pathname === '/:/progress');
  assert.ok(r, 'Plex no recibio nada: ' + JSON.stringify(recibidas.map((x) => x.url.pathname)));
  assert.equal(r.metodo, 'PUT');
  assert.equal(r.url.searchParams.get('key'), String(RATING_KEY));
  assert.equal(r.url.searchParams.get('time'), '1200000');
  assert.equal(r.url.searchParams.get('X-Plex-Token'), TOKEN, 'el token se lee del fichero y sin el salto de linea');
  assert.equal(r.url.searchParams.get('identifier'), 'com.plexapp.plugins.library');
});

test('marcar como vista avisa a Plex con /:/scrobble', async () => {
  assert.equal((await post(`/api/items/${itemId}/watched`, { watched: true })).status, 200);
  const r = await llegada((x) => x.url.pathname === '/:/scrobble');
  assert.ok(r, 'Plex no recibio el scrobble');
  assert.equal(r.metodo, 'GET');
  assert.equal(r.url.searchParams.get('key'), String(RATING_KEY));
});
