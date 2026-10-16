/*
 * El catalogo de plataformas es un `discover` de TMDb: un perfil con limite de edad no puede ver ahi titulos de adultos
 * que ni estan en casa. TMDb pone 12 y 16 en el mismo nivel (medido el 16/10: 1.085 resultados cada uno), asi que solo se
 * deja pasar lo de A y 7; las series no tienen filtro por edad y no se ofrecen.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-edad-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { filtroDeEdad } = await import('../src/media/plataformas.ts');
const { db } = await import('../src/db.ts');

test('sin limite de edad no se filtra nada', () => {
  assert.equal(filtroDeEdad('movie', null), null);
  assert.equal(filtroDeEdad('movie', []), null);
  assert.equal(filtroDeEdad('show', undefined), null);
});

test('TP: solo A y Ai; TP y 7: ademas 7 y 7i', () => {
  assert.deepEqual(filtroDeEdad('movie', ['TP']), { certification_country: 'ES', certification: 'A|Ai' });
  assert.deepEqual(filtroDeEdad('movie', ['TP', '7']), { certification_country: 'ES', certification: 'A|Ai|7|7i' });
});

test('12 y 16 no se dejan pasar nunca (TMDb los pone en el mismo nivel)', () => {
  assert.deepEqual(filtroDeEdad('movie', ['TP', '7', '12']), { certification_country: 'ES', certification: 'A|Ai|7|7i' });
  assert.equal(filtroDeEdad('movie', ['12']), 'nada');
  assert.equal(filtroDeEdad('movie', ['16', '18']), 'nada');
});

test('las series no se ofrecen a un perfil con limite', () => {
  assert.equal(filtroDeEdad('show', ['TP', '7', '12']), 'nada');
});

// Y por la ruta, sin salir a internet (la serie y el «12» ni llegan a TMDb).
const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, base, galletaAdmin, galletaNino12, galletaNinoTp;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); s.on('error', rej); });
const pedir = (m, r, { cuerpo, galleta, cabeceras = {} } = {}) => fetch(base + r, { method: m, headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(galleta ? { Cookie: galleta } : {}), ...cabeceras }, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(8000) });
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

before(async () => {
  const dir2 = mkdtempSync(join(tmpdir(), 'mediawatch-edad2-'));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], { cwd: SERVER, stdio: 'ignore', env: { ...process.env, MEDIAWATCH_DATA_DIR: dir2, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/salud')).ok) break; } catch { /* arrancando */ } await esperar(500); }
  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  const a = await (await pedir('POST', '/api/users', { cuerpo: { name: 'Doce', pin: '112233', kidRatings: ['12'] }, galleta: galletaAdmin })).json();
  galletaNino12 = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: a.id, pin: '112233' } }));
  const b = await (await pedir('POST', '/api/users', { cuerpo: { name: 'Peque', pin: '223344', kidRatings: ['TP'] }, galleta: galletaAdmin })).json();
  galletaNinoTp = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: b.id, pin: '223344' } }));
  proceso.dir2 = dir2;
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  try { db.close(); } catch { /* ya cerrada */ }
  rmSync(datos, { recursive: true, force: true });
  if (proceso?.dir2) rmSync(proceso.dir2, { recursive: true, force: true });
});

test('ruta: series para un perfil infantil -> vacio y restringido', async () => {
  const r = await pedir('GET', '/api/plataformas/netflix/catalogo?kind=show', { galleta: galletaNinoTp });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.items, []);
  assert.equal(j.restringido, true);
});

test('ruta: peliculas para un perfil que solo llega a 12 -> vacio y restringido', async () => {
  const r = await pedir('GET', '/api/plataformas/netflix/catalogo?kind=movie', { galleta: galletaNino12 });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).items, []);
});

test('ruta: un administrador sin limite si llega a TMDb (aqui, sin clave: 502, no vacio)', async () => {
  const r = await pedir('GET', '/api/plataformas/netflix/catalogo?kind=show', { galleta: galletaAdmin });
  assert.equal(r.status, 502);
});
