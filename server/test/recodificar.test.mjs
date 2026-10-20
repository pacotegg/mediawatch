import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argumentosHevc, encodeFallido, pistasQueFaltan, retirarOriginal, verificarRecodificado } from '../src/media/recodificar.ts';
import { probeFile } from '../src/media/probe.ts';

// En los ejecutores del CI no hay ffmpeg: sin él no se puede fabricar el vídeo de prueba.
const hayFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

/**
 * El 18/10/2026 el lote de recodificación no llevaba `-map 0` y ffmpeg se quedó con un solo audio en 101 ficheros.
 * Esta prueba fabrica un MKV con dos audios y un subtítulo, lo pasa por los argumentos del lote (con libx264 en vez de
 * QSV, que no hay en todas partes) y exige que salgan las mismas pistas. Con los argumentos viejos sale un audio.
 */
test('recodificar conserva todas las pistas de audio y subtítulos', { skip: !hayFfmpeg && 'no hay ffmpeg' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-recod-'));
  try {
    const srt = join(dir, 'sub.srt');
    writeFileSync(srt, '1\n00:00:00,500 --> 00:00:01,500\nHola\n');
    const original = join(dir, 'original.mkv');
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x90:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
      '-i', srt,
      '-map', '0', '-map', '1', '-map', '2', '-map', '3',
      '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'srt',
      '-metadata:s:a:0', 'language=spa', '-metadata:s:a:1', 'language=eng', original]);
    assert.equal(r.status, 0, String(r.stderr));
    const antes = await probeFile(original);
    assert.equal(antes.audio.length, 2);
    assert.equal(antes.subs.length, 1);

    const salida = join(dir, 'nuevo.mkv');
    const args = argumentosHevc(original, salida, antes).map((a) => (a === 'hevc_qsv' ? 'libx264' : a));
    assert.equal(spawnSync('ffmpeg', args).status, 0);
    const despues = await probeFile(salida);
    assert.equal(pistasQueFaltan(antes, despues), null);
    assert.deepEqual(despues.audio.map((a) => a.language), ['spa', 'eng']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pistasQueFaltan detecta un audio o un subtítulo de menos', () => {
  const a = (n) => Array.from({ length: n }, () => ({}));
  assert.equal(pistasQueFaltan({ audio: a(2), subs: a(1) }, { audio: a(2), subs: a(1) }), null);
  assert.equal(pistasQueFaltan({ audio: a(2), subs: a(1) }, { audio: a(1), subs: a(1) }), 'audio 2 -> 1');
  assert.equal(pistasQueFaltan({ audio: a(1), subs: a(2) }, { audio: a(1), subs: a(0) }), 'subtítulos 2 -> 0');
});

test('los subtítulos de MP4 (mov_text) se pasan a SRT, que sí cabe en MKV', () => {
  const conMovText = argumentosHevc('a.mp4', 'b.mkv', { subs: [{ codec: 'mov_text' }] });
  assert.ok(conMovText.join(' ').includes('-c:s srt'));
  assert.ok(!argumentosHevc('a.mkv', 'b.mkv', { subs: [{ codec: 'subrip' }] }).includes('srt'));
});

test('retirarOriginal aparta el fichero sin borrarlo, conservando su ruta relativa', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'mw-retirar-'));
  try {
    const carpeta = join(raiz, 'Series', 'Una serie (2000)');
    mkdirSync(carpeta, { recursive: true });
    const fichero = join(carpeta, 'ep1.mkv');
    writeFileSync(fichero, 'x');
    const destino = retirarOriginal(fichero, new Date('2026-10-19T10:00:00Z'), raiz);
    assert.equal(destino, join(raiz, '_retirados', '2026-10-19', 'Series', 'Una serie (2000)', 'ep1.mkv'));
    assert.ok(existsSync(destino));
    assert.ok(!existsSync(fichero));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

/**
 * La verificación del lote (19/10/2026) comparaba idiomas, no pistas, y la duración del contenedor, no la del vídeo:
 * encode.ps1 descarta a propósito pistas «redundantes» del mismo idioma y en Casino Royale el vídeo dura 7 min menos
 * que el audio sin que el contenedor lo diga. Las dos cosas tienen que rechazarse.
 */
test('verificarRecodificado exige paridad pista a pista y la duración del vídeo', () => {
  const a = (language, channels) => ({ language, channels });
  const base = (audio, subs = []) => ({ duration: 6000, video: { codec: 'h264', width: 1920, height: 1080 }, audio, subs });
  const orig = base([a('eng', 6), a('eng', 6), a('spa', 2)], [{ language: 'spa', forced: true }, { language: 'spa', forced: false }]);
  const igual = { ...orig, video: { codec: 'hevc', width: 1920, height: 1080 } };
  assert.equal(verificarRecodificado(orig, igual, 1000, 500, 6000, 6000), null);
  // Dedup del pipeline: dos ingleses 5.1 -> uno. Por idiomas «está todo»; por pistas, falta una.
  assert.match(verificarRecodificado(orig, { ...igual, audio: [a('eng', 6), a('spa', 2)] }, 1000, 500, 6000, 6000), /pista de audio perdida: eng 6/);
  // Bajar canales también es perder.
  assert.match(verificarRecodificado(orig, { ...igual, audio: [a('eng', 6), a('eng', 2), a('spa', 2)] }, 1000, 500, 6000, 6000), /perdida/);
  // El forzado cuenta aparte del completo.
  assert.match(verificarRecodificado(orig, { ...igual, subs: [{ language: 'spa', forced: false }, { language: 'spa', forced: false }] }, 1000, 500, 6000, 6000), /subtítulo perdido: spa forzado/);
  // Vídeo cortado con el audio entero: el contenedor dice 6000 en los dos.
  assert.match(verificarRecodificado(orig, igual, 1000, 500, 6000, 5570), /duración del vídeo/);
  assert.match(verificarRecodificado(orig, igual, 1000, 500, 6000, NaN), /duración del vídeo/);
  // Mismo conjunto de idiomas pero reordenado (20/10/2026: spa,eng,cat -> eng,spa,cat): los perfiles guardan la pista por índice.
  const sb = (l) => ({ language: l, forced: false });
  const conSubs = (subs) => ({ ...base([a('spa', 2)], subs), video: igual.video });
  assert.match(verificarRecodificado(base([a('spa', 2)], [sb('spa'), sb('eng'), sb('cat')]), conSubs([sb('eng'), sb('spa'), sb('cat')]), 1000, 500, 6000, 6000), /subtítulos en otro orden: spa,eng,cat -> eng,spa,cat/);
  assert.match(verificarRecodificado(base([a('spa', 2), a('eng', 2)]), { ...base([a('eng', 2), a('spa', 2)]), video: igual.video }, 1000, 500, 6000, 6000), /audio en otro orden/);
  // Ganar una pista al final o en medio sin reordenar lo anterior no es reordenar.
  assert.equal(verificarRecodificado(base([a('spa', 2)], [sb('spa')]), conSubs([sb('spa'), sb('eng')]), 1000, 500, 6000, 6000), null);
  assert.equal(verificarRecodificado(base([a('spa', 2)], []), conSubs([sb('eng')]), 1000, 500, 6000, 6000), null);
  // Con más canales en la salida, vale.
  assert.equal(verificarRecodificado(base([a('spa', 2)]), { ...base([a('spa', 6)]), video: igual.video }, 1000, 500, 6000, 6000), null);
});

test('encodeFallido reconoce el registro de un encode que ffmpeg abandono (20/10/2026: Be Water, QSV -40)', () => {
  const malo = 'Error reinitializing filters!\nTask finished with error code: -40 (Function not implemented)\nConversion failed!\n';
  assert.equal(encodeFallido(malo), true);
  assert.equal(encodeFallido('frame= 100 fps=120\nvideo:52KiB audio:62KiB\n'), false);
  assert.equal(encodeFallido(''), false);
});
