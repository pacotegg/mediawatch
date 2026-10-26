/*
 * Editar los datos de una película a mano desde la ficha (como el diálogo de editar de Plex): título, título de orden, título
 * original, año, lema, sinopsis, estudio, calificación por edades, géneros y saga. Solo administrador, con validación, y cada
 * cambio se puede deshacer con la instantánea del scraper. Lo editado queda en `campos_fijados` para que el escáner no lo pise.
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
let proceso, datos, base, galletaAdmin, galletaNormal, id;

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
const editar = (cuerpo, galleta = galletaAdmin) => pedir('POST', `/api/items/${id}/metadatos`, { galleta, cuerpo });
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const fila = () => {
  const d = new DatabaseSync(join(datos, 'tvwatch.db'), { readOnly: true });
  try {
    const it = d.prepare('SELECT title, search_title, sort_title, original_title, year, tagline, plot, studio, mpaa, collection, campos_fijados FROM items WHERE id = ?').get(id);
    const generos = d.prepare('SELECT g.name FROM item_genres ig JOIN genres g ON g.id = ig.genre_id WHERE ig.item_id = ? ORDER BY g.name').all(id).map((x) => x.name);
    return { ...it, generos };
  } finally { d.close(); }
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
  id = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, year, plot, mpaa, scanned_at) VALUES (1,'movie','p','Romulus','romulus',2024,'Sinopsis vieja','12','x') RETURNING id").get().id;
  const g = db.prepare("INSERT INTO genres (name) VALUES ('Terror') RETURNING id").get().id;
  db.prepare('INSERT INTO item_genres (item_id, genre_id) VALUES (?,?)').run(id, g);
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('un perfil normal no puede editar los datos', async () => {
  assert.equal((await editar({ title: 'Hackeado' }, galletaNormal)).status, 403);
  assert.equal(fila().title, 'Romulus');
});

test('el administrador edita varios campos a la vez y quedan fijados', async () => {
  const r = await editar({ title: '  Alien:   Romulus ', sort_title: 'Alien 7', original_title: 'Alien: Romulus', year: 2024, tagline: 'Un lema', plot: 'Sinopsis\nnueva', studio: '20th Century Studios', mpaa: '16', collection: 'Alien - Colección', genres: ['Terror', 'Ciencia ficción', 'terror'] });
  assert.equal(r.status, 200, await r.text());
  const f = fila();
  assert.equal(f.title, 'Alien: Romulus');
  assert.equal(f.search_title, 'alien romulus', 'el título de búsqueda sigue al título');
  assert.deepEqual({ sort: f.sort_title, orig: f.original_title, anio: f.year, lema: f.tagline, sin: f.plot, est: f.studio, edad: f.mpaa, saga: f.collection }, { sort: 'Alien 7', orig: 'Alien: Romulus', anio: 2024, lema: 'Un lema', sin: 'Sinopsis\nnueva', est: '20th Century Studios', edad: '16', saga: 'Alien - Colección' });
  assert.deepEqual(f.generos, ['Ciencia ficción', 'Terror'], 'sin repetidos aunque cambie la capitalización');
  for (const c of ['title', 'sort_title', 'original_title', 'year', 'tagline', 'plot', 'studio', 'mpaa', 'collection', 'genres']) assert.ok(f.campos_fijados.split(',').includes(c), c);
});

test('un texto vacío o null quita el dato (y sigue fijado)', async () => {
  const r = await editar({ tagline: '', sort_title: null, collection: null, genres: [] });
  assert.equal(r.status, 200, await r.text());
  const f = fila();
  assert.deepEqual({ lema: f.tagline, sort: f.sort_title, saga: f.collection, generos: f.generos }, { lema: null, sort: null, saga: null, generos: [] });
});

test('se rechazan datos no válidos y no se cambia nada', async () => {
  const antes = JSON.stringify(fila());
  const malos = [{ title: '' }, { title: null }, { title: 'a\nb' }, { title: 'x'.repeat(300) }, { year: 1500 }, { year: 'dos mil' }, { year: 2024.5 }, { plot: 'x'.repeat(6000) },
    { collection: 'a\tb' }, { genres: 'Terror' }, { genres: [1] }, { genres: Array.from({ length: 30 }, (_, i) => 'G' + i) }, { desconocido: 'x' }, {}];
  for (const m of malos) assert.equal((await editar(m)).status, 400, JSON.stringify(m).slice(0, 40));
  assert.equal(JSON.stringify(fila()), antes);
});

test('un título que no existe da 404', async () => {
  assert.equal((await pedir('POST', '/api/items/999999/metadatos', { galleta: galletaAdmin, cuerpo: { title: 'X' } })).status, 404);
});

test('cada edición deja una instantánea y deshacer devuelve el estado anterior', async () => {
  assert.equal((await editar({ title: 'Otro título', genres: ['Drama'] })).status, 200);
  assert.equal(fila().title, 'Otro título');
  const r = await pedir('POST', `/api/scraper/deshacer/${id}`, { galleta: galletaAdmin, cuerpo: {} });
  assert.equal(r.status, 200, await r.text());
  const f = fila();
  assert.equal(f.title, 'Alien: Romulus');
  assert.deepEqual(f.generos, [], 'los géneros vuelven a los de antes');
});
