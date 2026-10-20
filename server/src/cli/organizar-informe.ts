/**
 * Cuantos nombres de la biblioteca reproducen las reglas «como tMM» (scanner/nombres-tmm.ts). SOLO LECTURA: abre la base de datos real
 * en modo lectura y no toca ningun fichero.
 *
 *   node src/cli/organizar-informe.ts
 */
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, extname, join } from 'node:path';
import { carpetaDePelicula, carpetaDeSerie, carpetaDeTemporada, ficheroDeEpisodio } from '../scanner/nombres-tmm.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const db = new DatabaseSync(join(ROOT, 'data', 'tvwatch.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout = 10000');

const ejemplosN = Number(process.env.EJ ?? 6);
const pct = (a: number, b: number) => (b ? +((100 * a) / b).toFixed(1) : 0);
const ejemplos = (xs: [string, string][]) => xs.slice(0, ejemplosN).map(([real, esperado]) => `    real:     ${real}\n    esperado: ${esperado}`).join('\n');

// Peliculas con carpeta propia
const pelis = db.prepare("SELECT title, year, folder FROM items WHERE kind = 'movie' AND folder NOT GLOB '*.[mM][kKpP][vV4]' AND folder NOT GLOB '*.[aA][vV][iI]'").all() as { title: string; year: number | null; folder: string }[];
let okP = 0;
const malP: [string, string][] = [];
for (const p of pelis) {
  const real = basename(p.folder);
  // La edicion no se guarda aparte: si el nombre real la lleva («Titulo - Extended Edition (1986)») se saca de ahi.
  const m = real.match(/^.*? - (.+?) \(\d{4}\)$/);
  const conEdicion = m ? carpetaDePelicula({ titulo: p.title, anio: p.year, edicion: m[1] }) : null;
  const esperado = carpetaDePelicula({ titulo: p.title, anio: p.year });
  if (real === esperado || real === conEdicion) okP++;
  else malP.push([real, esperado]);
}
console.log(`PELICULAS (carpeta): ${okP} de ${pelis.length} = ${pct(okP, pelis.length)} %`);
console.log(ejemplos(malP));

// Series: carpeta, carpeta de temporada y fichero de episodio
const series = db.prepare("SELECT id, title, year, folder FROM items WHERE kind = 'show'").all() as { id: number; title: string; year: number | null; folder: string }[];
let okS = 0;
const malS: [string, string][] = [];
for (const s of series) {
  const real = basename(s.folder);
  const esperado = carpetaDeSerie(s.title, s.year);
  if (real === esperado) okS++; else malS.push([real, esperado]);
}
console.log(`SERIES (carpeta): ${okS} de ${series.length} = ${pct(okS, series.length)} %`);
console.log(ejemplos(malS));

const eps = db.prepare(`SELECT s.title AS serie, e.season, e.episode, e.title, f.path FROM episodes e JOIN items s ON s.id = e.show_id JOIN media_files f ON f.episode_id = e.id`).all() as { serie: string; season: number; episode: number; title: string | null; path: string }[];
let okE = 0, okT = 0;
const malE: [string, string][] = [];
for (const e of eps) {
  const real = basename(e.path, extname(e.path));
  const esperado = ficheroDeEpisodio(e.serie, e.season, e.episode, e.title);
  if (real === esperado) okE++; else malE.push([real, esperado]);
  if (basename(dirname(e.path)) === carpetaDeTemporada(e.season)) okT++;
}
console.log(`EPISODIOS (fichero): ${okE} de ${eps.length} = ${pct(okE, eps.length)} %   carpeta de temporada: ${okT} = ${pct(okT, eps.length)} %`);
console.log(ejemplos(malE));
