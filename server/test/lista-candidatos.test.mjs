/*
 * El asistente de nuevos como tMM: aparece la LISTA de ficheros de la fuente y el usuario marca los que quiere escrapear (no se busca
 * nada por su cuenta). La lista se puede filtrar por fuente (carpeta de entrada, biblioteca...), por texto, y mostrar solo lo sin escrapear
 * o todo. Datos y bibliotecas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
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

/* ---- lo que hay en el DISCO de la fuente y el servidor aun no ha analizado (como tMM: aparecen los ficheros al elegir la carpeta) ---- */

test('sinRegistrar: carpetas con video y videos sueltos que aun no estan en la base; ignora lo que no es video, lo pequeno y las carpetas _', async () => {
  const { sinRegistrar } = await import('../src/scanner/lote.ts');
  video(join(entrada, 'Hellraiser (1987)_Tereyalber', 'Hellraiser.mkv'));
  video(join(entrada, 'Suelta.2026.mkv'));
  mkdirSync(join(entrada, 'Carpeta sin videos'), { recursive: true });
  writeFileSync(join(entrada, 'Carpeta sin videos', 'notas.txt'), 'x');
  mkdirSync(join(entrada, '_retirados', 'x'), { recursive: true });
  video(join(entrada, '_retirados', 'x', 'viejo.mkv'));
  writeFileSync(join(entrada, 'Diminuta.mkv'), 'poco');
  const r = sinRegistrar(entrada);
  assert.deepEqual(r.map((x) => [x.carpeta, x.tipo]).sort(), [['Hellraiser (1987)_Tereyalber', 'carpeta'], ['Suelta.2026.mkv', 'video']]);
  // lo ya registrado no sale
  assert.ok(!r.some((x) => /Nueva/.test(x.carpeta)));
});

test('registrarRutas: escanea la fuente y devuelve los ids de lo marcado (carpeta y video suelto)', async () => {
  const { registrarRutas } = await import('../src/scanner/lote.ts');
  const { scanAll } = await import('../src/scanner/scan.ts');
  const ids = await registrarRutas([join(entrada, 'Hellraiser (1987)_Tereyalber'), join(entrada, 'Suelta.2026.mkv')], (_p, solo) => scanAll(undefined, { solo }));
  assert.equal(ids.length, 2);
  const filas = db.prepare(`SELECT folder FROM items WHERE id IN (${ids.join(',')}) ORDER BY folder`).all().map((r) => r.folder);
  assert.deepEqual(filas, [join(entrada, 'Hellraiser (1987)_Tereyalber'), join(entrada, 'Suelta.2026.mkv')]);
});

test('registrarRutas rechaza una ruta que no es de ninguna fuente configurada', async () => {
  const { registrarRutas } = await import('../src/scanner/lote.ts');
  await assert.rejects(() => registrarRutas([join(base, 'fuera', 'algo')]), /no pertenece a ninguna fuente/i);
});
