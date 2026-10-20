/*
 * Las miniaturas de episodio de tinyMediaManager son `<episodio>-thumb.webp`; el escaner solo buscaba .jpg/.png y los 3.793
 * episodios de la biblioteca tenian `thumb = NULL` teniendo 3.341 ficheros en disco. Tiene que ser por nombre EXACTO: un episodio
 * sin miniatura no puede quedarse con la del vecino (comparten casi todo el nombre).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-thumb-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { db } = await import('../src/db.ts');

const raiz = join(datos, 'series');
const lib = { name: 'Series', path: raiz, kind: 'show' };

before(() => {
  const t = join(raiz, 'Serie Prueba (2020)', 'Season 1');
  mkdirSync(t, { recursive: true });
  for (const n of ['Serie Prueba - S01E01 - Uno', 'Serie Prueba - S01E02 - Dos', 'Serie Prueba - S01E03 - Tres']) {
    const fd = openSync(join(t, n + '.mkv'), 'w');
    ftruncateSync(fd, 6 * 1024 * 1024);
    closeSync(fd);
  }
  writeFileSync(join(t, 'Serie Prueba - S01E01 - Uno-thumb.webp'), 'x');
  writeFileSync(join(t, 'Serie Prueba - S01E03 - Tres-thumb.jpg'), 'x');
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('el -thumb.webp de un episodio se reconoce y el episodio sin miniatura no coge la de otro', async () => {
  await scanLibrary(lib);
  const filas = db.prepare('SELECT episode, thumb FROM episodes ORDER BY episode').all();
  assert.match(filas[0].thumb, /S01E01 - Uno-thumb\.webp$/);
  assert.equal(filas[1].thumb, null, 'E02 no tiene miniatura: no se le presta la del vecino');
  assert.match(filas[2].thumb, /S01E03 - Tres-thumb\.jpg$/, 'jpg sigue valiendo');
});
