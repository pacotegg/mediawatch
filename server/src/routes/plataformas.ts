import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  PLATAFORMAS,
  catalogo,
  caratula,
  dondeVer,
  guardarMisPlataformas,
  misPlataformas,
  enlaceDirecto,
  tmdbDeItem,
  jobPlataformas,
  pararPlataformas,
  refrescarPlataformas,
  resumenPlataformas,
} from '../media/plataformas.ts';
import { requireUser } from './auth.ts';

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function servirImagen(reply: FastifyReply, path: string) {
  const stat = statSync(path);
  return reply
    .header('Content-Type', MIME[extname(path).toLowerCase()] ?? 'image/jpeg')
    .header('Content-Length', stat.size)
    .header('Cache-Control', 'public, max-age=2592000')
    .send(createReadStream(path));
}

/** Órdenes que ofrece la interfaz; cerrado a propósito para no pasarle a TMDb lo que llegue. */
const ORDENES: Record<string, string> = {
  popular: 'popularity.desc',
  nuevo: 'primary_release_date.desc',
  nota: 'vote_average.desc',
};

export default async function plataformaRoutes(app: FastifyInstance) {
  /**
   * El catálogo completo de plataformas posibles (con `mia`: si este perfil la marcó) y,
   * en `configurado`, si el perfil ya eligió alguna vez. Para el resumen del refresco
   * (`porPlataforma`) siguen todas.
   */
  app.get('/api/plataformas', async (req) => {
    const mias = misPlataformas(requireUser(req).id);
    return {
      plataformas: PLATAFORMAS.map((p) => ({ ...p, mia: !!mias?.includes(p.clave) })),
      configurado: mias !== null,
      ...resumenPlataformas(),
      job: jobPlataformas,
    };
  });

  /** Lo que el perfil tiene marcado: «conectar» una plataforma es marcarla aquí. */
  app.get('/api/mis-plataformas', async (req) => ({ claves: misPlataformas(requireUser(req).id) ?? [] }));
  const guardarMias = async (req: FastifyRequest, reply: FastifyReply) => {
    const { claves } = (req.body ?? {}) as { claves?: unknown };
    if (!Array.isArray(claves) || claves.some((k) => typeof k !== 'string')) {
      return reply.code(400).send({ error: 'Falta la lista de claves' });
    }
    return { claves: guardarMisPlataformas(requireUser(req).id, claves as string[]) };
  };
  app.put('/api/mis-plataformas', guardarMias);
  app.post('/api/mis-plataformas', guardarMias);

  /** Dónde ver un título de la biblioteca, para la insignia de la ficha: solo las plataformas de este perfil. */
  app.get('/api/items/:id/plataformas', async (req) => dondeVer(Number((req.params as { id: string }).id), requireUser(req).id));

  app.get('/api/plataformas/:clave/catalogo', async (req, reply) => {
    const { clave } = req.params as { clave: string };
    const q = req.query as { kind?: string; orden?: string; pagina?: string };
    const kind = q.kind === 'show' ? 'show' : 'movie';
    // Las series no tienen `primary_release_date`: TMDb las ordena por `first_air_date`.
    const orden = ORDENES[q.orden ?? 'popular'] ?? ORDENES.popular;
    const ordenReal = kind === 'show' && orden.startsWith('primary_release_date') ? 'first_air_date.desc' : orden;
    try {
      return await catalogo(clave, kind, ordenReal, Number(q.pagina ?? 1) || 1);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  /*
   * Carátula de TMDb servida desde aquí: la app de Tizen tiene `img-src` sin
   * `https:` y bloquearía image.tmdb.org en silencio. Ver plataformas.ts.
   */
  app.get('/api/plataformas/caratula/:tipo/:ruta', async (req, reply) => {
    const { tipo, ruta } = req.params as { tipo: string; ruta: string };
    try {
      return servirImagen(reply, await caratula(tipo, ruta));
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  /*
   * Enlace directo al título dentro de la plataforma (Watchmode). Dos rutas para
   * el mismo dato: por título de la biblioteca (la ficha) y por id de TMDb (el
   * catálogo, donde el título quizá no está en casa). Devuelve `url: null` si no
   * hay enlace; el cliente entonces se limita a abrir la app.
   */
  app.get('/api/items/:id/plataformas/:clave/enlace', async (req, reply) => {
    const { id, clave } = req.params as { id: string; clave: string };
    const t = tmdbDeItem(Number(id));
    if (!t) return { url: null, tipo: null, respaldo: '' };
    try {
      return await enlaceDirecto(t.kind, t.tmdbId, clave);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.get('/api/plataformas/:clave/enlace', async (req, reply) => {
    const { clave } = req.params as { clave: string };
    const q = req.query as { kind?: string; tmdbId?: string };
    const tmdbId = Number(q.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) return reply.code(400).send({ error: 'Falta tmdbId' });
    try {
      return await enlaceDirecto(q.kind === 'show' ? 'show' : 'movie', tmdbId, clave);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post('/api/plataformas/refrescar', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    const { dias } = (req.body ?? {}) as { dias?: number };
    try {
      return { started: true, total: refrescarPlataformas(Number.isFinite(dias) ? Number(dias) : 7) };
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.post('/api/plataformas/parar', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    return { parando: pararPlataformas() };
  });
}
