/*
 * Escribir el NFO junto al video para que los datos VIAJEN con la carpeta (el flujo de tMM: se prepara en una carpeta de entrada y se
 * mueve a la biblioteca). Se comprueba la ida y vuelta con el propio lector (`parseNfo`) y el viaje entero: escribir en una carpeta,
 * copiarla a OTRA biblioteca, escanear, y que el titulo salga con todos sus datos. Hay plan (que ficheros) y solo se aplica ese plan;
 * lo que se sustituye se aparta a `_retirados`. Datos y bibliotecas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, cpSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-nfo-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { generarNfoPelicula, planNfo, aplicarNfo } = await import('../src/scanner/nfo-escribir.ts');
const { parseNfo } = await import('../src/scanner/nfo.ts');
const { db } = await import('../src/db.ts');

const entrada = join(base, 'Entrada');
const destino = join(base, 'Peliculas');
const libE = { name: 'Entrada', path: entrada, kind: 'movie' };
const libD = { name: 'Peliculas', path: destino, kind: 'movie' };
const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
let id;

before(async () => {
  video(join(entrada, 'La Peli & Cia (2019)', 'La Peli & Cia (2019) 1080p AC3.mkv'));
  writeFileSync(join(entrada, 'La Peli & Cia (2019)', 'nombre-viejo.nfo'), '<movie><title>viejo</title></movie>');
  await scanLibrary(libE);
  id = db.prepare('SELECT id FROM items').get().id;
  db.prepare(`UPDATE items SET title = ?, original_title = ?, sort_title = ?, year = ?, plot = ?, tagline = ?, runtime = ?, rating = 7.4, votes = 1234,
     mpaa = 'ES:12', premiered = '2019-05-17', studio = ?, country = ?, collection = ?, imdb_id = 'tt1234567', tmdb_id = '4242', added_at = '2026-10-20T10:30:00' WHERE id = ?`)
    .run('La Peli & Cia: "Origen"', 'The Movie <and> Co', 'Peli y Cia', 2019, 'Sinopsis con acentos: ñ, é y «comillas» & símbolos <raros>.', 'Una frase', 118, 'Estudio A, Estudio B', 'España, Chile', 'Saga Peli', id);
  for (const g of ['Drama', 'Comedia']) db.prepare('INSERT OR IGNORE INTO genres (name) VALUES (?)').run(g);
  for (const g of ['Drama', 'Comedia']) db.prepare('INSERT INTO item_genres (item_id, genre_id) SELECT ?, id FROM genres WHERE name = ?').run(id, g);
  const persona = (n) => db.prepare('INSERT INTO people (name, search_name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id').get(n, n.toLowerCase()).id;
  db.prepare('INSERT INTO item_people (item_id, person_id, role, character, ord) VALUES (?,?,?,?,?)').run(id, persona('Ana Actriz'), 'actor', 'Lucía', 0);
  db.prepare('INSERT INTO item_people (item_id, person_id, role, character, ord) VALUES (?,?,?,?,?)').run(id, persona('Beto Actor'), 'actor', 'Don Beto', 1);
  db.prepare('INSERT INTO item_people (item_id, person_id, role, character, ord) VALUES (?,?,?,?,?)').run(id, persona('Dora Directora'), 'director', null, null);
  db.prepare('INSERT INTO item_people (item_id, person_id, role, character, ord) VALUES (?,?,?,?,?)').run(id, persona('Gil Guionista'), 'writer', null, null);
  db.prepare("INSERT INTO item_ratings (item_id, fuente, valor, maximo, votos, origen) VALUES (?, 'imdb', 7.4, 10, 1234, 'nfo'), (?, 'metacritic', 71, 100, 0, 'nfo')").run(id, id);
  const f = db.prepare('SELECT id FROM media_files WHERE item_id = ?').get(id).id;
  db.prepare("UPDATE media_files SET width = 1920, height = 800, duration = 7080, video_codec = 'hevc', hdr = 'HDR10', probed = 1 WHERE id = ?").run(f);
  db.prepare("INSERT INTO audio_tracks (file_id, idx, codec, language, channels) VALUES (?, 1, 'ac3', 'spa', 6)").run(f);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('ida y vuelta: lo que se escribe lo lee el propio lector, con caracteres especiales intactos', () => {
  const ruta = join(base, 'x.nfo');
  writeFileSync(ruta, generarNfoPelicula(id));
  const n = parseNfo(ruta);
  assert.equal(n.title, 'La Peli & Cia: "Origen"');
  assert.equal(n.originalTitle, 'The Movie <and> Co');
  assert.equal(n.sortTitle, 'Peli y Cia');
  assert.equal(n.year, 2019);
  assert.equal(n.plot, 'Sinopsis con acentos: ñ, é y «comillas» & símbolos <raros>.');
  assert.equal(n.tagline, 'Una frase');
  assert.equal(n.runtime, 118);
  assert.equal(n.mpaa, 'ES:12');
  assert.equal(n.premiered, '2019-05-17');
  assert.equal(n.studio, 'Estudio A, Estudio B');
  assert.equal(n.country, 'España, Chile');
  assert.equal(n.collection, 'Saga Peli');
  assert.equal(n.imdbId, 'tt1234567');
  assert.equal(n.tmdbId, '4242');
  assert.deepEqual(n.genres, ['Drama', 'Comedia']);
  assert.deepEqual(n.people.map((p) => `${p.role}:${p.name}:${p.character ?? ''}:${p.order ?? ''}`), ['actor:Ana Actriz:Lucía:0', 'actor:Beto Actor:Don Beto:1', 'director:Dora Directora::', 'writer:Gil Guionista::']);
  assert.deepEqual(n.ratings.map((r) => [r.fuente, r.valor, r.maximo]), [['imdb', 7.4, 10], ['metacritic', 71, 100]]);
  assert.equal(n.rating, 7.4);
  assert.deepEqual({ ...n.video }, { codec: 'hevc', width: 1920, height: 800, duration: 7080, hdr: 'HDR10' });
  assert.deepEqual(n.audio.map((a) => [a.codec, a.language, a.channels]), [['ac3', 'spa', 6]]);
});

test('el plan dice que NFO se crea y cual se aparta; no toca nada', () => {
  const plan = planNfo(id);
  assert.deepEqual(plan.map((p) => [p.tipo, p.hacia.split(/[\\/]/).pop(), p.retira?.split(/[\\/]/).pop() ?? null]), [['pelicula', 'La Peli & Cia (2019) 1080p AC3.nfo', 'nombre-viejo.nfo']]);
  assert.ok(existsSync(join(entrada, 'La Peli & Cia (2019)', 'nombre-viejo.nfo')));
});

test('aplicar escribe el NFO, aparta el viejo en _retirados y un segundo plan esta vacio', () => {
  const r = aplicarNfo(id);
  assert.equal(r.escritos.length, 1);
  const carpeta = join(entrada, 'La Peli & Cia (2019)');
  assert.deepEqual(readdirSync(carpeta).sort(), ['La Peli & Cia (2019) 1080p AC3.mkv', 'La Peli & Cia (2019) 1080p AC3.nfo']);
  const dia = readdirSync(join(entrada, '_retirados'))[0];
  assert.ok(existsSync(join(entrada, '_retirados', dia, 'La Peli & Cia (2019)', 'nombre-viejo.nfo')));
  assert.deepEqual(planNfo(id), []);
});

test('el viaje: copiar la carpeta a otra biblioteca y escanear la recupera con todos sus datos', async () => {
  mkdirSync(destino, { recursive: true });
  cpSync(join(entrada, 'La Peli & Cia (2019)'), join(destino, 'La Peli & Cia (2019)'), { recursive: true });
  await scanLibrary(libD);
  const it = db.prepare("SELECT id, title, year, plot, studio, collection, mpaa FROM items WHERE folder = ?").get(join(destino, 'La Peli & Cia (2019)'));
  assert.equal(it.title, 'La Peli & Cia: "Origen"');
  assert.equal(it.year, 2019);
  assert.equal(it.studio, 'Estudio A, Estudio B');
  assert.equal(it.collection, 'Saga Peli');
  assert.equal(it.mpaa, 'ES:12');
  const gente = db.prepare('SELECT p.name FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ? ORDER BY ip.role, ip.ord').all(it.id).map((r) => r.name);
  assert.deepEqual(gente, ['Ana Actriz', 'Beto Actor', 'Dora Directora', 'Gil Guionista']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM item_ratings WHERE item_id = ?").get(it.id).n, 2);
});
