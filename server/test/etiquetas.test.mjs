import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { etiquetasTecnicas } from '../src/media/etiquetas.ts';

const f = (width, height, hdr, audio) => ({ width, height, hdr, audio });

describe('etiquetasTecnicas', () => {
  test('sin ficheros no hay etiquetas', () => {
    assert.deepEqual(etiquetasTecnicas([]), []);
  });

  test('1080p sin HDR con AC3 5.1', () => {
    assert.deepEqual(etiquetasTecnicas([f(1920, 1080, null, [{ codec: 'ac3', channels: 6 }])]), ['5.1']);
  });

  test('4K con Dolby Vision y Atmos', () => {
    const t = etiquetasTecnicas([f(3840, 2160, 'DOLBYVISION', [{ codec: 'eac3_ddp_atmos', channels: 6 }])]);
    assert.deepEqual(t, ['4K', 'DV', 'Atmos', '5.1']);
  });

  test('HDR10, HDR10+ y HDR genérico se distinguen', () => {
    assert.ok(etiquetasTecnicas([f(3840, 2160, 'HDR10', [])]).includes('HDR10'));
    assert.ok(etiquetasTecnicas([f(3840, 2160, 'HDR10PLUS', [])]).includes('HDR10+'));
    assert.ok(etiquetasTecnicas([f(3840, 2160, 'HDR', [])]).includes('HDR'));
  });

  test('TrueHD Atmos y DTS-HD, 7.1', () => {
    assert.deepEqual(etiquetasTecnicas([f(3840, 2160, null, [{ codec: 'truehd_atmos', channels: 8 }])]), ['4K', 'Atmos', 'TrueHD', '7.1']);
    assert.deepEqual(etiquetasTecnicas([f(1920, 1080, null, [{ codec: 'dtshd_ma', channels: 8 }])]), ['DTS-HD', '7.1']);
  });

  test('con varias versiones manda la de mayor anchura', () => {
    const t = etiquetasTecnicas([f(1920, 1080, null, [{ codec: 'aac', channels: 2 }]), f(3840, 2160, 'HDR10', [{ codec: 'eac3', channels: 6 }])]);
    assert.deepEqual(t, ['4K', 'HDR10', '5.1']);
  });

  test('un 4K recortado (anchura 3840, altura 1600) sigue siendo 4K', () => {
    assert.ok(etiquetasTecnicas([f(3840, 1600, null, [])]).includes('4K'));
  });
});
