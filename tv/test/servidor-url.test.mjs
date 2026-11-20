import test from 'node:test';
import assert from 'node:assert/strict';
import { urlServidor, quitarEsquema } from '../src/servidor-url.ts';

test('IP con puerto va por http', () => {
  assert.equal(urlServidor('192.168.31.16:8730'), 'http://192.168.31.16:8730');
});
test('nombre con letras va por https', () => {
  assert.equal(urlServidor('TV.ejemplo.org'), 'https://tv.ejemplo.org');
});
test('quita esquema y barras', () => {
  assert.equal(quitarEsquema('https://a.b.c/'), 'a.b.c');
  assert.equal(urlServidor('http://a.b.c/'), 'https://a.b.c');
});
