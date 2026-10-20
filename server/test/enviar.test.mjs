/*
 * «Enviar a la biblioteca»: llevar un titulo preparado en una carpeta de entrada (C:\Videos) a la biblioteca que se elija (E:\Peliculas).
 * Entre discos es COPIA con comprobacion (SHA-256 del origen mientras se copia y del destino despues); solo si coincide, se actualiza la
 * base de datos (el titulo conserva su id y pasa a la otra biblioteca) y el original se APARTA a `_enviados/<fecha>` o, si se pide
 * expresamente, se quita. Si algo falla, el destino parcial se limpia y el original queda como estaba. Todo en carpetas temporales
 * (`forzarCopia` hace que el mismo disco tambien pase por la ruta de copia).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-envio-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { planEnvio, enviarTitulo } = await import('../src/scanner/enviar.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const entrada = join(base, 'Entrada');
const destino = join(base, 'Peliculas');
const libE = { name: 'Entrada', path: entrada, kind: 'movie' };
const libD = { name: 'Peliculas', path: destino, kind: 'movie' };
const libS = { name: 'Series', path: join(base, 'Series'), kind: 'show' };
const sha = (r) => createHash('sha256').update(readFileSync(r)).digest('hex');
const crear = (carpeta, nombre, relleno) => {
  const d = join(entrada, carpeta);
  mkdirSync(d, { recursive: true });
  const fd = openSync(join(d, nombre + '.mkv'), 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd);
  writeFileSync(join(d, nombre + '.mkv'), Buffer.alloc(6 * 1024 * 1024, relleno));
  writeFileSync(join(d, nombre + '.es.srt'), '1\n00:00:01,000 --> 00:00:02,000\nhola\n');
  writeFileSync(join(d, nombre + '.nfo'), `<movie><title>${carpeta}</title><year>2020</year></movie>`);
  return d;
};
const id = (t) => db.prepare('SELECT id FROM items WHERE title = ?').get(t).id;

before(async () => {
  mkdirSync(destino, { recursive: true });
  config.libraries = [libE, libD, libS];
  crear('Pelicula Uno (2020)', 'Pelicula Uno (2020) 1080p AC3', 1);
  crear('Pelicula Dos (2020)', 'Pelicula Dos (2020) 1080p AC3', 2);
  crear('Pelicula Tres (2020)', 'Pelicula Tres (2020) 1080p AC3', 3);
  await scanLibrary(libE);
  await scanLibrary(libD); // para que exista la fila de la biblioteca de destino
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('el plan dice de donde a donde, cuanto pesa y no toca nada', () => {
  const plan = planEnvio(id('Pelicula Uno (2020)'), destino);
  assert.equal(plan.destino, join(destino, 'Pelicula Uno (2020)'));
  assert.equal(plan.bytes > 6 * 1024 * 1024, true);
  assert.ok(existsSync(join(entrada, 'Pelicula Uno (2020)')) && !existsSync(plan.destino));
});

test('se rechaza si el destino no es una biblioteca, es de otro tipo o ya existe la carpeta', () => {
  assert.throws(() => planEnvio(id('Pelicula Uno (2020)'), join(base, 'cualquier-sitio')), /no es una de las bibliotecas/i);
  assert.throws(() => planEnvio(id('Pelicula Uno (2020)'), join(base, 'Series')), /otro tipo/i);
  mkdirSync(join(destino, 'Pelicula Tres (2020)'));
  assert.throws(() => planEnvio(id('Pelicula Tres (2020)'), destino), /ya existe/i);
  rmSync(join(destino, 'Pelicula Tres (2020)'), { recursive: true });
});

test('enviar copia con comprobacion, el titulo conserva su id y pasa a la otra biblioteca, y el original se aparta (no se borra)', async () => {
  const i = id('Pelicula Uno (2020)');
  const f = db.prepare('SELECT id, path FROM media_files WHERE item_id = ?').get(i);
  const antes = sha(f.path);
  const fases = [];
  const r = await enviarTitulo(i, destino, { quitarOriginal: false, forzarCopia: true }, (p) => fases.push(p.fase));
  assert.equal(r.copiado, true);
  const nuevo = join(destino, 'Pelicula Uno (2020)');
  assert.equal(sha(join(nuevo, 'Pelicula Uno (2020) 1080p AC3.mkv')), antes, 'copia identica');
  assert.deepEqual(readdirSync(nuevo).sort(), ['Pelicula Uno (2020) 1080p AC3.es.srt', 'Pelicula Uno (2020) 1080p AC3.mkv', 'Pelicula Uno (2020) 1080p AC3.nfo']);
  const it = db.prepare('SELECT folder, library_id FROM items WHERE id = ?').get(i);
  assert.equal(it.folder, nuevo);
  assert.equal(it.library_id, db.prepare('SELECT id FROM libraries WHERE path = ?').get(destino).id);
  const g = db.prepare('SELECT id, path FROM media_files WHERE item_id = ?').get(i);
  assert.equal(g.id, f.id, 'el fichero conserva su id');
  assert.equal(g.path, join(nuevo, 'Pelicula Uno (2020) 1080p AC3.mkv'));
  assert.ok(!existsSync(join(entrada, 'Pelicula Uno (2020)')), 'ya no esta en la entrada');
  const dia = readdirSync(join(entrada, '_enviados'))[0];
  assert.ok(existsSync(join(entrada, '_enviados', dia, 'Pelicula Uno (2020)', 'Pelicula Uno (2020) 1080p AC3.mkv')), 'el original esta apartado, no borrado');
  assert.ok(fases.includes('copiando') && fases.includes('verificando'));
  assert.deepEqual(readdirSync(destino).filter((n) => n.startsWith('_enviando')), [], 'sin carpetas temporales');
  await scanLibrary(libD);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM items WHERE title LIKE 'Pelicula Uno%'").get().n, 1, 'el escaneo no lo duplica');
});

test('quitarOriginal: tras comprobar la copia, el original se quita', async () => {
  const i = id('Pelicula Dos (2020)');
  await enviarTitulo(i, destino, { quitarOriginal: true, forzarCopia: true }, () => {});
  assert.ok(existsSync(join(destino, 'Pelicula Dos (2020)', 'Pelicula Dos (2020) 1080p AC3.mkv')));
  assert.ok(!existsSync(join(entrada, 'Pelicula Dos (2020)')));
  assert.ok(!existsSync(join(entrada, '_enviados', new Date().toISOString().slice(0, 10), 'Pelicula Dos (2020)')));
});

test('si algo falla a medias, el destino parcial se limpia y el original queda como estaba', async () => {
  const i = id('Pelicula Tres (2020)');
  const antes = db.prepare('SELECT folder, library_id FROM items WHERE id = ?').get(i);
  await assert.rejects(() => enviarTitulo(i, destino, { quitarOriginal: true, forzarCopia: true }, (p) => { if (p.fase === 'verificando') throw new Error('fallo simulado'); }), /fallo simulado/);
  assert.ok(existsSync(join(entrada, 'Pelicula Tres (2020)', 'Pelicula Tres (2020) 1080p AC3.mkv')), 'el original sigue');
  assert.ok(!existsSync(join(destino, 'Pelicula Tres (2020)')));
  assert.deepEqual(readdirSync(destino).filter((n) => n.startsWith('_enviando')), []);
  assert.deepEqual({ ...db.prepare('SELECT folder, library_id FROM items WHERE id = ?').get(i) }, { ...antes });
});
