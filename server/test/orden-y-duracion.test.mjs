/*
 * 1) «Alfabético pero en orden de estreno»: las películas de una misma colección van juntas, en la posición alfabética de
 *    la primera de la saga y por año dentro de ella (Alien, Aliens, Alien³, Covenant…, no Alien, Covenant, Resurrection,
 *    Aliens, Alien³). El abecedario usa esa misma posición: «El imperio contraataca» cuelga de la S de Star Wars, no de la E.
 * 2) La duración de una película sale del FICHERO: la ficha de El Conjuro decía 223 min y el fichero dura 112 (26/10/2026).
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
let proceso, datos, base, galleta;
const ids = {};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const get = async (ruta) => (await fetch(base + ruta, { headers: { Cookie: galleta }, signal: AbortSignal.timeout(8000) })).json();

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
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 1, pin: '654321' }) });
  galleta = (login.headers.get('set-cookie') ?? '').split(';')[0];

  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
  const peli = (titulo, anio, coleccion, runtime = 100) => {
    const id = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, year, collection, runtime, scanned_at) VALUES (1,'movie',?,?,?,?,?,?,'x') RETURNING id")
      .get('p/' + titulo, titulo, titulo.toLowerCase(), anio, coleccion, runtime).id;
    ids[titulo] = id;
    return id;
  };
  peli('Alien: Covenant', 2017, 'Alien - Colección');
  peli('Zeta', 2000, null);
  peli('Alicia', 2001, null);
  peli('Star Wars', 1977, 'Star Wars - Colección');
  peli('Aliens: El regreso', 1986, 'Alien - Colección');
  peli('El imperio contraataca', 1980, 'Star Wars - Colección');
  peli('Alien³', 1992, 'Alien - Colección');
  peli('Bola de dragón', 1986, '');
  peli('Alien, el octavo pasajero', 1979, 'Alien - Colección');
  const conjuro = peli('Warren, el conjuro', 2013, null, 223);
  const sinFichero = peli('Xx sin fichero', 1999, null, 90);
  db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,6718.08,1)').run(conjuro, 'C:/no/existe/warren.mkv');
  ids.sinFichero = sinFichero;
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

const titulos = (r) => r.items.map((x) => x.title).filter((t) => !['Warren, el conjuro', 'Xx sin fichero'].includes(t));

test('por título: alfabético por saga y por año dentro de cada saga', async () => {
  const r = await get('/api/items?library=1&sort=title&limit=100');
  assert.deepEqual(titulos(r), [
    'Alicia',
    'Alien, el octavo pasajero', 'Aliens: El regreso', 'Alien³', 'Alien: Covenant',
    'Bola de dragón',
    'Star Wars', 'El imperio contraataca',
    'Zeta',
  ]);
});

test('Z-A invierte las sagas pero dentro de cada una sigue el orden de estreno', async () => {
  const r = await get('/api/items?library=1&sort=title_desc&limit=100');
  assert.deepEqual(titulos(r), [
    'Zeta',
    'Star Wars', 'El imperio contraataca',
    'Bola de dragón',
    'Alien, el octavo pasajero', 'Aliens: El regreso', 'Alien³', 'Alien: Covenant',
    'Alicia',
  ]);
});

test('el abecedario cuenta cada saga bajo la letra de su primera película', async () => {
  const filas = (await get('/api/items?library=1&sort=title&limit=100')).items.map((x) => x.title);
  const r = await get('/api/items/letras?library=1');
  const letras = Object.fromEntries(r.letras.map((l) => [l.letra, l.offset]));
  assert.equal(letras.E, undefined, 'El imperio contraataca no abre la letra E');
  assert.equal(filas[letras.A], 'Alicia');
  assert.equal(filas[letras.B], 'Bola de dragón');
  assert.equal(filas[letras.S], 'Star Wars');
  assert.equal(filas[letras.Z], 'Zeta');
});

test('la duración de una película sale del fichero (223 min en la ficha, 112 el fichero)', async () => {
  const lista = await get('/api/items?library=1&sort=title&limit=100');
  assert.equal(lista.items.find((x) => x.title === 'Warren, el conjuro').runtime, 112);
  const ficha = await get(`/api/items/${ids['Warren, el conjuro']}`);
  assert.equal(ficha.runtime, 112);
  // Xx sin fichero medido se queda lo que diga la ficha.
  assert.equal(lista.items.find((x) => x.title === 'Xx sin fichero').runtime, 90);
});

test('filtrar por duración y ordenar por ella usan también la del fichero', async () => {
  const medias = await get('/api/items?library=1&runtime=medium&limit=100');
  assert.ok(medias.items.some((x) => x.title === 'Warren, el conjuro'), '112 min es «90–120», no «más de 120»');
  const largas = await get('/api/items?library=1&runtime=long&limit=100');
  assert.ok(!largas.items.some((x) => x.title === 'Warren, el conjuro'));
});
