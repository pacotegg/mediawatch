/*
 * Deteccion del «Anteriormente en…» con el indice de dialogos (src/media/resumenes.ts). Pura: los casos son
 * los patrones medidos en la biblioteca real el 15/10/2026.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MEDIAWATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
const { detectarResumen } = await import('../src/media/resumenes.ts');

const frases = ['Plant it in his suite tonight.', 'Your mother is well, we look after her.', 'He is really worried about Ingrid.',
  'I could move in with her for a while.', 'No need to ask what you are doing here.', 'The package has arrived this morning.'];
const anterior = frases.map((text, i) => ({ text, ms: 300_000 + i * 400_000 }));     // dispersas por el episodio anterior
const relleno = [{ text: 'Una frase nueva de este episodio, larga.', ms: 120_000 }];

test('frases de sitios dispersos del anterior, al principio: es un resumen', () => {
  const actual = [...frases.map((text, i) => ({ text, ms: 5_000 + i * 8_000 })), ...relleno];
  const r = detectarResumen(actual, [anterior]);
  assert.ok(r);
  assert.equal(r.inicioMs, 5_000);
  assert.equal(r.frases, 6);
});

test('el mismo subtitulo en la misma posicion (episodio doble): no es un resumen', () => {
  const doble = frases.map((text, i) => ({ text, ms: i * 5_000 }));
  assert.equal(detectarResumen(doble, [doble]), null);
});

test('pocas frases, o que empiezan tarde: no es un resumen', () => {
  assert.equal(detectarResumen(frases.slice(0, 3).map((text, i) => ({ text, ms: 5_000 + i * 8_000 })), [anterior]), null);
  assert.equal(detectarResumen(frases.map((text, i) => ({ text, ms: 200_000 + i * 8_000 })), [anterior]), null);
});

test('las frases cortas que se repiten en cualquier episodio no cuentan', () => {
  const cortas = ['¿Qué?', 'Sí.', 'Vamos.', 'No lo sé.', 'Gracias.'].map((text, i) => ({ text, ms: 2_000 + i * 3_000 }));
  assert.equal(detectarResumen(cortas, [cortas.map((c) => ({ ...c, ms: c.ms + 600_000 }))]), null);
});

test('las acotaciones para sordos no cuentan, y un «resumen» de pocos segundos (tiempos rotos) no vale', () => {
  const acot = ['(THEME MUSIC PLAYING)', '(PHONE RINGING)', '[RISAS EN EL PUBLICO]', '♪ Be all right ♪', '(DOOR CLOSES LOUDLY)'];
  assert.equal(detectarResumen(acot.map((text, i) => ({ text, ms: 2_000 + i * 6_000 })), [acot.map((text, i) => ({ text, ms: 500_000 + i * 90_000 }))]), null);
  const enCero = frases.map((text) => ({ text, ms: 0 }));
  assert.equal(detectarResumen(enCero, [anterior]), null);
});
