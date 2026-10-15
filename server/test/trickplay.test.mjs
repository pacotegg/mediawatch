/*
 * Las hojas de la barra de progreso: las nuevas se guardan en WebP (ocupan un 33 % menos) y las que
 * ya estaban en JPEG se siguen sirviendo. Servidor real en modo portable con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galleta, fileId, fileViejo;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (ruta, opciones = {}) => fetch(base + ruta, { headers: { Cookie: galleta }, signal: AbortSignal.timeout(60_000), ...opciones });

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  // Un vídeo de verdad, corto: sin esto no hay fotogramas clave que convertir en miniaturas.
  const video = join(datos, 'prueba.mkv');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=20:size=320x180:rate=10', '-c:v', 'libx264', '-g', '10', video]);

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
  const alta = (titulo, ruta) => {
    // Más de 300 s porque el lote salta lo corto; el vídeo de verdad dura 20 s, que es lo que se lee.
    const it = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie',?,?,?,'x') RETURNING id").get(titulo, titulo, titulo);
    return db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,6000,1) RETURNING id').get(it.id, ruta.replace(/\\/g, '/')).id;
  };
  // `media_files.path` es único: la segunda entrada necesita su propio fichero.
  const video2 = join(datos, 'prueba2.mkv');
  copyFileSync(video, video2);
  fileId = alta('nueva', video);
  fileViejo = alta('vieja', video2);
  db.close();

  // Una hoja «de antes», en JPEG, puesta a mano con su apunte.
  const dirViejo = join(datos, 'trickplay', String(fileViejo));
  mkdirSync(dirViejo, { recursive: true });
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=1600x680:d=1', '-frames:v', '1', join(dirViejo, 'sheet-001.jpg')]);
  writeFileSync(join(dirViejo, 'manifest.json'), JSON.stringify({
    fileId: fileViejo, tileWidth: 160, tileHeight: 68, columns: 10, rows: 10, sheets: 1, times: [0], generatedAt: new Date().toISOString(),
  }));

  const host = new URL(base).host;
  await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: host, Origin: base }, body: JSON.stringify({ name: 'Admin', pin: '654321' }) });
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 1, pin: '654321' }) });
  galleta = (login.headers.get('set-cookie') ?? '').split(';')[0];
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('una hoja nueva se genera y se sirve en WebP', async () => {
  // Quien genera las miniaturas es el lote (la ruta del apunte solo lo lee).
  const lanzado = await pedir('/api/trickplay/lote', {
    method: 'POST', headers: { Cookie: galleta, 'Content-Type': 'application/json' }, body: JSON.stringify({ todo: true }),
  });
  assert.equal(lanzado.status, 200, 'no arrancó el lote');

  let manifest = null;
  for (let i = 0; i < 40; i++) {
    const r = await pedir(`/api/play/${fileId}/trickplay`);
    if (r.ok) { manifest = await r.json(); break; }
    await esperar(1000);
  }
  assert.ok(manifest, 'no se generaron las miniaturas');
  assert.ok(manifest.sheets >= 1, 'el apunte no tiene hojas');

  const hoja = await pedir(`/api/play/${fileId}/trickplay/0.jpg`);
  assert.equal(hoja.status, 200);
  assert.equal(hoja.headers.get('content-type'), 'image/webp', 'la hoja nueva debería ser WebP');
  // Las dos primeras letras de un WebP son «RIFF»; así se ve que no es un JPEG con otro nombre.
  const bytes = Buffer.from(await hoja.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP');
});

test('una hoja antigua en JPEG se sigue sirviendo', async () => {
  const hoja = await pedir(`/api/play/${fileViejo}/trickplay/0.jpg`);
  assert.equal(hoja.status, 200);
  assert.equal(hoja.headers.get('content-type'), 'image/jpeg');
  const bytes = Buffer.from(await hoja.arrayBuffer());
  assert.equal(bytes[0], 0xff, 'no empieza como un JPEG');
  assert.equal(bytes[1], 0xd8, 'no empieza como un JPEG');
});

test('una hoja que no existe da 404', async () => {
  assert.equal((await pedir(`/api/play/${fileViejo}/trickplay/99.jpg`)).status, 404);
});
