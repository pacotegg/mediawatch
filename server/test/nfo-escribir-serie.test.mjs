/*
 * NFO de una SERIE: tvshow.nfo + un .nfo por episodio, para que la serie viaje con su carpeta (carpeta de entrada -> biblioteca).
 * Viaje completo: escribir, copiar a otra biblioteca, escanear y recuperar serie, reparto y los datos de cada episodio.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, cpSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-nfoserie-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { planNfo, aplicarNfo } = await import('../src/scanner/nfo-escribir.ts');
const { db } = await import('../src/db.ts');

const entrada = join(base, 'EntradaSeries');
const destino = join(base, 'Series');
const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
let id;

before(async () => {
  const t = join(entrada, 'Mi Serie (2018)', 'Season 1');
  video(join(t, 'Mi Serie - S01E01 - Uno.mkv'));
  video(join(t, 'Mi Serie - S01E02 - Dos.mkv'));
  await scanLibrary({ name: 'Entrada', path: entrada, kind: 'show' });
  id = db.prepare("SELECT id FROM items WHERE kind = 'show'").get().id;
  db.prepare("UPDATE items SET title = 'Mi Serie', year = 2018, plot = 'Trama de la serie', studio = 'Cadena Uno', country = 'España', mpaa = 'ES:12', tmdb_id = '77' WHERE id = ?").run(id);
  db.prepare("UPDATE episodes SET title = 'Primero', plot = 'Trama uno', aired = '2018-03-01', runtime = 45 WHERE show_id = ? AND episode = 1").run(id);
  db.prepare("UPDATE episodes SET title = 'Segundo', plot = 'Trama dos', aired = '2018-03-08', runtime = 44 WHERE show_id = ? AND episode = 2").run(id);
  const p = db.prepare("INSERT INTO people (name, search_name) VALUES ('Eva Estrella', 'eva estrella') RETURNING id").get().id;
  db.prepare("INSERT INTO item_people (item_id, person_id, role, character, ord) VALUES (?,?,?,?,0)").run(id, p, 'actor', 'Eva');
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('el plan de una serie: tvshow.nfo y un .nfo por episodio', () => {
  const plan = planNfo(id);
  assert.deepEqual(plan.map((p) => [p.tipo, p.hacia.split(/[\\/]/).pop()]), [['serie', 'tvshow.nfo'], ['episodio', 'Mi Serie - S01E01 - Uno.nfo'], ['episodio', 'Mi Serie - S01E02 - Dos.nfo']]);
});

test('el viaje: la serie copiada a otra biblioteca recupera serie, reparto y episodios', async () => {
  const r = aplicarNfo(id);
  assert.equal(r.escritos.length, 3);
  assert.deepEqual(planNfo(id), [], 'idempotente');
  mkdirSync(destino, { recursive: true });
  cpSync(join(entrada, 'Mi Serie (2018)'), join(destino, 'Mi Serie (2018)'), { recursive: true });
  await scanLibrary({ name: 'Series', path: destino, kind: 'show' });
  const s = db.prepare("SELECT id, title, year, plot, studio, mpaa FROM items WHERE folder = ?").get(join(destino, 'Mi Serie (2018)'));
  assert.deepEqual({ ...s, id: 0 }, { id: 0, title: 'Mi Serie', year: 2018, plot: 'Trama de la serie', studio: 'Cadena Uno', mpaa: 'ES:12' });
  assert.deepEqual(db.prepare('SELECT p.name FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ?').all(s.id).map((x) => x.name), ['Eva Estrella']);
  const eps = db.prepare('SELECT episode, title, plot, aired, runtime FROM episodes WHERE show_id = ? ORDER BY episode').all(s.id).map((e) => ({ ...e }));
  assert.deepEqual(eps, [{ episode: 1, title: 'Primero', plot: 'Trama uno', aired: '2018-03-01', runtime: 45 }, { episode: 2, title: 'Segundo', plot: 'Trama dos', aired: '2018-03-08', runtime: 44 }]);
  assert.equal(readdirSync(join(destino, 'Mi Serie (2018)')).includes('tvshow.nfo'), true);
});
