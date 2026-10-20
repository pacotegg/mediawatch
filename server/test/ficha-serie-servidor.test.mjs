/*
 * Adoptar una SERIE: la ficha de TMDb (reparto, estudios, pais, valoracion) la marca `servidor` y sus episodios se congelan tal
 * como estan, de modo que el escaneo deja de reescribirlos desde los .nfo. Una serie sin adoptar sigue a sus .nfo. Deshacer
 * devuelve la serie y sus episodios al estado anterior. Biblioteca y datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-serie-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { escribirFicha } = await import('../src/scanner/ficha.ts');
const { tomarInstantanea, deshacerUltima } = await import('../src/scanner/historial.ts');
const { db } = await import('../src/db.ts');

const raiz = join(base, 'series');
const lib = { name: 'Series', path: raiz, kind: 'show' };
const nfoEp = (titulo) => `<episodedetails><title>${titulo}</title><season>1</season><episode>1</episode><plot>Trama ${titulo}</plot></episodedetails>`;

function serie(nombre) {
  const t = join(raiz, `${nombre} (2020)`, 'Season 1');
  mkdirSync(t, { recursive: true });
  const fd = openSync(join(t, `${nombre} - S01E01 - Uno.mkv`), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
  writeFileSync(join(raiz, `${nombre} (2020)`, 'tvshow.nfo'), `<tvshow><title>${nombre}</title><studio>Cadena NFO</studio><actor><name>Actor NFO</name></actor></tvshow>`);
  writeFileSync(join(t, `${nombre} - S01E01 - Uno.nfo`), nfoEp('Episodio NFO'));
  return t;
}
const id = (t) => db.prepare('SELECT id FROM items WHERE title = ?').get(t).id;
const ep = (t) => db.prepare('SELECT title, plot, meta_origen FROM episodes WHERE show_id = ?').get(id(t));
const gente = (t) => db.prepare('SELECT p.name FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ?').all(id(t)).map((r) => r.name);
const propuesta = { tmdbId: 5, kind: 'show', title: 'X', year: 2020, overview: null, rating: 8, votos: 10, posterUrl: null, backdropUrl: null, logoUrl: null, genres: [],
  reparto: [{ nombre: 'Actor TMDb', personaje: '' }], estudios: ['Cadena TMDb'], paises: ['Chile'] };
let carpetaAdoptada;

before(async () => { carpetaAdoptada = serie('Adoptada'); serie('Libre'); await scanLibrary(lib); });
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('adoptar una serie congela serie y episodios: el escaneo ya no los reescribe desde el .nfo', async () => {
  tomarInstantanea(id('Adoptada'), 'prueba');
  assert.deepEqual(escribirFicha(id('Adoptada'), propuesta, ['cast', 'studio', 'ratings']), ['cast', 'studio', 'ratings']);
  assert.equal(ep('Adoptada').meta_origen, 'servidor');

  // El usuario edita los .nfo en tMM despues de adoptar: no debe notarse.
  writeFileSync(join(carpetaAdoptada, 'Adoptada - S01E01 - Uno.nfo'), nfoEp('Episodio CAMBIADO'));
  writeFileSync(join(raiz, 'Adoptada (2020)', 'tvshow.nfo'), '<tvshow><title>Adoptada</title><studio>Otra cadena</studio><actor><name>Otro Actor</name></actor></tvshow>');
  await scanLibrary(lib);
  assert.equal(ep('Adoptada').title, 'Episodio NFO');
  assert.deepEqual(gente('Adoptada'), ['Actor TMDb']);
  assert.equal(db.prepare('SELECT studio FROM items WHERE id = ?').get(id('Adoptada')).studio, 'Cadena TMDb');
});

test('control: una serie sin adoptar sigue a sus .nfo', async () => {
  writeFileSync(join(raiz, 'Libre (2020)', 'Season 1', 'Libre - S01E01 - Uno.nfo'), nfoEp('Episodio LIBRE NUEVO'));
  await scanLibrary(lib);
  assert.equal(ep('Libre').title, 'Episodio LIBRE NUEVO');
  assert.deepEqual(gente('Libre'), ['Actor NFO']);
});

test('deshacer devuelve la serie y sus episodios a seguir al .nfo', async () => {
  deshacerUltima(id('Adoptada'));
  assert.equal(ep('Adoptada').meta_origen, null);
  await scanLibrary(lib);
  assert.equal(ep('Adoptada').title, 'Episodio CAMBIADO', 'ya vuelve a leer el .nfo');
  assert.deepEqual(gente('Adoptada'), ['Otro Actor']);
});
