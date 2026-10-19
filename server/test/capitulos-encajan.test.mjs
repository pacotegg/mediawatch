import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitulosEncajan } from '../src/media/chapterdb.ts';

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
