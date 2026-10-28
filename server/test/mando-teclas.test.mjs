/*
 * El móvil como mando de la tele (28/10/2026): dos teclas seguidas se pisaban (solo llegaba la última) y cada una tardaba
 * hasta 1,2 s, lo que tardaba la tele en volver a preguntar. Ahora el servidor guarda una cola y la tele puede dejar la
 * consulta abierta (`espera=1`) hasta que llegue algo. Servidor real con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galleta;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, cuerpo) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: galleta },
  body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(15000),
});

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
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 1, pin: '654321' }) });
  galleta = (r.headers.get('set-cookie') ?? '').split(';')[0];
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('dos teclas seguidas llegan las dos, en orden', async () => {
  await pedir('POST', '/api/mando/tecla', { tecla: 'derecha' });
  await pedir('POST', '/api/mando/tecla', { tecla: 'ok' });
  const r = await (await pedir('GET', '/api/mando?tele=1&espera=1')).json();
  assert.deepEqual(r.teclas, ['derecha', 'ok']);
  assert.equal(r.tecla, 'derecha');
});

test('una tele antigua (sin espera) se las lleva de una en una, sin perder ninguna', async () => {
  await pedir('POST', '/api/mando/tecla', { tecla: 'arriba' });
  await pedir('POST', '/api/mando/tecla', { tecla: 'abajo' });
  assert.equal((await (await pedir('GET', '/api/mando?tele=1')).json()).tecla, 'arriba');
  assert.equal((await (await pedir('GET', '/api/mando?tele=1')).json()).tecla, 'abajo');
});

test('la consulta en espera contesta en cuanto llega la tecla, no al cabo de los 8 s', async () => {
  const t0 = Date.now();
  const consulta = pedir('GET', '/api/mando?tele=1&espera=1').then((r) => r.json());
  await esperar(600);
  await pedir('POST', '/api/mando/tecla', { tecla: 'atras' });
  const r = await consulta;
  const ms = Date.now() - t0;
  assert.deepEqual(r.teclas, ['atras']);
  assert.ok(ms >= 550 && ms < 2000, `contestó a los ${ms} ms`);
});
