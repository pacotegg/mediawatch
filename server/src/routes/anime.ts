/**
 * Anime y numeración de episodios.
 *
 * Todo lo que escribe va detrás de una previsualización: se pide el plan, se
 * mira el antes y el después, y solo entonces se aplica. Nada de arreglar 243
 * episodios a ciegas.
 */
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth.ts';
import { actividad, biblioteca, salud } from '../media/estadisticas.ts';
import { analizar, copiasRepetidas } from '../media/calidad.ts';
import { aplicarAnime, buscarAnime, candidatoAnime, AnimeError } from '../scanner/anime.ts';
import {
  aplicar,
  estado,
  planDeshacer,
  planDesdeTmdb,
  planDesplazamiento,
  planManual,
  seriesSospechosas,
  type PlanNumeracion,
} from '../scanner/numeracion.ts';

export default async function animeRoutes(app: FastifyInstance) {
  const soloAdmin = (req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const user = requireUser(req as never);
    if (!user.is_admin) {
      reply.code(403).send({ error: 'No autorizado' });
      return null;
    }
    return user;
  };

  // --- Identificación del anime --------------------------------------------

  app.get('/api/anime/item/:id', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    try {
      return await candidatoAnime(Number((req.params as { id: string }).id));
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/anime/search', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const { query, year } = req.body as { query?: string; year?: number };
    if (!query?.trim()) return reply.code(400).send({ error: 'Escribe algo que buscar' });
    try {
      return { results: await buscarAnime(query.trim(), year ?? null) };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/anime/apply', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const body = req.body as Parameters<typeof aplicarAnime>[0];
    if (!body?.itemId || !body?.animeId) return reply.code(400).send({ error: 'Faltan datos de la propuesta' });
    try {
      return await aplicarAnime(body);
    } catch (err) {
      return reply.code(err instanceof AnimeError ? 502 : 400).send({ error: (err as Error).message });
    }
  });

  // --- Estadísticas del servidor -------------------------------------------

  app.get('/api/estadisticas', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const dias = Math.min(Math.max(Number((req.query as { dias?: string }).dias ?? 30), 1), 365);
    return { biblioteca: biblioteca(), actividad: actividad(dias), salud: salud() };
  });

  app.get('/api/calidad', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    return { ...analizar(), repetidas: copiasRepetidas() };
  });

  // --- Numeración de episodios ---------------------------------------------

  app.get('/api/numeracion/sospechosas', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    return { series: seriesSospechosas() };
  });

  app.get('/api/numeracion/:id', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    try {
      return estado(Number((req.params as { id: string }).id));
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  /** Devuelve el plan sin tocar nada; el cuerpo decide de dónde sale el reparto. */
  app.post('/api/numeracion/:id/plan', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const showId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as { modo?: string; reparto?: number[]; temporada?: number; desde?: number; delta?: number };

    try {
      let plan: PlanNumeracion;
      switch (body.modo) {
        case 'manual':
          plan = planManual(showId, body.reparto ?? []);
          break;
        case 'desplazar':
          plan = planDesplazamiento(showId, Number(body.temporada ?? 1), Number(body.desde ?? 1), Number(body.delta ?? 0));
          break;
        case 'deshacer':
          plan = planDeshacer(showId);
          break;
        default:
          plan = await planDesdeTmdb(showId);
      }
      return plan;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Aplica un plan que el cliente acaba de ver. */
  app.post('/api/numeracion/:id/aplicar', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const showId = Number((req.params as { id: string }).id);
    const plan = req.body as PlanNumeracion;
    if (!plan?.cambios?.length) return reply.code(400).send({ error: 'El plan no trae cambios' });
    if (plan.showId !== showId) return reply.code(400).send({ error: 'El plan no es de esta serie' });

    try {
      const resultado = aplicar(plan);
      return { ...resultado, estado: estado(showId) };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });
}
