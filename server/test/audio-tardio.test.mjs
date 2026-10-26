/*
 * AVPlay (QN93A) no termina de preparar un fichero cuyo primer paquete de audio llega a 15 s o más
 * del vídeo: se queda en IDLE sin error (medido el 26/10/2026 con «Historias de fantasmas», audio a
 * 19,3 s; a 14 s prepara, a 15 s no). El servidor debe detectarlo para servir ese audio con silencio
 * delante. Necesita ffmpeg y ffprobe (en el CI no hay: se salta).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// probe.ts abre la base al importarse: carpeta de datos temporal, nunca la real.
process.env.MEDIAWATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'audio-tardio-datos-'));
const { audioTardio, retrasoDeAudio } = await import('../src/media/probe.ts');

const hayFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let dir, tarde, normal;

before(() => {
  if (!hayFfmpeg) return;
  dir = mkdtempSync(join(tmpdir(), 'audio-tardio-'));
  const hacer = (nombre, desfase) => {
    const f = join(dir, nombre);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=2:d=24',
      '-itsoffset', String(desfase), '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'ac3', f]);
    assert.equal(r.status, 0, String(r.stderr));
    return f;
  };
  tarde = hacer('tarde.mkv', 18);
  normal = hacer('normal.mkv', 0);
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('mide cuánto llega el audio después del vídeo', { skip: !hayFfmpeg }, async () => {
  const r = await retrasoDeAudio(tarde, statSync(tarde).size, 1);
  assert.ok(r > 17 && r < 19, `esperaba ~18 s, salió ${r}`);
  assert.ok((await retrasoDeAudio(normal, statSync(normal).size, 1)) < 1);
});

test('un fichero que no existe no rompe: se sirve como hasta ahora', async () => {
  assert.equal(await retrasoDeAudio(join(tmpdir(), 'no-existe.mkv'), 0, 1), 0);
});

test('audioTardio: umbral de 12 s contando lo que ya se salta al reanudar', () => {
  assert.equal(audioTardio(19.3, 0), true);
  assert.equal(audioTardio(14.65, 0), true); // pasa de 12: se trata igual aunque AVPlay lo aguantaba
  assert.equal(audioTardio(9, 0), false);
  assert.equal(audioTardio(19.3, 10), false); // reanudando en el 10, el audio queda a 9,3 s
  assert.equal(audioTardio(19.3, 5), true);
});
