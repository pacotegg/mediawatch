/*
 * Lo que se guarda para todos o gasta el cupo diario de subtitulos es cosa del administrador: el desfase
 * manual de un subtitulo (vale para todos los perfiles) y buscar o bajar subtitulos de internet.
 * Servidor real en modo portable con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galletaAdmin, galletaNormal, fileId;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, { cuerpo, galleta, cabeceras = {} } = {}) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(galleta ? { Cookie: galleta } : {}), ...cabeceras },
  body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(8000),
});
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
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
  fileId = db.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,5400,1) RETURNING id').get(it.id, 'C:/no/existe/t.mkv').id;
  db.close();

  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  const normal = await (await pedir('POST', '/api/users', { cuerpo: { name: 'Normal', pin: '112233' }, galleta: galletaAdmin })).json();
  galletaNormal = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: normal.id, pin: '112233' } }));
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

const rutas = [
  ['guardar el desfase de un subtitulo', () => [`/api/play/${fileId}/offsets/embedded-0`, { offsetMs: 500 }]],
  ['buscar subtitulos', () => ['/api/subtitles/search', { fileId }]],
  ['bajar subtitulos', () => ['/api/subtitles/download', { fileId, provider: 'opensubtitles', subId: '1', language: 'es' }]],
  ['buscar subtitulos en lote', () => ['/api/subtitles/fetch', { fileId }]],
];

test('un perfil normal tiene sesion', () => assert.ok(galletaNormal.includes('=')));

for (const [nombre, lo] of rutas) {
  test(`un perfil normal no puede ${nombre}`, async () => {
    const [ruta, cuerpo] = lo();
    assert.equal((await pedir('POST', ruta, { galleta: galletaNormal, cuerpo })).status, 403);
  });
}

/*
 * Vista previa del selector de arte servida por el servidor (la tele solo carga imágenes por http): solo administrador y
 * solo de los orígenes de arte, para que no sirva para pedir cualquier dirección desde el servidor.
 */
test('la vista previa de arte externa es solo de administrador', async () => {
  const r = await pedir('GET', '/api/enrich/arte/vista?u=' + encodeURIComponent('https://image.tmdb.org/t/p/w342/x.jpg'), { galleta: galletaNormal });
  assert.equal(r.status, 403);
});

test('la vista previa de arte externa rechaza un origen que no es de arte', async () => {
  for (const u of ['http://127.0.0.1:8730/api/salud', 'https://ejemplo.invalid/x.jpg', 'file:///C:/Windows/win.ini', 'https://user:pw@image.tmdb.org/x.jpg']) {
    const r = await pedir('GET', '/api/enrich/arte/vista?u=' + encodeURIComponent(u), { galleta: galletaAdmin });
    assert.equal(r.status, 400, u);
  }
});

test('el administrador si puede guardar el desfase', async () => {
  const r = await pedir('POST', `/api/play/${fileId}/offsets/embedded-0`, { galleta: galletaAdmin, cuerpo: { offsetMs: 500 } });
  assert.equal(r.status, 200);
});
