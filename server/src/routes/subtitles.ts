import { spawn } from 'node:child_process';
import { config, DATA_DIR, ROOT } from '../config.ts';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { db } from '../db.ts';
import {
  filesWithoutSubtitles,
  job as transcribeJob,
  missingSubtitleStats,
  stopQueue,
  transcribe,
  transcribeBatch,
} from '../media/transcribe.ts';
import { rescanItem } from '../scanner/scan.ts';
import { requireUser } from './auth.ts';

/**
 * Delegates to the pipeline's own subsfetch.py rather than reimplementing it:
 * that script already searches the local library first, then OpenSubtitles by
 * moviehash, and proves synchronisation by cross-correlating against the
 * centre audio channel — rejecting anything it cannot verify.
 */
const SUBSFETCH = 'C:\\scripts\\webpanel\\subsfetch.py';
const SUBTITLES_API = join(ROOT, 'server', 'scripts', 'subtitles_api.py');
const PYTHON = config.python;

type Job = {
  running: boolean;
  fileId: number | null;
  title: string;
  log: string[];
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
};

const job: Job = { running: false, fileId: null, title: '', log: [], exitCode: null, startedAt: null, finishedAt: null };

const OUTCOME: Record<number, string> = {
  0: 'Encontrados y verificados todos los subtítulos pedidos',
  2: 'Se consiguieron algunos, pero no todos',
  1: 'No se consiguió ninguno que superara la verificación de sincronía',
};

export default async function subtitleRoutes(app: FastifyInstance) {
  app.get('/api/subtitles/available', async (req) => {
    requireUser(req);
    return { available: existsSync(SUBSFETCH), script: SUBSFETCH };
  });

  app.get('/api/subtitles/job', async (req) => {
    requireUser(req);
    return {
      ...job,
      outcome: job.exitCode === null ? null : (OUTCOME[job.exitCode] ?? `Terminó con código ${job.exitCode}`),
    };
  });

  app.get('/api/subtitles/transcribe', async (req) => {
    requireUser(req);
    return transcribeJob;
  });

  app.get('/api/subtitles/missing', async (req) => {
    requireUser(req);
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 60), 300);
    return { stats: missingSubtitleStats(), files: filesWithoutSubtitles(limit) };
  });

  app.post('/api/subtitles/transcribe', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede transcribir' });
    const { fileId, fileIds, model, language, force } = req.body as {
      fileId?: number; fileIds?: number[]; model?: string; language?: string; force?: boolean;
    };
    try {
      if (fileIds?.length) return await transcribeBatch(fileIds, { model, language });
      if (!fileId) return reply.code(400).send({ error: 'Falta el fichero' });
      return await transcribe(fileId, { model, language, force });
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.post('/api/subtitles/transcribe/stop', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });
    stopQueue();
    return { ok: true };
  });

  app.post('/api/subtitles/fetch', async (req, reply) => {
    requireUser(req);
    if (job.running) return reply.code(409).send({ error: 'Ya hay una búsqueda de subtítulos en curso' });
    if (!existsSync(SUBSFETCH)) return reply.code(400).send({ error: 'No se encuentra subsfetch.py del pipeline' });

    const { fileId, languages, forced, mux, localOnly, dryRun, wait } = req.body as {
      fileId: number; languages?: string; forced?: boolean; mux?: boolean; localOnly?: boolean; dryRun?: boolean; wait?: boolean;
    };

    const file = db
      .prepare(`SELECT f.path, COALESCE(f.item_id, e.show_id) AS item_id, COALESCE(i.title, s.title) AS title
                FROM media_files f
                LEFT JOIN items i ON i.id = f.item_id
                LEFT JOIN episodes e ON e.id = f.episode_id
                LEFT JOIN items s ON s.id = e.show_id
                WHERE f.id = ?`)
      .get(fileId) as { path: string; item_id: number; title: string } | undefined;
    if (!file) return reply.code(404).send({ error: 'Fichero no encontrado' });

    const outDir = join(DATA_DIR, 'subtitles', String(fileId));
    mkdirSync(outDir, { recursive: true });

    const args = [
      SUBSFETCH,
      file.path,
      '--idiomas', (languages ?? 'es,en').replace(/\s/g, ''),
      '--out', outDir,
      ...(forced ? ['--forzados'] : []),
      ...(mux ? ['--mux'] : []),
      ...(localOnly ? ['--solo-local'] : []),
      ...(dryRun ? ['--dry-run'] : []),
    ];

    Object.assign(job, {
      running: true,
      fileId,
      title: file.title,
      log: [`> subsfetch ${file.path}`],
      exitCode: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    const proc = spawn(PYTHON, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    const push = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) job.log.push(line.trimEnd());
      }
      if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
    };
    proc.stdout.on('data', push);
    proc.stderr.on('data', push);

    const onDone = new Promise<{ ok: boolean; exitCode: number | null; outcome: string | null; title: string }>((resolve) => {
      proc.on('close', (code) => {
        job.exitCode = code ?? 1;
        job.running = false;
        job.finishedAt = new Date().toISOString();
        if (code === 0 || code === 2) {
          try {
            rescanItem(file.item_id);
            job.log.push('Ficha actualizada con los subtítulos nuevos.');
          } catch (err) {
            job.log.push(`No se pudo refrescar la ficha: ${(err as Error).message}`);
          }
        }
        resolve({
          ok: code === 0 || code === 2,
          exitCode: job.exitCode,
          outcome: job.exitCode !== null ? (OUTCOME[job.exitCode] ?? `Terminó con código ${job.exitCode}`) : null,
          title: file.title,
        });
      });

      proc.on('error', (err) => {
        job.log.push(`No se pudo lanzar Python: ${err.message}`);
        job.exitCode = 1;
        job.running = false;
        job.finishedAt = new Date().toISOString();
        resolve({
          ok: false,
          exitCode: 1,
          outcome: `Error al iniciar: ${err.message}`,
          title: file.title,
        });
      });
    });

    if (wait) {
      return await onDone;
    }

    return { started: true, title: file.title };
  });

  app.post('/api/subtitles/search', async (req, reply) => {
    requireUser(req);
    const { fileId, languages } = req.body as { fileId: number; languages?: string };
    if (!fileId) return reply.code(400).send({ error: 'Falta fileId' });

    const file = db
      .prepare(`SELECT f.path, COALESCE(f.item_id, e.show_id) AS item_id, COALESCE(i.title, s.title) AS title
                FROM media_files f
                LEFT JOIN items i ON i.id = f.item_id
                LEFT JOIN episodes e ON e.id = f.episode_id
                LEFT JOIN items s ON s.id = e.show_id
                WHERE f.id = ?`)
      .get(fileId) as { path: string; item_id: number; title: string } | undefined;
    if (!file) return reply.code(404).send({ error: 'Fichero no encontrado' });

    const langs = languages ?? 'es,en';
    const args = [SUBTITLES_API, 'buscar', '--video', file.path, '--idiomas', langs];
    const proc = spawn(PYTHON, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

    let salida = '';
    proc.stdout.on('data', (d) => { salida += d.toString('utf8'); });
    proc.stderr.on('data', (d) => console.warn('[subtitles/search]', d.toString('utf8').trim()));

    return await new Promise((resolve) => {
      proc.on('close', (code) => {
        try {
          const parsed = JSON.parse(salida);
          resolve(parsed);
        } catch (e) {
          resolve({ ok: false, error: 'Error parseando resultados de búsqueda', candidates: [] });
        }
      });
      proc.on('error', (err) => resolve({ ok: false, error: err.message, candidates: [] }));
    });
  });

  app.post('/api/subtitles/download', async (req, reply) => {
    requireUser(req);
    const { fileId, provider, subId, language, release, forced } = req.body as {
      fileId: number; provider: string; subId: string | number; language: string; release?: string; forced?: boolean;
    };
    if (!fileId || !provider || !subId) return reply.code(400).send({ error: 'Faltan parámetros' });

    const file = db
      .prepare(`SELECT f.path, COALESCE(f.item_id, e.show_id) AS item_id, COALESCE(i.title, s.title) AS title
                FROM media_files f
                LEFT JOIN items i ON i.id = f.item_id
                LEFT JOIN episodes e ON e.id = f.episode_id
                LEFT JOIN items s ON s.id = e.show_id
                WHERE f.id = ?`)
      .get(fileId) as { path: string; item_id: number; title: string } | undefined;
    if (!file) return reply.code(404).send({ error: 'Fichero no encontrado' });

    const outDir = join(DATA_DIR, 'subtitles', String(fileId));
    mkdirSync(outDir, { recursive: true });

    const cleanRel = (release || 'subtitle').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50);
    const langSuffix = language === 'en' ? 'en' : 'es';
    const forcedSuffix = forced ? '.forced' : '';
    const fileName = `${cleanRel}.${langSuffix}${forcedSuffix}.srt`;
    const outFile = join(outDir, fileName);

    const args = [
      SUBTITLES_API,
      'descargar',
      '--video', file.path,
      '--provider', provider,
      '--sub-id', String(subId),
      '--out', outFile,
    ];
    const proc = spawn(PYTHON, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

    let salida = '';
    proc.stdout.on('data', (d) => { salida += d.toString('utf8'); });
    proc.stderr.on('data', (d) => console.warn('[subtitles/download]', d.toString('utf8').trim()));

    return await new Promise((resolve) => {
      proc.on('close', (code) => {
        if (code === 0 && existsSync(outFile)) {
          try {
            rescanItem(file.item_id);
          } catch (e) {
            console.error('[subtitles/download] error rescanning:', e);
          }
          const row = db.prepare('SELECT id FROM sub_tracks WHERE file_id = ? AND external = ?').get(fileId, outFile) as { id: number } | undefined;
          resolve({ ok: true, trackId: row ? `external-${row.id}` : null, path: outFile, fileName });
        } else {
          resolve({ ok: false, error: 'No se pudo descargar el subtítulo' });
        }
      });
      proc.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
  });
}
