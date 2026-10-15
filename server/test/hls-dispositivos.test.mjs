/*
 * Dos aparatos viendo la misma pelicula con los mismos ajustes tienen cada uno su ffmpeg: antes
 * compartian sesion y, cuando uno cerraba o saltaba, al otro se le cortaba la conversion.
 * Necesita ffmpeg (en los ejecutores del CI no hay: se salta). Servidor real con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const hayFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let proceso, datos, base, galletaA, galletaB, fileId;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, galleta, cuerpo) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), Cookie: galleta },
  body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(60_000),
});
const login = async () => (await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 1, pin: '654321' }),
})).headers.get('set-cookie').split(';')[0];
const carpetas = () => { try { return readdirSync(join(datos, 'transcode', 'hls')); } catch { return []; } };

before(async () => {
  if (!hayFfmpeg) return;
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  const video = join(datos, 'prueba.mkv');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=20:size=320x180:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-g', '10', '-c:a', 'aac', '-shortest', video]);

  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER, stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) },
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/salud')).ok) break; } catch { /* arrancando */ }
    await esperar(500);
  }
  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
  const it = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie','p','t','t','x') RETURNING id").get();
  fileId = db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,20,1) RETURNING id').get(it.id, video.replace(/\\/g, '/')).id;
  db.close();

  const host = new URL(base).host;
  await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: host, Origin: base }, body: JSON.stringify({ name: 'Admin', pin: '654321' }) });
  galletaA = await login(); // dos entradas = dos aparatos
  galletaB = await login();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(1500); }
  try { if (datos) rmSync(datos, { recursive: true, force: true }); } catch { /* temporal */ }
});

test('dos aparatos con los mismos ajustes tienen cada uno su sesion, y cerrar la de uno no toca la del otro', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  const ruta = `/api/play/${fileId}/hls/baja/0.ts`;
  const a = await pedir('GET', ruta, galletaA);
  const b = await pedir('GET', ruta, galletaB);
  assert.equal(a.status, 200, 'el aparato A no recibio el trozo');
  assert.equal(b.status, 200, 'el aparato B no recibio el trozo');
  assert.equal(carpetas().length, 2, 'cada aparato debia tener su carpeta de trabajo: ' + carpetas().join(', '));

  assert.equal((await pedir('POST', `/api/play/${fileId}/hls/cerrar`, galletaA)).status, 200);
  assert.equal(carpetas().length, 1, 'cerrar el aparato A debia dejar solo la sesion de B: ' + carpetas().join(', '));
});
