import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { db, normalize } from '../db.ts';
import { requireUser } from './auth.ts';
import { detallesDe, search, tmdbGet, TmdbError, type Proposal } from '../scanner/tmdb.ts';
import { interpretarBusqueda } from '../scanner/buscar-id.ts';

/*
 * Pantalla «Scraper» (solo administrador): lista de titulos con lo que les falta y emparejado por
 * texto, id de TMDb, id de IMDb o direccion pegada. Aqui solo se LEE la biblioteca; aplicar una
 * propuesta sigue pasando por /api/enrich/apply, que escribe en data/, nunca en la biblioteca.
 */
const FILTROS: Record<string, string> = {
  todos: '1',
  huecos: '(i.poster IS NULL OR i.fanart IS NULL OR i.clearlogo IS NULL OR i.plot IS NULL OR i.plot = \'\' OR i.rating IS NULL)',
  sinid: "(i.tmdb_id IS NULL OR i.tmdb_id = '')",
  sinsinopsis: "(i.plot IS NULL OR i.plot = '')",
  sinedad: "(i.mpaa IS NULL OR i.mpaa = '')",
  sinlogo: 'i.clearlogo IS NULL',
};

const PAGINA = 60;

export default async function scraperRoutes(app: FastifyInstance) {
  app.get('/api/scraper/titulos', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const q = req.query as { filtro?: string; q?: string; kind?: string; offset?: string };
    const filtro = FILTROS[q.filtro ?? 'todos'] ?? FILTROS.todos;
    const donde = [filtro];
    const params: (string | number)[] = [];
    if (q.kind === 'movie' || q.kind === 'show') { donde.push('i.kind = ?'); params.push(q.kind); }
    const texto = normalize(q.q ?? '');
    if (texto) { donde.push('i.search_title LIKE ?'); params.push(`%${texto}%`); }
    const offset = Math.max(0, Math.trunc(Number(q.offset)) || 0);

    const total = (db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${donde.join(' AND ')}`).get(...params) as { n: number }).n;
    const items = db
      .prepare(`SELECT i.id, i.title, i.year, i.kind, l.name AS biblioteca, i.tmdb_id, i.imdb_id, i.meta_origen AS origen,
                       i.poster IS NOT NULL AS poster, i.fanart IS NOT NULL AS fanart, i.clearlogo IS NOT NULL AS logo,
                       (i.plot IS NOT NULL AND i.plot <> '') AS sinopsis, (i.mpaa IS NOT NULL AND i.mpaa <> '') AS edad
                FROM items i JOIN libraries l ON l.id = i.library_id
                WHERE ${donde.join(' AND ')}
                ORDER BY COALESCE(i.sort_title, i.title) COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(...params, PAGINA, offset);

    // Los contadores de las pastillas no dependen del filtro elegido, solo de la busqueda y el tipo.
    const base = donde.slice(1);
    const cuenta: Record<string, number> = {};
    for (const [nombre, sql] of Object.entries(FILTROS)) {
      cuenta[nombre] = (db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${[sql, ...base].join(' AND ')}`).get(...params) as { n: number }).n;
    }
    return { total, offset, pagina: PAGINA, items, cuenta };
  });

  app.get('/api/scraper/titulo/:id', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const fila = db
      .prepare(`SELECT i.id, i.title, i.original_title, i.year, i.kind, l.name AS biblioteca, i.tmdb_id, i.imdb_id, i.plot, i.tagline,
                       i.rating, i.mpaa, i.runtime, i.collection, i.studio, i.country, i.premiered, i.meta_origen AS origen,
                       i.arte_fijado, i.arte_actualizado,
                       i.poster IS NOT NULL AS poster, i.fanart IS NOT NULL AS fanart, i.clearlogo IS NOT NULL AS logo
                FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?`)
      .get(Number((req.params as { id: string }).id));
    if (!fila) return reply.code(404).send({ error: 'Título no encontrado' });
    const id = (fila as { id: number }).id;
    const reparto = (db.prepare('SELECT COUNT(*) AS n FROM item_people WHERE item_id = ?').get(id) as { n: number }).n;
    return { ...fila, reparto };
  });

  /** Titulo, id de TMDb, id de IMDb o direccion pegada -> propuestas de TMDb. */
  app.post('/api/scraper/resolver', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    if (!config.tmdbApiKey) return reply.code(400).send({ error: 'Falta la clave de API de TMDb (Ajustes → Metadatos)' });
    const { entrada, kind, year } = (req.body ?? {}) as { entrada?: string; kind?: 'movie' | 'show'; year?: number | null };
    if (!entrada?.trim() || (kind !== 'movie' && kind !== 'show')) return reply.code(400).send({ error: 'Escribe un título, un id o una dirección' });
    const b = interpretarBusqueda(entrada);
    try {
      let propuestas: Proposal[];
      if (b.tipo === 'texto') {
        propuestas = await search(b.texto, kind, year);
      } else if (b.tipo === 'tmdb') {
        propuestas = [await detallesDe(b.id, b.kind ?? kind)];
      } else {
        const r = await tmdbGet<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(`/find/${b.id}`, { external_source: 'imdb_id' });
        const hit = (kind === 'movie' ? r.movie_results : r.tv_results)?.[0];
        if (!hit) return { propuestas: [], aviso: `TMDb no conoce ${b.id} como ${kind === 'movie' ? 'película' : 'serie'}` };
        propuestas = [await detallesDe(hit.id, kind)];
      }
      return { propuestas };
    } catch (err) {
      if (err instanceof TmdbError && /No encontrado/.test(err.message)) return { propuestas: [], aviso: 'TMDb no tiene ese id' };
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
