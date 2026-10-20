/*
 * Las imagenes JPG/PNG que aparecen en la biblioteca (tinyMediaManager sigue bajandolas asi) se pasan a WebP junto al original, se comprueba que
 * miden lo mismo y pesan menos, se actualizan las rutas de la base y el original se retira (a _retirados) o se borra. Nunca antes de tener el WebP
 * bueno. Carpeta temporal y base temporal. Sin ffmpeg (CI) la prueba se salta.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hayFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const datos = mkdtempSync(join(tmpdir(), 'mediawatch-webp-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { convertirImagen, comprimirCarpetas } = await import('../src/media/imagenes-webp.ts');
const { db } = await import('../src/db.ts');

const h = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
const raiz = join(datos, 'biblioteca');
const peli = join(raiz, 'Pelicula (2001)');

function imagen(ruta, ancho, alto, filtro = 'testsrc') {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `${filtro}=size=${ancho}x${alto}:rate=1`, '-frames:v', '1', ruta]);
  assert.equal(r.status, 0, String(r.stderr));
}

before(() => {
  mkdirSync(peli, { recursive: true });
  if (!hayFfmpeg) return;
  imagen(join(peli, 'poster.jpg'), 600, 900);
  imagen(join(peli, 'clearlogo.jpg'), 800, 300, 'mandelbrot');
  writeFileSync(join(peli, 'vacia.jpg'), '');
  const lib = db.prepare("INSERT INTO libraries (name, path, kind) VALUES ('Pelis', ?, 'movie') RETURNING id").get(raiz);
  db.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, poster, clearlogo, scanned_at) VALUES (?, 'movie', ?, 'P', 'p', ?, ?, 'x')")
    .run(lib.id, peli, join(peli, 'poster.jpg'), join(peli, 'clearlogo.jpg'));
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('convertirImagen: crea el WebP del mismo tamano, mas pequeno, y retira el original', { skip: !hayFfmpeg && 'no hay ffmpeg' }, async () => {
  const r = await convertirImagen(join(peli, 'poster.jpg'), h, 'retirar', raiz);
  assert.equal(r.estado, 'convertida', JSON.stringify(r));
  assert.ok(existsSync(join(peli, 'poster.webp')));
  assert.ok(!existsSync(join(peli, 'poster.jpg')), 'el original ya no esta junto al webp');
  assert.ok(existsSync(r.retirado), 'el original esta en _retirados: ' + r.retirado);
  assert.ok(statSync(join(peli, 'poster.webp')).size < statSync(r.retirado).size);
});

test('comprimirCarpetas: convierte lo que queda, actualiza la base y salta lo vacio o lo que ya tiene webp', { skip: !hayFfmpeg && 'no hay ffmpeg' }, async () => {
  const res = await comprimirCarpetas([raiz], 'borrar', h);
  assert.equal(res.convertidas, 1, JSON.stringify(res)); // clearlogo.jpg (poster.jpg ya estaba hecho)
  assert.equal(res.saltadas, 1); // vacia.jpg
  assert.ok(existsSync(join(peli, 'clearlogo.webp')));
  assert.ok(!existsSync(join(peli, 'clearlogo.jpg')), 'con "borrar" el original desaparece');
  const it = db.prepare('SELECT poster, clearlogo FROM items').get();
  assert.equal(it.clearlogo, join(peli, 'clearlogo.webp'), 'la ruta de la base apunta al webp');
  assert.equal(it.poster, join(peli, 'poster.webp'), 'y la del poster, convertido en la prueba anterior, tambien');
});

test('con un .webp del mismo nombre ya presente no se toca nada', { skip: !hayFfmpeg && 'no hay ffmpeg' }, async () => {
  imagen(join(peli, 'fanart.jpg'), 800, 450);
  imagen(join(peli, 'fanart.webp'), 800, 450);
  const r = await convertirImagen(join(peli, 'fanart.jpg'), h, 'borrar', raiz);
  assert.equal(r.estado, 'saltada');
  assert.ok(existsSync(join(peli, 'fanart.jpg')));
});
