/*
 * Pruebas para instalacion nueva (modo portable / Docker) y asistente inicial:
 * - Creacion del primer administrador desde la red local (no desde fuera).
 * - Explorador seguro de carpetas del servidor para seleccionar bibliotecas.
 * - Configuracion de bibliotecas guardada en config.json.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base;

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

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-setup-test-'));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER, stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) },
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/salud')).ok) break; } catch { /* esperando */ }
    await esperar(200);
  }
});

after(() => {
  try { proceso?.kill(); } catch {}
  try { rmSync(datos, { recursive: true, force: true }); } catch {}
});

test('explorador de carpetas y configuracion de bibliotecas', async () => {
  // 1. Debe existir GET /api/users anunciando setupNeeded = true
  const resUsers = await pedir('GET', '/api/users');
  assert.equal(resUsers.status, 200);
  const jsonUsers = await resUsers.json();
  assert.equal(jsonUsers.setupNeeded, true);

  // 2. Crear primer admin: debe permitir crear con PIN de 6 cifras y devolver sesion
  const resAdmin = await pedir('POST', '/api/users', {
    cuerpo: { name: 'AdminTest', pin: '123456', isAdmin: true },
    cabeceras: { Origin: base, Host: base.replace('http://', '') },
  });
  assert.equal(resAdmin.status, 200, 'el primer admin debia crearse');
  const jsonAdmin = await resAdmin.json();
  assert.ok(jsonAdmin.id > 0);

  // Comprobar cookie de sesion recibida o iniciar sesion
  const galleta = resAdmin.headers.get('set-cookie')?.split(';')[0];
  let adminCookie = galleta;
  if (!adminCookie) {
    const resLogin = await pedir('POST', '/api/auth/login', { cuerpo: { userId: jsonAdmin.id, pin: '123456' } });
    adminCookie = resLogin.headers.get('set-cookie')?.split(';')[0];
  }
  assert.ok(adminCookie, 'debe tener sesion de admin');

  // 3. GET /api/system/browse para explorar directorios
  const testSubdir = join(datos, 'media_test');
  mkdirSync(join(testSubdir, 'peliculas'), { recursive: true });
  mkdirSync(join(testSubdir, 'series'), { recursive: true });

  const resBrowse = await pedir('GET', `/api/system/browse?dir=${encodeURIComponent(testSubdir)}`, { galleta: adminCookie });
  assert.equal(resBrowse.status, 200, 'el explorador debia responder 200');
  const jsonBrowse = await resBrowse.json();
  assert.ok(Array.isArray(jsonBrowse.dirs), 'dirs debe ser un array');
  assert.ok(jsonBrowse.dirs.some((d) => d.name === 'peliculas'));
  assert.ok(jsonBrowse.dirs.some((d) => d.name === 'series'));

  // 4. PUT /api/system/libraries para guardar las bibliotecas elegidas
  const resLibs = await pedir('PUT', '/api/system/libraries', {
    cuerpo: {
      libraries: [
        { name: 'Cine', path: join(testSubdir, 'peliculas'), kind: 'movie' },
        { name: 'Series TV', path: join(testSubdir, 'series'), kind: 'show' },
      ],
    },
    galleta: adminCookie,
  });
  assert.equal(resLibs.status, 200, 'guardar bibliotecas debia responder 200');

  // Verificar que config.json en disco tiene las bibliotecas guardadas
  const configEnDisco = JSON.parse(readFileSync(join(datos, 'config.json'), 'utf8'));
  assert.equal(configEnDisco.libraries?.length, 2);
  assert.equal(configEnDisco.libraries[0].name, 'Cine');
  assert.equal(configEnDisco.libraries[1].name, 'Series TV');
});
