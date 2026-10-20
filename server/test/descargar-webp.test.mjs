/*
 * El arte que baja el scraper queda en WebP (un cartel de TMDb pesa 3-5 MB). Si ffmpeg falla se conserva la original con su
 * extension real. Servidor HTTP local que sirve un JPG generado con ffmpeg; datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-webp-'));
process.env.MEDIAWATCH_DATA_DIR = datos;
const { descargarWebp } = await import('../src/scanner/tmdb.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

let servidor, url;
before(async () => {
  const jpg = join(datos, 'origen.jpg');
  const r = spawnSync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=600x900', '-frames:v', '1', '-q:v', '2', jpg]);
  assert.equal(r.status, 0, 'ffmpeg genera la imagen de prueba');
  const bytes = readFileSync(jpg);
  servidor = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(bytes); });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${servidor.address().port}/p.jpg`;
});
after(() => { servidor.close(); try { db.close(); } catch { /* ya cerrada */ } rmSync(datos, { recursive: true, force: true }); });

test('la imagen baja y se queda en WebP, sin dejar la original ni temporales', async () => {
  const destino = await descargarWebp(url, join(datos, 'poster'), 82);
  assert.equal(destino, join(datos, 'poster.webp'));
  const cab = readFileSync(destino).subarray(0, 12);
  assert.equal(cab.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(cab.subarray(8, 12).toString('latin1'), 'WEBP');
  assert.equal(existsSync(join(datos, 'poster.orig')), false);
  assert.equal(existsSync(join(datos, 'poster.webp.parte')), false);
});

test('si ffmpeg no esta, se conserva la original con su extension real', async () => {
  const buena = config.ffmpeg;
  config.ffmpeg = join(datos, 'no-existe.exe');
  try {
    const destino = await descargarWebp(url, join(datos, 'fondo'), 82);
    assert.equal(destino, join(datos, 'fondo.jpg'));
    assert.equal(readFileSync(destino)[0], 0xff);
  } finally {
    config.ffmpeg = buena;
  }
});
