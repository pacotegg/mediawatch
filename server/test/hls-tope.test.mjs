// Tope de calidad en la lista maestra (`max=`), para el Chromecast fuera de casa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listaMaestra } from '../src/media/hls.ts';

const info = { video: { width: 1920, height: 1080 }, audio: [], duration: 100 };
const variantes = (txt) => txt.split('\n').filter((l) => l.includes('.m3u8')).map((l) => l.split('/hls/')[1].split('.m3u8')[0]);

test('sin tope ofrece toda la escalera', () => {
  assert.deepEqual(variantes(listaMaestra(1, info, '')), ['alta', 'media', 'baja']);
});
test('con tope 720 no ofrece 1080p', () => {
  assert.deepEqual(variantes(listaMaestra(1, info, '', null, 720)), ['media', 'baja']);
});
test('un tope por debajo de todo deja la más baja', () => {
  assert.deepEqual(variantes(listaMaestra(1, info, '', null, 240)), ['baja']);
});
