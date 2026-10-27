/*
 * Todas las fuentes de un titulo a la vez y aplicar eligiendo de cual toma cada dato. Servidor real contra un OMDb y un TVmaze FALSOS en
 * local (MEDIAWATCH_OMDB_URL / MEDIAWATCH_TVMAZE_URL); sin claves de TMDb ni TVDB, que se avisan como «sin clave» y no estorban.
 * Solo administrador, cada dato de la fuente elegida, una sola instantanea, y nada de lo que mande el cliente se usa como direccion.
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
let proceso, datos, base, omdb, tvmaze, galletaAdmin, galletaNormal, id, urlTvmaze;

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const OMDB = { Title: 'Breaking Bad', Year: '2008–2013', Rated: 'TV-MA', Runtime: '49 min', Genre: 'Crime, Drama, Thriller', Plot: 'A chemistry teacher turns to crime.', Country: 'United States', Poster: 'N/A', imdbRating: '9.5', imdbVotes: '2,000,000', imdbID: 'tt0903747', Response: 'True' };

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
  signal: AbortSignal.timeout(15000),
});
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const fichas = (cuerpo, galleta = galletaAdmin) => pedir('POST', '/api/scraper/fuentes-ficha', { galleta, cuerpo });
const mezclar = (cuerpo, galleta = galletaAdmin) => pedir('POST', '/api/scraper/aplicar-mezcla', { galleta, cuerpo });
const fila = () => {
  const d = new DatabaseSync(join(datos, 'tvwatch.db'), { readOnly: true });
  try {
    const it = d.prepare('SELECT title, plot, rating, mpaa, imdb_id, poster, arte_fijado FROM items WHERE id = ?').get(id);
    const generos = d.prepare('SELECT g.name FROM item_genres ig JOIN genres g ON g.id = ig.genre_id WHERE ig.item_id = ? ORDER BY g.name').all(id).map((x) => x.name);
    const instantaneas = d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%instant%'").get().n;
    return { ...it, generos, instantaneas };
  } finally { d.close(); }
};

before(async () => {
  omdb = servidor((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(u.searchParams.get('i') === 'tt0903747' ? OMDB : { Response: 'False', Error: 'Incorrect IMDb ID.' }));
  });
  await new Promise((r) => omdb.listen(0, '127.0.0.1', r));
  tvmaze = servidor((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/lookup/shows') {
      if (u.searchParams.get('imdb') !== 'tt0903747') { res.statusCode = 404; return res.end('{}'); }
      res.statusCode = 301; res.setHeader('Location', '/shows/169'); return res.end();
    }
    if (u.pathname === '/shows/169') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ id: 169, url: 'https://www.tvmaze.com/shows/169/breaking-bad', name: 'Breaking Bad', premiered: '2008-01-20', summary: '<p><b>Breaking Bad</b> follows a teacher &amp; his past.</p>', genres: ['Drama', 'Crime'], runtime: 60, rating: { average: 9.2 }, image: { original: urlTvmaze + '/poster.png' } }));
    }
    if (u.pathname === '/poster.png') { res.setHeader('Content-Type', 'image/png'); return res.end(PNG); }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => tvmaze.listen(0, '127.0.0.1', r));
  urlTvmaze = `http://127.0.0.1:${tvmaze.address().port}`;
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  writeFileSync(join(datos, 'config.json'), JSON.stringify({ omdbApiKey: 'clave-falsa' }));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER, stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto), MEDIAWATCH_OMDB_URL: `http://127.0.0.1:${omdb.address().port}/`, MEDIAWATCH_TVMAZE_URL: urlTvmaze },
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
  db.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'s','x','show')").run();
  id = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, year, plot, scanned_at) VALUES (1,'show','p','Breaking Bad','breaking bad',2008,'Sinopsis en español','x') RETURNING id").get().id;
  const g = db.prepare("INSERT INTO genres (name) VALUES ('Drama') RETURNING id").get().id;
  db.prepare('INSERT INTO item_genres (item_id, genre_id) VALUES (?,?)').run(id, g);
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  omdb?.close(); tvmaze?.close();
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('un perfil normal no puede consultar ni aplicar', async () => {
  assert.equal((await fichas({ kind: 'show', imdbId: 'tt0903747' }, galletaNormal)).status, 403);
  assert.equal((await mezclar({ itemId: id, kind: 'show', imdbId: 'tt0903747', elecciones: { rating: 'omdb' } }, galletaNormal)).status, 403);
  assert.equal(fila().rating, null);
});

test('las fuentes responden juntas, cada ficha con su procedencia e idioma, y las que faltan se avisan', async () => {
  const r = await (await fichas({ kind: 'show', imdbId: 'tt0903747' })).json();
  const por = Object.fromEntries(r.fichas.map((f) => [f.fuente, f]));
  assert.deepEqual(Object.keys(por).sort(), ['omdb', 'tvmaze']);
  assert.deepEqual({ i: por.omdb.idioma, n: por.omdb.rating, e: por.omdb.certificacion, g: por.omdb.genres }, { i: 'en', n: 9.5, e: 'US:TV-MA', g: ['Crime', 'Drama', 'Thriller'] });
  assert.deepEqual({ i: por.tvmaze.idioma, n: por.tvmaze.rating, id: por.tvmaze.id, p: por.tvmaze.overview }, { i: 'en', n: 9.2, id: '169', p: 'Breaking Bad follows a teacher & his past.' }, 'el HTML de la sinopsis se limpia y la redirección se sigue');
  assert.ok(r.avisos.some((a) => /TMDb/.test(a)), 'sin clave de TMDb se avisa');
  assert.equal(r.ids.imdbId, 'tt0903747');
});

test('una película no consulta TVmaze, y sin ids o con un id mal formado se rechaza', async () => {
  const peli = await (await fichas({ kind: 'movie', imdbId: 'tt0903747' })).json();
  assert.deepEqual(peli.fichas.map((f) => f.fuente), ['omdb']);
  for (const m of [{ kind: 'show' }, { kind: 'show', imdbId: '603' }, { kind: 'otra', imdbId: 'tt0903747' }, { imdbId: 'tt0903747' }]) assert.equal((await fichas(m)).status, 400, JSON.stringify(m));
});

test('cada dato sale de la fuente elegida; los géneros se sustituyen; el resto no se toca', async () => {
  const r = await mezclar({ itemId: id, kind: 'show', imdbId: 'tt0903747', elecciones: { rating: 'omdb', mpaa: 'omdb', plot: 'tvmaze', genres: 'tvmaze' } });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual(j.aplicado, [{ campo: 'rating', fuente: 'omdb' }, { campo: 'mpaa', fuente: 'omdb' }, { campo: 'plot', fuente: 'tvmaze' }, { campo: 'genres', fuente: 'tvmaze' }]);
  const f = fila();
  assert.deepEqual({ n: f.rating, e: f.mpaa, p: f.plot, g: f.generos, t: f.title, i: f.imdb_id }, { n: 9.5, e: 'US:TV-MA', p: 'Breaking Bad follows a teacher & his past.', g: ['Crime', 'Drama'], t: 'Breaking Bad', i: 'tt0903747' });
});

test('el cartel se baja de la fuente elegida y queda fijado', async () => {
  const r = await mezclar({ itemId: id, kind: 'show', imdbId: 'tt0903747', elecciones: { poster: 'tvmaze' } });
  assert.equal(r.status, 200, await r.clone().text());
  const f = fila();
  assert.ok(f.poster, 'hay cartel');
  assert.ok(f.arte_fijado.split(',').includes('poster'));
});

test('pedir un dato a una fuente que no lo tiene, o una elección mal hecha, da error y no escribe', async () => {
  const antes = JSON.stringify(fila());
  assert.equal((await mezclar({ itemId: id, kind: 'show', imdbId: 'tt0903747', elecciones: { fanart: 'tvmaze' } })).status, 400, 'TVmaze no tiene fondo');
  assert.equal((await mezclar({ itemId: id, kind: 'show', imdbId: 'tt0903747', elecciones: { rating: 'tmdb' } })).status, 400, 'TMDb no respondió (sin clave)');
  const malas = [{}, { rating: 'imdb' }, { titulo: 'omdb' }, { poster: 'http://evil/x.png' }, null];
  for (const e of malas) assert.equal((await mezclar({ itemId: id, kind: 'show', imdbId: 'tt0903747', elecciones: e })).status, 400, JSON.stringify(e));
  assert.equal((await mezclar({ itemId: 'x', kind: 'show', imdbId: 'tt0903747', elecciones: { rating: 'omdb' } })).status, 400);
  assert.equal((await mezclar({ itemId: 999999, kind: 'show', imdbId: 'tt0903747', elecciones: { rating: 'omdb' } })).status, 404);
  assert.equal(JSON.stringify(fila()), antes);
});

test('de la mezcla se deshace de una vez', async () => {
  const r = await mezclar({ itemId: id, kind: 'show', imdbId: 'tt0903747', elecciones: { plot: 'omdb' } });
  assert.equal(r.status, 200);
  assert.equal(fila().plot, 'A chemistry teacher turns to crime.');
  assert.equal((await pedir('POST', `/api/scraper/deshacer/${id}`, { galleta: galletaAdmin })).status, 200);
  assert.equal(fila().plot, 'Breaking Bad follows a teacher & his past.', 'un solo deshacer devuelve el estado anterior a esa aplicación');
});
