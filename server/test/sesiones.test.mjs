/*
 * Los tokens de sesion no se guardan en claro: solo su huella SHA-256. Y las sesiones que ya existian
 * en claro siguen valiendo tras la migracion (nadie tiene que volver a entrar).
 * Servidor real en modo portable con datos temporales; se arranca dos veces.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
const sha = (t) => createHash('sha256').update(t).digest('hex');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let proceso;
let base;

const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});

async function arrancar() {
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER, stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) },
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/salud')).ok) return; } catch { /* arrancando */ }
    await esperar(500);
  }
  throw new Error('no arranco');
}
async function parar() {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await new Promise((r) => proceso.once('exit', r)); }
}

after(async () => { await parar(); rmSync(datos, { recursive: true, force: true }); });

test('una sesion antigua en claro se cifra al arrancar y sigue valiendo; las nuevas se guardan cifradas', async () => {
  await arrancar(); // crea el esquema
  await parar();

  // Una sesion «de antes»: token en claro y sin marca de cifrado.
  const antiguo = randomBytes(32).toString('hex');
  let db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  const u = db.prepare("INSERT INTO users (name, color, is_admin, created_at) VALUES ('Viejo','#fff',1,'x') RETURNING id").get();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(antiguo, u.id, new Date().toISOString());
  db.close();

  await arrancar(); // migra
  const yo = await fetch(base + '/api/me', { headers: { Authorization: 'Bearer ' + antiguo } });
  assert.equal(yo.status, 200, 'la sesion antigua debia seguir valiendo tras cifrarla');

  db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  const filas = db.prepare('SELECT token, cifrado FROM sessions').all();
  db.close();
  assert.ok(!filas.some((f) => f.token === antiguo), 'el token antiguo sigue guardado en claro');
  assert.ok(filas.some((f) => f.token === sha(antiguo) && f.cifrado === 1), 'no se guardo la huella del token antiguo');

  // El «id» de aparato que enseña la lista coincide con los 8 primeros de la huella
  const lista = await (await fetch(base + '/api/auth/dispositivos', { headers: { Authorization: 'Bearer ' + antiguo } })).json();
  assert.ok(lista.some((d) => d.id === sha(antiguo).slice(0, 8)), 'el id de aparato no sale de la huella');
});

test('el login nuevo guarda solo la huella', async () => {
  const db0 = new DatabaseSync(join(datos, 'tvwatch.db'));
  db0.exec('PRAGMA busy_timeout = 10000');
  // Usuario con PIN conocido, con el mismo formato que hashPin de auth.ts (sal hex:clave hex)
  const sal = randomBytes(16);
  const pin = `${sal.toString('hex')}:${scryptSync('246810', sal, 32).toString('hex')}`;
  const u = db0.prepare("INSERT INTO users (name, color, is_admin, pin, pin_len, created_at) VALUES ('Nuevo','#fff',0,?,6,'x') RETURNING id").get(pin);
  db0.close();
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u.id, pin: '246810' }) });
  assert.equal(r.status, 200, 'el login no entro');
  const valor = (r.headers.get('set-cookie') ?? '').split(';')[0].split('=')[1];
  assert.ok(valor && valor.length === 64, 'sin galleta de sesion');

  // Con la galleta se entra, y al salir la sesion desaparece de la base
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: `cineteca_session=${valor}` } })).status, 200);
  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  const filas = db.prepare('SELECT token, cifrado FROM sessions WHERE user_id = ?').all(u.id);
  db.close();
  assert.equal(filas.length, 1);
  assert.equal(filas[0].token, sha(valor), 'se guardo algo distinto de la huella');
  assert.equal(filas[0].cifrado, 1);

  await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: `cineteca_session=${valor}` } });
  const db2 = new DatabaseSync(join(datos, 'tvwatch.db'));
  const quedan = db2.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(u.id).n;
  db2.close();
  assert.equal(quedan, 0, 'el logout no borro la sesion');
});
