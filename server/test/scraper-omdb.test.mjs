/*
 * OMDb como segunda fuente del scraper: buscar por titulo o id de IMDb y aplicar sus datos. Servidor real contra un OMDb FALSO en local
 * (MEDIAWATCH_OMDB_URL), para no gastar el cupo ni depender de la red. Solo administrador, solo los campos permitidos, solo huecos
 * salvo `overwrite`, y se deshace desde el historial.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as servidor } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, falso, galletaAdmin, galletaNormal, id, consultas;

const FICHAS = {
  tt0133093: { Title: 'The Matrix', Year: '1999', Rated: 'R', Runtime: '136 min', Genre: 'Action, Sci-Fi', Director: 'Lana Wachowski, Lilly Wachowski', Plot: 'A hacker learns the truth.', Country: 'United States', Poster: 'N/A', imdbRating: '8.7', imdbVotes: '2,100,000', imdbID: 'tt0133093', Response: 'True' },
  tt0234215: { Title: 'The Matrix Reloaded', Year: '2003', Rated: 'Not Rated', Runtime: 'N/A', Genre: 'Action', Director: 'N/A', Plot: 'N/A', Country: 'United States', Poster: 'N/A', imdbRating: 'N/A', imdbVotes: 'N/A', imdbID: 'tt0234215', Response: 'True' },
};

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
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const buscar = (cuerpo, galleta = galletaAdmin) => pedir('POST', '/api/scraper/resolver-omdb', { galleta, cuerpo });
const aplicar = (cuerpo, galleta = galletaAdmin) => pedir('POST', '/api/scraper/aplicar-omdb', { galleta, cuerpo });
const fila = () => {
  const d = new DatabaseSync(join(datos, 'tvwatch.db'), { readOnly: true });
  try {
    const it = d.prepare('SELECT title, year, plot, rating, imdb_id, mpaa FROM items WHERE id = ?').get(id);
    const generos = d.prepare('SELECT g.name FROM item_genres ig JOIN genres g ON g.id = ig.genre_id WHERE ig.item_id = ? ORDER BY g.name').all(id).map((x) => x.name);
    return { ...it, generos };
  } finally { d.close(); }
};

before(async () => {
  consultas = [];
  falso = servidor((req, res) => {
    const u = new URL(req.url, 'http://x');
    consultas.push(u.search);
    const salida = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.searchParams.get('apikey') !== 'clave-falsa') return salida({ Response: 'False', Error: 'Invalid API key!' });
    const i = u.searchParams.get('i');
    if (i) return salida(FICHAS[i] ?? { Response: 'False', Error: 'Incorrect IMDb ID.' });
    const s = u.searchParams.get('s');
    if (/matrix/i.test(s ?? '')) return salida({ Response: 'True', Search: [{ imdbID: 'tt0133093' }, { imdbID: 'tt0234215' }] });
    return salida({ Response: 'False', Error: 'Movie not found!' });
  });
  await new Promise((r) => falso.listen(0, '127.0.0.1', r));
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  writeFileSync(join(datos, 'config.json'), JSON.stringify({ omdbApiKey: 'clave-falsa' }));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER, stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto), MEDIAWATCH_OMDB_URL: `http://127.0.0.1:${falso.address().port}/` },
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
  id = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, year, plot, scanned_at) VALUES (1,'movie','p','Matrix','matrix',1999,'Sinopsis en español','x') RETURNING id").get().id;
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  falso?.close();
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('un perfil normal no puede buscar ni aplicar', async () => {
  assert.equal((await buscar({ entrada: 'matrix', kind: 'movie' }, galletaNormal)).status, 403);
  assert.equal((await aplicar({ itemId: id, imdbId: 'tt0133093', kind: 'movie', fields: ['rating'] }, galletaNormal)).status, 403);
  assert.equal(fila().rating, null);
});

test('buscar por título devuelve propuestas con la misma forma que TMDb y marcadas como de OMDb', async () => {
  const r = await (await buscar({ entrada: 'matrix', kind: 'movie' })).json();
  assert.equal(r.propuestas.length, 2);
  const m = r.propuestas[0];
  assert.deepEqual({ f: m.fuente, t: m.title, a: m.year, n: m.rating, g: m.genres, e: m.certificacion, i: m.imdbId, rt: m.runtime, d: m.directores, p: m.overview, poster: m.posterUrl },
    { f: 'omdb', t: 'The Matrix', a: 1999, n: 8.7, g: ['Action', 'Sci-Fi'], e: 'R', i: 'tt0133093', rt: 136, d: ['Lana Wachowski', 'Lilly Wachowski'], p: 'A hacker learns the truth.', poster: null });
  const otra = r.propuestas[1];
  assert.deepEqual({ n: otra.rating, e: otra.certificacion, p: otra.overview, rt: otra.runtime }, { n: null, e: null, p: null, rt: null }, 'N/A y «Not Rated» no son datos');
});

test('buscar por id de IMDb, y sin resultados o con id de TMDb da un aviso en vez de error', async () => {
  const porId = await (await buscar({ entrada: 'https://www.imdb.com/title/tt0133093/', kind: 'movie' })).json();
  assert.equal(porId.propuestas[0].imdbId, 'tt0133093');
  const nada = await (await buscar({ entrada: 'zzzz', kind: 'movie' })).json();
  assert.deepEqual(nada.propuestas, []);
  assert.match(nada.aviso, /no encuentra/i);
  const tmdb = await (await buscar({ entrada: 'tmdb:603', kind: 'movie' })).json();
  assert.deepEqual(tmdb.propuestas, []);
  assert.match(tmdb.aviso, /TMDb/);
});

test('aplicar rellena solo huecos: no pisa la sinopsis existente ni cambia título ni año', async () => {
  const r = await aplicar({ itemId: id, imdbId: 'tt0133093', kind: 'movie', fields: ['plot', 'rating', 'genres'] });
  assert.equal(r.status, 200, await r.clone().text());
  const f = fila();
  assert.equal(f.plot, 'Sinopsis en español', 'la sinopsis que ya había se queda');
  assert.equal(f.rating, 8.7);
  assert.equal(f.imdb_id, 'tt0133093');
  assert.deepEqual(f.generos, ['Action', 'Sci-Fi']);
  assert.deepEqual({ t: f.title, a: f.year }, { t: 'Matrix', a: 1999 }, 'OMDb no toca la identidad');
});

test('con overwrite sí pisa, y deshacer lo devuelve', async () => {
  assert.equal((await aplicar({ itemId: id, imdbId: 'tt0133093', kind: 'movie', fields: ['plot'], overwrite: true })).status, 200);
  assert.equal(fila().plot, 'A hacker learns the truth.');
  assert.equal((await pedir('POST', `/api/scraper/deshacer/${id}`, { galleta: galletaAdmin })).status, 200);
  assert.equal(fila().plot, 'Sinopsis en español');
});

test('se rechazan campos no permitidos o datos mal formados y no se cambia nada', async () => {
  const antes = JSON.stringify(fila());
  const malos = [
    { itemId: id, imdbId: 'tt0133093', kind: 'movie', fields: ['title'] }, { itemId: id, imdbId: 'tt0133093', kind: 'movie', fields: ['fanart'] },
    { itemId: id, imdbId: 'tt0133093', kind: 'movie', fields: [] }, { itemId: id, imdbId: 'tt0133093', kind: 'movie' },
    { itemId: id, imdbId: '603', kind: 'movie', fields: ['plot'] }, { itemId: 'x', imdbId: 'tt0133093', kind: 'movie', fields: ['plot'] }, { itemId: id, imdbId: 'tt0133093', kind: 'otro', fields: ['plot'] },
  ];
  for (const m of malos) assert.equal((await aplicar(m)).status, 400, JSON.stringify(m).slice(0, 60));
  assert.equal(JSON.stringify(fila()), antes);
});

test('un título que ya no existe, o una ficha que OMDb no tiene, dan error y no escriben', async () => {
  assert.notEqual((await aplicar({ itemId: 999999, imdbId: 'tt0133093', kind: 'movie', fields: ['rating'] })).status, 200);
  assert.notEqual((await aplicar({ itemId: id, imdbId: 'tt9999999', kind: 'movie', fields: ['rating'], overwrite: true })).status, 200);
  assert.equal(fila().rating, 8.7);
});
