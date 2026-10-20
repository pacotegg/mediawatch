import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { db, normalize } from '../db.ts';
import { requireUser } from './auth.ts';
import { detallesDe, search, tmdbGet, TmdbError, type Proposal } from '../scanner/tmdb.ts';
import { interpretarBusqueda } from '../scanner/buscar-id.ts';
import { aplicarArteCarpeta, ArteCarpetaError, planArteCarpeta } from '../scanner/arte-carpeta.ts';
import { basename, dirname, relative } from 'node:path';
import { aplicarOrganizar, OrganizarError, planOrganizar } from '../scanner/organizar.ts';
import { carpetaDePelicula, carpetaDeSerie } from '../scanner/nombres-tmm.ts';
import { deshacerUltima, HistorialError, ultimaInstantanea } from '../scanner/historial.ts';

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
  sinorganizar: '1', // se resuelve aparte: depende del nombre de la carpeta, no de una columna
};

const PAGINA = 60;

/** ¿La carpeta del titulo ya se llama como la dejaria tMM? Solo con datos de la base: no toca el disco. */
function carpetaOrganizada(f: { kind: string; title: string; year: number | null; folder: string }): boolean {
  if (/\.(mkv|mp4|avi|m4v|mov|wmv|mpg|mpeg|ts|webm)$/i.test(f.folder)) return false; // video suelto en la raiz
  const real = basename(f.folder);
  if (f.kind === 'show') return real === carpetaDeSerie(f.title, f.year);
  if (real === carpetaDePelicula({ titulo: f.title, anio: f.year })) return true;
  // Con edicion: «Titulo - Extended Edition (1986)»
  const m = real.match(/^.*? - (.+?) \(\d{4}\)$/);
  return Boolean(m && real === carpetaDePelicula({ titulo: f.title, anio: f.year, edicion: m[1] }));
}

/** Los contadores de las pastillas no dependen del filtro elegido, solo de la busqueda y el tipo. */
function contadores(base: string[], params: (string | number)[]): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const [nombre, sql] of Object.entries(FILTROS)) {
    cuenta[nombre] = (db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${[sql, ...base].join(' AND ')}`).get(...params) as { n: number }).n;
  }
  cuenta.sinorganizar = (db.prepare(`SELECT i.kind, i.title, i.year, i.folder FROM items i WHERE ${['1', ...base].join(' AND ')}`).all(...params) as { kind: string; title: string; year: number | null; folder: string }[]).filter((f) => !carpetaOrganizada(f)).length;
  return cuenta;
}

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

    const base = donde.slice(1);
    if (q.filtro === 'sinorganizar') {
      const todas = db.prepare(`SELECT i.id, i.title, i.year, i.kind, i.folder, l.name AS biblioteca, i.tmdb_id, i.imdb_id, i.meta_origen AS origen,
                       i.poster IS NOT NULL AS poster, i.fanart IS NOT NULL AS fanart, i.clearlogo IS NOT NULL AS logo,
                       (i.plot IS NOT NULL AND i.plot <> '') AS sinopsis, (i.mpaa IS NOT NULL AND i.mpaa <> '') AS edad
                FROM items i JOIN libraries l ON l.id = i.library_id WHERE ${donde.slice(1).concat('1').join(' AND ')}
                ORDER BY COALESCE(i.sort_title, i.title) COLLATE NOCASE`).all(...params) as (Record<string, unknown> & { kind: string; title: string; year: number | null; folder: string })[];
      const sin = todas.filter((f) => !carpetaOrganizada(f));
      return { total: sin.length, offset, pagina: PAGINA, items: sin.slice(offset, offset + PAGINA).map(({ folder: _f, ...resto }) => resto), cuenta: contadores(base, params) };
    }
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${donde.join(' AND ')}`).get(...params) as { n: number }).n;
    const items = db
      .prepare(`SELECT i.id, i.title, i.year, i.kind, l.name AS biblioteca, i.tmdb_id, i.imdb_id, i.meta_origen AS origen,
                       i.poster IS NOT NULL AS poster, i.fanart IS NOT NULL AS fanart, i.clearlogo IS NOT NULL AS logo,
                       (i.plot IS NOT NULL AND i.plot <> '') AS sinopsis, (i.mpaa IS NOT NULL AND i.mpaa <> '') AS edad
                FROM items i JOIN libraries l ON l.id = i.library_id
                WHERE ${donde.join(' AND ')}
                ORDER BY COALESCE(i.sort_title, i.title) COLLATE NOCASE LIMIT ? OFFSET ?`)
      .all(...params, PAGINA, offset);

    const cuenta = contadores(base, params);
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

  /*
   * Copiar el arte elegido a la carpeta del titulo (Plex con activos locales, Jellyfin, Kodi). GET = plan, sin tocar nada;
   * POST = aplicar ese plan. Es la UNICA ruta de esta pantalla que escribe en la biblioteca, y pide confirmacion expresa.
   */
  app.get('/api/scraper/arte-carpeta/:id', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    try {
      const plan = planArteCarpeta(Number((req.params as { id: string }).id));
      return { carpeta: plan[0] ? dirname(plan[0].hacia) : null, pasos: plan.map((p) => ({ papel: p.papel, hacia: basename(p.hacia), retira: p.retira ? basename(p.retira) : null })) };
    } catch (err) {
      return reply.code(err instanceof ArteCarpetaError ? 400 : 500).send({ error: (err as Error).message });
    }
  });

  app.post('/api/scraper/arte-carpeta/:id', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    if ((req.body as { confirmar?: boolean } | null)?.confirmar !== true) return reply.code(400).send({ error: 'Falta la confirmación expresa' });
    try {
      const r = aplicarArteCarpeta(Number((req.params as { id: string }).id));
      return { escritos: r.escritos.map((f) => basename(f)), retirados: r.retirados.length };
    } catch (err) {
      return reply.code(err instanceof ArteCarpetaError ? 400 : 500).send({ error: (err as Error).message });
    }
  });

  /*
   * Organizar: dejar carpeta y ficheros con los nombres de tMM. GET = plan, sin tocar nada; POST = aplicar ese plan (confirmacion expresa).
   * Es escritura en la biblioteca: renombra, no borra.
   */
  const ver = (id: number, ruta: string) => {
    const raiz = (db.prepare('SELECT l.path FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?').get(id) as { path: string } | undefined)?.path ?? '';
    return relative(raiz, ruta);
  };
  app.get('/api/scraper/organizar/:id', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const id = Number((req.params as { id: string }).id);
    const edicion = (req.query as { edicion?: string }).edicion?.trim() || null;
    try {
      const plan = planOrganizar(id, { edicion });
      return { pasos: plan.pasos.map((p) => ({ tipo: p.tipo, desde: ver(id, p.desde), final: ver(id, p.final) })) };
    } catch (err) {
      return reply.code(err instanceof OrganizarError ? 400 : 500).send({ error: (err as Error).message });
    }
  });

  app.post('/api/scraper/organizar/:id', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const body = (req.body ?? {}) as { confirmar?: boolean; edicion?: string };
    if (body.confirmar !== true) return reply.code(400).send({ error: 'Falta la confirmación expresa' });
    try {
      return aplicarOrganizar(Number((req.params as { id: string }).id), { edicion: body.edicion?.trim() || null });
    } catch (err) {
      return reply.code(err instanceof OrganizarError ? 400 : 500).send({ error: (err as Error).message });
    }
  });

  /** Lo ultimo que se puede deshacer en un titulo (si hay algo) y el boton que lo deshace. */
  app.get('/api/scraper/historial/:id', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    return { ultima: ultimaInstantanea(Number((req.params as { id: string }).id)) };
  });

  app.post('/api/scraper/deshacer/:id', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    try {
      return deshacerUltima(Number((req.params as { id: string }).id));
    } catch (err) {
      return reply.code(err instanceof HistorialError ? 400 : 500).send({ error: (err as Error).message });
    }
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
