/*
 * Las fuentes del scraper (carpetas de entrada como C:\Videos) estan SEPARADAS de la biblioteca: viven en `fuentesScraper`, el escaneo general
 * no las toca, y lo que se registra de ellas queda en una biblioteca marcada `entrada` (el scraper la usa; los clientes no la ven).
 * Datos y bibliotecas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-entrada-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanAll } = await import('../src/scanner/scan.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const real = join(base, 'Peliculas');
const entrada = join(base, 'Videos');

before(() => {
  video(join(real, 'Real (2000)', 'Real (2000).mkv'));
  video(join(entrada, 'Entrada Uno (2024)', 'Entrada Uno (2024).mkv'));
  config.libraries = [{ name: 'Peliculas', path: real, kind: 'movie' }];
  config.fuentesScraper = [{ name: 'Videos', path: entrada, kind: 'movie' }];
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('el escaneo general solo toca las bibliotecas, nunca las fuentes del scraper', async () => {
  await scanAll();
  assert.deepEqual(db.prepare('SELECT title FROM items').all().map((r) => r.title), ['Real']);
  assert.deepEqual(db.prepare('SELECT name, entrada FROM libraries').all().map((r) => ({ ...r })), [{ name: 'Peliculas', entrada: 0 }]);
});

test('escanear una fuente del scraper la registra como biblioteca de ENTRADA', async () => {
  await scanAll(undefined, { solo: [entrada] });
  assert.deepEqual(db.prepare('SELECT title FROM items ORDER BY title').all().map((r) => r.title), ['Entrada Uno', 'Real']);
  assert.deepEqual(db.prepare('SELECT name, entrada FROM libraries ORDER BY name').all().map((r) => ({ ...r })), [{ name: 'Peliculas', entrada: 0 }, { name: 'Videos', entrada: 1 }]);
});

test('despues, el escaneo general sigue sin tocar la entrada (no la actualiza ni la borra)', async () => {
  video(join(entrada, 'Entrada Dos (2025)', 'Entrada Dos (2025).mkv'));
  await scanAll();
  assert.deepEqual(db.prepare('SELECT title FROM items ORDER BY title').all().map((r) => r.title), ['Entrada Uno', 'Real']);
});
