/*
 * Las fotos de actores que se buscan por NOMBRE (Wikipedia, Wikidata, TMDb sin id) se equivocaban de persona: el 26/10/2026,
 * de 71 fotos de Wikipedia, 28 eran de otro (homónimos como el productor Sam Phillips para el actor del mismo nombre, o la
 * página de una película, Platoon o Tiburón, con su cartel como foto del actor). Una ficha de Wikidata solo vale si es una
 * persona y sus ids de TMDb/IMDb no contradicen a los de nuestra persona.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { juzgarFichaWikidata, mismoNombre } from '../src/scanner/fotos-actores.ts';

const persona = (o = {}) => ({ humano: true, tmdb: [], imdb: [], ...o });

test('una ficha que no es una persona se rechaza aunque no tenga ids (la página de una película)', () => {
  assert.equal(juzgarFichaWikidata(persona({ humano: false, imdb: ['tt0091763'] }), 11888, 'nm0426047'), 'no-persona');
  assert.equal(juzgarFichaWikidata(persona({ humano: false }), null, null), 'no-persona');
});

test('con ids distintos es otra persona (Sam Phillips: el productor de Sun Records, no el actor de Ace Ventura)', () => {
  const productor = persona({ tmdb: ['1279506'], imdb: ['nm0680769'] });
  assert.equal(juzgarFichaWikidata(productor, 1080061, 'nm0680771'), 'contradice');
  // Basta con que contradiga un id si el otro no se puede comparar
  assert.equal(juzgarFichaWikidata(productor, 1080061, null), 'contradice');
  assert.equal(juzgarFichaWikidata(productor, null, 'nm0680771'), 'contradice');
});

test('un id que coincide confirma, aunque el otro falte o difiera', () => {
  assert.equal(juzgarFichaWikidata(persona({ tmdb: ['936'], imdb: ['nm0001657'] }), 936, 'nm9999999'), 'confirmada');
  assert.equal(juzgarFichaWikidata(persona({ imdb: ['nm0001657'] }), null, 'nm0001657'), 'confirmada');
});

test('sin ids en la ficha (o en la persona) no se puede comprobar', () => {
  assert.equal(juzgarFichaWikidata(persona(), 123, 'nm1'), 'sin-ids');
  assert.equal(juzgarFichaWikidata(persona({ tmdb: ['5'] }), null, null), 'sin-ids');
});

test('mismoNombre ignora tildes, mayúsculas, paréntesis de desambiguación y orden de espacios', () => {
  assert.equal(mismoNombre('Béla Lugosi', 'Bela Lugosi'), true);
  assert.equal(mismoNombre('Richard Alexander (actor)', 'richard alexander'), true);
  assert.equal(mismoNombre('Julie Anne Peters', 'Julie Peters'), false);
  assert.equal(mismoNombre('Davis Roberts', 'Robert Davis'), false);
});
