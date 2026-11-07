import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitulosEncajan, esTituloGenerico } from '../src/media/chapterdb.ts';

const caps = (...inicios) => inicios.map((start, i) => ({ start, end: inicios[i + 1] ?? start + 60, title: `Escena ${i + 1}` }));

// Casos medidos en la biblioteca el 19/10/2026: capítulos de ChapterDB guardados para películas que no eran su montaje.
test('rechaza capítulos de otro montaje que empiezan después del final', () => {
  assert.equal(capitulosEncajan(caps(0, 3000, 8000, 11766), 6890), false); // Thor
  assert.equal(capitulosEncajan(caps(0, 2000, 4000, 6542), 5666), false); // Dos mulas y una mujer
});

test('rechaza listas que se quedan en el primer cuarto o son un solo capítulo', () => {
  assert.equal(capitulosEncajan(caps(0, 600, 1535), 6357), false); // Black Friday
  assert.equal(capitulosEncajan(caps(0), 7311), false); // Hotel Rwanda
});

test('admite capítulos que recorren la película, también con la marca de fin del Blu-ray', () => {
  assert.equal(capitulosEncajan(caps(0, 1200, 3600, 6000), 6900), true);
  assert.equal(capitulosEncajan(caps(0, 2400, 4800, 6950), 6949), true); // Alien: marca de fin a 1 s del final
});

test('esTituloGenerico identifica títulos genéricos y marcas de tiempo sin nombres reales', () => {
  // Numéricos y palabras genéricas en varios idiomas
  assert.equal(esTituloGenerico('Chapter 1'), true);
  assert.equal(esTituloGenerico('Capítulo 02'), true);
  assert.equal(esTituloGenerico('Chapitre 03'), true);
  assert.equal(esTituloGenerico('Kapitel 01'), true);
  assert.equal(esTituloGenerico('Escena 5'), true);
  assert.equal(esTituloGenerico('Part 2'), true);
  assert.equal(esTituloGenerico('14'), true);

  // Marcas de tiempo de ripeo
  assert.equal(esTituloGenerico('00:00:00.000'), true);
  assert.equal(esTituloGenerico('01:23:45.678'), true);
  assert.equal(esTituloGenerico('11:04'), true);
  assert.equal(esTituloGenerico('Chapter 01 - 00:00:00'), true);

  // Vacíos o placeholders
  assert.equal(esTituloGenerico('{Empty Chapter}'), true);
  assert.equal(esTituloGenerico(''), true);
  assert.equal(esTituloGenerico('   '), true);

  // Nombres reales legítimos no deben considerarse genéricos
  assert.equal(esTituloGenerico('01.Open Credits'), false);
  assert.equal(esTituloGenerico('The Abyss'), false);
  assert.equal(esTituloGenerico('End Credits'), false);
  assert.equal(esTituloGenerico('Two Hearts'), false);
  assert.equal(esTituloGenerico('Logos / Main Title'), false);
});

