/*
 * Tras escanear, el servidor mide SOLO los ficheros pendientes (nuevos o sustituidos). Antes un fichero sustituido se quedaba
 * con lo del .nfo viejo hasta reproducirlo: «Freddy contra Jason» salia como 2160p SDR siendo 1632p HDR10, y sin duracion no
 * hay barra, ni reanudar, ni «Seguir viendo» (01/11/2026). Servidor real con datos temporales y videos reales de 6 s.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = mkdtempSync(join(tmpdir(), 'mediawatch-medir-escaneo-'));
const datos = join(base, 'datos');
const pelis = join(base, 'peliculas');
const video = join(pelis, 'Prueba.Medir.2024', 'Prueba.Medir.2024.mkv');
let proceso, url, galleta;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, cuerpo) => fetch(url + ruta, {
  method: metodo,
  headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(galleta ? { Cookie: galleta } : {}) },
  body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(8000),
});
const fichero = () => {
  const db = new DatabaseSync(join(datos, 'tvwatch.db'), { readOnly: true });
  try { return db.prepare('SELECT probed, width, height FROM media_files').get(); } finally { db.close(); }
};
// Video real de 6 s (pasa el suelo de 5 MB del escaner): mpeg4 a calidad maxima + AC3.
const hacerVideo = (tam) => {
  const ffmpeg = process.env.MEDIAWATCH_FFMPEG || 'ffmpeg';
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${tam}:r=25:d=6`,
    '-f', 'lavfi', '-i', 'anoisesrc=d=6:c=pink', '-c:v', 'mpeg4', '-q:v', '1', '-c:a', 'ac3', video]);
  return r.status === 0;
};
const escanearYEsperarMedida = async (anchoEsperado) => {
  assert.equal((await pedir('POST', '/api/scan')).status, 200);
  for (let i = 0; i < 60; i++) {
    const f = fichero();
    if (f && f.probed === 1 && f.width === anchoEsperado) return f;
    await esperar(500);
  }
  return fichero();
};

let hayFfmpeg = false;
before(async () => {
  mkdirSync(join(pelis, 'Prueba.Medir.2024'), { recursive: true });
  mkdirSync(datos);
  writeFileSync(join(datos, 'config.json'), JSON.stringify({ libraries: [{ name: 'Pelis', path: pelis, kind: 'movie' }] }));
  const { config } = await import('../src/config.ts');
  process.env.MEDIAWATCH_FFMPEG = config.ffmpeg;
  hayFfmpeg = hacerVideo('1280x720');
  const puerto = await puertoLibre();
  url = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER, stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) },
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url + '/api/salud')).ok) break; } catch { /* arrancando */ }
    await esperar(500);
  }
  const host = new URL(url).host;
  await fetch(url + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: host, Origin: url }, body: JSON.stringify({ name: 'Admin', pin: '654321' }) });
  const login = await pedir('POST', '/api/auth/login', { userId: 1, pin: '654321' });
  galleta = (login.headers.get('set-cookie') ?? '').split(';')[0];
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  rmSync(base, { recursive: true, force: true });
});

test('un fichero nuevo queda medido tras escanear, sin reproducirlo', async (t) => {
  if (!hayFfmpeg) return t.skip('sin ffmpeg');
  assert.deepEqual({ ...(await escanearYEsperarMedida(1280)) }, { probed: 1, width: 1280, height: 720 });
});

test('un fichero sustituido por otro distinto se vuelve a medir tras escanear', async (t) => {
  if (!hayFfmpeg) return t.skip('sin ffmpeg');
  assert.ok(hacerVideo('1920x1080'), 'ffmpeg genera el video sustituto');
  assert.deepEqual({ ...(await escanearYEsperarMedida(1920)) }, { probed: 1, width: 1920, height: 1080 });
});
