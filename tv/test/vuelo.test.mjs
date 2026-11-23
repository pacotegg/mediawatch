import test from 'node:test';
import assert from 'node:assert/strict';
import { registrar, quitar, alOcultar, alVolver } from '../src/vuelo.ts';

test('al volver del reposo se cancelan las de antes, no las de después', () => {
  let a = 0, b = 0;
  const vieja = registrar({ abort: () => a++ }, 1000);
  alOcultar(2000);
  const nueva = registrar({ abort: () => b++ }, 3000);
  assert.equal(alVolver(), 1);
  assert.equal(a, 1);
  assert.equal(b, 0);
  assert.equal(vieja.despertada, true);
  assert.equal(nueva.despertada, false);
  assert.equal(alVolver(), 0, 'no se cancela dos veces');
  quitar(vieja); quitar(nueva);
});

test('una ya terminada no se cancela', () => {
  let a = 0;
  const v = registrar({ abort: () => a++ }, 5000);
  quitar(v);
  alOcultar(6000);
  assert.equal(alVolver(), 0);
  assert.equal(a, 0);
});
