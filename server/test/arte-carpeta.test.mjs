/*
 * Copiar el arte elegido (data/artwork/<id>/) a la carpeta del titulo, con los nombres de tinyMediaManager, para quien siga
 * leyendolo (Plex con «usar activos locales»). Es escritura en la biblioteca: hay PLAN (que ficheros, cuales retira) y solo se
 * aplica ese plan; lo que se sustituye se aparta a `_retirados/<fecha>` en vez de borrarse. Todo en carpetas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-arte-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { planArteCarpeta, aplicarArteCarpeta } = await import('../src/scanner/arte-carpeta.ts');
const { DATA_DIR } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const raiz = join(base, 'peliculas');
const carpeta = join(raiz, 'Peli Plex (2001)');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
let id;

before(async () => {
  mkdirSync(carpeta, { recursive: true });
  const fd = openSync(join(carpeta, 'Peli Plex (2001).mkv'), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
  writeFileSync(join(carpeta, 'Peli Plex (2001) 1080p-poster.webp'), 'POSTER VIEJO'); // nombre antiguo, de antes de recodificar
  await scanLibrary(lib);
  id = db.prepare('SELECT id FROM items').get().id;
  const art = join(DATA_DIR, 'artwork', String(id));
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, 'poster.webp'), 'POSTER NUEVO');
  writeFileSync(join(art, 'fanart.webp'), 'FONDO NUEVO');
  db.prepare("UPDATE items SET poster = ?, fanart = ?, arte_fijado = 'poster,fanart' WHERE id = ?").run(join(art, 'poster.webp'), join(art, 'fanart.webp'), id);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('el plan dice exactamente que se crea y que se aparta, y no toca nada', () => {
  const plan = planArteCarpeta(id);
  assert.deepEqual(plan.map((p) => [p.papel, p.hacia.split(/[\\/]/).pop(), p.retira?.split(/[\\/]/).pop() ?? null]), [
    ['poster', 'Peli Plex (2001)-poster.webp', 'Peli Plex (2001) 1080p-poster.webp'],
    ['fanart', 'Peli Plex (2001)-fanart.webp', null],
  ]);
  assert.equal(readFileSync(join(carpeta, 'Peli Plex (2001) 1080p-poster.webp'), 'utf8'), 'POSTER VIEJO');
});

test('aplicar escribe los ficheros del plan y aparta el viejo en vez de borrarlo', () => {
  const r = aplicarArteCarpeta(id);
  assert.equal(r.escritos.length, 2);
  assert.equal(readFileSync(join(carpeta, 'Peli Plex (2001)-poster.webp'), 'utf8'), 'POSTER NUEVO');
  assert.equal(readFileSync(join(carpeta, 'Peli Plex (2001)-fanart.webp'), 'utf8'), 'FONDO NUEVO');
  assert.equal(existsSync(join(carpeta, 'Peli Plex (2001) 1080p-poster.webp')), false);
  const dia = readdirSync(join(raiz, '_retirados'))[0];
  assert.equal(readFileSync(join(raiz, '_retirados', dia, 'Peli Plex (2001)', 'Peli Plex (2001) 1080p-poster.webp'), 'utf8'), 'POSTER VIEJO');
  assert.equal(readdirSync(carpeta).filter((n) => n.endsWith('.parte')).length, 0, 'sin temporales');
});

test('despues de copiar, el escaneo sigue sirviendo el arte elegido (arte_fijado) y un segundo plan esta vacio', async () => {
  await scanLibrary(lib);
  const it = db.prepare('SELECT poster, fanart FROM items WHERE id = ?').get(id);
  assert.ok(it.poster.startsWith(DATA_DIR), 'el cartel sigue siendo el elegido');
  assert.deepEqual(planArteCarpeta(id), []);
});

test('un titulo suelto en la raiz (sin carpeta propia) se rechaza', () => {
  db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, added_at, scanned_at) VALUES ((SELECT id FROM libraries LIMIT 1),'movie',?, 'Suelto','suelto','2000','2000')").run(join(raiz, 'suelto.mkv'));
  const s = db.prepare("SELECT id FROM items WHERE title = 'Suelto'").get().id;
  assert.throws(() => planArteCarpeta(s), /sin carpeta propia/);
});
