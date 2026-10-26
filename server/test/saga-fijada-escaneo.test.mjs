/*
 * Una saga fijada a mano (`coleccion_fijada = 1`) no la pisa el escáner aunque el .nfo traiga otra, ni al quitarla
 * (collection NULL) aunque el .nfo la vuelva a poner. Sin fijar, sigue mandando el .nfo como siempre.
 * Biblioteca falsa en una carpeta temporal; datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, ftruncateSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-saga-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { db } = await import('../src/db.ts');

const raiz = join(datos, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
const nfo = (saga) => `<?xml version="1.0" encoding="UTF-8"?><movie><title>Peli Saga</title><year>2000</year>${saga ? `<set><name>${saga}</name></set>` : ''}</movie>`;
const fila = () => db.prepare('SELECT collection, coleccion_fijada FROM items').get();
let carpeta;

before(() => {
  carpeta = join(raiz, 'Peli Saga (2000)');
  mkdirSync(carpeta, { recursive: true });
  const fd = openSync(join(carpeta, 'Peli Saga (2000).mkv'), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('sin fijar, la saga la pone el .nfo', async () => {
  writeFileSync(join(carpeta, 'Peli Saga (2000).nfo'), nfo('Saga del nfo'));
  await scanLibrary(lib);
  assert.deepEqual({ ...fila() }, { collection: 'Saga del nfo', coleccion_fijada: 0 });
});

test('fijada a mano, otra saga en el .nfo no la pisa', async () => {
  db.prepare("UPDATE items SET collection = 'Saga a mano', coleccion_fijada = 1").run();
  writeFileSync(join(carpeta, 'Peli Saga (2000).nfo'), nfo('Otra saga del nfo'));
  await scanLibrary(lib);
  assert.equal(fila().collection, 'Saga a mano');
});

test('fijada como «sin saga», el .nfo no la vuelve a poner', async () => {
  db.prepare('UPDATE items SET collection = NULL, coleccion_fijada = 1').run();
  await scanLibrary(lib);
  assert.deepEqual({ ...fila() }, { collection: null, coleccion_fijada: 1 });
});
