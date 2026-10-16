/*
 * Emparejado de la tele: con secreto (que solo conoce la tele) nadie se adelanta a recoger el token; sin secreto
 * (la tele vieja) sigue funcionando; un codigo no se aprueba dos veces. Servidor real con datos temporales.
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
const SECRETO = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';

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
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

const empezar = async (secreto) => (await pedir('POST', '/api/auth/device/start', { cuerpo: secreto ? { secreto } : undefined })).json();
const sondear = (code, secreto) => pedir('GET', `/api/auth/device/poll?code=${code}`, { cabeceras: secreto ? { 'X-Emparejado': secreto } : {} });
const aprobar = (code) => pedir('POST', '/api/auth/device/claim', { cuerpo: { code }, galleta: galletaAdmin });

test('con secreto: quien no lo sabe no recoge el token, ni antes ni despues de aprobar', async () => {
  const { code } = await empezar(SECRETO);
  assert.equal((await sondear(code)).status, 404, 'sin secreto');
  assert.equal((await sondear(code, 'f'.repeat(48))).status, 404, 'secreto equivocado');
  assert.equal((await aprobar(code)).status, 200);
  assert.equal((await sondear(code)).status, 404, 'sin secreto, ya aprobado: el robo de la carrera');
  assert.equal((await sondear(code, 'f'.repeat(48))).status, 404, 'equivocado, ya aprobado');
  const bueno = await sondear(code, SECRETO);
  assert.equal(bueno.status, 200);
  const { paired, token } = await bueno.json();
  assert.equal(paired, true);
  assert.equal((await pedir('GET', '/api/me', { cabeceras: { Authorization: `Bearer ${token}` } })).status, 200, 'el token debia valer');
});

test('con secreto, antes de aprobar el sondeo dice «aun no» solo a quien lo sabe', async () => {
  const { code } = await empezar(SECRETO);
  assert.deepEqual(await (await sondear(code, SECRETO)).json(), { paired: false });
});

test('la tele vieja (sin secreto) sigue pudiendo emparejarse', async () => {
  const { code } = await empezar();
  assert.deepEqual(await (await sondear(code)).json(), { paired: false });
  assert.equal((await aprobar(code)).status, 200);
  assert.equal((await (await sondear(code)).json()).paired, true);
});

test('un secreto mal formado se rechaza, y un codigo no se aprueba dos veces', async () => {
  const mal = await pedir('POST', '/api/auth/device/start', { cuerpo: { secreto: 'corto' } });
  assert.equal(mal.status, 400);
  const { code } = await empezar(SECRETO);
  assert.equal((await aprobar(code)).status, 200);
  assert.equal((await aprobar(code)).status, 409, 'la segunda aprobacion');
});
