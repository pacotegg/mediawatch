/*
 * Deshacer el ultimo cambio del Scraper en un titulo: antes de aplicar se guarda una instantanea de lo que cambia (campos de la
 * ficha, reparto, generos, valoracion TMDb y el arte propio, copiado a `_previo/`), y `deshacerUltima` lo devuelve todo, incluida
 * la marca meta_origen (el .nfo vuelve a mandar). Datos y biblioteca temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-hist-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { escribirFicha } = await import('../src/scanner/ficha.ts');
const { tomarInstantanea, deshacerUltima, ultimaInstantanea } = await import('../src/scanner/historial.ts');
const { DATA_DIR } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const raiz = join(base, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
let id, arte;
const gente = () => db.prepare('SELECT p.name, ip.role FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ? ORDER BY ip.role, p.name').all(id).map((r) => `${r.role}:${r.name}`);

before(async () => {
  const d = join(raiz, 'Peli Historia (2002)');
  mkdirSync(d, { recursive: true });
  const fd = openSync(join(d, 'Peli Historia (2002).mkv'), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
  writeFileSync(join(d, 'Peli Historia (2002).nfo'), '<movie><title>Peli Historia</title><year>2002</year><plot>Sinopsis NFO</plot><studio>Estudio NFO</studio><genre>Drama</genre><actor><name>Actor NFO</name></actor></movie>');
  await scanLibrary(lib);
  id = db.prepare('SELECT id FROM items').get().id;
  arte = join(DATA_DIR, 'artwork', String(id));
  mkdirSync(arte, { recursive: true });
  writeFileSync(join(arte, 'poster.webp'), 'POSTER ANTES');
  db.prepare("UPDATE items SET poster = ?, arte_fijado = 'poster' WHERE id = ?").run(join(arte, 'poster.webp'), id);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('sin cambios guardados no hay nada que deshacer', () => {
  assert.equal(ultimaInstantanea(id), null);
  assert.throws(() => deshacerUltima(id), /no hay nada que deshacer/i);
});

test('deshacer devuelve ficha, reparto, estudios, valoracion, marca y arte a como estaban', () => {
  const antes = db.prepare('SELECT title, plot, studio, country, poster, arte_fijado, meta_origen, tmdb_id FROM items WHERE id = ?').get(id);
  assert.deepEqual(gente(), ['actor:Actor NFO']);

  tomarInstantanea(id, 'prueba');
  // lo que haria aplicar: ficha nueva, arte sobrescrito en el mismo nombre, y mas campos
  escribirFicha(id, { tmdbId: 9, kind: 'movie', title: 'X', year: 2002, overview: null, rating: 8.1, votos: 5, posterUrl: null, backdropUrl: null, logoUrl: null, genres: [],
    reparto: [{ nombre: 'Actor TMDb', personaje: '' }], directores: ['Dir TMDb'], estudios: ['Estudio TMDb'], paises: ['Chile'] }, ['cast', 'studio', 'ratings']);
  writeFileSync(join(arte, 'poster.webp'), 'POSTER DESPUES');
  db.prepare("UPDATE items SET plot = 'Sinopsis TMDb', tmdb_id = '9' WHERE id = ?").run(id);
  assert.deepEqual(gente(), ['actor:Actor TMDb', 'director:Dir TMDb']);
  assert.equal(ultimaInstantanea(id).etiqueta, 'prueba');

  deshacerUltima(id);
  assert.deepEqual({ ...db.prepare('SELECT title, plot, studio, country, poster, arte_fijado, meta_origen, tmdb_id FROM items WHERE id = ?').get(id) }, { ...antes });
  assert.deepEqual(gente(), ['actor:Actor NFO']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_ratings WHERE item_id = ? AND fuente = 'themoviedb'").get(id).n, 0);
  assert.equal(readFileSync(join(arte, 'poster.webp'), 'utf8'), 'POSTER ANTES', 'el fichero de arte vuelve a su contenido');
  assert.equal(ultimaInstantanea(id), null, 'la instantanea se consume');
});

test('tras deshacer, el .nfo vuelve a mandar en el escaneo', async () => {
  await scanLibrary(lib);
  assert.deepEqual(gente(), ['actor:Actor NFO']);
  assert.equal(db.prepare('SELECT studio FROM items WHERE id = ?').get(id).studio, 'Estudio NFO');
});

test('solo se guardan las ultimas 5 instantaneas por titulo', () => {
  for (let i = 0; i < 8; i++) tomarInstantanea(id, 'n' + i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scrape_historial WHERE item_id = ?').get(id).n, 5);
  assert.equal(ultimaInstantanea(id).etiqueta, 'n7');
  assert.equal(existsSync(join(arte, '_previo')), true);
});
