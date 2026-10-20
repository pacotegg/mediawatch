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
