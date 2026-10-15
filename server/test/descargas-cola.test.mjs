/*
 * Las copias para descargar se convierten de una en una (antes, cada peticion lanzaba su ffmpeg al momento,
 * sin limite). Dos peticiones: nunca avanzan las dos a la vez, y las dos acaban listas.
 * Necesita ffmpeg (en el CI no hay: se salta). Servidor real con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const hayFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
let proceso, datos, base, galletaA, galletaB, fileId, fileId2;

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
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=90:size=640x360:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=90', '-c:v', 'libx264', '-g', '10', '-c:a', 'aac', '-shortest', video]);

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
  fileId = db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,90,1) RETURNING id').get(it.id, video.replace(/\\/g, '/')).id;
  const video2 = join(datos, 'prueba2.mkv');
  copyFileSync(video, video2);
  const it2 = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie','q','u','u','x') RETURNING id").get();
  fileId2 = db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,90,1) RETURNING id').get(it2.id, video2.replace(/\\/g, '/')).id;
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

test('dos descargas: se convierten de una en una y las dos terminan', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  for (const f of [fileId, fileId2]) {
    const r = await pedir('POST', '/api/descargas', galletaA, { fileId: f, perfil: 'baja', codec: 'h264' });
    assert.equal(r.status, 200, await r.text());
  }
  let maxAvanzando = 0, listas = 0;
  for (let i = 0; i < 600 && listas < 2; i++) {
    const { descargas } = await (await pedir('GET', '/api/descargas', galletaA)).json();
    maxAvanzando = Math.max(maxAvanzando, descargas.filter((d) => d.estado === 'preparando' && d.progreso > 0).length);
    listas = descargas.filter((d) => d.estado === 'lista').length;
    assert.ok(!descargas.some((d) => d.estado === 'error'), JSON.stringify(descargas));
    await esperar(200);
  }
  assert.equal(listas, 2, 'no terminaron las dos');
  assert.ok(maxAvanzando <= 1, `avanzaban ${maxAvanzando} a la vez`);
});
