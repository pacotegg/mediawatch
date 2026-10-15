/*
 * La copia de seguridad de la base se guarda comprimida (.db.gz), se puede descomprimir y abrir, y no
 * deja temporales. Servidor real en modo portable con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galleta;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});

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
  await fetch(base + '/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: host, Origin: base }, body: JSON.stringify({ name: 'Admin', pin: '654321' }) });
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 1, pin: '654321' }) });
  galleta = (login.headers.get('set-cookie') ?? '').split(';')[0];
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(1500); }
  try { if (datos) rmSync(datos, { recursive: true, force: true }); } catch { /* temporal */ }
});

test('la copia queda comprimida, se descomprime en una base valida y no deja temporales', async () => {
  const r = await fetch(base + '/api/mantenimiento/copia', { method: 'POST', headers: { Cookie: galleta }, signal: AbortSignal.timeout(60_000) });
  assert.equal(r.status, 200);
  const { ruta } = await r.json();
  assert.match(ruta, /tvwatch-\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.db\.gz$/);

  const ficheros = readdirSync(join(datos, 'copias'));
  const gz = ficheros.filter((f) => f.endsWith('.db.gz'));
  assert.ok(gz.length >= 1, 'no hay ninguna copia .db.gz: ' + ficheros.join(', '));
  assert.deepEqual(ficheros.filter((f) => /\.(tmp|parcial)$/.test(f)), [], 'quedaron temporales');

  // Se descomprime y es una base de verdad, con el usuario que acabamos de crear.
  const copia = join(datos, 'restaurada.db');
  writeFileSync(copia, gunzipSync(readFileSync(join(datos, 'copias', gz.at(-1)))));
  const db = new DatabaseSync(copia, { readOnly: true });
  assert.equal(db.prepare('SELECT name FROM users WHERE id = 1').get().name, 'Admin');
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
});

test('el estado de mantenimiento cuenta las copias comprimidas', async () => {
  const j = await (await fetch(base + '/api/mantenimiento/estado', { headers: { Cookie: galleta } })).json();
  assert.ok(j.copias.total >= 1);
  assert.match(j.copias.ultima, /\.db\.gz$/);
});

test('los avisos de salud señalan una biblioteca que no responde y dejan de señalar la copia ya hecha', async () => {
  const bd = new DatabaseSync(join(datos, 'tvwatch.db'));
  bd.exec('PRAGMA busy_timeout = 10000');
  bd.prepare("INSERT INTO libraries (name, path, kind) VALUES ('Peliculas', ?, 'movie')").run(join(datos, 'no-existe'));
  bd.close();
  const { avisos } = await (await fetch(base + '/api/mantenimiento/avisos', { headers: { Cookie: galleta } })).json();
  assert.ok(avisos.some((a) => a.nivel === 'error' && a.texto.includes('Peliculas')), JSON.stringify(avisos));
  assert.ok(!avisos.some((a) => a.texto.includes('copia de seguridad')), 'ya hay una copia (la del primer test): ' + JSON.stringify(avisos));
});
