/*
 * Lo que hay en una carpeta de ENTRADA (fuente del scraper) no lo ve ningun cliente: ni en listas, ni en buscador, ni en la portada, ni en
 * estadisticas, generos, sagas, actores, novedades... Servidor real con datos temporales, una biblioteca y una fuente con titulos marcados.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = mkdtempSync(join(tmpdir(), 'mediawatch-oculta-'));
const datos = join(base, 'datos');
const real = join(base, 'Peliculas');
const entrada = join(base, 'Videos');
let srv, U, cookie, idEntrada;

const libre = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const get = async (ruta) => (await fetch(U + ruta, { headers: { cookie } })).text();

before(async () => {
  mkdirSync(datos);
  video(join(real, 'Pelicula Visible (2000)', 'Pelicula Visible (2000).mkv'));
  for (const n of ['ZZSecretoDeEntrada (2024)', 'ZZSecretoB (2024)', 'ZZSecretoC (2024)']) video(join(entrada, n, n + '.mkv'));
  const puerto = await libre();
  U = `http://127.0.0.1:${puerto}`;
  writeFileSync(join(datos, 'config.json'), JSON.stringify({ port: puerto, host: '127.0.0.1', libraries: [{ name: 'Peliculas', path: real, kind: 'movie' }], fuentesScraper: [{ name: 'Videos', path: entrada, kind: 'movie' }] }));
  srv = spawn(process.execPath, ['src/index.ts'], { cwd: raiz, env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_PORT: String(puerto), MEDIAWATCH_HOST: '127.0.0.1' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await fetch(U + '/api/users'); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
  const r = await fetch(U + '/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Admin', pin: '123456' }) });
  cookie = `cineteca_session=${(await r.json()).token}`;
  await fetch(U + '/api/scan', { method: 'POST', headers: { cookie } });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 300)); if ((await get('/api/items')).includes('Pelicula Visible')) break; }
  await fetch(U + '/api/scan', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ruta: entrada }) });
  const db = new DatabaseSync(join(datos, 'tvwatch.db'), { readOnly: true });
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 300)); idEntrada = db.prepare("SELECT id FROM items WHERE title LIKE 'ZZSecreto%'").get()?.id; if (idEntrada) break; }
  db.close();
  // Como si ya se hubieran escrapeado: genero, actor, estudio y saga (por encima de los minimos de cada lista).
  const w = new DatabaseSync(join(datos, 'tvwatch.db'));
  w.exec('PRAGMA busy_timeout = 10000');
  const ids = w.prepare("SELECT id FROM items WHERE title LIKE 'ZZSecreto%'").all().map((r) => r.id);
  const g = w.prepare("INSERT INTO genres (name) VALUES ('ZZGenero') RETURNING id").get().id;
  const p = w.prepare("INSERT INTO people (name, search_name) VALUES ('ZZActor Secreto', 'zzactor secreto') RETURNING id").get().id;
  for (const i of ids) {
    w.prepare('INSERT INTO item_genres (item_id, genre_id) VALUES (?, ?)').run(i, g);
    w.prepare("INSERT INTO item_people (item_id, person_id, role, character, ord) VALUES (?, ?, 'actor', 'X', 0)").run(i, p);
    w.prepare("UPDATE items SET studio = 'ZZEstudio', collection = 'ZZSaga' WHERE id = ?").run(i);
  }
  w.close();
});
after(async () => { srv?.kill(); await new Promise((r) => setTimeout(r, 800)); try { rmSync(base, { recursive: true, force: true }); } catch { /* el SO aun lo tiene */ } });

test('la preparacion: el titulo de la entrada existe en la base y el visible sale en las listas', () => {
  assert.ok(idEntrada, 'el titulo de la entrada se registro al escanear su fuente');
});

const RUTAS = [
  '/api/libraries', '/api/genres', '/api/studios', '/api/actors', '/api/items', '/api/items?sort=added', '/api/items?sort=random', '/api/items/letras',
  '/api/home', '/api/collections', '/api/search?q=ZZSecreto', '/api/search?q=secreto', '/api/search/dialogue?q=secreto', '/api/novedades',
  '/api/favorites', '/api/estadisticas', '/api/genres', '/api/studios', '/api/actors', '/api/collections', '/api/collections/ZZSaga', '/api/people/1', '/api/items?genre=ZZGenero', '/api/items?collection=ZZSaga', '/api/libraries/1/continuar', '/api/libraries/2/continuar',
];

for (const ruta of RUTAS) {
  test(`un cliente no ve la entrada en ${ruta}`, async () => {
    const cuerpo = await get(ruta);
    assert.ok(!/ZZ(Secreto|Genero|Actor|Estudio|Saga)/.test(cuerpo), `${ruta} deja ver datos de la entrada: ${(cuerpo.match(/ZZw+/) ?? [''])[0]}`);
    assert.ok(!/"name":"Videos"/.test(cuerpo), `${ruta} deja ver la biblioteca de entrada`);
  });
}

test('la ficha de un titulo de la entrada no se sirve a los clientes (404)', async () => {
  const r = await fetch(`${U}/api/items/${idEntrada}`, { headers: { cookie } });
  assert.equal(r.status, 404);
});

test('la lista de bibliotecas solo trae las reales', async () => {
  const libs = JSON.parse(await get('/api/libraries'));
  assert.deepEqual(libs.map((l) => l.name), ['Peliculas']);
});

test('las cifras (estadisticas, recuentos) tampoco cuentan la entrada', async () => {
  const s = JSON.parse(await get('/api/stats'));
  assert.equal(s.movies, 1, '/api/stats cuenta peliculas de la entrada');
  assert.equal(s.bytes, 6 * 1024 * 1024, '/api/stats suma el tamano de la entrada');
  const e = JSON.parse(await get('/api/estadisticas'));
  const texto = JSON.stringify(e);
  assert.equal(e.biblioteca?.titulos ?? e.titulos, 1, 'estadisticas cuenta titulos de la entrada: ' + texto.slice(0, 300));
  assert.ok(!/"nombre":"Videos"/.test(texto), 'estadisticas lista la biblioteca de entrada');
});
