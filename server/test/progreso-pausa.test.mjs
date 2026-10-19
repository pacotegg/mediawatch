/*
 * Una sesión en PAUSA sigue mandando el informe de progreso cada 15 s con la misma posición. Eso refrescaba la señal de
 * actividad (data/actividad.timestamp) y `hayAlguienViendo()` daba «viendo» para siempre: el 19-20/10/2026 una película en
 * pausa 4 horas bloqueó el arte de los monólogos, la recodificación y la espera de un reinicio. Solo cuenta como actividad
 * lo que avanza (o el primer informe, o terminar).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let proceso;
let base;
let galleta;
let itemId;

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
const senal = () => { const f = join(datos, 'actividad.timestamp'); return existsSync(f) ? Number(readFileSync(f, 'utf8')) : 0; };
const informar = (position) => pedir('POST', '/api/progress', { galleta, cuerpo: { itemId, position, duration: 6840 } });

before(async () => {
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
  galleta = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));

  const db = new DatabaseSync(join(datos, 'tvwatch.db'));
  db.exec('PRAGMA busy_timeout = 10000');
  const lib = db.prepare("INSERT INTO libraries (name, path, kind) VALUES ('Pelis', '/tmp/pelis', 'movies') RETURNING id").get();
  const it = db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, added_at, scanned_at) VALUES (?, 'movie', 'pelitest', 'Pelicula Test', 'pelicula test', '2026-01-01', '2026-01-01') RETURNING id").get(lib.id);
  itemId = it.id;
  db.prepare("INSERT INTO media_files (item_id, duration, size, path) VALUES (?, 6840, 1000000, 'test.mkv')").run(itemId);
  db.close();
});

after(async () => {
  if (proceso && proceso.exitCode === null) {
    proceso.kill();
    await new Promise((r) => proceso.once('exit', r));
  }
  await esperar(200);
  try { rmSync(datos, { recursive: true, force: true }); } catch { /* ignorar lock en windows */ }
});

test('el progreso que avanza refresca la señal de actividad; el mismo informe repetido (pausa) no', async () => {
  assert.equal((await informar(100)).status, 200, 'primer informe');
  const t1 = senal();
  assert.ok(t1 > 0, 'el primer informe marca actividad');

  await esperar(5300); // marcarActividad escribe el fichero como mucho cada 5 s: menos, y la prueba no distinguiría nada
  assert.equal((await informar(100)).status, 200, 'pausa: misma posición');
  assert.equal(senal(), t1, 'una pausa no refresca la señal');

  await esperar(5300); // marcarActividad escribe el fichero como mucho cada 5 s: menos, y la prueba no distinguiría nada
  assert.equal((await informar(100.4)).status, 200, 'pausa con ruido de medio segundo');
  assert.equal(senal(), t1, 'menos de un segundo de diferencia sigue siendo pausa');

  await esperar(5300); // marcarActividad escribe el fichero como mucho cada 5 s: menos, y la prueba no distinguiría nada
  assert.equal((await informar(115)).status, 200, 'avanza');
  assert.ok(senal() > t1, 'avanzar sí refresca la señal');
}, { timeout: 60000 });
