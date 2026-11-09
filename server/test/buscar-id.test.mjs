/* La caja de busqueda del Scraper entiende titulo, id de TMDb, id de IMDb y direcciones pegadas. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarBusqueda as b } from '../src/scanner/buscar-id.ts';

test('direccion de TMDb', () => {
  assert.deepEqual(b('https://www.themoviedb.org/movie/241-natural-born-killers?language=es-ES'), { tipo: 'tmdb', id: 241, kind: 'movie' });
  assert.deepEqual(b('https://www.themoviedb.org/tv/1396-breaking-bad'), { tipo: 'tmdb', id: 1396, kind: 'show' });
});
test('IMDb: direccion o id suelto', () => {
  assert.deepEqual(b('https://www.imdb.com/title/tt0110632/'), { tipo: 'imdb', id: 'tt0110632' });
  assert.deepEqual(b(' TT0110632 '), { tipo: 'imdb', id: 'tt0110632' });
});
test('id de TMDb', () => {
  assert.deepEqual(b('241'), { tipo: 'tmdb', id: 241 });
  assert.deepEqual(b('tmdb:241'), { tipo: 'tmdb', id: 241 });
});
test('un titulo con numeros sigue siendo un titulo', () => {
  assert.deepEqual(b('Blade Runner 2049'), { tipo: 'texto', texto: 'Blade Runner 2049' });
  assert.deepEqual(b('2012'), { tipo: 'tmdb', id: 2012 }); // ambiguo: se resuelve por id; el titulo «2012» se busca con comillas o añadiendo una palabra
});

import { ordenarNumeroPelado, esNumeroPelado } from '../src/scanner/buscar-id.ts';
const p = (tmdbId, title) => ({ tmdbId, title });

test('un numero pelado es titulo O id: «1408» daba «La isla de las cabezas cortadas» (la 1408 de TMDb) y nunca la pelicula', () => {
  assert.equal(esNumeroPelado('1408'), true);
  assert.equal(esNumeroPelado(' 2012 '), true);
  assert.equal(esNumeroPelado('tmdb:1408'), false);
  assert.equal(esNumeroPelado('1408 2007'), false);
  const titulo = [p(1408000, '1408'), p(2, 'Otra')];
  const porId = [p(1408, 'La isla de las cabezas cortadas')];
  // Corto (≤4 cifras: parece titulo o año): primero los titulos
  assert.deepEqual(ordenarNumeroPelado('1408', titulo, porId).map((x) => x.tmdbId), [1408000, 2, 1408]);
  // Largo (parece un id): primero el id
  assert.deepEqual(ordenarNumeroPelado('603456', titulo, [p(603456, 'X')]).map((x) => x.tmdbId), [603456, 1408000, 2]);
  // Sin duplicados
  assert.deepEqual(ordenarNumeroPelado('1408', [p(1408, 'A')], [p(1408, 'A')]).length, 1);
});
