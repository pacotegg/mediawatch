/*
 * Ficha completa desde TMDb (reparto, estudios, pais, valoracion) y la marca `meta_origen = 'servidor'`: tras ponerla, un
 * reescaneo NO vuelve a leer el .nfo de ese titulo (antes de la marca, el escaneo reescribia el reparto con el del .nfo).
 * Biblioteca falsa y datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-ficha-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { escribirFicha } = await import('../src/scanner/ficha.ts');
const { db } = await import('../src/db.ts');

const raiz = join(datos, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
const nfo = (titulo, actor, estudio) => `<?xml version="1.0" encoding="UTF-8"?>
<movie><title>${titulo}</title><year>2000</year><studio>${estudio}</studio><country>Francia</country>
<actor><name>${actor}</name><role>Papel NFO</role></actor><director>Director NFO</director></movie>`;

function crear(nombre, actor, estudio) {
  const d = join(raiz, `${nombre} (2000)`);
  mkdirSync(d, { recursive: true });
  const fd = openSync(join(d, `${nombre} (2000).mkv`), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
  writeFileSync(join(d, `${nombre} (2000).nfo`), nfo(nombre, actor, estudio));
}
const gente = (id) => db.prepare('SELECT p.name, ip.role FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ? ORDER BY ip.role, ip.ord, p.name').all(id).map((r) => `${r.role}:${r.name}`);
const id = (titulo) => db.prepare('SELECT id FROM items WHERE title = ?').get(titulo).id;
const propuesta = {
  tmdbId: 1, kind: 'movie', title: 'X', year: 2000, overview: null, rating: 7.5, votos: 1234, posterUrl: null, backdropUrl: null, logoUrl: null, genres: [],
  reparto: [{ nombre: 'Actor TMDb', personaje: 'Papel TMDb' }, { nombre: 'Otra TMDb', personaje: '' }],
  directores: ['Director TMDb'], guionistas: ['Guion TMDb'], estudios: ['Estudio A', 'Estudio B'], paises: ['España'],
};

before(() => { crear('Con Ficha', 'Actor NFO', 'Estudio NFO'); crear('Sin Tocar', 'Actor NFO', 'Estudio NFO'); });
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('la ficha de TMDb sustituye el reparto, los estudios y el pais, y guarda la valoracion', async () => {
  await scanLibrary(lib);
  assert.deepEqual(gente(id('Con Ficha')), ['actor:Actor NFO', 'director:Director NFO']);
  const hechos = escribirFicha(id('Con Ficha'), propuesta, ['cast', 'studio', 'ratings']);
  assert.deepEqual(hechos, ['cast', 'studio', 'ratings']);
  assert.deepEqual(gente(id('Con Ficha')), ['actor:Actor TMDb', 'actor:Otra TMDb', 'director:Director TMDb', 'writer:Guion TMDb']);
  const it = db.prepare('SELECT studio, country, meta_origen FROM items WHERE id = ?').get(id('Con Ficha'));
  assert.deepEqual({ ...it }, { studio: 'Estudio A, Estudio B', country: 'España', meta_origen: 'servidor' });
  const r = db.prepare("SELECT valor, maximo, votos, origen FROM item_ratings WHERE item_id = ? AND fuente = 'themoviedb'").get(id('Con Ficha'));
  assert.deepEqual({ ...r }, { valor: 7.5, maximo: 10, votos: 1234, origen: 'tmdb' });
});

test('un reescaneo no vuelve a leer el .nfo de un titulo gestionado por el servidor', async () => {
  await scanLibrary(lib);
  await scanLibrary(lib);
  assert.deepEqual(gente(id('Con Ficha')), ['actor:Actor TMDb', 'actor:Otra TMDb', 'director:Director TMDb', 'writer:Guion TMDb']);
  assert.equal(db.prepare('SELECT studio FROM items WHERE id = ?').get(id('Con Ficha')).studio, 'Estudio A, Estudio B');
});

test('control: un titulo al que no se aplica nada sigue siguiendo a su .nfo', async () => {
  assert.deepEqual(gente(id('Sin Tocar')), ['actor:Actor NFO', 'director:Director NFO']);
  assert.equal(db.prepare('SELECT studio FROM items WHERE id = ?').get(id('Sin Tocar')).studio, 'Estudio NFO');
});

test('sin sobrescribir, no pisa un reparto que ya existe', () => {
  const antes = gente(id('Sin Tocar'));
  assert.deepEqual(escribirFicha(id('Sin Tocar'), propuesta, ['cast'], false), []);
  assert.deepEqual(gente(id('Sin Tocar')), antes);
});
