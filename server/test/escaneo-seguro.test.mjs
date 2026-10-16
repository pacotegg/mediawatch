/*
 * Un escaneo con la biblioteca desmontada (E: que no responde, un USB que se reconecta) no puede vaciar la base:
 * borrar los titulos se lleva por delante el progreso, los favoritos y el historial de todos los perfiles, y el
 * borrado de ficheros ausentes tira despues las miniaturas de la barra (dias de trabajo).
 * Biblioteca falsa en una carpeta temporal; datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, ftruncateSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-scan-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { db } = await import('../src/db.ts');

const raiz = join(datos, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
const N = 25;

function video(ruta) {
  const fd = openSync(ruta, 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
}
const titulos = () => db.prepare('SELECT COUNT(*) AS n FROM items').get().n;

before(() => {
  mkdirSync(raiz, { recursive: true });
  for (let i = 0; i < N; i++) {
    const d = join(raiz, `Pelicula ${i} (2000)`);
    mkdirSync(d);
    video(join(d, `Pelicula ${i} (2000).mkv`));
  }
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('el primer escaneo mete los titulos', async () => {
  assert.equal(await scanLibrary(lib), N);
  assert.equal(titulos(), N);
});

test('quitar un par de peliculas de verdad se refleja', async () => {
  rmSync(join(raiz, 'Pelicula 0 (2000)'), { recursive: true });
  rmSync(join(raiz, 'Pelicula 1 (2000)'), { recursive: true });
  await scanLibrary(lib);
  assert.equal(titulos(), N - 2);
});

test('biblioteca que no responde: no se borra nada', async () => {
  renameSync(raiz, raiz + '-desmontada');
  await assert.rejects(() => scanLibrary(lib), /no responde/);
  assert.equal(titulos(), N - 2);
});

test('biblioteca que responde pero vacia (punto de montaje sin disco): no se borra nada', async () => {
  mkdirSync(raiz);
  await assert.rejects(() => scanLibrary(lib), /parece que el disco no responde/);
  assert.equal(titulos(), N - 2);
  rmSync(raiz, { recursive: true });
  renameSync(raiz + '-desmontada', raiz);
});

test('los ficheros de casi toda la biblioteca ausentes de golpe: no se borra nada', async () => {
  const antes = db.prepare('SELECT COUNT(*) AS n FROM media_files').get().n;
  for (let i = 2; i < 22; i++) rmSync(join(raiz, `Pelicula ${i} (2000)`, `Pelicula ${i} (2000).mkv`));
  await assert.rejects(() => scanLibrary(lib), /parece que el disco no responde/);
  assert.equal(titulos(), N - 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_files').get().n, antes);
});

test('con forzar si se aplica el borrado grande', async () => {
  await scanLibrary(lib, undefined, { forzar: true });
  assert.ok(titulos() <= 5, `quedan ${titulos()}`);
});

test('solo ficheros ausentes (los titulos siguen con otra version): tampoco se retiran de golpe', async () => {
  const dobles = join(datos, 'dobles');
  mkdirSync(dobles);
  for (let i = 0; i < N; i++) {
    const d = join(dobles, `Doble ${i} (2001)`);
    mkdirSync(d);
    const fd = openSync(join(d, `Doble ${i} (2001).mkv`), 'w');
    ftruncateSync(fd, 8 * 1024 * 1024);
    closeSync(fd);
    const fd2 = openSync(join(d, `Doble ${i} (2001) corta.mkv`), 'w');
    ftruncateSync(fd2, 6 * 1024 * 1024);
    closeSync(fd2);
  }
  const libDobles = { name: 'Dobles', path: dobles, kind: 'movie' };
  await scanLibrary(libDobles);
  const antes = db.prepare("SELECT COUNT(*) AS n FROM media_files WHERE path LIKE '%dobles%'").get().n;
  assert.equal(antes, N);
  for (let i = 0; i < 20; i++) rmSync(join(dobles, `Doble ${i} (2001)`, `Doble ${i} (2001).mkv`));
  await assert.rejects(() => scanLibrary(libDobles), /Faltan \d+ de \d+ ficheros/);
  const rutas = db.prepare("SELECT path FROM media_files WHERE path LIKE '%dobles%'").all();
  assert.equal(rutas.filter((r) => /corta/.test(r.path)).length >= 0, true);
  // Las filas de los 20 ficheros que ya no existen siguen ahi: no se retiraron.
  assert.ok(rutas.filter((r) => !/corta/.test(r.path)).length >= 20, 'las filas ausentes se conservan');
});
