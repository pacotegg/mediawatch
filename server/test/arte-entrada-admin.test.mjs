/*
 * El arte de un título de una carpeta de ENTRADA del scraper (C:\Videos) lo ve el administrador (el Asistente y la Biblioteca del Scraper lo
 * pintan) y nadie más: antes las rutas de imagen leían la vista de bibliotecas, daban 404 y el paso «Elige el arte» salía con las imágenes
 * rotas aunque el cartel, el fondo y el logo estuvieran bien guardados. Servidor real con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galletaAdmin, galletaNormal, idEntrada, idBiblioteca;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, { cuerpo, galleta } = {}) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(galleta ? { Cookie: galleta } : {}) },
  body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(8000),
});
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], { cwd: SERVER, stdio: 'ignore', env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) } });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/salud')).ok) break; } catch { /* arrancando */ }
    await esperar(500);
  }
  const host = new URL(base).host;
  await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: host, Origin: base }, body: JSON.stringify({ name: 'Admin', pin: '654321' }) });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  const normal = await (await pedir('POST', '/api/users', { cuerpo: { name: 'Normal', pin: '112233' }, galleta: galletaAdmin })).json();
  galletaNormal = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: normal.id, pin: '112233' } }));
  const png = join(datos, 'cartel.png');
  writeFileSync(png, PNG);
  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT INTO libraries (id,name,path,kind,entrada) VALUES (7,'Videos','x','movie',1)").run();
  db.prepare("INSERT INTO libraries (id,name,path,kind,entrada) VALUES (8,'Pelis','y','movie',0)").run();
  const nuevo = (lib, t) => db.prepare('INSERT INTO items (library_id, kind, folder, title, search_title, poster, scanned_at) VALUES (?,?,?,?,?,?,?) RETURNING id').get(lib, 'movie', 'p' + t, t, t.toLowerCase(), png, 'x').id;
  idEntrada = nuevo(7, 'Entrada');
  idBiblioteca = nuevo(8, 'Biblioteca');
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('el administrador ve el cartel de un título de una carpeta de entrada', async () => {
  const r = await pedir('GET', `/api/items/${idEntrada}/poster`, { galleta: galletaAdmin });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /image/);
  assert.ok((await r.arrayBuffer()).byteLength > 0);
});

test('un perfil normal NO lo ve (lo de entrada no existe para los clientes)', async () => {
  assert.equal((await pedir('GET', `/api/items/${idEntrada}/poster`, { galleta: galletaNormal })).status, 404);
});

test('lo de una biblioteca de verdad lo ven los dos', async () => {
  assert.equal((await pedir('GET', `/api/items/${idBiblioteca}/poster`, { galleta: galletaAdmin })).status, 200);
  assert.equal((await pedir('GET', `/api/items/${idBiblioteca}/poster`, { galleta: galletaNormal })).status, 200);
});

test('la ficha de datos de un título de entrada también la ve solo el administrador (la pestaña Datos del Scraper)', async () => {
  assert.equal((await pedir('GET', `/api/items/${idEntrada}`, { galleta: galletaAdmin })).status, 200);
  assert.equal((await pedir('GET', `/api/items/${idEntrada}`, { galleta: galletaNormal })).status, 404);
});
