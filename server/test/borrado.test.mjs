/*
 * Borrar un titulo se lleva su carpeta entera, y aqui ya se han perdido peliculas. Ademas de los cerrojos de
 * siempre (administrador, desde casa, titulo exacto, dentro de una biblioteca), se niega a borrar si en esa carpeta
 * hay ficheros o carpetas de OTRO titulo. Solo toca carpetas temporales de la prueba.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galletaAdmin, biblio;
const ids = {};
const FUERA = { 'X-Forwarded-For': '8.8.8.8', 'X-Forwarded-Proto': 'http' };

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
const bd = () => { const d = new DatabaseSync(join(datos, 'tvwatch.db')); d.exec('PRAGMA busy_timeout = 10000'); return d; };

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  biblio = join(datos, 'biblioteca');
  mkdirSync(biblio);
  // La biblioteca real de la prueba: el borrado solo vale dentro de una biblioteca configurada.
  writeFileSync(join(datos, 'config.json'), JSON.stringify({ libraries: [{ name: 'prueba', path: biblio, kind: 'movie' }] }));
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
  const d = new DatabaseSync(join(datos, 'tvwatch.db'));
  d.exec('PRAGMA busy_timeout = 10000');
  d.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'prueba',?,'movie')").run(biblio);
  const alta = (nombre, carpeta, fichero) => {
    mkdirSync(carpeta, { recursive: true });
    const ruta = join(carpeta, fichero);
    writeFileSync(ruta, 'contenido');
    const it = d.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie',?,?,?,'x') RETURNING id").get(carpeta, nombre, nombre).id;
    d.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,5400,1)').run(it, ruta);
    ids[nombre] = { id: it, carpeta, ruta };
  };
  alta('Sola', join(biblio, 'Sola'), 'sola.mkv');
  alta('Padre', join(biblio, 'Padre'), 'padre.mkv');
  alta('Hija', join(biblio, 'Padre', 'Hija'), 'hija.mkv');            // carpeta dentro de la de otro titulo
  alta('Con ajeno', join(biblio, 'ConAjeno'), 'a.mkv');
  const ajeno = join(biblio, 'ConAjeno', 'otra.mkv');                   // fichero de otro titulo dentro de esa carpeta
  writeFileSync(ajeno, 'de otro');
  const otro = d.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at) VALUES (1,'movie',?,?,?,'x') RETURNING id").get(join(biblio, 'Otro sitio'), 'Otro', 'otro').id;
  d.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,5400,1)').run(otro, ajeno);
  d.close();
  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  try { if (datos) rmSync(datos, { recursive: true, force: true }); } catch { /* temporal */ }
});

const borrar = (nombre, confirmar, cabeceras = {}) => pedir('DELETE', `/api/items/${ids[nombre].id}`, { galleta: galletaAdmin, cuerpo: { confirmar }, cabeceras });

test('sin el titulo exacto, o desde fuera de casa, no se borra nada', async () => {
  assert.equal((await borrar('Sola', 'otro texto')).status, 400);
  assert.equal((await borrar('Sola', 'Sola', FUERA)).status, 403);
  assert.ok(existsSync(ids.Sola.ruta));
});

test('si en la carpeta hay otro titulo (anidado o con un fichero suyo), se niega y no se pierde nada', async () => {
  for (const nombre of ['Padre', 'Con ajeno']) {
    const r = await borrar(nombre, nombre);
    assert.equal(r.status, 409, nombre + ': ' + (await r.text()));
  }
  assert.ok(existsSync(ids.Padre.ruta) && existsSync(ids.Hija.ruta), 'se perdio algo de Padre/Hija');
  assert.ok(existsSync(ids['Con ajeno'].ruta) && existsSync(join(biblio, 'ConAjeno', 'otra.mkv')), 'se perdio algo de ConAjeno');
});

test('una carpeta propia se borra entera y solo esa', async () => {
  const r = await borrar('Sola', 'Sola');
  assert.equal(r.status, 200, await r.text());
  assert.ok(!existsSync(ids.Sola.carpeta), 'la carpeta debia haberse ido');
  assert.ok(existsSync(ids.Padre.ruta) && existsSync(ids.Hija.ruta), 'las demas deben seguir');
});

test('el titulo mas anidado (Hija) si se puede borrar y no toca a Padre', async () => {
  const r = await borrar('Hija', 'Hija');
  assert.equal(r.status, 200, await r.text());
  assert.ok(!existsSync(ids.Hija.carpeta));
  assert.ok(existsSync(ids.Padre.ruta));
});
