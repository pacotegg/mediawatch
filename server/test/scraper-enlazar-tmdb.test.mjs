/*
 * Las propuestas de OMDb/TVDB llevan `tmdbId: 0` y el Asistente solo aplica con id de TMDb: antes se descartaban en silencio
 * (`tmdbId ? ... : null`) y el titulo seguia al renombrado sin datos. `enlazarConTmdb` las cruza por IMDb (o por el id de TMDb que ya traigan).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enlazarConTmdb } from '../src/scanner/enlazar-tmdb.ts';

const prop = (o) => ({ tmdbId: 0, kind: 'movie', title: 'T', year: 1999, overview: null, rating: null, posterUrl: null, backdropUrl: null, logoUrl: null, genres: [], ...o });
const ficha = (id) => prop({ tmdbId: id, title: `TMDb ${id}`, fuente: 'tmdb' });

test('una propuesta sin id de TMDb se cambia por la ficha de TMDb hallada por su IMDb', async () => {
  const { propuestas, sinEnlace } = await enlazarConTmdb(
    [prop({ title: 'The Matrix', imdbId: 'tt0133093', fuente: 'omdb' })], 'movie',
    { porImdb: async (imdb) => (imdb === 'tt0133093' ? 603 : null), ficha: async (id) => ficha(id) });
  assert.deepEqual(propuestas.map((p) => p.tmdbId), [603]);
  assert.equal(sinEnlace, 0);
});

test('si ya trae id de TMDb se deja tal cual, y los duplicados se juntan', async () => {
  const { propuestas } = await enlazarConTmdb(
    [prop({ tmdbId: 603, fuente: 'tvdb' }), prop({ imdbId: 'tt0133093', fuente: 'omdb' })], 'movie',
    { porImdb: async () => 603, ficha: async (id) => ficha(id) });
  assert.equal(propuestas.length, 1);
  assert.equal(propuestas[0].tmdbId, 603);
});

test('lo que TMDb no conoce no se ofrece, y se cuenta', async () => {
  const { propuestas, sinEnlace } = await enlazarConTmdb(
    [prop({ imdbId: 'tt9999999', fuente: 'omdb' }), prop({ fuente: 'omdb' })], 'movie',
    { porImdb: async () => null, ficha: async (id) => ficha(id) });
  assert.deepEqual(propuestas, []);
  assert.equal(sinEnlace, 2);
});

test('un fallo de TMDb en una propuesta no tumba las demas', async () => {
  const { propuestas, sinEnlace } = await enlazarConTmdb(
    [prop({ imdbId: 'tt1', fuente: 'omdb' }), prop({ imdbId: 'tt2', fuente: 'omdb' })], 'movie',
    { porImdb: async (i) => { if (i === 'tt1') throw new Error('red'); return 7; }, ficha: async (id) => ficha(id) });
  assert.deepEqual(propuestas.map((p) => p.tmdbId), [7]);
  assert.equal(sinEnlace, 1);
});
