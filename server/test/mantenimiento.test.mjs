/*
 * Lote de miniaturas que sobrevive a un reinicio y registro de origenes CORS ajenos.
 * Servidor real en modo portable con datos temporales, como autenticacion.test.mjs.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso;
let datos;
let base;

const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  // Un lote completo que «murió con el proceso»: el servidor debe retomarlo solo al arrancar.
  writeFileSync(join(datos, 'trickplay-lote.json'), JSON.stringify({ todo: true, desde: 'prueba' }));
  writeFileSync(join(datos, 'creditos-afinar.json'), JSON.stringify({ desde: 'prueba' }));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER,
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto), MEDIAWATCH_TRICKPLAY_REANUDAR_MS: '1500' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/salud')).ok) return; } catch { /* arrancando */ }
    await esperar(500);
  }
  throw new Error('El servidor de prueba no arranco');
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

test('un lote de miniaturas pendiente se reanuda al arrancar y se borra al terminar', async () => {
  const marca = join(datos, 'trickplay-lote.json');
  for (let i = 0; i < 20 && existsSync(marca); i++) await esperar(500);
  // Sin ficheros en la biblioteca el lote reanudado termina enseguida y quita el apunte.
  assert.equal(existsSync(marca), false, 'el apunte del lote sigue ahi: no se reanudo o no termino');
});

test('CORS: un origen ajeno se apunta una vez; el propio no', async () => {
  const log = join(datos, 'cors-origenes.log');
  await fetch(base + '/api/salud', { headers: { Origin: base } });
  await fetch(base + '/api/salud', { headers: { Origin: 'https://ajeno.example' } });
  await fetch(base + '/api/salud', { headers: { Origin: 'https://ajeno.example' } });
  const texto = existsSync(log) ? readFileSync(log, 'utf8') : '';
  assert.equal((texto.match(/ajeno\.example/g) ?? []).length, 1, 'el origen ajeno debe aparecer una sola vez');
  assert.ok(!texto.includes(base), 'el origen propio no se apunta');
});

test('un afinado de creditos pendiente se reanuda al arrancar y se borra al terminar', async () => {
  const marca = join(datos, 'creditos-afinar.json');
  for (let i = 0; i < 20 && existsSync(marca); i++) await esperar(500);
  assert.equal(existsSync(marca), false, 'el apunte del afinado sigue ahi: no se reanudo o no termino');
});
