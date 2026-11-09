// Reglas de creditos por capitulos y de coincidencia por duracion (revision del 09/11/2026).
//
// - El fallback «ultimo capitulo» marcaba como creditos el desenlace de los cortos: en las 4 de Wallace & Gromit
//   (24-31 min) saltaba el 20-24 % de la pelicula. Medido en la biblioteca (349 peliculas >= 60 min con creditos
//   conocidos por capitulo o IntroDB): los creditos ocupan una mediana del 4,3 % y un p98 del 9,4 % (max 13,9 %).
//   Por debajo de 60 min no hay ni un caso medido, asi que no se adivina.
// - La tolerancia de duracion con ChapterDB estaba en 15 s; el 07/11 pasaba a 45 s sin medir nada.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { creditosDePelicula } from '../src/media/creditos-pelicula.ts';
import { TOLERANCIA_DURACION_S, candidatoPorDuracion } from '../src/media/chapterdb.ts';

const genericos = (duracion, inicioUltimo, n = 12) => {
  // n capitulos genericos; el ultimo empieza en inicioUltimo
  const caps = [];
  const paso = inicioUltimo / (n - 1);
  for (let i = 0; i < n - 1; i++) caps.push({ start: i * paso, end: (i + 1) * paso, title: `Chapter ${i + 1}` });
  caps.push({ start: inicioUltimo, end: duracion, title: `Chapter ${n}` });
  return caps;
};

describe('creditosDePelicula: ultimo capitulo generico', () => {
  it('un largo normal: el ultimo capitulo de 6 min vale como pista (confianza 70)', () => {
    const r = creditosDePelicula(genericos(7200, 7200 - 360), 7200);
    assert.equal(r.length, 1);
    assert.equal(r[0].source, 'ultimo-capitulo');
    assert.equal(r[0].confidence, 70);
    assert.equal(r[0].start_s, 7200 - 360);
  });

  it('un corto de 30 min con un ultimo capitulo de 6 min NO: es el desenlace (caso Wallace & Gromit)', () => {
    assert.deepEqual(creditosDePelicula(genericos(1820, 1820 - 366), 1820), []);
    assert.deepEqual(creditosDePelicula(genericos(1886, 1886 - 425), 1886), []);
  });

  it('por debajo de 60 min no se adivina aunque el ultimo capitulo parezca pequeno', () => {
    assert.deepEqual(creditosDePelicula(genericos(3300, 3300 - 180), 3300), []);
  });

  it('un ultimo capitulo de mas del 10 % de la pelicula no son creditos', () => {
    // 90 min: 10,7 % = 9,6 min  -> fuera;  8 min = 8,9 % -> dentro
    assert.deepEqual(creditosDePelicula(genericos(5400, 5400 - 576), 5400), []);
    assert.equal(creditosDePelicula(genericos(5400, 5400 - 480), 5400).length, 1);
  });

  it('se conservan los topes de siempre: menos de 2 min o mas de 12 min no valen', () => {
    assert.deepEqual(creditosDePelicula(genericos(7200, 7200 - 90), 7200), []);
    assert.deepEqual(creditosDePelicula(genericos(14400, 14400 - 800), 14400), []);
  });

  it('con nombres de escena de verdad no se usa el ultimo capitulo', () => {
    const caps = [
      { start: 0, end: 3000, title: 'Opening' },
      { start: 3000, end: 6800, title: 'The Chase' },
      { start: 6800, end: 7200, title: 'Epilogue' },
    ];
    assert.deepEqual(creditosDePelicula(caps, 7200), []);
  });
});

describe('creditosDePelicula: capitulo con nombre de creditos (sin cambios)', () => {
  it('«End Credits» manda, con confianza 95, aunque el fichero sea corto', () => {
    const caps = [
      { start: 0, end: 1500, title: 'Chapter 1' },
      { start: 1500, end: 1800, title: 'End Credits' },
    ];
    const r = creditosDePelicula(caps, 1800);
    assert.equal(r.length, 1);
    assert.equal(r[0].source, 'capitulo');
    assert.equal(r[0].confidence, 95);
  });
});

describe('coincidencia por duracion con ChapterDB', () => {
  const cand = (id, durationSec) => ({ id, title: 'X', hasNames: true, durationSec });

  it('la tolerancia es de 15 s', () => {
    assert.equal(TOLERANCIA_DURACION_S, 15);
  });

  it('acepta hasta 15 s y rechaza 16 s o 45 s', () => {
    assert.equal(candidatoPorDuracion([cand('a', 7215)], 7200)?.id, 'a');
    assert.equal(candidatoPorDuracion([cand('a', 7185)], 7200)?.id, 'a');
    assert.equal(candidatoPorDuracion([cand('a', 7216)], 7200), undefined);
    assert.equal(candidatoPorDuracion([cand('a', 7245)], 7200), undefined);
  });

  it('entre varios que valen elige el mas cercano, no el primero de la lista', () => {
    assert.equal(candidatoPorDuracion([cand('lejos', 7212), cand('cerca', 7201), cand('medio', 7206)], 7200)?.id, 'cerca');
  });

  it('ignora los que no declaran duracion', () => {
    assert.equal(candidatoPorDuracion([cand('sin', 0), cand('ok', 7200)], 7200)?.id, 'ok');
    assert.equal(candidatoPorDuracion([cand('sin', 0)], 7200), undefined);
  });
});
