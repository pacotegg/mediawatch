/**
 * Informe EN SECO de «adoptar» la biblioteca: que pasaria si el servidor tomara los metadatos de TMDb en vez del .nfo de tinyMediaManager.
 *
 *   node src/cli/adoptar-informe.ts [--n 40]
 *
 * Elige N peliculas al azar con id de TMDb en su .nfo, pide a TMDb su ficha (la misma que usaria el Scraper) y la COMPARA con lo que hay
 * en la base. No cambia nada: la base real se abre de solo lectura, y el codigo de TMDb corre contra una base temporal. La clave de TMDb se
 * lee de data/config.json y solo vive en memoria: no se imprime ni se escribe. El informe va a data/adoptar-informe-<fecha>.json.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Antes de importar nada del servidor: que su base de datos sea una temporal, nunca data/.
const temporal = mkdtempSync(join(tmpdir(), 'mw-adoptar-'));
process.env.MEDIAWATCH_DATA_DIR = temporal;
const { config, ROOT } = await import('../config.ts');
const { detallesDe } = await import('../scanner/tmdb.ts');
const { normalize } = await import('../db.ts');

const reales = join(ROOT, 'data');
config.tmdbApiKey = JSON.parse(readFileSync(join(reales, 'config.json'), 'utf8')).tmdbApiKey ?? '';
if (!config.tmdbApiKey) throw new Error('Falta la clave de TMDb en data/config.json');
const db = new DatabaseSync(join(reales, 'tvwatch.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout = 10000');

const arg = process.argv.indexOf('--n');
const n = arg > 0 ? Math.max(1, Math.min(300, Number(process.argv[arg + 1]) || 40)) : 40;

type Fila = { id: number; title: string; original_title: string | null; year: number | null; plot: string | null; studio: string | null; country: string | null; rating: number | null; mpaa: string | null; tmdb_id: string };
const filas = db
  .prepare("SELECT id, title, original_title, year, plot, studio, country, rating, mpaa, tmdb_id FROM items WHERE kind = 'movie' AND meta_origen IS NULL AND tmdb_id GLOB '[0-9]*' ORDER BY RANDOM() LIMIT ?")
  .all(n) as Fila[];

const lista = (s: string | null) => (s ?? '').split(',').map((x) => normalize(x)).filter(Boolean);
const solapamiento = (a: string[], b: string[]) => (a.length === 0 && b.length === 0 ? 1 : a.filter((x) => b.includes(x)).length / Math.max(a.length, b.length, 1));
const gente = db.prepare("SELECT p.name, ip.role FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ? ORDER BY ip.ord, p.name");

const informe: Record<string, unknown>[] = [];
let errores = 0;
for (const f of filas) {
  try {
    const p = await detallesDe(Number(f.tmdb_id), 'movie');
    const nfoActores = (gente.all(f.id) as { name: string; role: string }[]).filter((g) => g.role === 'actor').map((g) => normalize(g.name));
    const nfoDirectores = (gente.all(f.id) as { name: string; role: string }[]).filter((g) => g.role === 'director').map((g) => normalize(g.name));
    const tmdbActores = (p.reparto ?? []).slice(0, 10).map((a) => normalize(a.nombre));
    informe.push({
      id: f.id, titulo: f.title, tmdb: f.tmdb_id,
      tituloIgual: [f.title, f.original_title].some((t) => t && (normalize(t) === normalize(p.title) || normalize(t) === normalize(p.originalTitle ?? ''))),
      anioIgual: f.year === p.year,
      sinopsisIgual: normalize(f.plot ?? '') === normalize(p.overview ?? ''),
      sinopsisVaciaEnBd: !f.plot, sinopsisVaciaEnTmdb: !p.overview,
      repartoSolapa10: +solapamiento(nfoActores.slice(0, 10), tmdbActores).toFixed(2),
      directoresIguales: solapamiento(nfoDirectores, (p.directores ?? []).map(normalize)) === 1,
      estudiosSolapan: +solapamiento(lista(f.studio), (p.estudios ?? []).map(normalize)).toFixed(2),
      paisesSolapan: +solapamiento(lista(f.country), (p.paises ?? []).map(normalize)).toFixed(2),
      notaBd: f.rating, notaTmdb: p.rating, mpaaBd: f.mpaa, edadTmdb: p.certificacion ?? null,
      nReparto: p.reparto?.length ?? 0, nEstudios: p.estudios?.length ?? 0,
    });
  } catch (e) {
    errores++;
    informe.push({ id: f.id, titulo: f.title, tmdb: f.tmdb_id, error: (e as Error).message });
  }
  await new Promise((r) => setTimeout(r, 300));
}

const ok = informe.filter((i) => !('error' in i));
const cuenta = (campo: string) => ok.filter((i) => i[campo] === true).length;
const media = (campo: string) => (ok.length ? +(ok.reduce((s, i) => s + Number(i[campo]), 0) / ok.length).toFixed(2) : 0);
const resumen = {
  muestra: filas.length, conErrores: errores,
  tituloIgual: cuenta('tituloIgual'), anioIgual: cuenta('anioIgual'), sinopsisIgual: cuenta('sinopsisIgual'),
  sinopsisVaciaEnBdYConTmdb: ok.filter((i) => i.sinopsisVaciaEnBd && !i.sinopsisVaciaEnTmdb).length,
  directoresIguales: cuenta('directoresIguales'),
  repartoSolapaMedia: media('repartoSolapa10'), estudiosSolapanMedia: media('estudiosSolapan'), paisesSolapanMedia: media('paisesSolapan'),
  conEdadES: ok.filter((i) => String(i.edadTmdb ?? '').startsWith('ES:')).length,
  bdSinEdadYTmdbConEdad: ok.filter((i) => !i.mpaaBd && i.edadTmdb).length,
};
const salida = join(reales, `adoptar-informe-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(salida, JSON.stringify({ resumen, informe }, null, 1));
console.log(JSON.stringify(resumen, null, 1));
console.log('Informe en', salida);
process.exit(0);
