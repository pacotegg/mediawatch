import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
// `config` hace falta para `config.python`: sin este import la deteccion
// reventaba con «config is not defined» en cuanto se lanzaba.
import { ROOT, config } from '../config.ts';
import { db } from '../db.ts';
import { esperarSiHayAlguienViendo, hayAlguienViendo } from './ocupado.ts';

const run = promisify(execFile);
const SCRIPT = join(ROOT, 'server', 'scripts', 'intros.py');

db.exec(`
CREATE TABLE IF NOT EXISTS skip_ranges (
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  start_s    REAL NOT NULL,
  end_s      REAL NOT NULL,
  confidence INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (episode_id, kind)
);
`);

export type SkipRange = { kind: string; start_s: number; end_s: number; confidence: number };

export const skipRangesFor = (episodeId: number): SkipRange[] =>
  db.prepare('SELECT kind, start_s, end_s, confidence FROM skip_ranges WHERE episode_id = ?').all(episodeId) as SkipRange[];

export type DetectionJob = {
  running: boolean;
  showId: number | null;
  showTitle: string;
  season: number | null;
  kind: string;
  found: number;
  error: string | null;
  finishedAt: string | null;
  /** Series pendientes y hechas cuando se recorre la biblioteca entera. */
  total: number;
  hechas: number;
  parando: boolean;
  /** En pausa porque hay alguien viendo algo. */
  esperando: boolean;
};

export const job: DetectionJob = {
  running: false, showId: null, showTitle: '', season: null, kind: '', found: 0, error: null, finishedAt: null,
  total: 0, hechas: 0, parando: false, esperando: false,
};

/** Corta el recorrido en cuanto termine la temporada que este analizando. */
export function pararDeteccion() {
  if (!job.running) return false;
  job.parando = true;
  return true;
}

type Detected = { episodeId: number; tipo: string; startS: number; endS: number; confianza: number };

async function detectSeason(showId: number, season: number, kind: 'cabecera' | 'creditos'): Promise<number> {
  const episodes = db
    .prepare(`SELECT e.id AS episodeId, f.path, f.duration
              FROM episodes e JOIN media_files f ON f.episode_id = e.id
              WHERE e.show_id = ? AND e.season = ? ORDER BY e.episode`)
    .all(showId, season) as { episodeId: number; path: string; duration: number | null }[];

  if (episodes.length < 2) return 0;

  const dir = mkdtempSync(join(tmpdir(), 'cineteca-intros-'));
  const listPath = join(dir, 'episodes.json');
  writeFileSync(listPath, JSON.stringify(episodes), 'utf8');

  try {
    const { stdout } = await run(config.python, [SCRIPT, '--ficheros', listPath, '--modo', kind], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60 * 60_000,
    });

    const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '[]');
    if (!Array.isArray(parsed)) return 0;

    const insert = db.prepare(`INSERT INTO skip_ranges (episode_id, kind, start_s, end_s, confidence, created_at)
                               VALUES (?,?,?,?,?,?)
                               ON CONFLICT(episode_id, kind) DO UPDATE SET
                                 start_s = excluded.start_s, end_s = excluded.end_s,
                                 confidence = excluded.confidence, created_at = excluded.created_at`);
    const now = new Date().toISOString();
    let saved = 0;
    for (const r of parsed as Detected[]) {
      if (r.endS - r.startS < 10) continue;
      insert.run(r.episodeId, kind === 'cabecera' ? 'intro' : 'credits', r.startS, r.endS, r.confianza, now);
      saved++;
    }
    return saved;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * An intro is the only stretch of audio every episode of a season shares, so it
 * is found by fingerprinting each episode and looking for the longest run that
 * matches across pairs. Needs at least two episodes to compare.
 */
export function detectForShow(showId: number, kind: 'cabecera' | 'creditos') {
  if (job.running) throw new Error('Ya hay una detección en curso');

  const show = db.prepare('SELECT title FROM items WHERE id = ?').get(showId) as { title: string } | undefined;
  const seasons = db.prepare('SELECT DISTINCT season FROM episodes WHERE show_id = ? ORDER BY season').all(showId) as { season: number }[];

  Object.assign(job, {
    running: true, showId, showTitle: show?.title ?? '', season: null, kind, found: 0, error: null, finishedAt: null,
    total: 0, hechas: 0, parando: false,
  });

  queueMicrotask(async () => {
    try {
      for (const { season } of seasons) {
        // Sin esta comprobacion el boton de parar no hacia nada al analizar una
        // serie suelta: marcaba la bandera y este bucle seguia hasta el final.
        if (job.parando) break;
        job.season = season;
        job.found += await detectSeason(showId, season, kind);
      }
    } catch (err) {
      job.error = (err as Error).message;
    } finally {
      job.running = false;
      job.parando = false;
      job.finishedAt = new Date().toISOString();
    }
  });
}

/**
 * Recorre la biblioteca entera buscando cabecera y creditos.
 *
 * Es trabajo caro: hay que sacar la huella acustica de cada episodio con
 * ffmpeg, y son 3808. Por eso va serie a serie, en segundo plano, se puede
 * parar, y se salta las temporadas que ya tienen resultados: relanzarlo despues
 * de anadir una serie nueva cuesta solo esa serie.
 */
export function detectarTodas(soloNuevas = true) {
  if (job.running) throw new Error('Ya hay una detección en curso');

  const series = db
    .prepare(`SELECT s.id, s.title FROM items s
               WHERE s.kind = 'show'
                 AND (SELECT COUNT(*) FROM episodes e WHERE e.show_id = s.id) >= 2
               ORDER BY s.title`)
    .all() as { id: number; title: string }[];

  const hechas = new Set(
    (db
      .prepare(`SELECT DISTINCT e.show_id AS id FROM skip_ranges r JOIN episodes e ON e.id = r.episode_id`)
      .all() as { id: number }[]).map((r) => r.id),
  );
  const pendientes = soloNuevas ? series.filter((s) => !hechas.has(s.id)) : series;

  Object.assign(job, {
    running: true, showId: null, showTitle: '', season: null, kind: 'todo',
    found: 0, error: null, finishedAt: null,
    total: pendientes.length, hechas: 0, parando: false,
  });

  queueMicrotask(async () => {
    try {
      for (const serie of pendientes) {
        if (job.parando) break;
        // Nadie analiza nada mientras se ve una película: comparten disco.
        job.esperando = hayAlguienViendo();
        if (!(await esperarSiHayAlguienViendo(() => !job.parando))) break;
        job.esperando = false;
        job.showId = serie.id;
        job.showTitle = serie.title;
        const temporadas = db
          .prepare('SELECT DISTINCT season FROM episodes WHERE show_id = ? ORDER BY season')
          .all(serie.id) as { season: number }[];
        for (const { season } of temporadas) {
          if (job.parando) break;
          job.season = season;
          for (const tipo of ['cabecera', 'creditos'] as const) {
            job.kind = tipo;
            try {
              job.found += await detectSeason(serie.id, season, tipo);
            } catch (err) {
              // Una serie que falla no puede llevarse por delante el recorrido.
              console.error('[cabeceras]', serie.title, season, tipo, (err as Error).message);
            }
          }
        }
        job.hechas++;
      }
    } catch (err) {
      job.error = (err as Error).message;
    } finally {
      job.running = false;
      job.parando = false;
      job.esperando = false;
      job.finishedAt = new Date().toISOString();
      console.log(`[cabeceras] terminado: ${job.hechas}/${job.total} series, ${job.found} tramos`);
    }
  });
}

export function showsWithRanges() {
  return db
    .prepare(`SELECT s.id, s.title, COUNT(DISTINCT r.episode_id) AS episodes,
                SUM(r.kind = 'intro') AS intros, SUM(r.kind = 'credits') AS credits
              FROM skip_ranges r JOIN episodes e ON e.id = r.episode_id JOIN items s ON s.id = e.show_id
              GROUP BY s.id ORDER BY s.title`)
    .all();
}
