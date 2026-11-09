// /api/skip/marcar: validacion de entrada. La ruta del 07/11 aceptaba cualquier cosa y dejaba en la BD
// rangos imposibles o una deteccion automatica convertida en «manual» sin cambiar nada (revision 09/11/2026).
// La siembra es la REAL: en la biblioteca los ficheros de episodio llevan episode_id y NO item_id (0 de 3.891
// llevan los dos); el test original los sembraba con ambos y por eso no veia lo que pasaba en produccion.
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

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });

const pedir = (metodo, ruta, { cuerpo, galleta, cabeceras = {} } = {}) =>
  fetch(base + ruta, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(galleta ? { Cookie: galleta } : {}),
      ...cabeceras,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(8000),
  });
const marcar = (cuerpo) => pedir('POST', '/api/skip/marcar', { cuerpo, galleta: galletaAdmin });
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const bd = () => {
  const d = new DatabaseSync(join(datos, 'tvwatch.db'));
  d.exec('PRAGMA busy_timeout = 10000');
  return d;
};
const consulta = (sql, ...p) => {
  const d = bd();
  try { return d.prepare(sql).all(...p); } finally { d.close(); }
};

// ids sembrados
const PELI = 10;       // pelicula sin analizar, 7200 s
const AUTO = 30;       // pelicula con deteccion automatica ya hecha (texto-sube), 7200 s
const EP = 200;        // episodio, 3000 s, SIN item_id como en produccion

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-marcar-val-'));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER,
    stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_PORT: String(puerto), MEDIAWATCH_HOST: '127.0.0.1' },
  });
  const t0 = Date.now();
  let vivo = false;
  while (Date.now() - t0 < 15_000) {
    try {
      const r = await fetch(`${base}/api/salud`, { signal: AbortSignal.timeout(500) });
      if (r.ok) { vivo = true; break; }
    } catch { /* arrancando */ }
    await esperar(100);
  }
  if (!vivo) throw new Error('El servidor de pruebas no arranco');

  const resAdmin = await pedir('POST', '/api/users', {
    cuerpo: { name: 'Admin', pin: '654321', is_admin: 1 },
    cabeceras: { Host: `127.0.0.1:${puerto}`, Origin: base },
  });
  assert.equal(resAdmin.status, 200);
  galletaAdmin = galletaDe(resAdmin);

  const d = bd();
  try {
    d.prepare("INSERT INTO libraries (id, name, path, kind) VALUES (1, 'Cine', '/cine', 'movie')").run();
    d.prepare("INSERT INTO items (id, library_id, title, sort_title, search_title, folder, scanned_at, kind, year) VALUES (1, 1, 'Peli', 'peli', 'peli', '/cine/p', '2026-11-09', 'movie', 2024)").run();
    d.prepare(`INSERT INTO media_files (id, item_id, path, duration) VALUES (${PELI}, 1, '/cine/p.mkv', 7200)`).run();
    d.prepare("INSERT INTO items (id, library_id, title, sort_title, search_title, folder, scanned_at, kind, year) VALUES (2, 1, 'Serie', 'serie', 'serie', '/cine/s', '2026-11-09', 'show', 2024)").run();
    d.prepare("INSERT INTO episodes (id, show_id, season, episode, title) VALUES (20, 2, 1, 1, 'Piloto')").run();
    d.prepare(`INSERT INTO media_files (id, episode_id, path, duration) VALUES (${EP}, 20, '/cine/s/e1.mkv', 3000)`).run();
    d.prepare("INSERT INTO items (id, library_id, title, sort_title, search_title, folder, scanned_at, kind, year) VALUES (3, 1, 'Auto', 'auto', 'auto', '/cine/a', '2026-11-09', 'movie', 2024)").run();
    d.prepare(`INSERT INTO media_files (id, item_id, path, duration) VALUES (${AUTO}, 3, '/cine/a.mkv', 7200)`).run();
    d.prepare("INSERT INTO pelicula_creditos (item_id, rangos, escenas, metodo, created_at) VALUES (3, ?, '[]', 'texto-sube', '2026-10-01')")
      .run(JSON.stringify([{ start_s: 6900, end_s: 7200 }]));
  } finally {
    d.close();
  }
});

after(() => {
  try { proceso?.kill(); } catch { /* fuera */ }
  if (datos) {
    try { rmSync(datos, { recursive: true, force: true }); } catch { /* temporal */ }
  }
});

const filaAuto = () => consulta('SELECT rangos, escenas, metodo FROM pelicula_creditos WHERE item_id = 3')[0];

test('un tipo que no existe se rechaza y no toca nada', async () => {
  const r = await marcar({ fileId: AUTO, tipo: 'loquesea', segundo: 10 });
  assert.equal(r.status, 400);
  assert.equal(filaAuto().metodo, 'texto-sube', 'la deteccion automatica no debe pasar a manual');
});

test('intro_* en una pelicula se rechaza: no cambia nada, no convierte lo automatico en manual', async () => {
  for (const tipo of ['intro_inicio', 'intro_fin']) {
    const r = await marcar({ fileId: AUTO, tipo, segundo: 30 });
    assert.equal(r.status, 400, tipo);
  }
  assert.equal(filaAuto().metodo, 'texto-sube');
  // y sobre una pelicula SIN fila, tampoco debe crearse una fila «manual» vacia (que la daria por «ya mirada»)
  const r = await marcar({ fileId: PELI, tipo: 'intro_inicio', segundo: 30 });
  assert.equal(r.status, 400);
  assert.equal(consulta('SELECT 1 FROM pelicula_creditos WHERE item_id = 1').length, 0);
});

test('post_creditos en un episodio da 400 con un motivo claro (no «no vinculado»)', async () => {
  const r = await marcar({ fileId: EP, tipo: 'post_creditos', segundo: 2900 });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /pel[ií]cula/i);
  assert.doesNotMatch(j.error, /vinculado/i);
});

test('sin segundo (o no numerico, o negativo) se rechaza en vez de guardar 0', async () => {
  for (const cuerpo of [
    { fileId: PELI, tipo: 'creditos_fin' },
    { fileId: PELI, tipo: 'creditos_inicio', segundo: 'abc' },
    { fileId: PELI, tipo: 'creditos_inicio', segundo: -5 },
    { fileId: PELI, tipo: 'creditos_inicio', segundo: null },
  ]) {
    const r = await marcar(cuerpo);
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
  }
  assert.equal(consulta('SELECT 1 FROM pelicula_creditos WHERE item_id = 1').length, 0, 'no debe haberse guardado nada');
});

test('un segundo mas alla de la duracion se rechaza', async () => {
  for (const tipo of ['creditos_inicio', 'creditos_fin', 'post_creditos']) {
    const r = await marcar({ fileId: PELI, tipo, segundo: 9999 });
    assert.equal(r.status, 400, tipo);
  }
  assert.equal(consulta('SELECT 1 FROM pelicula_creditos WHERE item_id = 1').length, 0);
});

test('pelicula: el fin de creditos no puede ser anterior al inicio marcado', async () => {
  let r = await marcar({ fileId: PELI, tipo: 'creditos_inicio', segundo: 6900 });
  assert.equal(r.status, 200);
  r = await marcar({ fileId: PELI, tipo: 'creditos_fin', segundo: 100 });
  assert.equal(r.status, 400);
  const fila = consulta('SELECT rangos FROM pelicula_creditos WHERE item_id = 1')[0];
  const rangos = JSON.parse(fila.rangos);
  assert.equal(rangos[0].start_s, 6900);
  assert.ok(rangos[0].end_s > rangos[0].start_s, 'el rango sigue siendo valido');
  // un fin valido si se acepta
  r = await marcar({ fileId: PELI, tipo: 'creditos_fin', segundo: 7100 });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(consulta('SELECT rangos FROM pelicula_creditos WHERE item_id = 1')[0].rangos)[0].end_s, 7100);
});

test('episodio: fin de cabecera anterior a su inicio y fin de creditos anterior a su inicio se rechazan', async () => {
  let r = await marcar({ fileId: EP, tipo: 'intro_inicio', segundo: 60 });
  assert.equal(r.status, 200);
  r = await marcar({ fileId: EP, tipo: 'intro_fin', segundo: 30 });
  assert.equal(r.status, 400);
  r = await marcar({ fileId: EP, tipo: 'intro_fin', segundo: 120 });
  assert.equal(r.status, 200);

  r = await marcar({ fileId: EP, tipo: 'creditos_inicio', segundo: 2800 });
  assert.equal(r.status, 200);
  r = await marcar({ fileId: EP, tipo: 'creditos_fin', segundo: 100 });
  assert.equal(r.status, 400);
  const rangos = consulta('SELECT kind, start_s, end_s FROM skip_ranges WHERE episode_id = 20 ORDER BY kind');
  for (const g of rangos) assert.ok(g.end_s > g.start_s, `${g.kind} sigue siendo un rango valido`);
  const cred = rangos.find((g) => g.kind === 'credits');
  assert.equal(cred.start_s, 2800, 'el inicio de creditos no se ha movido');
});

test('lo que SI estaba bien sigue funcionando: marcar y borrar en pelicula y episodio', async () => {
  let r = await marcar({ fileId: AUTO, tipo: 'creditos_inicio', segundo: 6950 });
  assert.equal(r.status, 200);
  assert.equal(filaAuto().metodo, 'manual');
  r = await marcar({ fileId: AUTO, tipo: 'post_creditos', segundo: 7150 });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(filaAuto().escenas)[0].start_s, 7150);
  r = await marcar({ fileId: AUTO, tipo: 'borrar' });
  assert.equal(r.status, 200);
  assert.equal(consulta('SELECT 1 FROM pelicula_creditos WHERE item_id = 3').length, 0);
  r = await marcar({ fileId: EP, tipo: 'borrar' });
  assert.equal(r.status, 200);
  assert.equal(consulta('SELECT 1 FROM skip_ranges WHERE episode_id = 20').length, 0);
});

test('solo un administrador puede marcar (sin cookie: no autenticado)', async () => {
  const r = await pedir('POST', '/api/skip/marcar', { cuerpo: { fileId: PELI, tipo: 'creditos_inicio', segundo: 6900 } });
  assert.ok(r.status === 401 || r.status === 403, `status ${r.status}`);
});
