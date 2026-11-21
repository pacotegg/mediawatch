import test from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaNR } from '../src/edad.ts';

test('NR en español: «Sin calificación»', () => {
  assert.equal(etiquetaNR('NR', true), 'Sin calificación');
  assert.equal(etiquetaNR(' nr ', true), 'Sin calificación');
});
test('NR en inglés: «NR»', () => {
  assert.equal(etiquetaNR('NR', false), 'NR');
});
test('cualquier otra calificación no es de esta función', () => {
  assert.equal(etiquetaNR('ES:12 / ES:12/fig', true), null);
  assert.equal(etiquetaNR('US:PG-13', false), null);
});
test('sin dato no inventa nada', () => {
  assert.equal(etiquetaNR(null, true), null);
  assert.equal(etiquetaNR('', true), null);
  assert.equal(etiquetaNR(undefined, false), null);
});
