/*
 * Rutas pequeñas que aceptaban cualquier cosa: preferencias (se guardaba lo que llegara), teclas y ordenes del mando,
 * estado de subtitulos (rutas del servidor y registro para cualquiera) y carpeta del registro de clientes (sin tope de ficheros).
 * Servidor real en modo portable con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galletaAdmin, galletaNormal, idNormal;

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
  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  const normal = await (await pedir('POST', '/api/users', { cuerpo: { name: 'Normal', pin: '112233' }, galleta: galletaAdmin })).json();
  idNormal = normal.id;
  galletaNormal = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: normal.id, pin: '112233' } }));
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('preferencias: lo que no es una preferencia no se guarda', async () => {
  const res = await pedir('PUT', '/api/preferences', {
    galleta: galletaNormal,
    cuerpo: { basura: 'x'.repeat(5000), playback: { seekStep: 30, adaptativo: 'siempre', objeto: { a: 1 }, 'clave rara!': 1, resume: 'si', maxHeight: null }, audio: { mode: 'ruidoso' }, subtitles: 'hola', interface: { reduceMotion: true, heroTrailer: false, language: 'es', largo: 'x'.repeat(500) } },
  });
  assert.equal(res.status, 200);
  const p = await (await pedir('GET', '/api/preferences', { galleta: galletaNormal })).json();
  assert.equal(p.basura, undefined);
  assert.equal(p.playback.adaptativo, 'siempre', 'los ajustes propios de un cliente (que el servidor no conoce) se conservan');
  assert.equal(p.interface.heroTrailer, false);
  assert.equal(p.interface.language, 'es');
  assert.equal(p.playback.objeto, undefined, 'un objeto anidado no entra');
  assert.equal(p.playback['clave rara!'], undefined, 'un nombre de clave raro no entra');
  assert.equal(p.interface.largo, undefined, 'un texto largo no entra');
  assert.equal(p.playback.seekStep, 30, 'lo valido se conserva');
  assert.equal(p.playback.resume, true, 'tipo equivocado: queda el de por defecto');
  assert.equal(p.playback.maxHeight, 0);
  assert.equal(p.audio.mode, 'normal', 'valor fuera de la lista');
  assert.equal(p.subtitles.size, 100, 'una seccion que no es un objeto no rompe nada');
  assert.equal(p.interface.reduceMotion, true);
});

test('mando: una tecla que no existe se rechaza', async () => {
  assert.equal((await pedir('POST', '/api/mando/tecla', { galleta: galletaNormal, cuerpo: { tecla: 'apagar' } })).status, 400);
  assert.equal((await pedir('POST', '/api/mando/tecla', { galleta: galletaNormal, cuerpo: { tecla: 'ok' } })).status, 200);
});

test('mando: reproducir con un fichero que no es un numero se rechaza', async () => {
  assert.equal((await pedir('POST', '/api/mando/reproducir', { galleta: galletaNormal, cuerpo: { fileId: 'abc', itemId: 1 } })).status, 400);
  assert.equal((await pedir('POST', '/api/mando/reproducir', { galleta: galletaNormal, cuerpo: { fileId: 1, itemId: 1, episodeId: 'x' } })).status, 400);
  assert.equal((await pedir('POST', '/api/mando/reproducir', { galleta: galletaNormal, cuerpo: { fileId: 1, itemId: 1 } })).status, 200);
});

test('subtitulos: un perfil normal no ve ni la ruta del script ni el registro del trabajo', async () => {
  const d = await (await pedir('GET', '/api/subtitles/available', { galleta: galletaNormal })).json();
  assert.equal(d.script, undefined);
  const j = await (await pedir('GET', '/api/subtitles/job', { galleta: galletaNormal })).json();
  assert.deepEqual(j.log, []);
  assert.equal(j.title, '');
  assert.equal((await pedir('GET', '/api/subtitles/missing', { galleta: galletaNormal })).status, 403);
  assert.equal((await pedir('GET', '/api/subtitles/transcribe', { galleta: galletaNormal })).status, 403);
});

test('subtitulos: el administrador sigue viendo todo', async () => {
  const d = await (await pedir('GET', '/api/subtitles/available', { galleta: galletaAdmin })).json();
  assert.equal(typeof d.script, 'string');
  assert.equal((await pedir('GET', '/api/subtitles/missing?limit=abc', { galleta: galletaAdmin })).status, 200);
  assert.equal((await pedir('GET', '/api/subtitles/transcribe', { galleta: galletaAdmin })).status, 200);
});

test('registro de clientes: la carpeta de un usuario tiene tope de ficheros', async () => {
  const carpeta = join(datos, 'clientes', `${idNormal}-Normal`);
  mkdirSync(carpeta, { recursive: true });
  for (let i = 0; i < 90; i++) writeFileSync(join(carpeta, `android-falso${i}-2026-10-16.log`), '# x\n');
  const res = await pedir('POST', '/api/cliente/log', {
    galleta: galletaNormal,
    cuerpo: { plataforma: 'android', aparato: 'real', version: '3.62', dispositivo: 'prueba', lineas: ['una linea'] },
  });
  assert.equal(res.status, 200);
  assert.ok(readdirSync(carpeta).length <= 60, `quedan ${readdirSync(carpeta).length} ficheros`);
  assert.ok(readdirSync(carpeta).some((f) => f.startsWith('android-real-')), 'el fichero recien escrito sobrevive');
});

test('metadatos: la lista de candidatos es del administrador', async () => {
  assert.equal((await pedir('GET', '/api/enrich/candidates', { galleta: galletaNormal })).status, 403);
  assert.equal((await pedir('GET', '/api/enrich/candidates', { galleta: galletaAdmin })).status, 200);
});

test('sin cuerpo: las rutas contestan 4xx, no 500 (tampoco el inicio de sesion, que es publico)', async () => {
  for (const [metodo, ruta] of [['POST', '/api/auth/login'], ['POST', '/api/users'], ['POST', '/api/enrich/search'], ['PATCH', '/api/extras/1']]) {
    const res = await pedir(metodo, ruta, { galleta: galletaAdmin });
    assert.ok(res.status >= 400 && res.status < 500, `${metodo} ${ruta} -> ${res.status}`);
  }
});

test('estadisticas con un numero de dias que no es un numero no da 500', async () => {
  assert.equal((await pedir('GET', '/api/estadisticas?dias=x', { galleta: galletaAdmin })).status, 200);
});
