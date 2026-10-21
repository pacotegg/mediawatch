/*
 * Gestion de las fuentes del scraper: se validan (existen, no se repiten, no son ni estan dentro de una biblioteca ni la contienen: una carpeta no
 * puede ser a la vez entrada y biblioteca) y se sincronizan con la base (la biblioteca de una fuente queda como ENTRADA; una biblioteca real, no).
 * Datos y carpetas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-gestion-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { validarFuentes, marcarEntradas, fuentesConPendientes } = await import('../src/scanner/lote.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const biblioteca = join(base, 'E', 'Peliculas');
const videos = join(base, 'C', 'Videos');
const descargas = join(base, 'C', 'Descargas');
before(() => {
  for (const d of [biblioteca, videos, descargas, join(biblioteca, 'dentro')]) mkdirSync(d, { recursive: true });
  config.libraries = [{ name: 'Peliculas', path: biblioteca, kind: 'movie' }];
  config.fuentesScraper = [];
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('una fuente valida se acepta y se normaliza', () => {
  const r = validarFuentes([{ name: '  Videos ', path: videos, kind: 'movie' }]);
  assert.deepEqual(r, [{ name: 'Videos', path: videos, kind: 'movie' }]);
});

test('se rechazan: sin nombre, tipo raro, ruta inexistente, repetida', () => {
  assert.throws(() => validarFuentes([{ name: '', path: videos, kind: 'movie' }]), /nombre/i);
  assert.throws(() => validarFuentes([{ name: 'X', path: videos, kind: 'otra' }]), /tipo/i);
  assert.throws(() => validarFuentes([{ name: 'X', path: join(base, 'no-existe'), kind: 'movie' }]), /no existe/i);
  assert.throws(() => validarFuentes([{ name: 'A', path: videos, kind: 'movie' }, { name: 'B', path: videos, kind: 'show' }]), /repetida/i);
});

test('una carpeta no puede ser entrada y biblioteca a la vez (ni estar dentro, ni contenerla)', () => {
  assert.throws(() => validarFuentes([{ name: 'X', path: biblioteca, kind: 'movie' }]), /ya es una biblioteca/i);
  assert.throws(() => validarFuentes([{ name: 'X', path: join(biblioteca, 'dentro'), kind: 'movie' }]), /dentro de la biblioteca/i);
  assert.throws(() => validarFuentes([{ name: 'X', path: join(base, 'E'), kind: 'movie' }]), /contiene la biblioteca/i);
});

test('marcarEntradas: la biblioteca de una fuente queda como entrada y una real no', () => {
  db.prepare("INSERT INTO libraries (name, path, kind, entrada) VALUES ('Videos', ?, 'movie', 0)").run(videos);
  db.prepare("INSERT INTO libraries (name, path, kind, entrada) VALUES ('Peliculas', ?, 'movie', 1)").run(biblioteca); // mal puesta a mano
  config.fuentesScraper = [{ name: 'Videos', path: videos, kind: 'movie' }];
  marcarEntradas();
  assert.deepEqual(db.prepare('SELECT name, entrada FROM libraries ORDER BY name').all().map((r) => ({ ...r })), [{ name: 'Peliculas', entrada: 0 }, { name: 'Videos', entrada: 1 }]);
});

test('el selector de fuentes trae bibliotecas y fuentes (aunque aun no se hayan escaneado), con su etiqueta', () => {
  config.fuentesScraper = [{ name: 'Videos', path: videos, kind: 'movie' }, { name: 'Descargas', path: descargas, kind: 'movie' }];
  const f = fuentesConPendientes();
  assert.deepEqual(f.map((x) => [x.name, x.entrada, x.pendientes]), [['Peliculas', false, 0], ['Videos', true, 0], ['Descargas', true, 0]]);
});
