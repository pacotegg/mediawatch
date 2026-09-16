import { spawn } from 'node:child_process';
import { join } from 'node:path';
// Igual que en intros.ts: se usa `config.python`, asi que hay que traerlo.
import { ROOT, config } from '../config.ts';
import { db } from '../db.ts';
import { rescanItem } from '../scanner/scan.ts';
import { mediaInfo } from './probe.ts';

const SCRIPT = join(ROOT, 'server', 'scripts', 'transcribe.py');

export type TranscribeJob = {
  running: boolean;
  fileId: number | null;
  title: string;
  log: string[];
  result: { frases: number; idioma: string; segundos: number } | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  queue: number[];
  done: number;
  failed: number;
  stopping: boolean;
};

export const job: TranscribeJob = {
  running: false, fileId: null, title: '', log: [], result: null, error: null,
  startedAt: null, finishedAt: null, queue: [], done: 0, failed: 0, stopping: false,
};

/**
 * Files with no subtitle track at all: the only ones worth transcribing.
 * Anything that already has one, even in another language, is better served by
 * the downloader, which verifies synchronisation.
 */
export function filesWithoutSubtitles(limit = 100) {
  return db
    .prepare(`SELECT f.id, f.duration,
                COALESCE(i.title, s.title) AS title,
                e.season, e.episode,
                COALESCE(l1.name, l2.name) AS library
              FROM media_files f
              LEFT JOIN items i    ON i.id = f.item_id
              LEFT JOIN episodes e ON e.id = f.episode_id
              LEFT JOIN items s    ON s.id = e.show_id
              LEFT JOIN libraries l1 ON l1.id = i.library_id
              LEFT JOIN libraries l2 ON l2.id = s.library_id
              WHERE NOT EXISTS (SELECT 1 FROM sub_tracks t WHERE t.file_id = f.id)
                AND f.duration > 120
              ORDER BY f.duration
              LIMIT ?`)
    .all(limit);
}

export function missingSubtitleStats() {
  return db
    .prepare(`SELECT COUNT(*) AS ficheros, ROUND(COALESCE(SUM(duration), 0) / 3600.0, 1) AS horas
              FROM media_files f
              WHERE NOT EXISTS (SELECT 1 FROM sub_tracks t WHERE t.file_id = f.id)
                AND f.duration > 120`)
    .get();
}

export const hasSubtitles = (fileId: number): boolean =>
  ((db.prepare('SELECT COUNT(*) AS n FROM sub_tracks WHERE file_id = ?').get(fileId) as { n: number }).n) > 0;

export function stopQueue() {
  job.stopping = true;
  job.queue = [];
}

/**
 * Whisper on the CPU runs at roughly ten times real time here, so a feature
 * film takes about a quarter of an hour. It is a background job by nature:
 * there is no version of this that keeps up with playback.
 */
export async function transcribe(fileId: number, options: { model?: string; language?: string; audioIndex?: number; force?: boolean }) {
  if (job.running) throw new Error('Ya hay una transcripción en curso');
  if (!options.force && hasSubtitles(fileId)) {
    throw new Error('Ese fichero ya tiene subtítulos; la transcripción es para los que no tienen ninguno');
  }

  const file = db
    .prepare(`SELECT f.path, COALESCE(f.item_id, e.show_id) AS item_id, COALESCE(i.title, s.title) AS title
              FROM media_files f
              LEFT JOIN items i ON i.id = f.item_id
              LEFT JOIN episodes e ON e.id = f.episode_id
              LEFT JOIN items s ON s.id = e.show_id
              WHERE f.id = ?`)
    .get(fileId) as { path: string; item_id: number; title: string } | undefined;
  if (!file) throw new Error('Fichero no encontrado');

  const info = await mediaInfo(fileId);
  const wanted = options.language === 'en' ? 'eng' : options.language === 'es' ? 'spa' : null;
  const matching = wanted ? info.audio.find((a) => a.language === wanted) : undefined;
  const chosen = matching ?? info.audio[0];
  const audioIndex = options.audioIndex ?? chosen?.streamIndex ?? 1;

  /*
   * Whisper transcribes what is actually spoken; it cannot translate into
   * Spanish. Forcing a language the track is not in returns garbage or nothing
   * at all, so when the requested language is missing we let it detect instead.
   */
  const language = matching ? options.language : undefined;
  const languageNote =
    wanted && !matching
      ? `No hay pista en ${options.language === 'en' ? 'inglés' : 'español'}; se transcribirá «${chosen?.language ?? 'desconocido'}» detectando el idioma hablado.`
      : null;

  Object.assign(job, {
    running: true, fileId, title: file.title, log: languageNote ? [languageNote] : [], result: null, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
  });

  const proc = spawn(
    config.python,
    [
      SCRIPT,
      '--video', file.path,
      '--audio-index', String(audioIndex),
      '--modelo', options.model ?? 'small',
      ...(language ? ['--idioma', language] : []),
    ],
    { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  );

  const push = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.trim()) job.log.push(line.trimEnd());
    }
    if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  };
  proc.stdout.on('data', push);
  proc.stderr.on('data', push);

  proc.on('close', (code) => {
    job.running = false;
    job.finishedAt = new Date().toISOString();
    const last = job.log.at(-1) ?? '';
    try {
      const parsed = JSON.parse(last);
      if (parsed.ok) {
        job.result = { frases: parsed.frases, idioma: parsed.idioma, segundos: parsed.segundos };
        job.done++;
        rescanItem(file.item_id);
        job.log.push('Subtítulo generado y añadido a la ficha.');
      } else {
        job.error = parsed.motivo ?? 'falló la transcripción';
        job.failed++;
      }
    } catch {
      if (code !== 0) {
        job.error = `terminó con código ${code}`;
        job.failed++;
      }
    }
    void advanceQueue(options);
  });

  proc.on('error', (err) => {
    job.running = false;
    job.error = err.message;
    job.failed++;
    job.finishedAt = new Date().toISOString();
    void advanceQueue(options);
  });

  return { started: true, title: file.title };
}

/** Walks the batch one file at a time; two Whispers at once would just fight over the CPU. */
async function advanceQueue(options: { model?: string; language?: string }) {
  if (job.stopping || job.queue.length === 0) {
    job.stopping = false;
    return;
  }
  const next = job.queue.shift()!;
  try {
    await transcribe(next, options);
  } catch (err) {
    job.log.push(`Saltado ${next}: ${(err as Error).message}`);
    job.failed++;
    void advanceQueue(options);
  }
}

export async function transcribeBatch(fileIds: number[], options: { model?: string; language?: string }) {
  if (job.running) throw new Error('Ya hay una transcripción en curso');

  const pending = fileIds.filter((id) => !hasSubtitles(id));
  if (pending.length === 0) throw new Error('Ninguno de esos ficheros necesita subtítulos');

  Object.assign(job, { queue: pending.slice(1), done: 0, failed: 0, stopping: false });
  return transcribe(pending[0], options);
}
