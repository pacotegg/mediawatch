/*
 * descargar(): una pagina de error no se guarda como imagen, una respuesta enorme se corta, y una imagen buena se
 * coloca. Servidor HTTP local y carpeta temporal; no toca la biblioteca.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MEDIAWATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
const { descargar } = await import('../src/scanner/tmdb.ts');

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
let servidor, base, destino;

before(async () => {
  destino = mkdtempSync(join(tmpdir(), 'mediawatch-descarga-'));
  servidor = createServer((req, res) => {
    if (req.url === '/buena.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(JPG); }
    else if (req.url === '/error.jpg') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>Not found</html>'); }
    else if (req.url === '/enorme.jpg') {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.write(JPG);
      const trozo = Buffer.alloc(1024 * 1024, 1);
      let n = 0;
      const mandar = () => { while (n++ < 40) if (!res.write(trozo)) return void res.once('drain', mandar); res.end(); };
      mandar();
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => { servidor.closeAllConnections?.(); servidor.close(); try { rmSync(destino, { recursive: true, force: true }); } catch { /* temporal */ } });

test('una imagen buena se coloca y no deja restos', async () => {
  const d = join(destino, 'buena.jpg');
  assert.equal(await descargar(`${base}/buena.jpg`, d), d);
  assert.equal(statSync(d).size, JPG.length);
  assert.ok(!existsSync(d + '.parcial'));
});

test('una pagina de error no se guarda como imagen', async () => {
  const d = join(destino, 'error.jpg');
  await assert.rejects(() => descargar(`${base}/error.jpg`, d), /no es una imagen/);
  assert.ok(!existsSync(d), 'no debia quedar nada con el nombre final');
});

test('una respuesta de mas de 25 MB se corta y no deja el disco lleno de restos', async () => {
  const d = join(destino, 'enorme.jpg');
  await assert.rejects(() => descargar(`${base}/enorme.jpg`, d), /demasiado grande/);
  assert.ok(!existsSync(d));
  assert.deepEqual(readdirSync(destino).filter((f) => f.startsWith('enorme')), []);
});
