/*
 * Cada escaneo borraba las pistas de audio que ffprobe habia medido y las reescribia con lo que dijera el .nfo. Si el
 * .nfo no traia audio, el fichero quedaba con probed = 1 y sin ninguna pista (254 de 5.671 el 20/10/2026), y las
 * listas y las estadisticas lo daban por mudo. Lo medido manda sobre el .nfo; el .nfo solo vale mientras no hay medida.
 * Biblioteca falsa en una carpeta temporal; datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, ftruncateSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-pistas-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { db } = await import('../src/db.ts');

const raiz = join(datos, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
const audio = (id) => db.prepare('SELECT idx, codec, language, channels FROM audio_tracks WHERE file_id = ? ORDER BY idx').all(id);

before(() => {
  const d = join(raiz, 'Pelicula Medida (2000)');
  mkdirSync(d, { recursive: true });
  const fd = openSync(join(d, 'Pelicula Medida (2000).mkv'), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('un fichero ya medido por ffprobe conserva sus pistas de audio en el siguiente escaneo', async () => {
  await scanLibrary(lib);
  const id = db.prepare('SELECT id FROM media_files').get().id;
  // Lo que deja mediaInfo() al medir: pistas con el indice de flujo real y probed = 1.
  db.prepare('DELETE FROM audio_tracks WHERE file_id = ?').run(id);
  db.prepare("INSERT INTO audio_tracks (file_id, idx, codec, language, channels) VALUES (?,?,?,?,?)").run(id, 1, 'eac3', 'spa', 6);
  db.prepare("INSERT INTO audio_tracks (file_id, idx, codec, language, channels) VALUES (?,?,?,?,?)").run(id, 2, 'eac3', 'eng', 6);
  db.prepare('UPDATE media_files SET probed = 1 WHERE id = ?').run(id);

  await scanLibrary(lib);
  await scanLibrary(lib);
  assert.deepEqual(audio(id).map((a) => [a.idx, a.codec, a.language]), [[1, 'eac3', 'spa'], [2, 'eac3', 'eng']]);
});

test('lo mismo con los subtitulos incrustados medidos: se conservan, y un .srt de al lado se sigue refrescando', async () => {
  const id = db.prepare('SELECT id FROM media_files').get().id;
  db.prepare('UPDATE media_files SET probed = 1 WHERE id = ?').run(id);
  db.prepare('DELETE FROM sub_tracks WHERE file_id = ?').run(id);
  db.prepare("INSERT INTO sub_tracks (file_id, idx, codec, language, forced, external) VALUES (?,?,?,?,?,NULL)").run(id, 3, 'subrip', 'spa', 0);
  const ruta = db.prepare('SELECT path FROM media_files WHERE id = ?').get(id).path;
  writeFileSync(ruta.replace(/\.mkv$/, '.es.srt'), '1\n00:00:01,000 --> 00:00:02,000\nhola\n');
  await scanLibrary(lib);
  const subs = db.prepare('SELECT idx, codec, external FROM sub_tracks WHERE file_id = ? ORDER BY idx').all(id);
  assert.equal(subs.filter((x) => x.external === null).length, 1, 'la incrustada medida sigue');
  assert.equal(subs.filter((x) => x.external !== null).length, 1, 'el .srt de al lado se registra');
});

test('un fichero que cambia de tamano (otro fichero) vuelve a depender del .nfo', async () => {
  const id = db.prepare('SELECT id FROM media_files').get().id;
  const ruta = db.prepare('SELECT path FROM media_files WHERE id = ?').get(id).path;
  const fd = openSync(ruta, 'r+');
  ftruncateSync(fd, 7 * 1024 * 1024);
  closeSync(fd);
  await scanLibrary(lib);
  assert.equal(db.prepare('SELECT probed FROM media_files WHERE id = ?').get(id).probed, 0, 'tamano distinto: hay que volver a medir');
  assert.deepEqual(audio(id), [], 'sin .nfo ni medida no se inventa nada');
});
