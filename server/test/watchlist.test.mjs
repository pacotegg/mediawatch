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
let proceso, datos, base, galletaAdmin, itemId;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });

const pedir = (metodo, ruta, { cuerpo, galleta, cabeceras = {} } = {}) =>
  fetch(base + ruta, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(galleta ? { Cookie: galleta } : {}),
      ...cabeceras,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(8000),
  });

const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const bd = () => {
  const d = new DatabaseSync(join(datos, 'tvwatch.db'));
  d.exec('PRAGMA busy_timeout = 10000');
  return d;
};

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-watchlist-test-'));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER,
    stdio: 'ignore',
    env: {
      ...process.env,
      MEDIAWATCH_DATA_DIR: datos,
      MEDIAWATCH_HOST: '127.0.0.1',
      MEDIAWATCH_PORT: String(puerto),
    },
  });

  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/api/salud')).ok) break;
    } catch {
      /* arrancando */
    }
    await esperar(500);
  }

  const d = bd();
  d.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'Peliculas','C:/test/pels','movie')").run();
  itemId = d.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at, mpaa) VALUES (1,'movie','C:/test/pels/Matrix','Matrix','matrix','2026-11-07','ES:16') RETURNING id").get().id;
  d.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,7200,1)').run(itemId, 'C:/test/pels/Matrix/Matrix.mkv');
  d.close();

  // Crear primer usuario admin (ya devuelve la cookie de sesión)
  const loginRes = await pedir('POST', '/api/users', {
    cuerpo: { name: 'Admin', pin: '654321' },
    cabeceras: { Host: `127.0.0.1:${puerto}`, Origin: base },
  });
  assert.equal(loginRes.status, 200);
  galletaAdmin = galletaDe(loginRes);
});

after(() => {
  try {
    proceso.kill();
  } catch {}
  try {
    rmSync(datos, { recursive: true, force: true });
  } catch {}
});

test('watchlist: anadir, listar, comprobar en ficha y quitar', async () => {
  // Inicialmente no está en watchlist
  let ficha = await (await pedir('GET', `/api/items/${itemId}`, { galleta: galletaAdmin })).json();
  assert.equal(ficha.watchlist, 0);

  let lista = await (await pedir('GET', '/api/watchlist', { galleta: galletaAdmin })).json();
  assert.equal(lista.length, 0);

  // Añadir con POST /api/items/:id/watchlist
  const addRes = await pedir('POST', `/api/items/${itemId}/watchlist`, {
    galleta: galletaAdmin,
    cuerpo: { watchlist: true },
  });
  assert.equal(addRes.status, 200);

  ficha = await (await pedir('GET', `/api/items/${itemId}`, { galleta: galletaAdmin })).json();
  assert.equal(ficha.watchlist, 1);

  lista = await (await pedir('GET', '/api/watchlist', { galleta: galletaAdmin })).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, itemId);
  assert.equal(lista[0].title, 'Matrix');

  // Quitar con POST /api/items/:id/watchlist (watchlist: false)
  const remRes = await pedir('POST', `/api/items/${itemId}/watchlist`, {
    galleta: galletaAdmin,
    cuerpo: { watchlist: false },
  });
  assert.equal(remRes.status, 200);

  ficha = await (await pedir('GET', `/api/items/${itemId}`, { galleta: galletaAdmin })).json();
  assert.equal(ficha.watchlist, 0);

  lista = await (await pedir('GET', '/api/watchlist', { galleta: galletaAdmin })).json();
  assert.equal(lista.length, 0);

  // Añadir con PUT /api/watchlist/:id
  const putRes = await pedir('PUT', `/api/watchlist/${itemId}`, {
    galleta: galletaAdmin,
    cuerpo: { watchlist: true },
  });
  assert.equal(putRes.status, 200);

  lista = await (await pedir('GET', '/api/watchlist', { galleta: galletaAdmin })).json();
  assert.equal(lista.length, 1);

  // Título inexistente da 404
  const res404 = await pedir('POST', '/api/items/999999/watchlist', {
    galleta: galletaAdmin,
    cuerpo: { watchlist: true },
  });
  assert.equal(res404.status, 404);

  // Sin autenticación da 401
  const res401 = await pedir('GET', '/api/watchlist');
  assert.equal(res401.status, 401);
});
