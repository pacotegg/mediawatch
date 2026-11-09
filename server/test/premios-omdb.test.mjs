/*
 * Premios: OMDb los da en `Awards`. Se guardan en `items.premios` ('' = comprobado y sin premios, por eso se mira `!== null`),
 * sin tocar nada mas, y un reescaneo no los borra. OMDb FALSO en local, biblioteca falsa y datos temporales.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-premios-'));
const peticiones = [];
const premiosPor = { tt0000001: 'Won 1 Oscar. 19 wins & 22 nominations total', tt0000002: 'N/A' };
const edadPor = { tt0000001: 'R', tt0000002: 'Not Rated' };
const falso = createServer((req, res) => {
  const i = new URL(req.url, 'http://x').searchParams.get('i');
  peticiones.push(i);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(i in premiosPor ? { Response: 'True', imdbID: i, Awards: premiosPor[i], Rated: edadPor[i] } : { Response: 'False', Error: 'Incorrect IMDb ID.' }));
});
await new Promise((r) => falso.listen(0, '127.0.0.1', r));
process.env.MEDIAWATCH_DATA_DIR = datos;
process.env.MEDIAWATCH_OMDB_URL = `http://127.0.0.1:${falso.address().port}/`;
writeFileSync(join(datos, 'config.json'), JSON.stringify({ omdbApiKey: 'clave-falsa' }));
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { traerPremios } = await import('../src/scanner/omdb-ficha.ts');
const { parseRatingCategoria } = await import('../src/db.ts');
const { db } = await import('../src/db.ts');

const raiz = join(datos, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
const carpeta = (n) => join(raiz, n);
for (const n of ['Con premios (2000)', 'Sin premios (2001)', 'Sin imdb (2002)']) {
  mkdirSync(carpeta(n), { recursive: true });
  const fd = openSync(join(carpeta(n), `${n}.mkv`), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
}
after(() => { try { db.close(); } catch { /* ya cerrada */ } falso.close(); try { rmSync(datos, { recursive: true, force: true, maxRetries: 5 }); } catch { /* temporal */ } });

const fila = (n) => db.prepare('SELECT id, premios, mpaa, campos_fijados, title FROM items WHERE folder = ?').get(carpeta(n));

test('guarda los premios, y "N/A" queda como cadena vacia (comprobado, sin premios)', async () => {
  await scanLibrary(lib);
  db.prepare('UPDATE items SET imdb_id = ? WHERE id = ?').run('tt0000001', fila('Con premios (2000)').id);
  db.prepare('UPDATE items SET imdb_id = ? WHERE id = ?').run('tt0000002', fila('Sin premios (2001)').id);
  await traerPremios(fila('Con premios (2000)').id);
  await traerPremios(fila('Sin premios (2001)').id);
  assert.equal(fila('Con premios (2000)').premios, 'Won 1 Oscar. 19 wins & 22 nominations total');
  assert.equal(fila('Sin premios (2001)').premios, '');
});

test('sin id de IMDb no se consulta ni se escribe nada', async () => {
  const antes = peticiones.length;
  await traerPremios(fila('Sin imdb (2002)').id);
  assert.equal(peticiones.length, antes);
  assert.equal(fila('Sin imdb (2002)').premios, null);
});

test('un fallo de OMDb no borra los premios que ya habia', async () => {
  db.prepare('UPDATE items SET imdb_id = ? WHERE id = ?').run('tt9999999', fila('Con premios (2000)').id);
  await assert.rejects(() => traerPremios(fila('Con premios (2000)').id));
  assert.equal(fila('Con premios (2000)').premios, 'Won 1 Oscar. 19 wins & 22 nominations total');
});

test('un reescaneo conserva los premios', async () => {
  await scanLibrary(lib);
  assert.equal(fila('Con premios (2000)').premios, 'Won 1 Oscar. 19 wins & 22 nominations total');
});

test('la edad se completa desde OMDb solo si falta; «Not Rated» no dice nada', async () => {
  const con = fila('Con premios (2000)').id, sin = fila('Sin premios (2001)').id;
  db.prepare("UPDATE items SET imdb_id = 'tt0000001', mpaa = NULL WHERE id = ?").run(con);
  await traerPremios(con);
  assert.equal(fila('Con premios (2000)').mpaa, 'US:R');
  await traerPremios(sin);
  assert.equal(fila('Sin premios (2001)').mpaa, null, '«Not Rated» no es una edad');
});

test('no pisa una edad que ya tenia ni una fijada a mano', async () => {
  const id = fila('Con premios (2000)').id;
  db.prepare("UPDATE items SET mpaa = 'ES:16' WHERE id = ?").run(id);
  await traerPremios(id);
  assert.equal(fila('Con premios (2000)').mpaa, 'ES:16');
  db.prepare("UPDATE items SET mpaa = NULL, campos_fijados = ',mpaa,' WHERE id = ?").run(id);
  await traerPremios(id);
  assert.equal(fila('Con premios (2000)').mpaa, null, 'si se vacio a mano, se respeta');
  db.prepare("UPDATE items SET campos_fijados = NULL WHERE id = ?").run(id);
});

test('un reescaneo no borra la edad traida de OMDb en una ficha con NFO sin edad', async () => {
  const id = fila('Con premios (2000)').id;
  await traerPremios(id);
  assert.equal(fila('Con premios (2000)').mpaa, 'US:R');
  await scanLibrary(lib);
  assert.equal(fila('Con premios (2000)').mpaa, 'US:R');
});

test('las edades de EE. UU. caen en su categoria: G es para todos, R es 18', () => {
  assert.equal(parseRatingCategoria('US:G', 1), 'TP');
  assert.equal(parseRatingCategoria('US:PG', 1), '7');
  assert.equal(parseRatingCategoria('US:PG-13', 1), '12');
  assert.equal(parseRatingCategoria('US:R', 1), '18');
});
