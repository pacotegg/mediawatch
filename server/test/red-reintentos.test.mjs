/*
 * Un fallo de red pasajero («fetch failed») ya no tira abajo toda una aplicacion de datos del scraper: se reintenta, y al rendirse el
 * mensaje dice la causa. Servidor local que corta la conexion a proposito. Datos temporales.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-red-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { pedir } = await import('../src/scanner/tmdb.ts');
const { db } = await import('../src/db.ts');

let peticiones = 0;
let fallar = 0; // cuantas peticiones seguidas se cortan antes de contestar
const srv = createServer((req, res) => {
  peticiones++;
  if (req.url === '/404') { res.statusCode = 404; return res.end('no'); }
  if (fallar > 0) { fallar--; return req.socket.destroy(); }
  res.end('ok');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = (ruta = '/') => `http://127.0.0.1:${srv.address().port}${ruta}`;
after(() => { srv.close(); try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('un corte de red pasajero se reintenta y la petición sale bien', async () => {
  peticiones = 0; fallar = 2;
  const res = await pedir(url(), 3000);
  assert.equal(await res.text(), 'ok');
  assert.equal(peticiones, 3);
});

test('si la red no vuelve se rinde a los 3 intentos y el mensaje lleva la causa', async () => {
  peticiones = 0; fallar = 99;
  await assert.rejects(() => pedir(url(), 3000), (e) => { assert.match(e.message, /fetch failed \(\w+\)/); return true; });
  assert.equal(peticiones, 3);
});

test('una respuesta HTTP de error no se reintenta (ya llegó)', async () => {
  peticiones = 0; fallar = 0;
  const res = await pedir(url('/404'), 3000);
  assert.equal(res.status, 404);
  assert.equal(peticiones, 1);
});
