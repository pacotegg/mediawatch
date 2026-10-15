/*
 * Los subtítulos de la web: leer un VTT y colocarlo en la línea de tiempo. Es código puro, así que se
 * prueba directamente (Node 26 lee el TypeScript sin compilar). Hasta ahora la web solo tenía
 * comprobación de tipos, que no mira lo que hace el código.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCues, parseVtt } from '../src/lib/vtt.ts';

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
Hola
qué tal

2
00:01:02,250 --> 00:01:04.000 line:90%
Con coma y con posición
`;

test('lee los tiempos, el texto de varias líneas y las comas de los .srt', () => {
  const cues = parseVtt(VTT);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 3.5, text: 'Hola\nqué tal' });
  // 00:01:02,250 son 62,25 s: la coma decimal de los .srt también vale.
  assert.equal(cues[1].start, 62.25);
  assert.equal(cues[1].end, 64);
  // Lo que va detrás del final («line:90%») no es parte del tiempo.
  assert.equal(cues[1].text, 'Con coma y con posición');
});

test('los bloques sin tiempo o sin texto se saltan', () => {
  assert.equal(parseVtt('WEBVTT\n\nNOTE algo\n\n').length, 0);
  assert.equal(parseVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n\n').length, 0);
  assert.equal(parseVtt('').length, 0);
});

test('un VTT con saltos de Windows se lee igual', () => {
  assert.equal(parseVtt('WEBVTT\r\n\r\n1\r\n00:00:05.000 --> 00:00:06.000\r\nAhí\r\n').length, 1);
});

/** Lo mínimo de un TextTrack para poder probar applyCues sin navegador. */
function pistaFalsa() {
  const cues = [];
  return {
    cues,
    addCue(c) { cues.push(c); },
    removeCue(c) { const i = cues.indexOf(c); if (i >= 0) cues.splice(i, 1); },
  };
}

test('aplicar los subtítulos los desplaza por el salto y por el ajuste a mano', (t) => {
  // applyCues construye VTTCue, que no existe fuera del navegador.
  globalThis.VTTCue = class { constructor(start, end, text) { Object.assign(this, { start, end, text }); } };
  t.after(() => { delete globalThis.VTTCue; });

  const pista = pistaFalsa();
  const cues = parseVtt(VTT);

  applyCues(pista, cues, 0);
  assert.deepEqual(pista.cues.map((c) => c.start), [1, 62.25]);

  // Con la película arrancada en el segundo 60, el primero cae antes de cero y no se pone.
  applyCues(pista, cues, 60);
  assert.deepEqual(pista.cues.map((c) => c.start), [2.25]);

  // Medio segundo de retraso a mano.
  applyCues(pista, cues, 0, 0.5);
  assert.deepEqual(pista.cues.map((c) => c.start), [1.5, 62.75]);
});
