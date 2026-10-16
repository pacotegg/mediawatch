import test from 'node:test';
import assert from 'node:assert/strict';
import { tileCoordinates } from '../src/lib/trickplay.ts';

test('tileCoordinates con array vacio', () => {
  const coord = tileCoordinates([], 100, 10, 10);
  assert.equal(coord.index, 0);
  assert.equal(coord.sheet, 0);
  assert.equal(coord.percentX, 0);
  assert.equal(coord.percentY, 0);
});

test('tileCoordinates encuentra el fotograma mas cercano y calcula hoja, fila y columna', () => {
  // 150 miniaturas espaciadas cada 10 segundos
  const times = Array.from({ length: 150 }, (_, i) => i * 10);
  
  // Buscar en segundo 22 -> el más cercano es 20 (índice 2)
  const c1 = tileCoordinates(times, 22, 10, 10);
  assert.equal(c1.index, 2);
  assert.equal(c1.sheet, 0);
  assert.equal(c1.col, 2);
  assert.equal(c1.row, 0);
  assert.equal(c1.percentX, (2 / 9) * 100);
  assert.equal(c1.percentY, 0);

  // Buscar en segundo 1054 -> el más cercano es 1050 (índice 105)
  // En hojas de 10x10 (100 por hoja): índice 105 está en hoja 1, col 5, fila 0
  const c2 = tileCoordinates(times, 1054, 10, 10);
  assert.equal(c2.index, 105);
  assert.equal(c2.sheet, 1);
  assert.equal(c2.col, 5);
  assert.equal(c2.row, 0);
  assert.equal(c2.percentX, (5 / 9) * 100);
  assert.equal(c2.percentY, 0);

  // Última columna y última fila de la primera hoja (índice 99 -> col 9, fila 9)
  const c3 = tileCoordinates(times, 990, 10, 10);
  assert.equal(c3.index, 99);
  assert.equal(c3.sheet, 0);
  assert.equal(c3.col, 9);
  assert.equal(c3.row, 9);
  assert.equal(c3.percentX, 100);
  assert.equal(c3.percentY, 100);
});
