/*
 * Lo que una persona editó a mano (`campos_fijados`) no lo pisa el escáner desde el .nfo: ni título, ni sinopsis, ni saga, ni
 * géneros, ni tampoco si se dejó vacío a propósito. Lo que no está fijado sigue mandando el .nfo como siempre.
 * Biblioteca falsa en una carpeta temporal; datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, ftruncateSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-campos-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { db } = await import('../src/db.ts');

const raiz = join(datos, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
const nfo = ({ titulo = 'Peli Campos', saga = '', sinopsis = 'Sinopsis del nfo', generos = ['Drama'] } = {}) =>
  `<?xml version="1.0" encoding="UTF-8"?><movie><title>${titulo}</title><year>2000</year><plot>${sinopsis}</plot>${saga ? `<set><name>${saga}</name></set>` : ''}${generos.map((g) => `<genre>${g}</genre>`).join('')}</movie>`;
const fila = () => db.prepare('SELECT title, search_title, plot, collection, campos_fijados FROM items').get();
const generos = () => db.prepare('SELECT g.name FROM item_genres ig JOIN genres g ON g.id = ig.genre_id ORDER BY g.name').all().map((x) => x.name);
let carpeta;
const poner = (o) => writeFileSync(join(carpeta, 'Peli Campos (2000).nfo'), nfo(o));

before(() => {
  carpeta = join(raiz, 'Peli Campos (2000)');
  mkdirSync(carpeta, { recursive: true });
  const fd = openSync(join(carpeta, 'Peli Campos (2000).mkv'), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('sin fijar, todo lo pone el .nfo', async () => {
  poner({ saga: 'Saga del nfo' });
  await scanLibrary(lib);
  assert.deepEqual({ ...fila() }, { title: 'Peli Campos', search_title: 'peli campos', plot: 'Sinopsis del nfo', collection: 'Saga del nfo', campos_fijados: null });
  assert.deepEqual(generos(), ['Drama']);
});

test('lo fijado a mano (título, sinopsis y saga) no lo pisa otro valor del .nfo', async () => {
  db.prepare("UPDATE items SET title = 'Título a mano', search_title = 'titulo a mano', plot = 'Sinopsis a mano', collection = 'Saga a mano', campos_fijados = ',title,plot,collection,'").run();
  poner({ titulo: 'Otro título del nfo', sinopsis: 'Otra sinopsis del nfo', saga: 'Otra saga del nfo' });
  await scanLibrary(lib);
  assert.deepEqual({ ...fila() }, { title: 'Título a mano', search_title: 'titulo a mano', plot: 'Sinopsis a mano', collection: 'Saga a mano', campos_fijados: ',title,plot,collection,' });
});

test('fijado como «vacío», el .nfo no lo vuelve a poner', async () => {
  db.prepare("UPDATE items SET plot = NULL, collection = NULL, campos_fijados = ',title,plot,collection,'").run();
  await scanLibrary(lib);
  const f = fila();
  assert.equal(f.plot, null);
  assert.equal(f.collection, null);
});

test('los géneros fijados a mano no se reescriben desde el .nfo; sin fijar, sí', async () => {
  db.prepare("DELETE FROM item_genres").run();
  const g = db.prepare("INSERT INTO genres (name) VALUES ('Terror') ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id").get().id;
  db.prepare('INSERT INTO item_genres (item_id, genre_id) SELECT id, ? FROM items').run(g);
  db.prepare("UPDATE items SET campos_fijados = ',genres,'").run();
  poner({ generos: ['Comedia', 'Drama'] });
  await scanLibrary(lib);
  assert.deepEqual(generos(), ['Terror'], 'fijados: se quedan los de a mano');
  db.prepare('UPDATE items SET campos_fijados = NULL').run();
  await scanLibrary(lib);
  assert.deepEqual(generos(), ['Comedia', 'Drama'], 'sin fijar: manda el .nfo');
});
