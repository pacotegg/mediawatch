import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioCompatible, audioDelCliente } from '../src/routes/play.ts';

test('perfil lgwebos reconoce audio nativo garantizado en LG Smart TV', () => {
  const codecs = audioDelCliente('lgwebos');
  assert.ok(codecs, 'el perfil lgwebos debe existir en el servidor');

  // Formatos garantizados por la especificacion oficial de LG webOS (modelos 4K)
  assert.equal(audioCompatible('lgwebos', 'aac'), true, 'AAC debe ser compatible');
  assert.equal(audioCompatible('lgwebos', 'ac3'), true, 'AC3 debe ser compatible');
  assert.equal(audioCompatible('lgwebos', 'eac3'), true, 'EAC3 debe ser compatible');
  assert.equal(audioCompatible('lgwebos', 'eac3_ddp_atmos'), true, 'EAC3 Atmos debe ser compatible');
  assert.equal(audioCompatible('lgwebos', 'mp3'), true, 'MP3 debe ser compatible');
  assert.equal(audioCompatible('lgwebos', 'opus'), true, 'Opus debe ser compatible');
  assert.equal(audioCompatible('lgwebos', 'pcm_s16le'), true, 'PCM debe ser compatible');

  // Formatos no soportados nativamente en webOS -> deben dar false para transcodificar a DD+
  assert.equal(audioCompatible('lgwebos', 'dts'), false, 'DTS no debe ser compatible directo');
  assert.equal(audioCompatible('lgwebos', 'dtshd_ma'), false, 'DTS-HD MA no debe ser compatible directo');
  assert.equal(audioCompatible('lgwebos', 'truehd'), false, 'TrueHD no debe ser compatible directo');
  assert.equal(audioCompatible('lgwebos', 'truehd_atmos'), false, 'TrueHD Atmos no debe ser compatible directo');
  assert.equal(audioCompatible('lgwebos', 'flac'), false, 'FLAC en video no debe ser compatible directo');
});
