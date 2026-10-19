import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argumentosHevc, pistasQueFaltan, retirarOriginal } from '../src/media/recodificar.ts';
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
