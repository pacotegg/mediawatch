/*
 * Pruebas de la búsqueda multicomponente y tolerante a erratas (/api/search):
 * - Varias palabras en cualquier orden («mitchell maquinas», «senor anillos»).
 * - Coincidencia por colección o saga («batman» -> El caballero oscuro).
 * - Coincidencia por título original («dark knight» -> El caballero oscuro).
 * - Tolerancia a erratas Levenshtein («pul fiction», «gladiador», «mitchel maquinas»).
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
let proceso, datos, base, galletaAdmin;

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
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-busqueda-'));
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

  // Crear usuario administrador y obtener sesión
  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '123456' }, cabeceras: { Host: host, Origin: base } });
  const login = await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '123456' } });
  galletaAdmin = galletaDe(login);

  // Sembrar títulos de prueba
  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec(`
    INSERT INTO libraries (id, name, path, kind) VALUES (1, 'Películas', '/media/movies', 'movie');
    INSERT INTO items (id, library_id, kind, folder, title, search_title, sort_title, original_title, collection, rating, scanned_at) VALUES
      (1, 1, 'movie', 'mitchell', 'Los Mitchell contra las máquinas', 'los mitchell contra las maquinas', 'Mitchell contra las máquinas', 'The Mitchells vs. the Machines', NULL, 7.6, datetime('now')),
      (2, 1, 'movie', 'lotr', 'El señor de los anillos: La comunidad del anillo', 'el senor de los anillos la comunidad del anillo', 'Señor de los anillos 1', 'The Lord of the Rings: The Fellowship of the Ring', 'El Señor de los Anillos', 8.8, datetime('now')),
      (3, 1, 'movie', 'batman', 'El caballero oscuro', 'el caballero oscuro', 'Caballero oscuro', 'The Dark Knight', 'Batman - Trilogía', 9.0, datetime('now')),
      (4, 1, 'movie', 'pulp', 'Pulp Fiction', 'pulp fiction', 'Pulp Fiction', 'Pulp Fiction', NULL, 8.9, datetime('now')),
      (5, 1, 'movie', 'gladiator', 'Gladiator', 'gladiator', 'Gladiator', 'Gladiator', NULL, 8.5, datetime('now'));
  `);
  db.close();
});

after(async () => {
  if (proceso) { proceso.kill(); await esperar(300); }
  if (datos) { try { rmSync(datos, { recursive: true, force: true }); } catch { /* ya borrado */ } }
});

test('búsqueda por palabras sueltas en cualquier orden', async () => {
  const res = await pedir('GET', '/api/search?q=mitchell+maquinas', { galleta: galletaAdmin });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.items.length >= 1);
  assert.equal(data.items[0].id, 1);
  assert.equal(data.items[0].title, 'Los Mitchell contra las máquinas');

  const res2 = await pedir('GET', '/api/search?q=senor+anillos', { galleta: galletaAdmin });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.ok(data2.items.length >= 1);
  assert.equal(data2.items[0].id, 2);
});

test('búsqueda por colección o saga', async () => {
  const res = await pedir('GET', '/api/search?q=batman', { galleta: galletaAdmin });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.items.length >= 1);
  assert.equal(data.items[0].id, 3);
  assert.equal(data.items[0].title, 'El caballero oscuro');
});

test('búsqueda por título original', async () => {
  const res = await pedir('GET', '/api/search?q=dark+knight', { galleta: galletaAdmin });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.items.length >= 1);
  assert.equal(data.items[0].id, 3);
});

test('tolerancia a erratas con Levenshtein (fuzzy search)', async () => {
  // «pul fiction» -> Pulp Fiction
  const res1 = await pedir('GET', '/api/search?q=pul+fiction', { galleta: galletaAdmin });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.ok(data1.items.length >= 1);
  assert.equal(data1.items[0].id, 4);

  // «gladiador» -> Gladiator
  const res2 = await pedir('GET', '/api/search?q=gladiador', { galleta: galletaAdmin });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.ok(data2.items.length >= 1);
  assert.equal(data2.items[0].id, 5);

  // «mitchel maquinas» -> Los Mitchell contra las máquinas
  const res3 = await pedir('GET', '/api/search?q=mitchel+maquinas', { galleta: galletaAdmin });
  assert.equal(res3.status, 200);
  const data3 = await res3.json();
  assert.ok(data3.items.length >= 1);
  assert.equal(data3.items[0].id, 1);
});
