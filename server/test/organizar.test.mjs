/*
 * «Organizar»: dejar carpetas y ficheros NUEVOS con los nombres que ponia tinyMediaManager (Titulo (Ano)/Titulo (Ano) 1080p AC3.mkv,
 * Serie (Ano)/Season N/Serie - S01E01 - Titulo.mkv). Hay plan (que se mueve a donde) y solo se aplica ese plan. Las rutas de la base de
 * datos se actualizan en el mismo paso, asi el fichero conserva su id (miniaturas de la barra, progreso). Todo en carpetas temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-org-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { planOrganizar, aplicarOrganizar } = await import('../src/scanner/organizar.ts');
const { db } = await import('../src/db.ts');

const pelis = join(base, 'peliculas');
const series = join(base, 'series');
const libP = { name: 'Pelis', path: pelis, kind: 'movie' };
const libS = { name: 'Series', path: series, kind: 'show' };
const video = (ruta) => { mkdirSync(join(ruta, '..'), { recursive: true }); const fd = openSync(ruta, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const nombres = (d) => readdirSync(d).sort();
const item = (t) => db.prepare('SELECT id, folder FROM items WHERE title = ?').get(t);
const medir = (itemId, w, h, audio) => {
  const f = db.prepare('SELECT id FROM media_files WHERE item_id = ?').get(itemId).id;
  db.prepare('UPDATE media_files SET width = ?, height = ?, probed = 1 WHERE id = ?').run(w, h, f);
  db.prepare('DELETE FROM audio_tracks WHERE file_id = ?').run(f);
  db.prepare('INSERT INTO audio_tracks (file_id, idx, codec, language, channels) VALUES (?,?,?,?,?)').run(f, 1, audio, 'spa', 6);
  return f;
};

before(async () => {
  // A: carpeta sucia con subtitulo, nfo y un cartel con su nombre
  const a = join(pelis, 'Messy.Name.2019.1080p.BluRay');
  video(join(a, 'Messy.Name.2019.1080p.BluRay.mkv'));
  writeFileSync(join(a, 'Messy.Name.2019.1080p.BluRay.eng.srt'), '1\n');
  writeFileSync(join(a, 'Messy.Name.2019.1080p.BluRay-poster.webp'), 'x');
  writeFileSync(join(a, 'poster.jpg'), 'x');
  // B: video suelto en la raiz de la biblioteca (con su subtitulo y OTRO video que no se debe tocar)
  video(join(pelis, 'Suelta.2020.mkv'));
  writeFileSync(join(pelis, 'Suelta.2020.es.srt'), '1\n');
  video(join(pelis, 'Suelta.2020.Parte2.mkv'));
  // E: para provocar el fallo
  video(join(pelis, 'Fallo.2021', 'Fallo.2021.mkv'));
  // C: serie con temporadas
  const s = join(series, 'Mi.Serie.2018');
  video(join(s, 'Temporada 1', 'mi.serie.s01e01.mkv'));
  video(join(s, 'Temporada 1', 'mi.serie.s01e02.mkv'));
  writeFileSync(join(s, 'Temporada 1', 'mi.serie.s01e01.es.srt'), '1\n');
  await scanLibrary(libP);
  await scanLibrary(libS);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('pelicula en carpeta sucia: el plan lista cada movimiento y no toca nada', () => {
  const { id } = item('Messy Name');
  db.prepare("UPDATE items SET title = 'Nombre: Real', year = 2019 WHERE id = ?").run(id);
  medir(id, 1920, 800, 'ac3');
  const plan = planOrganizar(id);
  assert.deepEqual(plan.pasos.map((p) => JSON.stringify([basename(p.desde), basename(p.final)])).sort(), [
    ['Messy.Name.2019.1080p.BluRay.mkv', 'Nombre∶ Real (2019) 1080p AC3.mkv'],
    ['Messy.Name.2019.1080p.BluRay.eng.srt', 'Nombre∶ Real (2019) 1080p AC3.eng.srt'],
    ['Messy.Name.2019.1080p.BluRay-poster.webp', 'Nombre∶ Real (2019) 1080p AC3-poster.webp'],
    ['Messy.Name.2019.1080p.BluRay', 'Nombre∶ Real (2019)'],
  ].map((x) => JSON.stringify(x)).sort());
  assert.ok(existsSync(join(pelis, 'Messy.Name.2019.1080p.BluRay', 'Messy.Name.2019.1080p.BluRay.mkv')), 'planificar no mueve nada');
});

test('aplicar renombra, conserva el id del fichero y el escaneo no duplica el titulo', async () => {
  const { id } = item('Nombre: Real');
  const fid = db.prepare('SELECT id FROM media_files WHERE item_id = ?').get(id).id;
  aplicarOrganizar(id);
  const carpeta = join(pelis, 'Nombre∶ Real (2019)');
  assert.deepEqual(nombres(carpeta), ['Nombre∶ Real (2019) 1080p AC3-poster.webp', 'Nombre∶ Real (2019) 1080p AC3.eng.srt', 'Nombre∶ Real (2019) 1080p AC3.mkv', 'poster.jpg']);
  assert.equal(db.prepare('SELECT folder FROM items WHERE id = ?').get(id).folder, carpeta);
  const f = db.prepare('SELECT id, path FROM media_files WHERE item_id = ?').get(id);
  assert.equal(f.id, fid);
  assert.equal(f.path, join(carpeta, 'Nombre∶ Real (2019) 1080p AC3.mkv'));
  await scanLibrary(libP);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM items WHERE title LIKE 'Nombre%'").get().n, 1);
  assert.equal(db.prepare('SELECT id FROM media_files WHERE item_id = ?').get(id).id, fid, 'el escaneo reconoce el fichero por su nueva ruta');
});

test('video suelto en la raiz: se crea su carpeta y solo se mueven SUS ficheros', () => {
  const { id } = item('Suelta');
  db.prepare("UPDATE items SET title = 'La Suelta', year = 2020 WHERE id = ?").run(id);
  medir(id, 1280, 720, 'aac');
  const plan = planOrganizar(id);
  assert.deepEqual(plan.pasos.map((p) => p.final.split(/[\\/]/).slice(-2).join('/')), ['La Suelta (2020)/La Suelta (2020) 720p AAC.mkv', 'La Suelta (2020)/La Suelta (2020) 720p AAC.es.srt']);
  aplicarOrganizar(id);
  assert.deepEqual(nombres(join(pelis, 'La Suelta (2020)')), ['La Suelta (2020) 720p AAC.es.srt', 'La Suelta (2020) 720p AAC.mkv']);
  assert.ok(existsSync(join(pelis, 'Suelta.2020.Parte2.mkv')), 'el otro video de la raiz no se toca');
  assert.equal(db.prepare('SELECT folder FROM items WHERE id = ?').get(id).folder, join(pelis, 'La Suelta (2020)'));
});

test('serie: carpeta, Season N y episodios como tMM; el id de cada episodio no cambia', async () => {
  const { id } = item('Mi Serie');
  db.prepare("UPDATE items SET title = 'Mi Serie', year = 2018 WHERE id = ?").run(id);
  db.prepare("UPDATE episodes SET title = 'Uno' WHERE show_id = ? AND episode = 1").run(id);
  const eps = db.prepare('SELECT e.id, f.id AS fid FROM episodes e JOIN media_files f ON f.episode_id = e.id WHERE e.show_id = ? ORDER BY e.episode').all(id);
  const plan = planOrganizar(id);
  const hacia = plan.pasos.map((p) => p.final.split(/[\\/]/).slice(-3).join('/'));
  assert.ok(hacia.includes('Mi Serie (2018)/Season 1/Mi Serie - S01E01 - Uno.mkv'), JSON.stringify(hacia));
  assert.ok(hacia.includes('Mi Serie (2018)/Season 1/Mi Serie - S01E02.mkv'), 'sin titulo real, sin « - titulo»');
  assert.ok(hacia.includes('Mi Serie (2018)/Season 1/Mi Serie - S01E01 - Uno.es.srt'));
  aplicarOrganizar(id);
  assert.deepEqual(nombres(join(series, 'Mi Serie (2018)', 'Season 1')), ['Mi Serie - S01E01 - Uno.es.srt', 'Mi Serie - S01E01 - Uno.mkv', 'Mi Serie - S01E02.mkv']);
  await scanLibrary(libS);
  assert.deepEqual(db.prepare('SELECT e.id, f.id AS fid FROM episodes e JOIN media_files f ON f.episode_id = e.id WHERE e.show_id = ? ORDER BY e.episode').all(id).map((r) => ({ ...r })), eps.map((r) => ({ ...r })));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM items WHERE kind = 'show'").get().n, 1);
});

test('si el destino ya existe, no se mueve nada', () => {
  const { id } = item('Fallo');
  db.prepare("UPDATE items SET title = 'Choque', year = 2021 WHERE id = ?").run(id);
  medir(id, 1920, 1080, 'ac3');
  mkdirSync(join(pelis, 'Choque (2021)'));
  assert.throws(() => planOrganizar(id), /ya existe/i);
  assert.ok(existsSync(join(pelis, 'Fallo.2021', 'Fallo.2021.mkv')));
  rmSync(join(pelis, 'Choque (2021)'), { recursive: true });
});

test('si falla la base de datos, los ficheros vuelven a su sitio', () => {
  const { id } = item('Choque');
  // otra fila ocupa la ruta de destino del fichero: el UPDATE de la base choca con UNIQUE
  const destino = join(pelis, 'Choque (2021)', 'Choque (2021) 1080p AC3.mkv');
  db.prepare("INSERT INTO media_files (path, size, probed) VALUES (?, 1, 1)").run(destino);
  assert.throws(() => aplicarOrganizar(id));
  assert.ok(existsSync(join(pelis, 'Fallo.2021', 'Fallo.2021.mkv')), 'el fichero sigue donde estaba');
  assert.ok(!existsSync(join(pelis, 'Choque (2021)')));
  assert.equal(db.prepare('SELECT folder FROM items WHERE id = ?').get(id).folder, join(pelis, 'Fallo.2021'));
  db.prepare('DELETE FROM media_files WHERE path = ?').run(destino);
});

test('un fichero sin medir (no se sabe formato ni audio) se rechaza con motivo', () => {
  video(join(pelis, 'Nueva.2022', 'Nueva.2022.mkv'));
  return scanLibrary(libP).then(() => {
    const { id } = item('Nueva');
    db.prepare("UPDATE items SET title = 'La Nueva', year = 2022 WHERE id = ?").run(id);
    assert.throws(() => planOrganizar(id), /sin medir/);
  });
});
