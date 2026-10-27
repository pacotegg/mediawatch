/*
 * Escanear SOLO unas carpetas de una biblioteca (lo que hace el Asistente del scraper al analizar los ficheros marcados): no debe
 * releer el resto de la biblioteca ni retirar nada. Antes, para analizar 2 ficheros se escaneaba E:\Peliculas entera (minutos).
 * Datos y bibliotecas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-carpetas-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanAll } = await import('../src/scanner/scan.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const E = join(base, 'E');
const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const titulos = () => db.prepare('SELECT title FROM items ORDER BY title').all().map((r) => r.title);
const visto = (t) => db.prepare('SELECT scanned_at FROM items WHERE title = ?').get(t)?.scanned_at;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

before(() => {
  video(join(E, 'Vieja (2000)', 'Vieja (2000).mkv'));
  video(join(E, 'Otra (2001)', 'Otra (2001).mkv'));
  video(join(E, 'Borrada (1999)', 'Borrada (1999).mkv'));
  config.libraries = [{ name: 'Peliculas', path: E, kind: 'movie' }];
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('un escaneo normal indexa toda la biblioteca', async () => {
  await scanAll();
  assert.deepEqual(titulos(), ['Borrada', 'Otra', 'Vieja']);
});

test('con `carpetas` solo se analiza lo pedido: no se relee lo demás ni se retira nada', async () => {
  rmSync(join(E, 'Borrada (1999)'), { recursive: true });
  video(join(E, 'Nueva (2024)', 'Nueva (2024).mkv'));
  video(join(E, 'Suelta (2020).mkv'));
  const antes = visto('Otra');
  await esperar(20);
  await scanAll(undefined, { solo: [E], carpetas: [join(E, 'Nueva (2024)'), join(E, 'Suelta (2020).mkv')] });
  assert.deepEqual(titulos(), ['Borrada', 'Nueva', 'Otra', 'Suelta', 'Vieja'], 'entran las dos pedidas; «Borrada» ya no está en disco pero un escaneo parcial no retira nada');
  assert.equal(visto('Otra'), antes, '«Otra» no se ha vuelto a leer');
  assert.equal(visto('Vieja') <= antes, true, '«Vieja» tampoco');
});

test('un escaneo completo posterior sí retira lo que ya no está en disco', async () => {
  await scanAll();
  assert.deepEqual(titulos(), ['Nueva', 'Otra', 'Suelta', 'Vieja']);
});
