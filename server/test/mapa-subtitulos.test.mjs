import test from 'node:test';
import assert from 'node:assert/strict';
import { mapaSubtitulos } from '../src/media/mapa-subtitulos.ts';

test('MP4 (nombre de contenedor de ffprobe): no se mapean subtitulos, mov_text no cabe en Matroska', () => {
  assert.deepEqual(mapaSubtitulos('mov,mp4,m4a,3gp,3g2,mj2'), []);
  assert.deepEqual(mapaSubtitulos('mp4'), []);
  assert.deepEqual(mapaSubtitulos('m4v'), []);
});
test('MKV conserva el mapeo de subtitulos', () => {
  assert.deepEqual(mapaSubtitulos('matroska,webm'), ['-map', '0:s?']);
});
