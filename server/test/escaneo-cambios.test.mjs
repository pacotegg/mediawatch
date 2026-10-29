/*
 * Al acabar un escaneo, cuántos títulos y ficheros han entrado y salido (pedido el 29/10/2026). Se compara por carpeta
 * y por ruta, nunca por id: los ids se renumeran en cada escaneo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararFotos } from '../src/media/estado-escaneo.ts';

const foto = (titulos, ficheros) => ({ titulos: new Map(titulos), ficheros: new Set(ficheros) });

test('cuenta títulos y ficheros añadidos y retirados, con los nombres de los títulos nuevos', () => {
  const antes = foto([['E:/Peliculas/A', 'A'], ['E:/Peliculas/B', 'B']], ['E:/Peliculas/A/a.mkv', 'E:/Peliculas/B/b.mkv']);
  const despues = foto([['E:/Peliculas/A', 'A'], ['E:/Peliculas/C', 'C']], ['E:/Peliculas/A/a.mkv', 'E:/Peliculas/C/c.mkv', 'E:/Peliculas/C/c2.mkv']);
  assert.deepEqual(compararFotos(antes, despues), {
    titulosAnadidos: 1,
    titulosRetirados: 1,
    ficherosAnadidos: 2,
    ficherosRetirados: 1,
    nuevos: ['C'],
    retirados: ['B'],
  });
});

test('sin cambios da ceros, y los nombres se cortan en 5', () => {
  const muchos = [1, 2, 3, 4, 5, 6, 7].map((n) => ['E:/S/' + n, 'T' + n]);
  assert.deepEqual(compararFotos(foto([], []), foto([], [])), {
    titulosAnadidos: 0, titulosRetirados: 0, ficherosAnadidos: 0, ficherosRetirados: 0, nuevos: [], retirados: [],
  });
  const r = compararFotos(foto([], []), foto(muchos, []));
  assert.equal(r.titulosAnadidos, 7);
  assert.deepEqual(r.nuevos, ['T1', 'T2', 'T3', 'T4', 'T5']);
});
