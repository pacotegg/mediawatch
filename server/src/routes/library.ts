import { config } from '../config.ts';
import { avanzar } from '../media/historial.ts';
import { createReadStream, existsSync, rmSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db, normalize } from '../db.ts';
import { thumbnail } from '../media/images.ts';
import { clearDialogue, dialogueStats, ftsQuery, indexarEnSegundoPlano, searchDialogue } from '../scanner/dialogue.ts';
import { detallePersona } from '../scanner/people.ts';
import { currentUser, deFuera, requireUser, sesionDe } from './auth.ts';
import { marcarActividad } from '../media/ocupado.ts';
import { loteOmdb, pararOmdb, rellenarConOmdb } from '../media/omdb.ts';

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function sendImage(reply: FastifyReply, path: string) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return reply.code(404).send({ error: 'Imagen no disponible' });
  }
  return reply
    .header('Content-Type', MIME[extname(path).toLowerCase()] ?? 'image/jpeg')
    .header('Content-Length', stat.size)
    .header('Cache-Control', 'public, max-age=2592000')
    .header('ETag', `"${stat.mtimeMs}-${stat.size}"`)
    .send(createReadStream(path));
}

async function serveArt(reply: FastifyReply, source: string | null, width: number | undefined) {
  if (!source) return reply.code(404).send({ error: 'Sin imagen' });
  if (!width) return sendImage(reply, source);
  try {
    return sendImage(reply, await thumbnail(source, width));
  } catch {
    return sendImage(reply, source);
  }
}

const SORTS: Record<string, string> = {
  title: 'COALESCE(i.sort_title, i.title) COLLATE NOCASE ASC',
  added: 'i.added_at DESC',
  year: 'i.year DESC, i.title ASC',
  rating: 'i.rating DESC NULLS LAST',
  random: 'RANDOM()',
};

const ITEM_FIELDS = `
  i.id, i.kind, i.title, i.year, i.rating, i.runtime, i.mpaa, i.tagline,
  i.poster IS NOT NULL AS has_poster, i.fanart IS NOT NULL AS has_fanart,
  i.clearlogo IS NOT NULL AS has_logo, i.landscape IS NOT NULL AS has_landscape,
  i.arte_actualizado, i.library_id, l.name AS library_name`;

function withProgress(rows: any[], userId: number | null) {
  if (!userId || rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const prog = db
    .prepare(`SELECT item_id, MAX(updated_at) AS updated_at, position, duration, watched
              FROM progress WHERE user_id = ? AND item_id IN (${placeholders}) GROUP BY item_id`)
    .all(userId, ...ids) as any[];
  const map = new Map(prog.map((p) => [p.item_id, p]));
  return rows.map((r) => {
    const p = map.get(r.id);
    return p ? { ...r, position: p.position, progressDuration: p.duration, watched: p.watched } : r;
  });
}

function nextEpisode(showId: number, userId: number | null) {
  if (userId) {
    const inProgress = db
      .prepare(`SELECT e.id, e.season, e.episode, e.title, p.position, p.duration
                FROM progress p JOIN episodes e ON e.id = p.episode_id
                WHERE p.user_id = ? AND p.item_id = ? AND p.watched = 0 AND p.position > 30
                ORDER BY p.updated_at DESC LIMIT 1`)
      .get(userId, showId) as any;
    if (inProgress) return inProgress;

    const lastWatched = db
      .prepare(`SELECT e.season, e.episode FROM progress p JOIN episodes e ON e.id = p.episode_id
                WHERE p.user_id = ? AND p.item_id = ? AND p.watched = 1
                ORDER BY e.season DESC, e.episode DESC LIMIT 1`)
      .get(userId, showId) as { season: number; episode: number } | undefined;
    if (lastWatched) {
      const next = db
        .prepare(`SELECT id, season, episode, title FROM episodes
                  WHERE show_id = ? AND (season > ? OR (season = ? AND episode > ?))
                  ORDER BY season, episode LIMIT 1`)
        .get(showId, lastWatched.season, lastWatched.season, lastWatched.episode) as any;
      if (next) return next;
    }
  }
  return db.prepare('SELECT id, season, episode, title FROM episodes WHERE show_id = ? ORDER BY season, episode LIMIT 1').get(showId);
}

export default async function libraryRoutes(app: FastifyInstance) {
  app.get('/api/libraries', async () => {
    return db
      .prepare(`SELECT l.id, l.name, l.kind, COUNT(i.id) AS count
                FROM libraries l LEFT JOIN items i ON i.library_id = l.id
                GROUP BY l.id ORDER BY l.id`)
      .all();
  });

  app.get('/api/genres', async (req) => {
    const { library } = req.query as { library?: string };
    return db
      .prepare(`SELECT g.id, g.name, COUNT(*) AS count
                FROM item_genres ig JOIN genres g ON g.id = ig.genre_id JOIN items i ON i.id = ig.item_id
                WHERE (? IS NULL OR i.library_id = ?)
                GROUP BY g.id HAVING count > 2 ORDER BY count DESC`)
      .all(library ?? null, library ?? null);
  });

  app.get('/api/items', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const user = currentUser(req);
    const limit = Math.min(Number(q.limit ?? 60), 500);
    const offset = Number(q.offset ?? 0);
    const order = SORTS[q.sort ?? 'title'] ?? SORTS.title;

    const where: string[] = [];
    const params: any[] = [];
    if (q.library) { where.push('i.library_id = ?'); params.push(Number(q.library)); }
    if (q.kind) { where.push('i.kind = ?'); params.push(q.kind); }
    if (q.genre) { where.push('EXISTS (SELECT 1 FROM item_genres ig JOIN genres g ON g.id = ig.genre_id WHERE ig.item_id = i.id AND g.name = ?)'); params.push(q.genre); }
    if (q.year) { where.push('i.year = ?'); params.push(Number(q.year)); }
    // Mismo motivo que en `/api/search`: la columna está sin tildes, el texto
    // que llega no tiene por qué estarlo.
    if (q.q) { where.push('(i.search_title LIKE ? OR i.original_title LIKE ?)'); params.push(`%${normalize(q.q)}%`, `%${q.q}%`); }
    if (q.decade) { const d = Number(q.decade); where.push('i.year BETWEEN ? AND ?'); params.push(d, d + 9); }
    // Solo lo que este perfil no ha terminado: el filtro que más se echa de
    // menos en una biblioteca de mil y pico títulos.
    if (q.unwatched === '1' && user) {
      where.push('NOT EXISTS (SELECT 1 FROM progress p WHERE p.user_id = ? AND p.item_id = i.id AND p.watched = 1)');
      params.push(user.id);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(`SELECT ${ITEM_FIELDS} FROM items i JOIN libraries l ON l.id = i.library_id ${clause}
                ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM items i ${clause}`).get(...params) as { n: number }).n;
    return { total, items: withProgress(rows, user?.id ?? null) };
  });

  app.get('/api/items/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const user = currentUser(req);
    const item = db
      .prepare(`SELECT i.*, l.name AS library_name, l.kind AS library_kind,
                  i.poster IS NOT NULL AS has_poster, i.fanart IS NOT NULL AS has_fanart,
                  i.clearlogo IS NOT NULL AS has_logo, i.landscape IS NOT NULL AS has_landscape,
                  i.discart IS NOT NULL AS has_discart
                FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?`)
      .get(id) as any;
    if (!item) return reply.code(404).send({ error: 'No encontrado' });

    for (const k of ['poster', 'fanart', 'clearlogo', 'landscape', 'folder', 'search_title']) delete item[k];

    // Sin esto la ficha no sabe si el título ya está en favoritos, así que el
    // botón no puede ni marcarse ni servir para quitarlo.
    item.favorite = user
      ? ((db.prepare('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ? AND item_id = ?').get(user.id, id) as any).n > 0 ? 1 : 0)
      : 0;

    /*
     * Las valoraciones, cada una con su escala y en un orden fijo: primero las
     * que el usuario mira (IMDb, Rotten Tomatoes, TheMovieDb) y despues el
     * resto. Los nombres de los `.nfo` son de Kodi —`tomatometerallcritics`— y
     * se traducen aqui, no en el cliente, para que la tele y la web digan lo
     * mismo.
     */
    const NOMBRES: Record<string, { etiqueta: string; orden: number }> = {
      imdb: { etiqueta: 'IMDb', orden: 1 },
      tomatometerallcritics: { etiqueta: 'Rotten Tomatoes', orden: 2 },
      tomatometeravgcritics: { etiqueta: 'RT nota media', orden: 5 },
      themoviedb: { etiqueta: 'TMDb', orden: 3 },
      tmdb: { etiqueta: 'TMDb', orden: 3 },
      tvdb: { etiqueta: 'TVDB', orden: 3 },
      thetvdb: { etiqueta: 'TVDB', orden: 3 },
      metacritic: { etiqueta: 'Metacritic', orden: 4 },
      trakt: { etiqueta: 'Trakt', orden: 6 },
    };
    /*
     * Lo que se ensena: IMDb, Rotten Tomatoes y TheMovieDb en peliculas; en
     * series, TVDB en lugar de TheMovieDb — pero TVDB solo aparece en 1 de los
     * 101 `tvshow.nfo` de la biblioteca, asi que si no esta se cae a TheMovieDb
     * antes que dejar el hueco vacio. Metacritic y la nota media de la critica
     * se siguen guardando, simplemente no compiten por el sitio.
     */
    const PARA_PELICULAS = ['imdb', 'tomatometerallcritics', 'themoviedb', 'tmdb'];
    const PARA_SERIES = ['imdb', 'tomatometerallcritics', 'tvdb', 'thetvdb', 'themoviedb', 'tmdb'];
    const visibles = item.kind === 'show' ? PARA_SERIES : PARA_PELICULAS;

    const todas = db
      .prepare('SELECT fuente, valor, maximo, votos FROM item_ratings WHERE item_id = ?')
      .all(id) as { fuente: string; valor: number; maximo: number; votos: number }[];
    const hayTvdb = todas.some((r) => r.fuente === 'tvdb' || r.fuente === 'thetvdb');

    item.ratings = todas
      .filter((r) => NOMBRES[r.fuente] && visibles.indexOf(r.fuente) >= 0)
      .filter((r) => !(item.kind === 'show' && hayTvdb && (r.fuente === 'themoviedb' || r.fuente === 'tmdb')))
      .map((r) => ({
        fuente: r.fuente,
        etiqueta: NOMBRES[r.fuente].etiqueta,
        valor: r.valor,
        maximo: r.maximo,
        votos: r.votos,
        orden: NOMBRES[r.fuente].orden,
      }))
      .sort((a, b) => a.orden - b.orden);

    const genres = db.prepare('SELECT g.name FROM item_genres ig JOIN genres g ON g.id = ig.genre_id WHERE ig.item_id = ? ORDER BY g.name').all(id) as { name: string }[];
    const cast = db
      .prepare(`SELECT p.id, p.name, ip.character, ip.role, p.thumb IS NOT NULL AS has_thumb
                FROM item_people ip JOIN people p ON p.id = ip.person_id
                WHERE ip.item_id = ? ORDER BY ip.role = 'actor' DESC, ip.ord IS NULL, ip.ord LIMIT 40`)
      .all(id) as any[];

    const files = db
      .prepare(`SELECT f.id, f.path, f.size, f.container, f.duration, f.video_codec, f.width, f.height, f.hdr, f.episode_id
                FROM media_files f WHERE f.item_id = ? OR f.episode_id IN (SELECT id FROM episodes WHERE show_id = ?)`)
      .all(id, id) as any[];

    const trackRows = files.length
      ? (db
          .prepare(`SELECT file_id, codec, language, channels FROM audio_tracks WHERE file_id IN (${files.map(() => '?').join(',')})`)
          .all(...files.map((f) => f.id)) as any[])
      : [];
    const subRows = files.length
      ? (db
          .prepare(`SELECT file_id, language, forced, external IS NOT NULL AS is_external FROM sub_tracks WHERE file_id IN (${files.map(() => '?').join(',')})`)
          .all(...files.map((f) => f.id)) as any[])
      : [];

    for (const f of files) {
      f.audio = trackRows.filter((t) => t.file_id === f.id);
      f.subtitles = subRows.filter((s) => s.file_id === f.id);
      f.name = f.path.split(/[\\/]/).pop();
      delete f.path;
    }

    const progress = user
      ? db.prepare('SELECT episode_id, position, duration, watched FROM progress WHERE user_id = ? AND item_id = ?').all(user.id, id)
      : [];

    if (item.kind === 'show') {
      const episodes = db
        .prepare(`SELECT e.id, e.season, e.episode, e.title, e.plot, e.aired, e.runtime, e.rating,
                    e.thumb IS NOT NULL AS has_thumb, f.id AS file_id, f.duration, f.height, f.video_codec
                  FROM episodes e LEFT JOIN media_files f ON f.episode_id = e.id
                  WHERE e.show_id = ? ORDER BY e.season, e.episode`)
        .all(id);
      return { ...item, genres: genres.map((g) => g.name), cast, files, episodes, progress, nextUp: nextEpisode(id, user?.id ?? null) };
    }

    return {
      ...item,
      genres: genres.map((g) => g.name),
      cast,
      files,
      progress,
      collectionItems: item.collection
        ? withProgress(
            db
              .prepare(`SELECT ${ITEM_FIELDS} FROM items i JOIN libraries l ON l.id = i.library_id
                        WHERE i.collection = ? ORDER BY i.year, i.title`)
              .all(item.collection),
            user?.id ?? null,
          )
        : [],
      // Relacionadas por genero: cuantos mas generos comparta, mas arriba; a
      // igualdad, la mejor valorada. Un solo genero en comun dice poco («Drama»
      // lo comparte media biblioteca), asi que se ordena por cuantos.
      similar: db
        .prepare(`SELECT ${ITEM_FIELDS}, COUNT(*) AS en_comun
                    FROM items i JOIN libraries l ON l.id = i.library_id
                    JOIN item_genres a ON a.item_id = i.id
                    JOIN item_genres b ON b.genre_id = a.genre_id AND b.item_id = ?
                   WHERE i.id != ? AND i.kind = (SELECT kind FROM items WHERE id = ?)
                   GROUP BY i.id
                   ORDER BY en_comun DESC, i.rating DESC NULLS LAST LIMIT 20`)
        .all(id, id, id),
    };
  });

  app.get('/api/home', async (req) => {
    const user = currentUser(req);
    const rows: { key: string; title: string; kind: string; items: any[] }[] = [];

    if (user) {
      const continueItems = db
        /*
         * Una fila por título, la más reciente. Sin el `GROUP BY` una serie con
         * tres episodios a medias aparecía tres veces seguidas, con la misma
         * carátula. SQLite garantiza que junto a un `MAX()` las demás columnas
         * salen de esa misma fila, así que la posición que se muestra es la del
         * último episodio que se estaba viendo.
         */
        .prepare(`SELECT ${ITEM_FIELDS}, p.position, p.duration AS progressDuration, p.episode_id,
                         MAX(p.updated_at) AS updated_at
                  FROM progress p JOIN items i ON i.id = p.item_id JOIN libraries l ON l.id = i.library_id
                  WHERE p.user_id = ? AND p.watched = 0 AND p.position > 60
                    AND (p.duration IS NULL OR p.position < p.duration * 0.95)
                  GROUP BY i.id
                  ORDER BY updated_at DESC LIMIT 20`)
        .all(user.id) as any[];
      if (continueItems.length) rows.push({ key: 'continue', title: 'Continuar viendo', kind: 'progress', items: continueItems });
    }

    /*
     * Estrenos primero, y lo que acaba de entrar al servidor después. Son dos
     * cosas distintas y se mezclaban en una sola fila: «Vaiana» se estrenó el
     * 8 de julio y entró aquí el 14 de septiembre, y una peli de los ochenta
     * bajada anoche encabezaba «Añadido recientemente» como si fuera novedad.
     *
     * `premiered` es fiable para esto: lo trae tinyMediaManager en ISO y lo
     * tienen 1.725 de las 1.742 películas (99%), así que ordenar por él no
     * deja fuera casi nada. Solo películas —el estreno de una serie es el de
     * su primer capítulo, de hace veinte años en muchas— y nunca fechas por
     * venir, que las hay en las fichas y encabezarían la fila sin poder verse.
     */
    const estrenos = db
      .prepare(`SELECT ${ITEM_FIELDS} FROM items i JOIN libraries l ON l.id = i.library_id
                WHERE i.kind = 'movie' AND i.premiered IS NOT NULL AND i.premiered != ''
                  AND i.premiered <= date('now')
                ORDER BY i.premiered DESC LIMIT 24`)
      .all();
    if (estrenos.length) {
      rows.push({ key: 'estrenos', title: 'Estrenadas recientemente', kind: 'poster', items: withProgress(estrenos, user?.id ?? null) });
    }

    const recent = db
      .prepare(`SELECT ${ITEM_FIELDS} FROM items i JOIN libraries l ON l.id = i.library_id
                WHERE i.added_at IS NOT NULL ORDER BY i.added_at DESC LIMIT 24`)
      .all();
    rows.push({ key: 'recent', title: 'Añadido recientemente', kind: 'poster', items: withProgress(recent, user?.id ?? null) });

    for (const lib of db.prepare('SELECT id, name, kind FROM libraries ORDER BY id').all() as any[]) {
      const items = db
        .prepare(`SELECT ${ITEM_FIELDS} FROM items i JOIN libraries l ON l.id = i.library_id
                  WHERE i.library_id = ? ORDER BY RANDOM() LIMIT 20`)
        .all(lib.id);
      if (items.length) rows.push({ key: `lib-${lib.id}`, title: lib.name, kind: 'poster', items: withProgress(items, user?.id ?? null) });
    }

    const hero = db
      .prepare(`SELECT ${ITEM_FIELDS}, i.plot FROM items i JOIN libraries l ON l.id = i.library_id
                WHERE i.fanart IS NOT NULL AND i.clearlogo IS NOT NULL AND i.rating >= 7.4
                ORDER BY RANDOM() LIMIT 6`)
      .all();

    return { hero, rows };
  });

  app.get('/api/collections', async (req) => {
    const user = currentUser(req);
    const rows = db
      .prepare(`SELECT i.collection AS name, COUNT(*) AS count, MIN(i.year) AS first_year, MAX(i.year) AS last_year,
                  (SELECT id FROM items WHERE collection = i.collection AND poster IS NOT NULL ORDER BY year LIMIT 1) AS poster_id,
                  (SELECT id FROM items WHERE collection = i.collection AND fanart IS NOT NULL ORDER BY rating DESC LIMIT 1) AS fanart_id
                FROM items i
                WHERE i.collection IS NOT NULL AND i.collection != ''
                GROUP BY i.collection HAVING count > 1
                ORDER BY count DESC, name`)
      .all() as any[];

    if (user) {
      const watched = db
        .prepare(`SELECT i.collection AS name, COUNT(*) AS seen
                  FROM progress p JOIN items i ON i.id = p.item_id
                  WHERE p.user_id = ? AND p.watched = 1 AND i.collection IS NOT NULL
                  GROUP BY i.collection`)
        .all(user.id) as { name: string; seen: number }[];
      const map = new Map(watched.map((w) => [w.name, w.seen]));
      for (const row of rows) row.seen = map.get(row.name) ?? 0;
    }
    return rows;
  });

  app.get('/api/collections/:name', async (req, reply) => {
    const name = decodeURIComponent((req.params as { name: string }).name);
    const user = currentUser(req);
    const items = db
      .prepare(`SELECT ${ITEM_FIELDS} FROM items i JOIN libraries l ON l.id = i.library_id
                WHERE i.collection = ? ORDER BY i.year, i.title`)
      .all(name);
    if (items.length === 0) return reply.code(404).send({ error: 'Saga no encontrada' });
    return { name, items: withProgress(items, user?.id ?? null) };
  });

  /*
   * Buscar sin que las tildes estorben.
   *
   * `search_title` se guarda ya sin tildes y en minúsculas —para eso existe la
   * columna— pero lo que escribía el usuario iba tal cual, así que escribir el
   * título BIEN no encontraba nada: «Cómo entrenar» daba 0 resultados y «COMO
   * ENTRENAR» daba 4. Con el teclado de la tele no se notaba, porque no tiene
   * tildes; desde el móvil, que las pone solo, fallaba siempre.
   *
   * `normalize` es exactamente la misma función con la que el escáner escribió
   * la columna, así que los dos lados hablan el mismo idioma. Para el título
   * original y para los nombres, que se guardan tal cual, se busca por las dos
   * formas: la escrita y la limpia.
   */
  app.get('/api/search', async (req) => {
    const { q } = req.query as { q?: string };
    if (!q || q.trim().length < 2) return { items: [], people: [] };
    const limpio = normalize(q);
    if (!limpio) return { items: [], people: [] };
    const term = `%${limpio}%`;
    const crudo = `%${q.toLowerCase().trim()}%`;
    const items = db
      .prepare(`SELECT ${ITEM_FIELDS} FROM items i JOIN libraries l ON l.id = i.library_id
                WHERE i.search_title LIKE ? OR LOWER(i.original_title) LIKE ? OR LOWER(i.original_title) LIKE ?
                ORDER BY (i.search_title LIKE ?) DESC, i.rating DESC NULLS LAST LIMIT 40`)
      .all(term, term, crudo, `${limpio}%`);
    const people = db
      .prepare(`SELECT p.id, p.name, p.thumb IS NOT NULL AS has_thumb, COUNT(ip.item_id) AS count
                FROM people p JOIN item_people ip ON ip.person_id = p.id
                WHERE p.search_name LIKE ? OR LOWER(p.name) LIKE ? GROUP BY p.id ORDER BY count DESC LIMIT 12`)
      .all(term, crudo);
    return { items, people };
  });

  app.get('/api/search/dialogue', async (req) => {
    const { q } = req.query as { q?: string };
    const expression = ftsQuery(q ?? '');
    if (!expression) return { hits: [], stats: dialogueStats() };
    try {
      return { hits: searchDialogue(expression, 40), stats: dialogueStats() };
    } catch (err) {
      return { hits: [], error: (err as Error).message, stats: dialogueStats() };
    }
  });

  app.get('/api/dialogue/status', async (req) => {
    const { language } = req.query as { language?: string };
    return dialogueStats(language || 'spa');
  });

  app.post('/api/dialogue/index', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede indexar' });
    const { language, reset } = req.body as { language?: string; reset?: boolean };
    if (dialogueStats().indexado.enCurso) return reply.code(409).send({ error: 'Ya hay un indexado en marcha' });
    if (reset) clearDialogue();
    // Sin esperar: contesta ya y el trabajo sigue en el servidor aunque se
    // cierre la pestaña. El progreso se lee en /api/dialogue/status.
    void indexarEnSegundoPlano(language ?? 'spa').catch((err) => console.error('Indexado de diálogos fallido:', err));
    return { started: true };
  });

  app.get('/api/people/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const person = db.prepare('SELECT id, name, thumb IS NOT NULL AS has_thumb FROM people WHERE id = ?').get(id);
    if (!person) return reply.code(404).send({ error: 'No encontrado' });

    // Se pide a TMDb la primera vez y queda guardada; si falla, la ficha sigue
    // mostrándose con lo que hay en local.
    let detalle = null;
    try {
      detalle = await detallePersona(id);
    } catch {
      detalle = null;
    }
    const credits = db
      .prepare(`SELECT ${ITEM_FIELDS}, ip.character, ip.role FROM item_people ip
                JOIN items i ON i.id = ip.item_id JOIN libraries l ON l.id = i.library_id
                WHERE ip.person_id = ? ORDER BY i.year DESC`)
      .all(id);
    return { ...person, detalle, credits };
  });

  for (const [route, column] of [['poster', 'poster'], ['fanart', 'fanart'], ['logo', 'clearlogo'], ['landscape', 'landscape'], ['discart', 'discart']] as const) {
    app.get(`/api/items/:id/${route}`, async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const width = (req.query as { w?: string }).w ? Number((req.query as { w: string }).w) : undefined;
      const row = db.prepare(`SELECT ${column} AS src FROM items WHERE id = ?`).get(id) as { src: string | null } | undefined;
      return serveArt(reply, row?.src ?? null, width);
    });
  }

  app.get('/api/episodes/:id/thumb', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const width = (req.query as { w?: string }).w ? Number((req.query as { w: string }).w) : undefined;
    const row = db.prepare('SELECT thumb AS src FROM episodes WHERE id = ?').get(id) as { src: string | null } | undefined;
    return serveArt(reply, row?.src ?? null, width);
  });

  app.get('/api/people/:id/thumb', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const width = Number((req.query as { w?: string }).w ?? 160);
    const row = db.prepare('SELECT thumb AS src FROM people WHERE id = ?').get(id) as { src: string | null } | undefined;
    return serveArt(reply, row?.src ?? null, width);
  });

  /*
   * Guardar progreso a mano en vez de con `ON CONFLICT`: la clave primaria
   * incluye `episode_id`, que en las películas es NULL, y SQLite no considera
   * iguales dos NULL, así que el upsert insertaba una fila nueva cada vez. El
   * operador `IS` sí compara NULL con NULL, y con eso el UPDATE encuentra la
   * fila que toca tanto en películas como en episodios.
   */
  const guardarProgreso = (
    userId: number,
    itemId: number,
    episodeId: number | null,
    position: number,
    duration: number | null,
    watched: number,
  ) => {
    const ahora = new Date().toISOString();
    const cambio = db
      .prepare(`UPDATE progress SET position = ?, duration = COALESCE(?, duration), watched = ?, updated_at = ?
                 WHERE user_id = ? AND item_id = ? AND episode_id IS ?`)
      .run(position, duration, watched, ahora, userId, itemId, episodeId);

    if (cambio.changes === 0) {
      db.prepare(`INSERT INTO progress (user_id, item_id, episode_id, position, duration, watched, updated_at)
                  VALUES (?,?,?,?,?,?,?)`)
        .run(userId, itemId, episodeId, position, duration, watched, ahora);
    }
  };

  app.get('/api/omdb/estado', async (req) => {
    requireUser(req);
    return { lote: loteOmdb, configurada: Boolean(config.omdbApiKey) };
  });

  app.post('/api/omdb/rellenar', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede pedirlas' });
    const { todos } = (req.body ?? {}) as { todos?: boolean };
    try {
      return { started: true, total: rellenarConOmdb(Boolean(todos)) };
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.post('/api/omdb/parar', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede pararla' });
    return { parando: pararOmdb() };
  });

  app.post('/api/progress', async (req) => {
    marcarActividad();
    const user = requireUser(req);
    const { itemId, episodeId, position, duration, watched } = req.body as {
      itemId: number; episodeId?: number | null; position: number; duration?: number; watched?: boolean;
    };
    /*
     * Un cero no es una duración, es que el cliente no la sabía. Como el
     * guardado hace `COALESCE(?, duration)` y COALESCE solo esquiva NULL, un
     * cero se habría escrito encima de la duración buena: el mismo fallo que
     * dejó 107 ficheros sin duración tras un reescaneo.
     */
    const duracion = duration && duration > 0 ? duration : null;
    guardarProgreso(
      user.id,
      itemId,
      episodeId ?? null,
      position,
      duracion,
      watched ? 1 : duracion && position > duracion * 0.95 ? 1 : 0,
    );
    avanzar({ userId: user.id, itemId, episodeId: episodeId ?? null, position, duracion: duration ?? null, vista: Boolean(watched), sesion: sesionDe(req) });
    return { ok: true };
  });

  app.post('/api/items/:id/watched', async (req) => {
    const user = requireUser(req);
    const id = Number((req.params as { id: string }).id);
    const { watched, episodeId } = req.body as { watched: boolean; episodeId?: number | null };
    guardarProgreso(user.id, id, episodeId ?? null, 0, null, watched ? 1 : 0);
    return { ok: true };
  });

  /** Lo que se estaba viendo dentro de una biblioteca: solo peliculas en Peliculas, solo series en Series. */
  app.get('/api/libraries/:id/continuar', async (req) => {
    const user = requireUser(req);
    const libraryId = Number((req.params as { id: string }).id);
    return db
      .prepare(`SELECT ${ITEM_FIELDS}, p.position, p.duration AS progressDuration, p.episode_id, MAX(p.updated_at) AS updated_at
                  FROM progress p JOIN items i ON i.id = p.item_id JOIN libraries l ON l.id = i.library_id
                 WHERE p.user_id = ? AND i.library_id = ? AND p.watched = 0 AND p.position > 60
                   AND (p.duration IS NULL OR p.position < p.duration * 0.95)
                 GROUP BY i.id ORDER BY updated_at DESC LIMIT 30`)
      .all(user.id, libraryId);
  });

  /*
   * Borrar un titulo con su carpeta entera. Es lo unico destructivo de la API,
   * asi que lleva tres cerrojos: solo administradores, la carpeta tiene que
   * estar dentro de una biblioteca configurada (nunca se borra fuera), y el
   * cliente tiene que mandar el nombre exacto del titulo como confirmacion.
   * Aqui ya se han perdido peliculas borrando a ojo: por eso tanto cerrojo.
   */
  app.delete('/api/items/:id', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede borrar' });
    /*
     * Borrar es lo único de aquí que no se deshace: se lleva la carpeta entera
     * de la biblioteca. Cambiar el PIN y emparejar ya estaban cerrados desde
     * internet; esto no, y era lo más destructivo que quedaba abierto. Una
     * sesión de admin olvidada en un móvil no debería poder vaciar `E:` desde
     * fuera de casa.
     */
    if (deFuera(req)) return reply.code(403).send({ error: 'Borrar se hace desde la red de casa' });
    const id = Number((req.params as { id: string }).id);
    const { confirmar } = (req.body ?? {}) as { confirmar?: string };

    const item = db.prepare('SELECT id, title, folder, kind FROM items WHERE id = ?').get(id) as
      | { id: number; title: string; folder: string; kind: string }
      | undefined;
    if (!item) return reply.code(404).send({ error: 'No encontrado' });
    if (confirmar !== item.title) return reply.code(400).send({ error: 'La confirmacion no coincide con el titulo' });

    const carpeta = resolve(item.folder);
    const dentro = config.libraries.some((l) => {
      const raiz = resolve(l.path);
      return carpeta.toLowerCase().startsWith(raiz.toLowerCase() + sep) && carpeta.length > raiz.length + 1;
    });
    if (!dentro) return reply.code(400).send({ error: 'La carpeta no esta dentro de ninguna biblioteca; no se toca' });

    const ficheros = (db.prepare(`SELECT COUNT(*) AS n FROM media_files f
                                    LEFT JOIN episodes e ON e.id = f.episode_id
                                   WHERE f.item_id = ? OR e.show_id = ?`).get(id, id) as { n: number }).n;
    try {
      if (existsSync(carpeta)) rmSync(carpeta, { recursive: true, force: true });
    } catch (err) {
      return reply.code(500).send({ error: `No se pudo borrar la carpeta: ${(err as Error).message}` });
    }
    // Las tablas dependientes (ficheros, episodios, progreso, favoritos) caen en cascada.
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
    console.log(`[borrado] ${user.name} borro «${item.title}» (${item.kind}): ${carpeta}, ${ficheros} ficheros`);
    return { borrado: true, titulo: item.title, carpeta, ficheros };
  });

  app.get('/api/favorites', async (req) => {
    const user = requireUser(req);
    return db
      .prepare(`SELECT ${ITEM_FIELDS} FROM favorites fv JOIN items i ON i.id = fv.item_id
                JOIN libraries l ON l.id = i.library_id WHERE fv.user_id = ? ORDER BY fv.added_at DESC`)
      .all(user.id);
  });

  app.post('/api/items/:id/favorite', async (req) => {
    const user = requireUser(req);
    const id = Number((req.params as { id: string }).id);
    const { favorite } = req.body as { favorite: boolean };
    if (favorite) {
      db.prepare('INSERT OR IGNORE INTO favorites (user_id, item_id, added_at) VALUES (?,?,?)').run(user.id, id, new Date().toISOString());
    } else {
      db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ?').run(user.id, id);
    }
    return { ok: true };
  });
}
