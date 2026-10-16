/*
 * Edicion de perfiles (PUT /api/users/:id): un perfil normal no puede cambiarse el PIN por esta puerta (la buena
 * es /pin, que exige el PIN actual), y desde fuera de casa nadie quita un PIN. Colores y nombres, acotados.
 * Servidor real con datos temporales.
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
let proceso, datos, base, galletaAdmin, galletaNormal, normal;
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
  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  normal = (await (await pedir('POST', '/api/users', { cuerpo: { name: 'Normal', pin: '112233' }, galleta: galletaAdmin })).json()).id;
  galletaNormal = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: normal, pin: '112233' } }));
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

const entra = async (userId, pin) => (await pedir('POST', '/api/auth/login', { cuerpo: { userId, pin } })).status;

test('un perfil normal no se cambia el PIN por PUT (sin saber el actual): el PIN no cambia', async () => {
  const r = await pedir('PUT', `/api/users/${normal}`, { cuerpo: { pin: '999999' }, galleta: galletaNormal });
  assert.equal(r.status, 403);
  assert.equal(await entra(normal, '112233'), 200, 'el PIN de siempre debia seguir valiendo');
});

test('desde fuera de casa no se quita el PIN, ni por PUT ni siendo administrador', async () => {
  const entrar = await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' }, cabeceras: FUERA });
  const galletaFuera = galletaDe(entrar);
  assert.equal(entrar.status, 200);
  const r = await pedir('PUT', `/api/users/${normal}`, { cuerpo: { pin: null }, galleta: galletaFuera, cabeceras: FUERA });
  assert.equal(r.status, 403);
  assert.equal(await entra(normal, '112233'), 200, 'el PIN debia seguir puesto');
});

test('el administrador si puede cambiar el PIN de otro perfil desde casa', async () => {
  const r = await pedir('PUT', `/api/users/${normal}`, { cuerpo: { pin: '445566' }, galleta: galletaAdmin });
  assert.equal(r.status, 200);
  assert.equal(await entra(normal, '445566'), 200);
  assert.equal(await entra(normal, '112233'), 401);
});

test('color y nombre acotados', async () => {
  // El PIN cambió en la prueba anterior y eso cerró sus sesiones: se vuelve a entrar.
  galletaNormal = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: normal, pin: '445566' } }));
  for (const cuerpo of [{ color: 'url(javascript:alert(1))' }, { color: 'red; position:fixed' }, { name: 'x'.repeat(41) }]) {
    assert.equal((await pedir('PUT', `/api/users/${normal}`, { cuerpo, galleta: galletaNormal })).status, 400, JSON.stringify(cuerpo));
  }
  assert.equal((await pedir('PUT', `/api/users/${normal}`, { cuerpo: { color: '#5ac8fa', name: 'Ñandú López' }, galleta: galletaNormal })).status, 200);
});

test('cerrar sesion con token de cabecera (tele, Android) la invalida en el servidor', async () => {
  const galleta = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  const token = galleta.split('=').slice(1).join('=');
  const conToken = { Authorization: `Bearer ${token}` };
  assert.equal((await pedir('GET', '/api/me', { cabeceras: conToken })).status, 200);
  assert.equal((await pedir('POST', '/api/auth/logout', { cabeceras: conToken })).status, 200);
  assert.equal((await pedir('GET', '/api/me', { cabeceras: conToken })).status, 401, 'el token seguia valiendo tras cerrar sesion');
});
