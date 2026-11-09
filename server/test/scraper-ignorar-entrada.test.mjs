/*
 * «Ya catalogado»: el usuario pulsa el boton y espera que el titulo salga de la lista de pendientes, tambien si esta en una fuente de entrada
 * (antes `COND_PENDIENTE` incluia `OR l.entrada = 1` y el boton no hacia nada ahi). Lo ya escrapeado de la entrada SIGUE pendiente hasta enviarlo.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-ign-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { listarCandidatos, ignorarItem, marcarEntradas, totalPendientes } = await import('../src/scanner/lote.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const entrada = join(base, 'Videos');
const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const id = (c) => db.prepare('SELECT id FROM items WHERE folder LIKE ?').get(`%${c}`).id;

before(async () => {
  video(join(entrada, 'Ignorada.2024', 'Ignorada.2024.mkv'));
  video(join(entrada, 'Escrapeada.2025', 'Escrapeada.2025.mkv'));
  video(join(entrada, 'Pendiente.2026', 'Pendiente.2026.mkv'));
  config.libraries = [];
  config.fuentesScraper = [{ name: 'Videos', path: entrada, kind: 'movie' }];
  await scanLibrary(config.fuentesScraper[0]);
  marcarEntradas();
  db.prepare("UPDATE items SET tmdb_id = '5', meta_origen = 'tmdb' WHERE folder LIKE '%Escrapeada.2025'").run();
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('en la entrada, lo marcado «ya catalogado» sale de pendientes; lo escrapeado y lo sin tocar siguen', () => {
  assert.equal(totalPendientes(), 3);
  ignorarItem(id('Ignorada.2024'));
  assert.deepEqual(listarCandidatos({}).map((x) => x.carpeta).sort(), ['Escrapeada.2025', 'Pendiente.2026']);
  assert.equal(totalPendientes(), 2);
});
