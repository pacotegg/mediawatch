import test from 'node:test';
import assert from 'node:assert/strict';
import { posicionDeReintento } from '../src/reintento.ts';

test('corte de red: AVPlay dice 0 y se reabre en la última posición buena', () => {
  assert.equal(posicionDeReintento(null, 0, 421), 421);
});
test('con tubería el reloj cae al desfase y no al punto donde iba', () => {
  assert.equal(posicionDeReintento(null, 300, 421), 421);
});
test('error normal: manda la lectura actual si va por delante', () => {
  assert.equal(posicionDeReintento(null, 430, 421), 430);
});
test('un salto a medias manda sobre todo lo demás', () => {
  assert.equal(posicionDeReintento(120, 0, 421), 120);
});
test('nunca devuelve negativo', () => {
  assert.equal(posicionDeReintento(-5, 0, 0), 0);
});
