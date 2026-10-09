import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { DATA_DIR, config } from '../config.ts';
import { db } from '../db.ts';

/**
 * Dónde ver un título fuera de la biblioteca, y qué hay en cada plataforma.
 *
 * Los datos son de TMDb (que los toma de JustWatch) para la región ES. Miden,
 * el 30/09/2026, el catálogo de cine y series de cada una y cuánto se solapa
 * con la biblioteca: 22 % de las películas y 11 % de las series de casa están
 * además en alguna de estas tres. O sea que la insignia «también en…» sale en
 * una de cada cinco películas, y el catálogo de la plataforma es casi todo
 * material que no está en casa.
 *
 * Aquí NO se reproduce nada: Apple TV+, Prime y Movistar+ van cifrados con DRM
 * y solo entregan vídeo a clientes suyos. Esto enseña qué hay y abre su app.
 */

const API = 'https://api.themoviedb.org/3';
const IMAGENES = 'https://image.tmdb.org/t/p';
const CACHE_DIR = join(DATA_DIR, 'cache', 'plataformas');

/**
 * Las plataformas que un perfil puede marcar como suyas («Mis plataformas»); cada
 * perfil elige las suyas y solo ve «también en…» de esas (tabla `usuario_plataformas`).
 * `id` es el `provider_id` de TMDb; los de esta lista están comprobados el 09/10/2026
 * contra `/watch/providers/{movie,tv}?watch_region=ES` (todas salen en cine y series).
 * Para añadir una: comprobar el id así, añadir su `source_id` de Watchmode abajo si lo
 * tiene (`/sources/?regions=ES`) y volver a lanzar el refresco (`/api/plataformas/refrescar`
 * con `dias: 0`), porque `item_plataformas` solo guarda las que están en esta lista.
 */
export const PLATAFORMAS = [
  { clave: 'movistar', id: 2241, nombre: 'Movistar Plus+' },
  { clave: 'prime', id: 119, nombre: 'Prime Video' },
  { clave: 'apple', id: 350, nombre: 'Apple TV+' },
  { clave: 'netflix', id: 8, nombre: 'Netflix' },
  { clave: 'disney', id: 337, nombre: 'Disney+' },
  { clave: 'hbomax', id: 1899, nombre: 'HBO Max' },
  { clave: 'skyshowtime', id: 1773, nombre: 'SkyShowtime' },
  { clave: 'filmin', id: 63, nombre: 'Filmin' },
  { clave: 'atresplayer', id: 62, nombre: 'Atresplayer' },
  { clave: 'rtve', id: 541, nombre: 'RTVE Play' },
  { clave: 'rakuten', id: 35, nombre: 'Rakuten TV' },
  { clave: 'crunchyroll', id: 283, nombre: 'Crunchyroll' },
  { clave: 'mubi', id: 11, nombre: 'MUBI' },
] as const;

const PROVEEDORES = new Map(PLATAFORMAS.map((p) => [p.id, p]));

db.exec(`
CREATE TABLE IF NOT EXISTS usuario_plataformas (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clave   TEXT NOT NULL,
  PRIMARY KEY (user_id, clave)
);
-- Quién ya ha elegido (aunque sea «ninguna»): sin esta fila, el perfil aún no ha configurado nada.
CREATE TABLE IF NOT EXISTS usuario_plataformas_cfg (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plataformas_meta (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_plataformas (
  item_id     INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  suscripcion TEXT NOT NULL,
  alquiler    TEXT NOT NULL,
  enlace      TEXT NOT NULL,
  actualizado TEXT NOT NULL
);
`);

/*
 * Enlace directo a un título dentro de la plataforma, vía Watchmode.
 *
 * TMDb no da enlaces a las plataformas («not going to return full deep links»):
 * solo su propia página. Watchmode sí da el `web_url` de cada una —Prime:
 * `app.primevideo.com/detail?gti=…`, Movistar+: `wl.movistarplus.es/ficha/?id=…`,
 * Apple TV: `tv.apple.com/…`— y son enlaces universales, de los que Android abre
 * en la app si está instalada. Los `android_url`/`ios_url` nativos son del plan
 * de pago: con la clave gratuita salen como «Deeplinks available for paid plans
 * only», y no se usan.
 *
 * Condiciones del plan gratuito (api.watchmode.com/tc, 30/09/2026): caché de
 * 30 días como máximo —aquí 25, para no rozarlo—, atribución a Watchmode donde
 * se usen sus datos, y no compartirlos con terceros.
 */
const WATCHMODE = 'https://api.watchmode.com/v1';
const CACHE_ENLACE_DIAS = 25;
/** Sin enlace (o Watchmode caído): se reintenta antes, no hay que esperar 25 días. */
const CACHE_SIN_ENLACE_DIAS = 3;

/** `source_id` de Watchmode por plataforma; se comprueba con `/sources/?regions=ES`. */
const FUENTES_WATCHMODE: Record<string, number[]> = {
  movistar: [456],
  prime: [26],
  // 371 es Apple TV+ (suscripción); 349 es la tienda de Apple (alquiler y compra).
  apple: [371, 349],
  // Comprobados el 09/10/2026 con `/sources/?regions=ES`. RTVE Play, Rakuten TV y MUBI no
  // salen como suscripción en Watchmode: sin enlace directo, se usa el respaldo de TMDb.
  netflix: [203],
  disney: [372],
  hbomax: [387],
  skyshowtime: [464],
  filmin: [457],
  atresplayer: [546],
  crunchyroll: [80],
};

db.exec(`
CREATE TABLE IF NOT EXISTS enlaces_directos (
  kind        TEXT NOT NULL,
  tmdb_id     INTEGER NOT NULL,
  clave       TEXT NOT NULL,
  url         TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  actualizado TEXT NOT NULL,
  PRIMARY KEY (kind, tmdb_id, clave)
);
`);

/**
 * `respaldo` es la página de disponibilidad de TMDb del título. Watchmode no
 * conoce todo: en una muestra de 45 títulos que TMDb da como disponibles, 5 (11 %)
 * no tenían enlace y la app abría la home de la plataforma. TMDb sí sabe que
 * están, así que su página sirve de plan B: se pulsa el logo de la plataforma y el
 * enlace de JustWatch lleva a la app. La dirección sin el nombre del título
 * redirige (301) a la buena, comprobado.
 */
export type EnlaceDirecto = { url: string | null; tipo: string | null; respaldo: string };

const respaldoTmdb = (kind: 'movie' | 'show', tmdbId: number) =>
  `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${tmdbId}/watch?locale=ES`;

type FuenteWatchmode = { source_id: number; type: string; web_url?: string | null };

/**
 * El enlace directo a un título en una plataforma, o `url: null` si no lo hay.
 * Se pide a Watchmode solo al pulsar (1 llamada), y se guarda: no se hace nada en
 * lote, porque el cupo son 2.500 al mes y la biblioteca tiene 1.823 títulos.
 */
export async function enlaceDirecto(kind: 'movie' | 'show', tmdbId: number, clave: string): Promise<EnlaceDirecto> {
  if (!PLATAFORMAS.some((p) => p.clave === clave)) throw new Error('Plataforma desconocida: ' + clave);
  const respaldo = respaldoTmdb(kind, tmdbId);
  const fuentes = FUENTES_WATCHMODE[clave];
  if (!fuentes) return { url: null, tipo: null, respaldo };
  if (!config.watchmodeApiKey) return { url: null, tipo: null, respaldo };

  const guardado = db
    .prepare('SELECT url, tipo, actualizado FROM enlaces_directos WHERE kind = ? AND tmdb_id = ? AND clave = ?')
    .get(kind, tmdbId, clave) as { url: string; tipo: string; actualizado: string } | undefined;
  if (guardado) {
    const edad = (Date.now() - new Date(guardado.actualizado).getTime()) / 86400_000;
    if (edad < (guardado.url ? CACHE_ENLACE_DIAS : CACHE_SIN_ENLACE_DIAS)) {
      return { url: guardado.url || null, tipo: guardado.tipo || null, respaldo };
    }
  }

  const guardar = (url: string, tipo: string) =>
    db
      .prepare(`INSERT INTO enlaces_directos (kind, tmdb_id, clave, url, tipo, actualizado) VALUES (?,?,?,?,?,?)
                ON CONFLICT(kind, tmdb_id, clave) DO UPDATE SET url = excluded.url, tipo = excluded.tipo,
                  actualizado = excluded.actualizado`)
      .run(kind, tmdbId, clave, url, tipo, new Date().toISOString());

  let lista: FuenteWatchmode[];
  try {
    const u = new URL(`${WATCHMODE}/title/${kind === 'movie' ? 'movie' : 'tv'}-${tmdbId}/sources/`);
    u.searchParams.set('apiKey', config.watchmodeApiKey);
    u.searchParams.set('regions', 'ES');
    const r = await fetch(u, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error('Watchmode respondió ' + r.status);
    const j = await r.json();
    lista = Array.isArray(j) ? (j as FuenteWatchmode[]) : [];
  } catch (err) {
    // Un fallo de red no se guarda como «no hay enlace»: se reintenta en el próximo toque.
    throw new Error('No se pudo pedir el enlace: ' + (err as Error).message);
  }

  // Suscripción antes que alquiler o compra: es lo que el usuario ya paga.
  const orden = ['sub', 'free', 'tve', 'rent', 'buy'];
  const candidatas = lista
    .filter((s) => fuentes.includes(s.source_id) && s.web_url && /^https?:\/\//.test(s.web_url))
    .sort((a, b) => orden.indexOf(a.type) - orden.indexOf(b.type));
  const elegida = candidatas[0];
  if (!elegida) {
    guardar('', '');
    return { url: null, tipo: null, respaldo };
  }
  guardar(elegida.web_url as string, elegida.type);
  return { url: elegida.web_url as string, tipo: elegida.type, respaldo };
}

/** El título de la biblioteca con su id de TMDb, para resolver el enlace desde la ficha. */
export function tmdbDeItem(itemId: number): { kind: 'movie' | 'show'; tmdbId: number } | null {
  const f = db.prepare('SELECT kind, tmdb_id FROM items WHERE id = ?').get(itemId) as { kind: string; tmdb_id: string | null } | undefined;
  if (!f || !f.tmdb_id || !Number(f.tmdb_id)) return null;
  return { kind: f.kind === 'movie' ? 'movie' : 'show', tmdbId: Number(f.tmdb_id) };
}

export type DondeVer = {
  /** Incluidas en la suscripción: las que interesan de verdad. */
  suscripcion: { clave: string; nombre: string }[];
  /** De pago aparte; se enseñan aparte para no prometer lo que cuesta dinero. */
  alquiler: { clave: string; nombre: string }[];
  /** Página de JustWatch del título; sirve de respaldo en la web. */
  enlace: string;
};

/**
 * Las plataformas de un perfil, o `null` si aún no ha elegido ninguna vez. La primera
 * vez que se consulta, el administrador arranca con las tres de siempre (Movistar+,
 * Prime y Apple TV+): es el comportamiento que tenía antes de que cada perfil eligiera.
 */
export function misPlataformas(userId: number): string[] | null {
  const hecho = db.prepare('SELECT 1 FROM usuario_plataformas_cfg WHERE user_id = ?').get(userId);
  if (!hecho) {
    const u = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
    if (u?.is_admin) {
      guardarMisPlataformas(userId, ['movistar', 'prime', 'apple']);
      return ['movistar', 'prime', 'apple'];
    }
    return null;
  }
  return (db.prepare('SELECT clave FROM usuario_plataformas WHERE user_id = ?').all(userId) as { clave: string }[]).map((f) => f.clave);
}

export function guardarMisPlataformas(userId: number, claves: string[]): string[] {
  const validas = [...new Set(claves)].filter((k) => PLATAFORMAS.some((p) => p.clave === k));
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM usuario_plataformas WHERE user_id = ?').run(userId);
    const ins = db.prepare('INSERT INTO usuario_plataformas (user_id, clave) VALUES (?, ?)');
    for (const k of validas) ins.run(userId, k);
    db.prepare('INSERT OR IGNORE INTO usuario_plataformas_cfg (user_id) VALUES (?)').run(userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return validas;
}

const VACIO: DondeVer = { suscripcion: [], alquiler: [], enlace: '' };

export function dondeVer(itemId: number, userId?: number): DondeVer {
  // Con perfil: solo las plataformas que ese perfil marcó como suyas; sin elegir, ninguna.
  const suyas = userId === undefined ? null : misPlataformas(userId) ?? [];
  const filtro = <T extends { clave: string }>(l: T[]) => (suyas ? l.filter((p) => suyas.includes(p.clave)) : l);
  const fila = db
    .prepare('SELECT suscripcion, alquiler, enlace FROM item_plataformas WHERE item_id = ?')
    .get(itemId) as { suscripcion: string; alquiler: string; enlace: string } | undefined;
  if (!fila) return VACIO;
  try {
    return {
      suscripcion: filtro(JSON.parse(fila.suscripcion)),
      alquiler: filtro(JSON.parse(fila.alquiler)),
      enlace: fila.enlace,
    };
  } catch {
    return VACIO;
  }
}

/** Varios títulos de una vez, para no hacer una consulta por tarjeta en una rejilla. */
export function dondeVerVarios(ids: number[]): Map<number, DondeVer> {
  const salida = new Map<number, DondeVer>();
  if (!ids.length) return salida;
  const filas = db
    .prepare(`SELECT item_id, suscripcion FROM item_plataformas
              WHERE item_id IN (${ids.map(() => '?').join(',')}) AND suscripcion != '[]'`)
    .all(...ids) as { item_id: number; suscripcion: string }[];
  for (const f of filas) {
    try {
      salida.set(f.item_id, { suscripcion: JSON.parse(f.suscripcion), alquiler: [], enlace: '' });
    } catch {
      /* fila ilegible: como si no estuviera */
    }
  }
  return salida;
}

async function tmdb<T>(ruta: string, params: Record<string, string> = {}): Promise<T> {
  if (!config.tmdbApiKey) throw new Error('Falta la clave de API de TMDb');
  const url = new URL(API + ruta);
  url.searchParams.set('api_key', config.tmdbApiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  /*
   * Tres intentos con tiempo corto. Medido el 30/09/2026: una petición al
   * catálogo murió con «fetch failed» tras 10,6 s y las dos siguientes tardaron
   * 82 y 28 ms. Con 20 s de espera y sin reintento, ese fallo puntual dejaba la
   * pantalla de la tele en «Cargando…» medio minuto. Un 4xx no se reintenta:
   * no va a cambiar.
   */
  let ultimo: Error = new Error('TMDb no respondió');
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6_000) });
      if (r.ok) return (await r.json()) as T;
      ultimo = new Error('TMDb respondió ' + r.status);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) throw ultimo;
    } catch (err) {
      ultimo = err as Error;
      if (ultimo.message.startsWith('TMDb respondió 4') && !ultimo.message.endsWith('429')) throw ultimo;
    }
    if (intento < 3) await new Promise((res) => setTimeout(res, 400 * intento));
  }
  throw ultimo;
}

type RespuestaProveedores = {
  results?: Record<string, {
    link?: string;
    flatrate?: { provider_id: number }[];
    rent?: { provider_id: number }[];
    buy?: { provider_id: number }[];
  }>;
};

const mias = (lista: { provider_id: number }[] | undefined) =>
  (lista ?? [])
    .map((p) => PROVEEDORES.get(p.provider_id))
    .filter((p): p is (typeof PLATAFORMAS)[number] => Boolean(p))
    .map((p) => ({ clave: p.clave, nombre: p.nombre }));

export type JobPlataformas = {
  running: boolean;
  total: number;
  hechos: number;
  conPlataforma: number;
  error: string | null;
  parando: boolean;
  finishedAt: string | null;
};

export const jobPlataformas: JobPlataformas = {
  running: false, total: 0, hechos: 0, conPlataforma: 0, error: null, parando: false, finishedAt: null,
};

export function pararPlataformas(): boolean {
  if (!jobPlataformas.running) return false;
  jobPlataformas.parando = true;
  return true;
}

export function resumenPlataformas() {
  const total = db.prepare(`SELECT COUNT(*) n FROM items WHERE tmdb_id IS NOT NULL AND tmdb_id != ''`).get() as { n: number };
  const hechos = db.prepare('SELECT COUNT(*) n FROM item_plataformas').get() as { n: number };
  const con = db.prepare(`SELECT COUNT(*) n FROM item_plataformas WHERE suscripcion != '[]'`).get() as { n: number };
  const porPlataforma = PLATAFORMAS.map((p) => ({
    ...p,
    titulos: (db
      .prepare(`SELECT COUNT(*) n FROM item_plataformas WHERE suscripcion LIKE ?`)
      .get('%"' + p.clave + '"%') as { n: number }).n,
  }));
  return { total: total.n, consultados: hechos.n, conPlataforma: con.n, porPlataforma };
}

/**
 * Sube este número al cambiar `PLATAFORMAS`: al arrancar, si `item_plataformas` se rellenó con
 * otro catálogo, se vuelve a consultar todo una vez (unos minutos de red, sin tocar el disco).
 */
const CATALOGO_VERSION = '2';

setTimeout(() => {
  try {
    const hecho = db.prepare(`SELECT valor FROM plataformas_meta WHERE clave = 'catalogo'`).get() as { valor: string } | undefined;
    if (hecho?.valor !== CATALOGO_VERSION && !jobPlataformas.running) refrescarPlataformas(0);
  } catch {
    /* sin clave de TMDb o ya en marcha: se hará con el refresco manual */
  }
}, 90_000).unref();

/** Rellena la tabla. Solo red y escrituras diminutas: no pisa el disco de la biblioteca. */
export function refrescarPlataformas(dias = 7): number {
  if (jobPlataformas.running) throw new Error('Ya hay una consulta en curso');
  const corte = new Date(Date.now() - dias * 86400_000).toISOString();
  const lista = db
    .prepare(`SELECT i.id, i.kind, i.tmdb_id FROM items i
              LEFT JOIN item_plataformas p ON p.item_id = i.id
              WHERE i.tmdb_id IS NOT NULL AND i.tmdb_id != ''
                AND (p.item_id IS NULL OR p.actualizado < ?)
              ORDER BY i.id`)
    .all(corte) as { id: number; kind: string; tmdb_id: string }[];

  Object.assign(jobPlataformas, {
    running: true, total: lista.length, hechos: 0, conPlataforma: 0, error: null, parando: false, finishedAt: null,
  });

  void (async () => {
    const guardar = db.prepare(`INSERT INTO item_plataformas (item_id, suscripcion, alquiler, enlace, actualizado)
                                VALUES (?,?,?,?,?)
                                ON CONFLICT(item_id) DO UPDATE SET suscripcion = excluded.suscripcion,
                                  alquiler = excluded.alquiler, enlace = excluded.enlace,
                                  actualizado = excluded.actualizado`);
    try {
      for (const t of lista) {
        if (jobPlataformas.parando) break;
        try {
          const tipo = t.kind === 'movie' ? 'movie' : 'tv';
          const r = await tmdb<RespuestaProveedores>(`/${tipo}/${t.tmdb_id}/watch/providers`);
          const es = r.results?.ES;
          const susc = mias(es?.flatrate);
          const alq = mias([...(es?.rent ?? []), ...(es?.buy ?? [])]);
          guardar.run(t.id, JSON.stringify(susc), JSON.stringify(alq), es?.link ?? '', new Date().toISOString());
          if (susc.length) jobPlataformas.conPlataforma++;
        } catch {
          /* un título que falla no corta la pasada; se reintenta en la siguiente */
        }
        jobPlataformas.hechos++;
        await new Promise((r) => setTimeout(r, 60));
      }
    } catch (err) {
      jobPlataformas.error = (err as Error).message;
      // Un refresco completo y sin cortes deja anotado que `item_plataformas` ya conoce todo el catálogo actual.
      if (dias === 0 && !jobPlataformas.parando && !jobPlataformas.error) {
        db.prepare(`INSERT INTO plataformas_meta (clave, valor) VALUES ('catalogo', ?)
                    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`).run(CATALOGO_VERSION);
      }
    } finally {
      jobPlataformas.running = false;
      jobPlataformas.parando = false;
      jobPlataformas.finishedAt = new Date().toISOString();
    }
  })();

  return lista.length;
}

export type FichaPlataforma = {
  tmdbId: number;
  kind: 'movie' | 'show';
  title: string;
  year: number | null;
  rating: number | null;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  enBiblioteca: number | null;
};

type RespuestaDescubrir = {
  page: number;
  total_pages: number;
  total_results: number;
  results: {
    id: number;
    title?: string;
    name?: string;
    release_date?: string;
    first_air_date?: string;
    vote_average?: number;
    overview?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
  }[];
};

/** Lo que ya está en casa no se ofrece como «ve a Prime»: se marca y se abre aquí. */
function enBiblioteca(tmdbIds: number[], kind: 'movie' | 'show'): Map<number, number> {
  const m = new Map<number, number>();
  if (!tmdbIds.length) return m;
  const filas = db
    .prepare(`SELECT id, tmdb_id FROM items WHERE kind = ? AND tmdb_id IN (${tmdbIds.map(() => '?').join(',')})`)
    .all(kind, ...tmdbIds.map(String)) as { id: number; tmdb_id: string }[];
  for (const f of filas) m.set(Number(f.tmdb_id), f.id);
  return m;
}

export async function catalogo(
  clave: string,
  kind: 'movie' | 'show',
  orden: string,
  pagina: number,
): Promise<{ total: number; paginas: number; items: FichaPlataforma[] }> {
  const plat = PLATAFORMAS.find((p) => p.clave === clave);
  if (!plat) throw new Error('Plataforma desconocida: ' + clave);
  const tipo = kind === 'movie' ? 'movie' : 'tv';
  const r = await tmdb<RespuestaDescubrir>('/discover/' + tipo, {
    watch_region: 'ES',
    with_watch_providers: String(plat.id),
    with_watch_monetization_types: 'flatrate',
    sort_by: orden,
    page: String(Math.max(1, Math.min(500, pagina))),
    language: config.tmdbLanguage,
  });

  const mapa = enBiblioteca(r.results.map((x) => x.id), kind);
  return {
    total: r.total_results,
    paginas: r.total_pages,
    items: r.results.map((x) => {
      const fecha = x.release_date || x.first_air_date || '';
      return {
        tmdbId: x.id,
        kind,
        title: x.title || x.name || '',
        year: fecha ? Number(fecha.slice(0, 4)) : null,
        rating: x.vote_average ?? null,
        overview: x.overview ?? '',
        poster: x.poster_path ?? null,
        backdrop: x.backdrop_path ?? null,
        enBiblioteca: mapa.get(x.id) ?? null,
      };
    }),
  };
}

/**
 * Carátula de TMDb servida por el propio servidor.
 *
 * No se enlaza directamente a image.tmdb.org: la política de seguridad de la
 * app de Tizen lleva `img-src 'self' http: data:`, **sin `https:`**, así que una
 * imagen de TMDb se bloquearía en silencio y la pantalla saldría sin carátulas.
 * De paso queda cacheada en disco y la segunda vez no sale a internet.
 */
export async function caratula(tipo: string, ruta: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(ruta)) throw new Error('Nombre de imagen no válido');
  if (!/^w\d{3,4}$/.test(tipo)) throw new Error('Tamaño no válido');
  mkdirSync(CACHE_DIR, { recursive: true });
  const destino = join(CACHE_DIR, tipo + '_' + ruta);
  if (existsSync(destino)) return destino;
  const r = await fetch(`${IMAGENES}/${tipo}/${ruta}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok || !r.body) throw new Error('TMDb no sirvió la imagen (' + r.status + ')');
  const parcial = destino + '.parcial';
  await pipeline(Readable.fromWeb(r.body as never), createWriteStream(parcial));
  const { renameSync } = await import('node:fs');
  renameSync(parcial, destino);
  return destino;
}
