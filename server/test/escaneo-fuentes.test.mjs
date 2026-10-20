/*
 * Fuentes del escaneo: una biblioteca se puede dejar INACTIVA (no entra en el escaneo general) y se puede escanear UNA sola, que es
 * lo que hace falta con una carpeta de entrada (C:\Videos) donde se prepara lo nuevo antes de moverlo a la biblioteca de verdad.
 * Datos y bibliotecas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-fuentes-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanAll } = await import('../src/scanner/scan.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const titulos = () => db.prepare('SELECT title FROM items ORDER BY title').all().map((r) => r.title);

before(() => {
  video(join(base, 'E', 'Vieja (2000)', 'Vieja (2000).mkv'));
  video(join(base, 'Entrada', 'Nueva (2024)', 'Nueva (2024).mkv'));
  config.libraries = [
    { name: 'Peliculas', path: join(base, 'E'), kind: 'movie' },
    { name: 'Entrada', path: join(base, 'Entrada'), kind: 'movie', activa: false },
  ];
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('una biblioteca inactiva no entra en el escaneo general', async () => {
  await scanAll();
  assert.deepEqual(titulos(), ['Vieja']);
});

test('escanear UNA sola funciona aunque este inactiva, y no toca las demas', async () => {
  await scanAll(undefined, { solo: [join(base, 'Entrada')] });
  assert.deepEqual(titulos(), ['Nueva', 'Vieja']);
});

test('activarla la mete en el escaneo general', async () => {
  config.libraries[1].activa = true;
  video(join(base, 'Entrada', 'Otra (2025)', 'Otra (2025).mkv'));
  await scanAll();
  assert.deepEqual(titulos(), ['Nueva', 'Otra', 'Vieja']);
});

test('desactivarla despues NO borra sus titulos de la base (solo deja de escanearse)', async () => {
  config.libraries[1].activa = false;
  await scanAll();
  assert.deepEqual(titulos(), ['Nueva', 'Otra', 'Vieja']);
});
