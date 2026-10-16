/*
 * desplazarVtt: los tiempos que escribe siempre son validos (HH:MM:SS.mmm, mmm de tres cifras), con cualquier desfase.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MEDIAWATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
const { desplazarVtt } = await import('../src/routes/play.ts');

const VTT = 'WEBVTT\n\n00:00:00.500 --> 00:00:01.000\nhola\n\n00:00:10.250 --> 00:00:12.750\nadios';
const TIEMPO = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

test('con desfases fraccionarios los tiempos siguen teniendo tres cifras de milisegundo', () => {
  for (const desfase of [0.4996, 0.0004, 1.9996, -0.0004, 3.14159, 12.3456, -0.4996]) {
    const salida = desplazarVtt(VTT, desfase);
    for (const [ini, fin] of [...salida.matchAll(/(\S+) --> (\S+)/g)].map((m) => [m[1], m[2]])) {
      assert.match(ini, TIEMPO, `inicio con desfase ${desfase}: ${ini}`);
      assert.match(fin, TIEMPO, `fin con desfase ${desfase}: ${fin}`);
    }
  }
});

test('desplaza de verdad, y tira lo que queda antes del cero', () => {
  const salida = desplazarVtt(VTT, -5);
  assert.ok(!salida.includes('hola'), 'el primero acaba antes de cero y se tira');
  assert.match(salida, /00:00:05\.250 --> 00:00:07\.750\nadios/);
});
