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
let proceso, datos, base, galletaAdmin, fileIdPeli, fileIdSerie;

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

const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const bd = () => {
  const d = new DatabaseSync(join(datos, 'tvwatch.db'));
  d.exec('PRAGMA busy_timeout = 10000');
  return d;
};

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-marcar-test-'));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER,
    stdio: 'ignore',
    env: {
      ...process.env,
      MEDIAWATCH_DATA_DIR: datos,
      MEDIAWATCH_PORT: String(puerto),
      MEDIAWATCH_HOST: '127.0.0.1',
    },
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
  if (!vivo) throw new Error('El servidor de pruebas no arrancó');

  // Crear primer admin
  const resAdmin = await pedir('POST', '/api/users', {
    cuerpo: { name: 'Admin', pin: '654321', is_admin: 1 },
    cabeceras: { Host: `127.0.0.1:${puerto}`, Origin: base },
  });
  assert.equal(resAdmin.status, 200);
  galletaAdmin = galletaDe(resAdmin);

  // Sembrar datos de prueba: 1 biblioteca, 1 película con media_file, 1 serie con episodio y media_file
  const d = bd();
  try {
    d.prepare("INSERT INTO libraries (id, name, path, kind) VALUES (1, 'Cine', '/cine', 'movie')").run();
    d.prepare("INSERT INTO items (id, library_id, title, sort_title, search_title, folder, scanned_at, kind, year) VALUES (1, 1, 'Test Movie', 'test movie', 'test movie', '/cine/test', '2026-11-07', 'movie', 2024)").run();
    d.prepare("INSERT INTO media_files (id, item_id, path, duration) VALUES (10, 1, '/cine/test.mkv', 7200)").run();
    fileIdPeli = 10;

    d.prepare("INSERT INTO items (id, library_id, title, sort_title, search_title, folder, scanned_at, kind, year) VALUES (2, 1, 'Test Show', 'test show', 'test show', '/cine/show', '2026-11-07', 'show', 2024)").run();
    d.prepare("INSERT INTO episodes (id, show_id, season, episode, title) VALUES (20, 2, 1, 1, 'Piloto')").run();
    d.prepare("INSERT INTO media_files (id, item_id, episode_id, path, duration) VALUES (200, 2, 20, '/cine/show/s01e01.mkv', 3000)").run();
    fileIdSerie = 200;
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

test('marcar tramos en episodio: intro_inicio, intro_fin, creditos_inicio y borrar', async () => {
  // 1. Marcar inicio de intro en 60s
  const r1 = await pedir('POST', '/api/skip/marcar', {
    cuerpo: { fileId: fileIdSerie, tipo: 'intro_inicio', segundo: 60 },
    galleta: galletaAdmin,
  });
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.ok, true);
  assert.equal(j1.tramo.kind, 'intro');
  assert.equal(j1.tramo.start_s, 60);

  // 2. Marcar fin de intro en 120s
  const r2 = await pedir('POST', '/api/skip/marcar', {
    cuerpo: { fileId: fileIdSerie, tipo: 'intro_fin', segundo: 120 },
    galleta: galletaAdmin,
  });
  assert.equal(r2.status, 200);
  const j2 = await r2.json();
  assert.equal(j2.tramo.start_s, 60);
  assert.equal(j2.tramo.end_s, 120);

  // 3. Marcar créditos en 2800s
  const r3 = await pedir('POST', '/api/skip/marcar', {
    cuerpo: { fileId: fileIdSerie, tipo: 'creditos_inicio', segundo: 2800 },
    galleta: galletaAdmin,
  });
  assert.equal(r3.status, 200);
  const j3 = await r3.json();
  assert.equal(j3.tramo.kind, 'credits');
  assert.equal(j3.tramo.start_s, 2800);

  // 4. Borrar tramos
  const r4 = await pedir('POST', '/api/skip/marcar', {
    cuerpo: { fileId: fileIdSerie, tipo: 'borrar' },
    galleta: galletaAdmin,
  });
  assert.equal(r4.status, 200);
  const j4 = await r4.json();
  assert.equal(j4.borrado, true);
});

test('marcar tramos en película: creditos_inicio, post_creditos', async () => {
  // 1. Marcar créditos en 6900s
  const r1 = await pedir('POST', '/api/skip/marcar', {
    cuerpo: { fileId: fileIdPeli, tipo: 'creditos_inicio', segundo: 6900 },
    galleta: galletaAdmin,
  });
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.ok, true);
  assert.equal(j1.pelicula.rangos[0].start_s, 6900);

  // 2. Marcar escena post-créditos en 7100s
  const r2 = await pedir('POST', '/api/skip/marcar', {
    cuerpo: { fileId: fileIdPeli, tipo: 'post_creditos', segundo: 7100 },
    galleta: galletaAdmin,
  });
  assert.equal(r2.status, 200);
  const j2 = await r2.json();
  assert.equal(j2.ok, true);
  assert.equal(j2.pelicula.escenas[0].start_s, 7100);
});
