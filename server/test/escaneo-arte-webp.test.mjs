/*
 * La migracion de la cache a WebP dejo carpetas con `poster.webp`, `fanart.webp`, `clearlogo.webp` y `landscape.webp` sin
 * prefijo, y el escaner solo buscaba esos nombres en JPG/PNG: el 20/10/2026 había 5 fichas sin cartel, 90 sin fondo, 77 sin logo
 * y 38 sin horizontal teniendo el fichero al lado. Biblioteca falsa en carpeta temporal.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, ftruncateSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-arte-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { db } = await import('../src/db.ts');
const raiz = join(datos, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };

before(() => {
  const d = join(raiz, 'Con Webp (2001)');
  mkdirSync(d, { recursive: true });
  const fd = openSync(join(d, 'Con Webp (2001).mkv'), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
  for (const n of ['poster.webp', 'fanart.webp', 'clearlogo.webp', 'landscape.webp']) writeFileSync(join(d, n), 'x');
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('el arte sin prefijo en WebP se registra (cartel, fondo, logo y horizontal)', async () => {
  await scanLibrary(lib);
  const it = db.prepare('SELECT poster, fanart, clearlogo, landscape FROM items').get();
  for (const campo of ['poster', 'fanart', 'clearlogo', 'landscape']) {
    assert.ok(it[campo] && it[campo].endsWith(`${campo}.webp`), `${campo}: ${it[campo]}`);
  }
});
