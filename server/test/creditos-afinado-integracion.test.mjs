/*
 * El afinado entero (subtitulo + blackdetect + base de datos + deshacer) sobre una pelicula sintetica:
 * 28:20 de imagen, 10 s de negro y 2:30 de «creditos»; dialogo hasta el 28:10; detector tarde (29:40).
 * Se salta si no hay ffmpeg. Corre en un proceso aparte con datos temporales: no toca ninguna BD real.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AYUDA = join(dirname(fileURLToPath(import.meta.url)), 'ayudas', 'afinado-integracion.mjs');
const hayFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let carpeta;

before(() => { carpeta = mkdtempSync(join(tmpdir(), 'mediawatch-afinado-')); });
after(() => { if (carpeta) rmSync(carpeta, { recursive: true, force: true }); });

test('afina, no repite lo ya mirado y se puede deshacer', { skip: !hayFfmpeg && 'no hay ffmpeg' }, () => {
  const video = join(carpeta, 'peli.mkv');
  const srt = join(carpeta, 'peli.srt');
  const hms = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
  let texto = '';
  for (let i = 0; i < 28; i++) texto += `${i + 1}\n${hms(60 + i * 60)} --> ${hms(62 + i * 60)}\nlinea ${i}\n\n`;
  writeFileSync(srt, texto); // ultima linea en 60 + 27 * 60 = 1680 s
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=1700',
    '-f', 'lavfi', '-i', 'color=c=black:size=160x90:rate=10:duration=10',
    '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=150',
    '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40', video], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'no se pudo crear el video de prueba: ' + r.stderr);

  const p = spawnSync(process.execPath, [AYUDA, video, srt], {
    cwd: dirname(AYUDA),
    env: { ...process.env, MEDIAWATCH_DATA_DIR: join(carpeta, 'datos') },
    encoding: 'utf8',
    timeout: 240_000,
  });
  assert.equal(p.status, 0, p.stderr);
  const salida = JSON.parse(p.stdout.trim().split('\n').pop());

  assert.equal(salida.total, 1);
  assert.equal(salida.afinadas, 1);
  assert.equal(salida.tras.metodo, 'texto-sube+negro');
  const inicio = JSON.parse(salida.tras.rangos)[0].start_s;
  assert.ok(Math.abs(inicio - 1700) <= 1, `el inicio debia caer en el negro (1700 s) y fue ${inicio}`);
  assert.equal(JSON.parse(salida.tras.rangos)[0].end_s, 1850, 'el final no se toca');
  assert.equal(salida.tras.rangos_texto, '[{"start_s":1780,"end_s":1850}]', 'el original queda guardado');
  assert.equal(salida.segunda, 0, 'lo ya mirado no se vuelve a mirar');
  assert.equal(salida.vueltas, 1);
  assert.equal(salida.final.metodo, 'texto-sube');
  assert.equal(salida.final.rangos, '[{"start_s":1780,"end_s":1850}]');
});
