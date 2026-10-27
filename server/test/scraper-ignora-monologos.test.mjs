/*
 * Los monólogos no tienen datos que buscar (ni los tendrán) y llenaban el Scraper: ni salen en la lista del asistente, ni en sus
 * contadores, ni como fuente, ni como ficheros sin registrar, ni en la pestaña Biblioteca. Lo demás sigue igual.
 * Datos y bibliotecas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-mono-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { listarCandidatos, fuentesConPendientes, totalPendientes, sinRegistrar, SIN_IGNORADAS } = await import('../src/scanner/lote.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const monologos = join(base, 'Monologos');
const peliculas = join(base, 'Peliculas');

before(async () => {
  video(join(monologos, 'Un Monologo (2020)', 'Un Monologo (2020).mkv'));
  video(join(peliculas, 'Una Pelicula (2021)', 'Una Pelicula (2021).mkv'));
  config.libraries = [{ name: 'Monólogos', path: monologos, kind: 'movie' }, { name: 'Películas', path: peliculas, kind: 'movie' }];
  await scanLibrary(config.libraries[0]);
  await scanLibrary(config.libraries[1]);
  // Esto llega al disco DESPUÉS del análisis: está «sin registrar».
  video(join(monologos, 'Sin Registrar Monologo', 'Sin Registrar Monologo.mkv'));
  video(join(peliculas, 'Sin Registrar Pelicula', 'Sin Registrar Pelicula.mkv'));
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('el asistente no lista monólogos, ni sin filtro ni con «todos»', () => {
  assert.ok(listarCandidatos({}).length > 0, 'la prueba necesita candidatos de la otra biblioteca');
  assert.ok(listarCandidatos({}).every((x) => x.biblioteca !== 'Monólogos'));
  assert.ok(listarCandidatos({ todos: true }).every((x) => x.biblioteca !== 'Monólogos'));
  assert.deepEqual(listarCandidatos({ biblioteca: monologos }), []);
});

test('los pendientes no cuentan monólogos y el selector de fuentes no los ofrece', () => {
  const pendientes = db.prepare("SELECT COUNT(*) AS n FROM items i JOIN libraries l ON l.id = i.library_id WHERE l.name <> 'Monólogos' AND (i.tmdb_id IS NULL OR i.tmdb_id = '') AND i.meta_origen IS NULL").get().n;
  assert.equal(totalPendientes(), pendientes);
  assert.deepEqual(fuentesConPendientes().map((f) => f.name), ['Películas']);
});

test('los ficheros sin registrar de la carpeta de monólogos no salen (y en otra biblioteca sí)', () => {
  assert.deepEqual(sinRegistrar(peliculas).map((x) => x.carpeta), ['Sin Registrar Pelicula']);
  assert.deepEqual(sinRegistrar(monologos), []);
});

test('SIN_IGNORADAS deja fuera los monólogos en una consulta sobre items (la pestaña Biblioteca)', () => {
  const todos = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  const sin = db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${SIN_IGNORADAS}`).get().n;
  const deMonologos = db.prepare("SELECT COUNT(*) AS n FROM items i JOIN libraries l ON l.id = i.library_id WHERE l.name = 'Monólogos'").get().n;
  assert.ok(deMonologos > 0);
  assert.equal(sin, todos - deMonologos);
});
