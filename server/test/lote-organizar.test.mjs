/*
 * Organizar EN LOTE (el flujo de tMM: «renombrar» sobre una seleccion). Primero se ve el plan de TODOS los titulos, y solo se
 * ejecuta si el cliente confirma esa lista; un titulo que falla no impide los demas y cada uno lleva su resultado. Datos y
 * biblioteca temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-lote-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { planesDeLote, ejecutarLote } = await import('../src/scanner/lote.ts');
const { db } = await import('../src/db.ts');

const pelis = join(base, 'peliculas');
const lib = { name: 'Pelis', path: pelis, kind: 'movie' };
const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const id = (t) => db.prepare('SELECT id FROM items WHERE title = ?').get(t).id;
const preparar = (titulo, nuevo, anio, medido = true) => {
  const i = id(titulo);
  db.prepare('UPDATE items SET title = ?, year = ? WHERE id = ?').run(nuevo, anio, i);
  if (medido) {
    const f = db.prepare('SELECT id FROM media_files WHERE item_id = ?').get(i).id;
    db.prepare('UPDATE media_files SET width = 1920, height = 1080, probed = 1 WHERE id = ?').run(f);
    db.prepare('INSERT INTO audio_tracks (file_id, idx, codec, language, channels) VALUES (?,?,?,?,?)').run(f, 1, 'eac3', 'spa', 6);
  }
  return i;
};

before(async () => {
  video(join(pelis, 'Uno.2001', 'Uno.2001.mkv'));
  video(join(pelis, 'Dos.2002', 'Dos.2002.mkv'));
  video(join(pelis, 'Tres.2003', 'Tres.2003.mkv'));
  await scanLibrary(lib);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('el plan del lote incluye a cada titulo, con su error si no se puede', () => {
  const a = preparar('Uno', 'La Uno', 2001);
  const b = preparar('Dos', 'La Dos', 2002);
  const c = preparar('Tres', 'La Tres', 2003, false); // sin medir: no se puede
  const planes = planesDeLote([a, b, c]);
  assert.equal(planes.length, 3);
  assert.equal(planes[0].error, undefined);
  assert.ok(planes[0].pasos.length >= 2);
  assert.match(planes[2].error, /sin medir/);
  assert.ok(existsSync(join(pelis, 'Uno.2001', 'Uno.2001.mkv')), 'planificar no mueve nada');
});

test('ejecutar mueve los que se pueden, informa de los que no, y un fallo no frena a los demas', async () => {
  const [a, b, c] = ['La Uno', 'La Dos', 'La Tres'].map(id);
  const progreso = [];
  const r = await ejecutarLote([a, b, c], { copiarArte: false }, (p) => progreso.push(p.hechos));
  assert.deepEqual(r.map((x) => [x.itemId, x.ok]), [[a, true], [b, true], [c, false]]);
  assert.match(r[2].error, /sin medir/);
  assert.ok(existsSync(join(pelis, 'La Uno (2001)', 'La Uno (2001) 1080p EAC3.mkv')));
  assert.ok(existsSync(join(pelis, 'La Dos (2002)', 'La Dos (2002) 1080p EAC3.mkv')));
  assert.ok(existsSync(join(pelis, 'Tres.2003', 'Tres.2003.mkv')), 'el fallido se queda como estaba');
  assert.deepEqual(progreso, [1, 2, 3]);
});

test('ejecutar otra vez lo ya organizado no hace nada (idempotente)', async () => {
  const r = await ejecutarLote([id('La Uno')], { copiarArte: false }, () => {});
  assert.deepEqual(r.map((x) => [x.ok, x.movidos]), [[true, 0]]);
});
