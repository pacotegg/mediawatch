/*
 * Lo que pide la app de Android (3.84) al administrador: el avance del escaneo (`GET /api/scan/estado`) y saber cuál de los
 * aparatos de `/api/actividad` es el suyo (`esta`), para no ofrecerle cerrar su propia sesión. Servidor real con datos temporales.
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
let proceso, datos, base, galletaAdmin, galletaNormal;

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
});

after(async () => {
  proceso?.kill();
  await esperar(500);
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('el estado del escaneo es solo del administrador', async () => {
  assert.equal((await pedir('GET', '/api/scan/estado', { galleta: galletaNormal })).status, 403);
  assert.equal((await pedir('GET', '/api/scan/estado')).status, 401);
});

test('sin haber escaneado nada: no escanea y no hay último', async () => {
  const r = await pedir('GET', '/api/scan/estado', { galleta: galletaAdmin });
  assert.equal(r.status, 200);
  const e = await r.json();
  assert.equal(e.scanning, false);
  assert.equal(e.progreso, null);
  assert.equal(e.ultimo, null);
});

test('tras lanzar un escaneo, acaba y deja apuntado cómo terminó', async () => {
  const lanzado = await (await pedir('POST', '/api/scan', { cuerpo: {}, galleta: galletaAdmin })).json();
  assert.equal(lanzado.started, true);
  let e;
  for (let i = 0; i < 60; i++) {
    e = await (await pedir('GET', '/api/scan/estado', { galleta: galletaAdmin })).json();
    if (!e.scanning && e.ultimo) break;
    await esperar(250);
  }
  assert.equal(e.scanning, false);
  assert.ok(e.ultimo, 'tiene que haber un último escaneo');
  assert.equal(e.ultimo.ok, true);
  assert.ok(Array.isArray(e.ultimo.resultados));
  assert.ok(Date.parse(e.ultimo.fin) > 0);
});

test('en la actividad, solo el aparato de quien pregunta lleva esta: true', async () => {
  // Dos sesiones más del mismo perfil: ninguna es la de esta petición.
  await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } });
  await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } });
  const aparatos = await (await pedir('GET', '/api/actividad', { galleta: galletaAdmin })).json();
  assert.ok(aparatos.length >= 3, 'hay varios aparatos con sesión');
  assert.equal(aparatos.filter((a) => a.esta === true).length, 1);
  assert.ok(aparatos.every((a) => typeof a.esta === 'boolean'));
});
