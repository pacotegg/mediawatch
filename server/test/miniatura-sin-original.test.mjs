/*
 * Servir una miniatura ya hecha no debe tocar el original: ese esta en E: (disco duro que se duerme) y `thumbnail()` le hacia un
 * `stat` en CADA peticion (p99 9,4 ms con el disco despierto, ~7 s dormido). Ahora la clave sale de un sello (fecha y tamano)
 * guardado en la base al escanear; el original solo se lee si la miniatura aun no existe.
 *
 * Proxy de «no toca E:»: con el original BORRADO, una miniatura ya hecha se sigue sirviendo. Las imagenes de data/ (que escriben
 * otros modulos con el mismo nombre) siguen mirandose siempre: ahi un `stat` es barato y un sello atrasado serviria la imagen vieja.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-sello-'));
const datos = join(base, 'datos');
const biblioteca = join(base, 'biblioteca');
mkdirSync(datos); mkdirSync(biblioteca);
process.env.MEDIAWATCH_DATA_DIR = datos;
const { thumbnail, refrescarSello } = await import('../src/media/images.ts');
const { config, DATA_DIR } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const gen = (ruta, color) => {
  const r = spawnSync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=400x600`, '-frames:v', '1', ruta]);
  assert.equal(r.status, 0, 'ffmpeg genera la imagen de prueba');
};
before(() => {});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('una miniatura ya hecha de la biblioteca se sirve aunque el original ya no se pueda leer', async () => {
  const origen = join(biblioteca, 'poster.png');
  gen(origen, 'red');
  const primera = await thumbnail(origen, 100);
  assert.ok(existsSync(primera));
  unlinkSync(origen); // como un disco dormido o ausente
  const segunda = await thumbnail(origen, 100);
  assert.equal(segunda, primera, 'misma miniatura, sin leer el original');
});

test('el escaneo refresca el sello: si el original cambia, la miniatura se rehace', async () => {
  const origen = join(biblioteca, 'fondo.png');
  gen(origen, 'blue');
  const antes = await thumbnail(origen, 100);
  gen(origen, 'green'); // otro contenido en el mismo nombre (tamano distinto: otro color comprime distinto en PNG)
  copyFileSync(origen, origen + '.x'); copyFileSync(origen + '.x', origen); // asegura mtime nuevo
  refrescarSello(origen); // lo que hace el escaner
  const despues = await thumbnail(origen, 100);
  assert.notEqual(despues, antes, 'sello nuevo, miniatura nueva');
});

test('las imagenes de data/ se miran siempre: un cambio se ve al momento, sin escaneo', async () => {
  const origen = join(DATA_DIR, 'artwork-prueba.png');
  gen(origen, 'yellow');
  const antes = await thumbnail(origen, 100);
  await new Promise((r) => setTimeout(r, 30));
  gen(origen, 'white');
  copyFileSync(origen, origen + '.x'); copyFileSync(origen + '.x', origen);
  const despues = await thumbnail(origen, 100);
  assert.notEqual(despues, antes);
});

test('un original que no existe y nunca se sello sigue dando error claro', async () => {
  await assert.rejects(() => thumbnail(join(biblioteca, 'no-existe.png'), 100), /imagen no encontrada/);
});
