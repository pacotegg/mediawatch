// node --test src/scanner/nombres.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limpiarNombre, esNombreGenerico, tituloDespuesDeNumeracion } from './nombres.ts';

const casos: [string, string, number | undefined][] = [
  ['Blade Runner (1982)', 'Blade Runner', 1982],
  ['The.Matrix.1999.1080p.BluRay.x264-GROUP', 'The Matrix', 1999],
  ['Amelie 2001 [1080p]', 'Amelie', 2001],
  ['Alien Resurrection (1997) [BluRay]', 'Alien Resurrection', 1997],
  ['Inception.2010.720p.BluRay', 'Inception', 2010],
  ['El_laberinto_del_fauno_2006_DVDRip_spa', 'El laberinto del fauno', 2006],
  ['The.Office.US.2005.720p', 'The Office US', 2005],
  ['Blade Runner 2049 (2017)', 'Blade Runner 2049', 2017],
  ['Blade Runner 2049 2017 1080p', 'Blade Runner 2049', 2017],
  ['1917 (2019)', '1917', 2019],
  ['1917', '1917', undefined],
  ['2012.2009.1080p.BluRay', '2012', 2009],
  ['Mr. Robot (2015)', 'Mr. Robot', 2015],
  ['Dual (2022)', 'Dual', 2022],
  ['Breaking Bad', 'Breaking Bad', undefined],
  ['Friends (1994)', 'Friends', 1994],
  ['Star Wars Episode IV - A New Hope (1977)', 'Star Wars Episode IV - A New Hope', 1977],
  ['Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.H.265-GRP', 'Dune Part Two', 2024],
  ['Pelicula sin ano', 'Pelicula sin ano', undefined],
];

for (const [entrada, titulo, ano] of casos) {
  test(`limpiarNombre: ${entrada}`, () => {
    assert.deepEqual(limpiarNombre(entrada), { title: titulo, year: ano });
  });
}

test('carpetas genericas', () => {
  for (const n of ['CD1', 'Movies', 'Peliculas', 'Películas', '01']) assert.ok(esNombreGenerico(n), n);
  assert.ok(!esNombreGenerico('Heat (1995)'));
});

test('titulo de episodio', () => {
  assert.equal(tituloDespuesDeNumeracion('Breaking.Bad.S01E01.720p'), null);
  assert.equal(tituloDespuesDeNumeracion('S02E03'), null);
  assert.equal(tituloDespuesDeNumeracion('Friends - 1x05 - The One'), 'The One');
  assert.equal(tituloDespuesDeNumeracion('s01e01 Queens of Sci-Fi'), 'Queens of Sci-Fi');
  assert.equal(tituloDespuesDeNumeracion('Show.S01E02.The.Pilot.1080p.WEB-DL'), 'The Pilot');
  assert.equal(tituloDespuesDeNumeracion('02 - Heroes de la Ciencia Ficcion'), null);
});
