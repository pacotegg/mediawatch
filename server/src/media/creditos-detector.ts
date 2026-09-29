import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Capitulo } from './probe.ts';
import { ROOT, config } from '../config.ts';
import { db } from '../db.ts';
import { creditosDePelicula, type RangoCreditos } from './creditos-pelicula.ts';
import { esperarSiHayAlguienViendo, hayAlguienViendo } from './ocupado.ts';
import { mediaInfo } from './probe.ts';

/**
 * Créditos de las películas por el texto que sube (creditos_pelicula.py).
 *
 * Corre DENTRO del servidor, como el de cabeceras de las series, y no como un
 * script aparte: «hay alguien viendo» vive en memoria de este proceso
 * (`ocupado.ts`), y un script CLI nunca lo vería. La biblioteca está en un disco
 * mecánico y cada película son unas 80 lecturas cortas con salto de cabezal.
 */

const run = promisify(execFile);
const SCRIPT = join(ROOT, 'server', 'scripts', 'creditos_pelicula.py');

db.exec(`
CREATE TABLE IF NOT EXISTS pelicula_creditos (
  item_id    INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  rangos     TEXT NOT NULL,
  escenas    TEXT NOT NULL,
  metodo     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

type Tramo = { start_s: number; end_s: number };

/** Rangos guardados por el detector; null si esta película aún no se ha mirado. */
function rangosDetectados(itemId: number): RangoCreditos[] | null {
  const fila = db.prepare('SELECT rangos FROM pelicula_creditos WHERE item_id = ?').get(itemId) as { rangos: string } | undefined;
  if (!fila) return null;
  try {
    return (JSON.parse(fila.rangos) as Tramo[]).map((r) => ({
      kind: 'credits',
      start_s: r.start_s,
      end_s: r.end_s,
      confidence: 80,
      source: 'texto-sube',
    }));
  } catch {
    return null;
  }
}

/**
 * Qué créditos devuelve una película, de más a menos fiable:
 * 1. un capítulo del fichero con nombre de créditos (95),
 * 2. el detector del texto que sube, que además separa las escenas extra (80),
 * 3. el último capítulo, si todos son genéricos (70).
 */
export function skipDePelicula(itemId: number, capitulos: Capitulo[], duracion: number): RangoCreditos[] {
  const porCapitulo = creditosDePelicula(capitulos, duracion);
  if (porCapitulo.length && porCapitulo[0].source === 'capitulo') return porCapitulo;
  const detectados = rangosDetectados(itemId);
  if (detectados && detectados.length) return detectados;
  return porCapitulo;
}

export type JobPeliculas = {
  running: boolean;
  total: number;
  hechas: number;
  actual: string;
  conCreditos: number;
  conEscenas: number;
  parando: boolean;
  esperando: boolean;
  error: string | null;
  finishedAt: string | null;
};

export const jobPeliculas: JobPeliculas = {
  running: false, total: 0, hechas: 0, actual: '', conCreditos: 0, conEscenas: 0,
  parando: false, esperando: false, error: null, finishedAt: null,
};

export function pararPeliculas(): boolean {
  if (!jobPeliculas.running) return false;
  jobPeliculas.parando = true;
  return true;
}

export function resumenPeliculas() {
  const fila = db
    .prepare(`SELECT COUNT(*) AS analizadas,
                     SUM(rangos != '[]') AS con_creditos,
                     SUM(escenas != '[]') AS con_escenas
              FROM pelicula_creditos`)
    .get() as { analizadas: number; con_creditos: number | null; con_escenas: number | null };
  return {
    analizadas: fila.analizadas,
    conCreditos: fila.con_creditos ?? 0,
    conEscenas: fila.con_escenas ?? 0,
  };
}

type Pendiente = { itemId: number; fileId: number; path: string; title: string };

/** Sin `ids`, las que aún no se han mirado; con `ids`, esas, se hayan mirado o no. */
function pendientes(ids?: number[]): Pendiente[] {
  const filtro = ids && ids.length
    ? 'AND i.id IN (' + ids.map(() => '?').join(',') + ')'
    : 'AND i.id NOT IN (SELECT item_id FROM pelicula_creditos)';
  return db
    .prepare(`SELECT i.id AS itemId, f.id AS fileId, f.path, i.title
              FROM items i JOIN media_files f ON f.item_id = i.id
              WHERE i.kind = 'movie' AND f.duration >= 1200 ${filtro}
              GROUP BY i.id ORDER BY i.id`)
    .all(...(ids ?? [])) as Pendiente[];
}

const guardar = () =>
  db.prepare(`INSERT INTO pelicula_creditos (item_id, rangos, escenas, metodo, created_at)
              VALUES (?,?,?,?,?)
              ON CONFLICT(item_id) DO UPDATE SET rangos = excluded.rangos, escenas = excluded.escenas,
                metodo = excluded.metodo, created_at = excluded.created_at`);

async function analizarUna(p: Pendiente): Promise<void> {
  if (!existsSync(p.path)) return;
  const info = await mediaInfo(p.fileId);
  const porCapitulo = creditosDePelicula(info.chapters, info.duration);

  // Con un capítulo de créditos con nombre no hace falta mirar el vídeo.
  if (porCapitulo.length && porCapitulo[0].source === 'capitulo') return;

  // Con un último capítulo genérico, los créditos están ahí dentro: se acota.
  const args = [SCRIPT, '--ffmpeg', config.ffmpeg, '--fichero', p.path, '--duracion', String(info.duration)];
  if (porCapitulo.length) args.push('--desde', String(Math.max(0, porCapitulo[0].start_s - 90)));

  let stdout: string;
  try {
    ({ stdout } = await run(config.python, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 20 * 60_000 }));
  } catch (err) {
    const salida = String((err as { stdout?: string }).stdout ?? '').trim().split('\n').pop() ?? '';
    let motivo = '';
    try {
      motivo = String((JSON.parse(salida) as { error?: string }).error ?? '');
    } catch {
      motivo = salida;
    }
    // Sin motivo legible es una avería de verdad: que suba y se registre.
    if (!motivo) throw err;
    console.log('[creditos-peliculas] ' + p.title + ': ' + motivo);
    // Se anota como mirada y vacía: sin esto se reanalizaría en cada pasada.
    guardar().run(p.itemId, '[]', '[]', 'error', new Date().toISOString());
    return;
  }

  const r = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { rangos?: Tramo[]; escenas?: Tramo[] };
  const rangos = r.rangos ?? [];
  const escenas = r.escenas ?? [];
  // Cadena '[]' y no vacía: «ya mirada y sin nada» no debe volver a analizarse.
  guardar().run(p.itemId, JSON.stringify(rangos), JSON.stringify(escenas), 'texto-sube', new Date().toISOString());
  if (rangos.length) jobPeliculas.conCreditos++;
  if (escenas.length) jobPeliculas.conEscenas++;
}

export function detectarPeliculas(ids?: number[]): number {
  if (jobPeliculas.running) throw new Error('Ya hay una detección de créditos en curso');
  const lista = pendientes(ids);
  Object.assign(jobPeliculas, {
    running: true, total: lista.length, hechas: 0, actual: '', conCreditos: 0, conEscenas: 0,
    parando: false, esperando: false, error: null, finishedAt: null,
  });

  void (async () => {
    try {
      for (const p of lista) {
        if (jobPeliculas.parando) break;
        jobPeliculas.esperando = hayAlguienViendo();
        const sigue = await esperarSiHayAlguienViendo(() => !jobPeliculas.parando);
        jobPeliculas.esperando = false;
        if (!sigue) break;
        jobPeliculas.actual = p.title;
        try {
          await analizarUna(p);
        } catch (err) {
          console.error('[creditos-peliculas] ' + p.title + ' ' + (err as Error).message);
        }
        jobPeliculas.hechas++;
      }
    } catch (err) {
      jobPeliculas.error = (err as Error).message;
    } finally {
      jobPeliculas.running = false;
      jobPeliculas.actual = '';
      jobPeliculas.parando = false;
      jobPeliculas.finishedAt = new Date().toISOString();
    }
  })();

  return lista.length;
}
