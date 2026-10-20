/*
 * El asistente de nuevos como tMM: aparece la LISTA de ficheros de la fuente y el usuario marca los que quiere escrapear (no se busca
 * nada por su cuenta). La lista se puede filtrar por fuente (carpeta de entrada, biblioteca...), por texto, y mostrar solo lo sin escrapear
 * o todo. Datos y bibliotecas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-cand-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { listarCandidatos, fuentesConPendientes } = await import('../src/scanner/lote.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const entrada = join(base, 'Videos');
const biblio = join(base, 'Peliculas');

before(async () => {
  video(join(entrada, 'Nueva.Uno.2024', 'Nueva.Uno.2024.mkv'));
  video(join(entrada, 'Nueva.Dos.2025', 'Nueva.Dos.2025.mkv'));
  video(join(biblio, 'Vieja Escrapeada (2001)', 'Vieja Escrapeada (2001).mkv'));
  video(join(biblio, 'Otra.Sin.Escrapear', 'Otra.Sin.Escrapear.mkv'));
  config.libraries = [{ name: 'Entrada', path: entrada, kind: 'movie' }, { name: 'Peliculas', path: biblio, kind: 'movie' }];
  await scanLibrary(config.libraries[0]);
  await scanLibrary(config.libraries[1]);
  db.prepare("UPDATE items SET tmdb_id = '99' WHERE title LIKE 'Vieja%'").run();
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('sin filtro: solo lo sin escrapear de todas las fuentes, con el nombre de la carpeta en disco', () => {
  const l = listarCandidatos({});
  assert.deepEqual(l.map((x) => x.carpeta).sort(), ['Nueva.Dos.2025', 'Nueva.Uno.2024', 'Otra.Sin.Escrapear']);
  assert.ok(l.every((x) => x.biblioteca && x.escrapeado === false));
});

test('por fuente: solo lo de esa carpeta', () => {
  assert.deepEqual(listarCandidatos({ biblioteca: entrada }).map((x) => x.carpeta).sort(), ['Nueva.Dos.2025', 'Nueva.Uno.2024']);
  assert.deepEqual(listarCandidatos({ biblioteca: biblio }).map((x) => x.carpeta), ['Otra.Sin.Escrapear']);
});

test('«todos» incluye lo ya escrapeado, marcado como tal', () => {
  const l = listarCandidatos({ biblioteca: biblio, todos: true });
  assert.deepEqual(l.map((x) => [x.carpeta, x.escrapeado]).sort(), [['Otra.Sin.Escrapear', false], ['Vieja Escrapeada (2001)', true]]);
});

test('por texto', () => {
  assert.deepEqual(listarCandidatos({ q: 'dos' }).map((x) => x.carpeta), ['Nueva.Dos.2025']);
});

test('las fuentes con su numero de pendientes (para el selector)', () => {
  const f = fuentesConPendientes();
  assert.deepEqual(f.map((x) => [x.name, x.pendientes]), [['Entrada', 2], ['Peliculas', 1]]);
});
