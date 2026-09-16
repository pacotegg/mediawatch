import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { requireUser } from './auth.ts';
import { applyProposal, buildCandidates, candidateForItem, imagenesDe, missingCount, ponerArte, search, soltarArte, TmdbError, type Candidate, type Papel } from '../scanner/tmdb.ts';

type Job = {
  running: boolean;
  done: number;
  total: number;
  candidates: Candidate[];
  error: string | null;
  finishedAt: string | null;
};

const job: Job = { running: false, done: 0, total: 0, candidates: [], error: null, finishedAt: null };

export default async function enrichRoutes(app: FastifyInstance) {
  app.get('/api/enrich/status', async (req) => {
    requireUser(req);
    return {
      configured: Boolean(config.tmdbApiKey),
      missing: missingCount(),
      job: { running: job.running, done: job.done, total: job.total, error: job.error, finishedAt: job.finishedAt, found: job.candidates.length },
    };
  });

  app.post('/api/enrich/scan', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede buscar metadatos' });
    if (!config.tmdbApiKey) return reply.code(400).send({ error: 'Configura primero la clave de API de TMDb' });
    if (job.running) return reply.code(409).send({ error: 'Ya hay una búsqueda en curso' });

    const limit = Math.min(Number((req.body as { limit?: number })?.limit ?? 40), 200);
    Object.assign(job, { running: true, done: 0, total: limit, candidates: [], error: null, finishedAt: null });

    queueMicrotask(async () => {
      try {
        job.candidates = await buildCandidates(limit, (done, total) => {
          job.done = done;
          job.total = total;
        });
      } catch (err) {
        job.error = err instanceof TmdbError ? err.message : String(err);
      } finally {
        job.running = false;
        job.finishedAt = new Date().toISOString();
      }
    });

    return { started: true, limit };
  });

  app.get('/api/enrich/candidates', async (req) => {
    requireUser(req);
    return { running: job.running, done: job.done, total: job.total, error: job.error, candidates: job.candidates };
  });

  app.get('/api/enrich/item/:id', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });
    if (!config.tmdbApiKey) return reply.code(400).send({ error: 'Configura primero la clave de API de TMDb' });
    try {
      return await candidateForItem(Number((req.params as { id: string }).id));
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/enrich/search', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const { query, kind, year } = req.body as { query: string; kind: 'movie' | 'show'; year?: number };
    if (!query?.trim()) return reply.code(400).send({ error: 'Escribe algo que buscar' });
    try {
      return { results: await search(query.trim(), kind ?? 'movie', year) };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/enrich/apply', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const body = req.body as Parameters<typeof applyProposal>[0];
    if (!body?.itemId || !body?.tmdbId) return reply.code(400).send({ error: 'Faltan datos de la propuesta' });

    try {
      const result = await applyProposal(body);
      job.candidates = job.candidates.filter((c) => c.itemId !== body.itemId);
      return result;
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /** Todas las imagenes que TMDb tiene de ese titulo, por papeles. */
  app.get('/api/enrich/imagenes/:kind/:tmdbId', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });
    if (!config.tmdbApiKey) return reply.code(400).send({ error: 'Configura primero la clave de API de TMDb' });
    const { kind, tmdbId } = req.params as { kind: string; tmdbId: string };
    try {
      return await imagenesDe(Number(tmdbId), kind === 'show' ? 'show' : 'movie');
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /** Poner una imagen concreta, o soltarla para volver a la de la carpeta. */
  app.post('/api/enrich/arte', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const { itemId, papel, url } = req.body as { itemId?: number; papel?: Papel; url?: string | null };
    if (!itemId || !papel || !['poster', 'fanart', 'clearlogo', 'landscape', 'discart'].includes(papel)) {
      return reply.code(400).send({ error: 'Falta el título o el tipo de imagen' });
    }
    try {
      return url ? await ponerArte(itemId, papel, url) : soltarArte(itemId, papel);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/enrich/dismiss', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    const { itemId } = req.body as { itemId: number };
    job.candidates = job.candidates.filter((c) => c.itemId !== itemId);
    return { ok: true };
  });
}
