/*
 * Dónde empieza de verdad un flujo cortado con `-ss -c copy`: el fotograma clave anterior a lo pedido (13/11/2026).
 * `elegirInicio` es pura; `inicioDelCorte` se prueba contra un vídeo con un fotograma clave cada 2 s (necesita ffmpeg).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MEDIAWATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'corte-datos-'));
const { elegirInicio, inicioDelCorte } = await import('../src/media/corte.ts');

test('elige el fotograma clave más tardío que no pasa de lo pedido', () => {
  const salida = ['1800.000000,K__', '1800.167000,___', '1800.042000,___', '1810.000000,K__'].join('\n');
  assert.equal(elegirInicio(salida, 1805), 1800);
  assert.equal(elegirInicio(salida, 1810), 1810);
  assert.equal(elegirInicio(salida, 1799), null);
});

test('ignora líneas vacías, sin bandera o con valores raros', () => {
  assert.equal(elegirInicio('\nN/A,K__\n12.5,___\n', 20), null);
  assert.equal(elegirInicio('12.5,K_\r\n', 20), 12.5);
});

const hayFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let dir, video;
before(() => {
  if (!hayFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), 'corte-'));
  video = join(dir, 'v.mkv');
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25', '-t', '20',
    '-c:v', 'libx264', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0', video]);
  assert.equal(r.status, 0, String(r.stderr));
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('contra un vídeo real: pedir 7 empieza en 6, pedir 8 en 8 y pedir 0 en 0', { skip: !hayFfmpeg }, async () => {
  const tam = statSync(video).size;
  assert.equal(await inicioDelCorte(video, tam, 7.9), 6);
  assert.equal(await inicioDelCorte(video, tam, 8), 8);
  assert.equal(await inicioDelCorte(video, tam, 0), 0);
});
