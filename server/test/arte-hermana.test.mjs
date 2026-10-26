/*
 * El arte debería estar siempre en WebP, pero la conversión del 18/10/2026 dejó 229 filas de
 * `coleccion_imagen` apuntando a `poster.jpg`/`fanart.jpg` que ya solo existen como `.webp`:
 * `/api/collections/<n>/imagen` daba 404 y la pantalla de Sagas salía sin carátulas.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hermanaDeArte } from '../src/media/arte-hermana.ts';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'arte-hermana-')); });
after(() => { rmSync(dir, { recursive: true, force: true }); });
const crear = (n) => { writeFileSync(join(dir, n), 'x'); return join(dir, n); };

test('una ruta .jpg que ya solo existe como .webp devuelve el .webp', async () => {
  const webp = crear('a.webp');
  assert.equal(await hermanaDeArte(join(dir, 'a.jpg')), webp);
});

test('una ruta .webp que aún no se ha convertido cae al .jpg o .png', async () => {
  const jpg = crear('b.jpg');
  assert.equal(await hermanaDeArte(join(dir, 'b.webp')), jpg);
  const png = crear('c.png');
  assert.equal(await hermanaDeArte(join(dir, 'c.webp')), png);
});

test('prefiere el .webp si hay varias hermanas', async () => {
  crear('d.jpg'); const webp = crear('d.webp');
  assert.equal(await hermanaDeArte(join(dir, 'd.png')), webp);
});

test('sin ninguna hermana devuelve null y no confunde otro nombre', async () => {
  crear('e-otra.webp');
  assert.equal(await hermanaDeArte(join(dir, 'e.jpg')), null);
});
