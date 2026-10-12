import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { DATA_DIR, config } from '../config.ts';
import { db, normalize } from '../db.ts';
import { imagenesDeFanart } from './fanart.ts';

const API = 'https://api.themoviedb.org/3';
const IMAGES = 'https://image.tmdb.org/t/p';
const ARTWORK_DIR = join(DATA_DIR, 'artwork');

export type Confidence = 'exact' | 'strong' | 'weak';

export type Proposal = {
  tmdbId: number;
  kind: 'movie' | 'show';
  title: string;
  originalTitle?: string;
  year: number | null;
  overview: string | null;
  rating: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  genres: string[];
  /** Solo en la ficha completa (`details`), no en los resultados de busqueda. */
  certificacion?: string | null;
  imdbId?: string | null;
  runtime?: number | null;
  tagline?: string | null;
  coleccion?: string | null;
  estreno?: string | null;
  votos?: number | null;
};

export type Candidate = {
  itemId: number;
  title: string;
  year: number | null;
  kind: 'movie' | 'show';
  libraryName: string;
  missing: string[];
  confidence: Confidence;
  matchedBy: string;
  proposal: Proposal | null;
  alternatives: Proposal[];
};

export class TmdbError extends Error {}

/** Para los modulos que piden a TMDb algo que aqui no tiene funcion propia. */
export const tmdbGet = <T>(path: string, params: Record<string, string> = {}) => tmdb<T>(path, params);
export { details as detallesDe, IMAGES as TMDB_IMAGENES, ARTWORK_DIR as DIR_ARTE };

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!config.tmdbApiKey) throw new TmdbError('Falta la clave de API de TMDb');
  const url = new URL(API + path);
  url.searchParams.set('api_key', config.tmdbApiKey);
  url.searchParams.set('language', config.tmdbLanguage);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, wait + 250));
      continue;
    }
    if (res.status === 401) throw new TmdbError('La clave de API de TMDb no es válida');
    if (res.status === 404) throw new TmdbError('No encontrado en TMDb');
    if (!res.ok) throw new TmdbError(`TMDb respondió ${res.status}`);
    return (await res.json()) as T;
  }
  throw new TmdbError('TMDb está limitando las peticiones; inténtalo más tarde');
}

const imageUrl = (path: string | null | undefined, size = 'original') => (path ? `${IMAGES}/${size}${path}` : null);

function toProposal(raw: any, kind: 'movie' | 'show'): Proposal {
  const date = raw.release_date ?? raw.first_air_date ?? '';
  const logos = raw.images?.logos ?? [];
  const preferred = logos.find((l: any) => l.iso_639_1 === config.tmdbLanguage.slice(0, 2)) ?? logos.find((l: any) => l.iso_639_1 === 'en') ?? logos[0];

  return {
    tmdbId: raw.id,
    kind,
    title: raw.title ?? raw.name ?? '',
    originalTitle: raw.original_title ?? raw.original_name,
    year: date ? Number(date.slice(0, 4)) : null,
    overview: raw.overview || null,
    rating: typeof raw.vote_average === 'number' && raw.vote_average > 0 ? raw.vote_average : null,
    posterUrl: imageUrl(raw.poster_path),
    backdropUrl: imageUrl(raw.backdrop_path),
    logoUrl: preferred ? imageUrl(preferred.file_path) : null,
    genres: (raw.genres ?? []).map((g: any) => g.name),
    certificacion: certificacionDe(raw, kind),
    imdbId: raw.external_ids?.imdb_id || raw.imdb_id || null,
    runtime: raw.runtime ?? raw.episode_run_time?.[0] ?? null,
    tagline: raw.tagline || null,
    coleccion: raw.belongs_to_collection?.name ?? null,
    estreno: date || null,
    votos: typeof raw.vote_count === 'number' ? raw.vote_count : null,
  };
}

/**
 * Clasificacion por edades del pais del idioma configurado (es-ES -> ES), en la
 * forma `ES:12` que entiende `parseRatingCategoria`. `null` si TMDb no la trae
 * para ese pais: entonces se avisa al administrador, no se adivina.
 *
 * Forma de la respuesta segun la documentacion de TMDb (no comprobada contra la
 * API real desde aqui): peliculas `release_dates.results[].release_dates[].certification`,
 * series `content_ratings.results[].rating`.
 */
const EQUIVALENCIA_EDAD: Record<string, string> = {
  tp: 'TP', a: 'TP', apta: 'TP', '0': 'TP', '0+': 'TP', '3': 'TP', '4': 'TP',
  '7': '7', '10': '7', '12': '12', '13': '12', '14': '16', '16': '16', '18': '18', '+18': '18',
};

export function certificacionDe(raw: any, kind: 'movie' | 'show', pais = config.tmdbLanguage.split('-')[1] ?? 'ES'): string | null {
  let crudo = '';
  if (kind === 'movie') {
    const fechas = (raw?.release_dates?.results ?? []).find((r: any) => r.iso_3166_1 === pais)?.release_dates ?? [];
    // Estreno en cines (3) antes que cualquier otro tipo.
    const conCert = fechas.filter((d: any) => String(d.certification ?? '').trim() !== '');
    crudo = String((conCert.find((d: any) => d.type === 3) ?? conCert[0])?.certification ?? '');
  } else {
    crudo = String((raw?.content_ratings?.results ?? []).find((r: any) => r.iso_3166_1 === pais)?.rating ?? '');
  }
  const cat = EQUIVALENCIA_EDAD[crudo.trim().toLowerCase()];
  return cat ? `${pais}:${cat}` : null;
}

const endpoint = (kind: 'movie' | 'show') => (kind === 'movie' ? 'movie' : 'tv');

async function details(tmdbId: number, kind: 'movie' | 'show'): Promise<Proposal> {
  const raw = await tmdb<any>(`/${endpoint(kind)}/${tmdbId}`, {
    append_to_response: `images,external_ids,${kind === 'movie' ? 'release_dates' : 'content_ratings'}`,
    include_image_language: `${config.tmdbLanguage.slice(0, 2)},en,null`,
  });
  return toProposal(raw, kind);
}

export async function search(query: string, kind: 'movie' | 'show', year?: number | null): Promise<Proposal[]> {
  const raw = await tmdb<{ results: any[] }>(`/search/${endpoint(kind)}`, {
    query,
    ...(year ? { [kind === 'movie' ? 'year' : 'first_air_date_year']: String(year) } : {}),
  });
  return (raw.results ?? []).slice(0, 8).map((r) => toProposal(r, kind));
}

function scoreMatch(item: { title: string; year: number | null }, proposal: Proposal): Confidence {
  const sameTitle = normalize(item.title) === normalize(proposal.title) || normalize(item.title) === normalize(proposal.originalTitle ?? '');
  const sameYear = item.year != null && proposal.year != null && Math.abs(item.year - proposal.year) <= 1;
  if (sameTitle && sameYear) return 'strong';
  return 'weak';
}

const MISSING_SQL = `
  SELECT i.id, i.title, i.year, i.kind, i.tmdb_id, i.imdb_id, l.name AS library_name,
         i.poster IS NULL AS no_poster, i.fanart IS NULL AS no_fanart, i.clearlogo IS NULL AS no_logo,
         i.plot IS NULL AS no_plot, i.rating IS NULL AS no_rating
  FROM items i JOIN libraries l ON l.id = i.library_id
  WHERE i.poster IS NULL OR i.fanart IS NULL OR i.plot IS NULL OR i.rating IS NULL OR i.clearlogo IS NULL
  ORDER BY (i.poster IS NULL) DESC, (i.plot IS NULL) DESC, i.title
  LIMIT ?`;

export function missingCount() {
  return db
    .prepare(`SELECT
        COUNT(*) AS total,
        SUM(poster IS NULL)    AS sin_poster,
        SUM(fanart IS NULL)    AS sin_fondo,
        SUM(clearlogo IS NULL) AS sin_logo,
        SUM(plot IS NULL)      AS sin_sinopsis,
        SUM(rating IS NULL)    AS sin_valoracion
      FROM items
      WHERE poster IS NULL OR fanart IS NULL OR plot IS NULL OR rating IS NULL OR clearlogo IS NULL`)
    .get();
}

/**
 * Builds review proposals. Nothing is written here on purpose: a wrong match
 * would overwrite good metadata, so the user confirms each one first.
 */
export async function buildCandidates(limit: number, onProgress?: (done: number, total: number) => void): Promise<Candidate[]> {
  const rows = db.prepare(MISSING_SQL).all(limit) as any[];
  const out: Candidate[] = [];

  for (const [index, row] of rows.entries()) {
    const missing = [
      row.no_poster && 'póster',
      row.no_fanart && 'fondo',
      row.no_logo && 'logo',
      row.no_plot && 'sinopsis',
      row.no_rating && 'valoración',
    ].filter(Boolean) as string[];

    const base = { itemId: row.id, title: row.title, year: row.year, kind: row.kind as 'movie' | 'show', libraryName: row.library_name, missing };

    try {
      if (row.tmdb_id) {
        out.push({ ...base, confidence: 'exact', matchedBy: `TMDb ${row.tmdb_id} del NFO`, proposal: await details(Number(row.tmdb_id), row.kind), alternatives: [] });
      } else if (row.imdb_id) {
        const found = await tmdb<any>(`/find/${row.imdb_id}`, { external_source: 'imdb_id' });
        const hit = (row.kind === 'movie' ? found.movie_results : found.tv_results)?.[0];
        if (hit) {
          out.push({ ...base, confidence: 'exact', matchedBy: `IMDb ${row.imdb_id} del NFO`, proposal: await details(hit.id, row.kind), alternatives: [] });
        } else {
          out.push({ ...base, confidence: 'weak', matchedBy: 'sin coincidencia por IMDb', proposal: null, alternatives: [] });
        }
      } else {
        const results = await search(row.title, row.kind, row.year);
        const best = results[0] ?? null;
        out.push({
          ...base,
          confidence: best ? scoreMatch(row, best) : 'weak',
          matchedBy: best ? 'búsqueda por título y año' : 'sin resultados',
          proposal: best ? await details(best.tmdbId, row.kind) : null,
          alternatives: results.slice(1, 6),
        });
      }
    } catch (err) {
      if (err instanceof TmdbError && /clave de API/.test(err.message)) throw err;
      out.push({ ...base, confidence: 'weak', matchedBy: `error: ${(err as Error).message}`, proposal: null, alternatives: [] });
    }

    onProgress?.(index + 1, rows.length);
  }

  return out;
}

/** Same shape as the bulk review, but for one title the user opened on purpose. */
export async function candidateForItem(itemId: number): Promise<Candidate> {
  const row = db
    .prepare(`SELECT i.id, i.title, i.year, i.kind, i.tmdb_id, i.imdb_id, l.name AS library_name,
                i.poster IS NULL AS no_poster, i.fanart IS NULL AS no_fanart, i.clearlogo IS NULL AS no_logo,
                i.plot IS NULL AS no_plot, i.rating IS NULL AS no_rating
              FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?`)
    .get(itemId) as any;
  if (!row) throw new Error('Título no encontrado');

  const missing = [
    row.no_poster && 'póster',
    row.no_fanart && 'fondo',
    row.no_logo && 'logo',
    row.no_plot && 'sinopsis',
    row.no_rating && 'valoración',
  ].filter(Boolean) as string[];

  const base = { itemId: row.id, title: row.title, year: row.year, kind: row.kind as 'movie' | 'show', libraryName: row.library_name, missing };
  const results = await search(row.title, row.kind, row.year);

  if (row.tmdb_id) {
    return { ...base, confidence: 'exact', matchedBy: `TMDb ${row.tmdb_id} del NFO`, proposal: await details(Number(row.tmdb_id), row.kind), alternatives: results.slice(0, 6) };
  }
  const best = results[0] ?? null;
  return {
    ...base,
    confidence: best ? scoreMatch(row, best) : 'weak',
    matchedBy: best ? 'búsqueda por título y año' : 'sin resultados',
    proposal: best ? await details(best.tmdbId, row.kind) : null,
    alternatives: results.slice(1, 7),
  };
}

/**
 * Cuántos episodios trae cada temporada según TMDb. Es lo que hace falta para
 * repartir una serie que en disco viene numerada del 1 al 243 de un tirón.
 * La temporada 0 (especiales) se deja fuera: no entra en la numeración normal.
 */
export async function temporadasDeSerie(tmdbId: number): Promise<{ temporada: number; episodios: number; nombre: string }[]> {
  const raw = await tmdb<any>(`/tv/${tmdbId}`);
  return (raw.seasons ?? [])
    .filter((s: any) => s.season_number > 0 && s.episode_count > 0)
    .map((s: any) => ({ temporada: s.season_number, episodios: s.episode_count, nombre: s.name }))
    .sort((a: any, b: any) => a.temporada - b.temporada);
}

/** Compartida con el agente de AniList: baja una imagen al disco y devuelve su ruta. */
export async function descargar(url: string, destination: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar la imagen (${res.status})`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destination));
  return destination;
}

/* ------------------------------------------------- galeria de imagenes */

export type Papel = 'poster' | 'fanart' | 'clearlogo' | 'landscape' | 'discart';

export type ImagenDisponible = {
  /** La grande, la que se descarga al elegirla. */
  url: string;
  /** Una pequena para la rejilla: pedir las originales ahoga la pantalla. */
  vista: string;
  ancho: number;
  alto: number;
  /** Codigo de dos letras, o vacio si la imagen no tiene texto (lo mejor para carteles). */
  idioma: string;
  voto: number;
};

/**
 * Todas las imagenes que TMDb tiene de un titulo, por papeles.
 *
 * Existe porque elegir «la caratula» no es una decision del servidor: una
 * pelicula tiene treinta carteles y el que gusta depende de quien mire. Esto es
 * lo que hace Plex y lo que aqui faltaba — solo se ofrecia la que TMDb marca
 * por defecto, sin alternativa.
 *
 * `include_image_language` con `null` incluido a proposito: las imagenes sin
 * texto suelen ser las mejores como cartel y TMDb las marca con idioma vacio.
 * Se ordenan poniendo delante el idioma de casa, luego las sin texto, luego el
 * ingles, y dentro de cada grupo por votos.
 */
export async function imagenesDe(tmdbId: number, kind: 'movie' | 'show') {
  const idioma = config.tmdbLanguage.slice(0, 2);
  const raw = await tmdb<any>(`/${endpoint(kind)}/${tmdbId}/images`, {
    include_image_language: `${idioma},en,null`,
  });

  const mapa = (lista: any[], anchoVista: number): ImagenDisponible[] =>
    (lista ?? [])
      .map((i) => ({
        url: imageUrl(i.file_path) as string,
        vista: imageUrl(i.file_path, `w${anchoVista}`) as string,
        ancho: i.width ?? 0,
        alto: i.height ?? 0,
        idioma: i.iso_639_1 ?? '',
        voto: i.vote_average ?? 0,
      }))
      .filter((i) => i.url)
      .sort((a, b) => orden(a, idioma) - orden(b, idioma) || b.voto - a.voto);

  const deTmdb = {
    poster: mapa(raw.posters, 342),
    fanart: mapa(raw.backdrops, 300),
    clearlogo: mapa(raw.logos, 300),
    landscape: [] as ImagenDisponible[],
    discart: [] as ImagenDisponible[],
  };

  // Y lo de fanart.tv detrás, si hay clave: sus logotipos y apaisadas son
  // mejores que los de TMDb, y las apaisadas TMDb ni las tiene.
  if (config.fanartApiKey) {
    try {
      const extra = await imagenesDeFanart(kind, tmdbId);
      if (extra) {
        for (const papel of ['poster', 'fanart', 'clearlogo', 'landscape', 'discart'] as const) {
          deTmdb[papel] = [...deTmdb[papel], ...extra[papel]].sort((a, b) => orden(a, idioma) - orden(b, idioma));
        }
      }
    } catch { /* fanart.tv caído: se enseña lo de TMDb y ya */ }
  }
  return deTmdb;
}

/** Imágenes oficiales (posters y fondos) de una colección/saga en TMDb y Fanart.tv. */
export async function imagenesDeSaga(nombre: string): Promise<{ posters: ImagenDisponible[]; fanarts: ImagenDisponible[] }> {
  const idioma = config.tmdbLanguage.slice(0, 2);
  const collectionIds: number[] = [];
  const normalizado = normalize(nombre);

  // Casos especiales conocidos (Saga del Infinito / Marvel / UCM)
  if (/infinit|marvel|ucm|mcu/i.test(nombre)) {
    collectionIds.push(1712635); // The Infinity Saga Collection
    const pelis = db
      .prepare('SELECT tmdb_id FROM items WHERE collection = ? AND tmdb_id IS NOT NULL AND length(tmdb_id) > 0')
      .all(nombre) as { tmdb_id: string }[];
    for (const p of pelis) {
      try {
        const det = await tmdb<any>(`/movie/${p.tmdb_id}`);
        if (det.belongs_to_collection?.id && !collectionIds.includes(det.belongs_to_collection.id)) {
          collectionIds.push(det.belongs_to_collection.id);
        }
      } catch {}
    }
  }

  // 1. Buscar la colección por nombre en TMDb
  const limpio = nombre
    .replace(/^(Saga de la|Saga del|Saga de|Saga|Colección)\s+/i, '')
    .replace(/\s*-\s*Colección$/i, '')
    .trim();
  const consultas = Array.from(new Set([nombre, limpio].filter(Boolean)));
  for (const q of consultas) {
    try {
      const searchRes = await tmdb<{ results: any[] }>('/search/collection', { query: q });
      for (const res of (searchRes.results || []).slice(0, 3)) {
        if (!collectionIds.includes(res.id)) {
          const nombreT = normalize(res.name);
          if (nombreT.includes(normalizado) || normalizado.includes(nombreT) || consultas.length === 1) {
            collectionIds.push(res.id);
          }
        }
      }
    } catch {
      /* continuar */
    }
  }

  // 2. Si no hubo coincidencia por nombre, mirar belongs_to_collection de sus películas
  if (collectionIds.length === 0) {
    const items = db
      .prepare('SELECT tmdb_id FROM items WHERE collection = ? AND tmdb_id IS NOT NULL AND length(tmdb_id) > 0 LIMIT 15')
      .all(nombre) as { tmdb_id: string }[];
    const vistas = new Map<number, { id: number; name: string; count: number }>();
    for (const it of items) {
      const tid = Number(it.tmdb_id);
      if (!tid) continue;
      try {
        const p = await tmdb<any>(`/movie/${tid}`);
        if (p.belongs_to_collection?.id) {
          const cid = p.belongs_to_collection.id;
          const actual = vistas.get(cid) || { id: cid, name: p.belongs_to_collection.name, count: 0 };
          actual.count++;
          vistas.set(cid, actual);
        }
      } catch {}
    }
    for (const col of vistas.values()) {
      const normCol = normalize(col.name);
      if (normCol.includes(normalizado) || normalizado.includes(normCol) || col.count === items.length) {
        collectionIds.push(col.id);
        break;
      }
    }
  }

  if (collectionIds.length === 0) {
    return { posters: [], fanarts: [] };
  }

  const mapa = (lista: any[], anchoVista: number): ImagenDisponible[] =>
    (lista ?? [])
      .map((i) => ({
        url: imageUrl(i.file_path) as string,
        vista: imageUrl(i.file_path, `w${anchoVista}`) as string,
        ancho: i.width ?? 0,
        alto: i.height ?? 0,
        idioma: i.iso_639_1 ?? '',
        voto: i.vote_average ?? 0,
      }))
      .filter((i) => i.url);

  let todosPosters: ImagenDisponible[] = [];
  let todosFanarts: ImagenDisponible[] = [];

  for (const cid of collectionIds.slice(0, 10)) {
    try {
      const raw = await tmdb<any>(`/collection/${cid}/images`, {
        include_image_language: `${idioma},en,null`,
      });
      if (raw.posters) todosPosters.push(...mapa(raw.posters, 342));
      if (raw.backdrops) todosFanarts.push(...mapa(raw.backdrops, 300));
    } catch {}

    if (config.fanartApiKey) {
      try {
        const fanartRes = await fetch(`https://webservice.fanart.tv/v3/movies/${cid}?api_key=${config.fanartApiKey}`).then((r) => r.json());
        if (fanartRes.movieposter) {
          todosPosters.push(
            ...fanartRes.movieposter.map((p: any) => ({
              url: p.url,
              vista: p.url.replace('/fanart/', '/preview/'),
              ancho: 1000,
              alto: 1500,
              idioma: p.lang === '00' ? '' : p.lang,
              voto: Number(p.likes || 0),
            }))
          );
        }
        if (fanartRes.moviebackground) {
          todosFanarts.push(
            ...fanartRes.moviebackground.map((b: any) => ({
              url: b.url,
              vista: b.url.replace('/fanart/', '/preview/'),
              ancho: 1920,
              alto: 1080,
              idioma: b.lang === '00' ? '' : b.lang,
              voto: Number(b.likes || 0),
            }))
          );
        }
      } catch {}
    }
  }

  const seenPosters = new Set<string>();
  const uniquePosters = todosPosters.filter((p) => {
    if (seenPosters.has(p.url)) return false;
    seenPosters.add(p.url);
    return true;
  });

  const seenFanarts = new Set<string>();
  const uniqueFanarts = todosFanarts.filter((f) => {
    if (seenFanarts.has(f.url)) return false;
    seenFanarts.add(f.url);
    return true;
  });

  return {
    posters: uniquePosters.sort((a, b) => orden(a, idioma) - orden(b, idioma) || b.voto - a.voto),
    fanarts: uniqueFanarts.sort((a, b) => orden(a, idioma) - orden(b, idioma) || b.voto - a.voto),
  };
}


/** Solo los logotipos de TMDb con su idioma, para saber de dónde salió uno local. */
export async function logosDeTmdb(tmdbId: number, kind: 'movie' | 'show'): Promise<{ url: string; vista: string; idioma: string }[]> {
  const raw = await tmdb<any>(`/${endpoint(kind)}/${tmdbId}/images`, { include_image_language: 'null' });
  return (raw.logos ?? [])
    .map((i: any) => ({ url: imageUrl(i.file_path) as string, vista: imageUrl(i.file_path, 'w300') as string, idioma: i.iso_639_1 ?? '' }))
    .filter((i: any) => i.url);
}

/** Los ids externos de TMDb: el de TheTVDB es el que pide fanart.tv para series. */
export async function tmdbExternalIds(tmdbId: number, kind: 'movie' | 'show'): Promise<{ tvdb_id?: number; imdb_id?: string } | null> {
  return tmdb<any>(`/${endpoint(kind)}/${tmdbId}/external_ids`);
}

/** Primero el idioma de casa, luego las sin texto, luego ingles, luego el resto. */
function orden(i: ImagenDisponible, idioma: string): number {
  if (i.idioma === idioma) return 0;
  if (!i.idioma) return 1;
  if (i.idioma === 'en') return 2;
  return 3;
}

const FICHERO_DE: Record<Papel, string> = {
  poster: 'poster.jpg',
  fanart: 'fanart.jpg',
  clearlogo: 'logo.png',
  landscape: 'landscape.jpg',
  discart: 'disc.png',
};

const COLUMNA_DE: Record<Papel, string> = {
  poster: 'poster',
  fanart: 'fanart',
  clearlogo: 'clearlogo',
  landscape: 'landscape',
  discart: 'discart',
};

/**
 * Poner una imagen concreta, elegida a mano.
 *
 * Se guarda en la carpeta de datos de TvWatch, **no** en la de la pelicula: las
 * carpetas de la biblioteca son del usuario y estan cuidadas, y no se tocan.
 * Queda apuntada en `arte_fijado` para que el escaner no la pise en la
 * siguiente pasada, que es lo que hacia que cambiar una caratula no durase nada.
 */
export async function ponerArte(itemId: number, papel: Papel, url: string) {
  const dir = carpetaDeArte(itemId);
  const destino = await descargar(url, join(dir, FICHERO_DE[papel]));
  fijarArte(itemId, papel, destino);
  return { papel, ruta: destino };
}

/**
 * Lo mismo, pero con los bytes ya en la mano: una imagen subida desde la web o
 * cogida del buzon. No pasa por `descargar`, que solo sabe de http.
 *
 * El formato se decide por el CONTENIDO, no por lo que diga el navegador, y la
 * extension acompana a ese formato: `thumbnail()` mira la extension del origen
 * para saber si conserva transparencia, asi que un PNG guardado como .jpg le
 * habria quitado el canal alfa a un logotipo.
 */
export function ponerArteDeDatos(itemId: number, papel: Papel, datos: Buffer) {
  const ext = formatoDeImagen(datos);
  if (!ext) throw new Error('Eso no es una imagen JPEG, PNG ni WebP');
  const dir = carpetaDeArte(itemId);
  const base = FICHERO_DE[papel].replace(EXTENSION, '');
  const destino = join(dir, base + '.' + ext);
  writeFileSync(destino, datos);
  fijarArte(itemId, papel, destino);
  return { papel, ruta: destino };
}

const EXTENSION = /\.[a-z]+$/;

/** Los primeros bytes dicen lo que es; la extension y el Content-Type, no. */
export function formatoDeImagen(datos: Buffer): 'jpg' | 'png' | 'webp' | null {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (datos.length > 3 && datos[0] === 0xff && datos[1] === 0xd8 && datos[2] === 0xff) return 'jpg';
  if (datos.length > 8 && datos.subarray(0, 8).equals(PNG)) return 'png';
  if (datos.length > 12 && datos.subarray(0, 4).toString('latin1') === 'RIFF' &&
      datos.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
}

function carpetaDeArte(itemId: number): string {
  const item = db.prepare('SELECT id FROM items WHERE id = ?').get(itemId) as { id: number } | undefined;
  if (!item) throw new Error('El titulo ya no existe');
  const dir = join(ARTWORK_DIR, String(itemId));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Apunta en la base que este papel lo ha elegido una persona. */
function fijarArte(itemId: number, papel: Papel, destino: string) {
  const item = db.prepare('SELECT arte_fijado FROM items WHERE id = ?').get(itemId) as
    | { arte_fijado: string | null }
    | undefined;
  const papeles = new Set((item?.arte_fijado ?? '').split(',').filter(Boolean));
  papeles.add(papel);
  db.prepare(`UPDATE items SET ${COLUMNA_DE[papel]} = ?, arte_fijado = ?, arte_actualizado = ? WHERE id = ?`)
    .run(destino, [...papeles].join(','), new Date().toISOString(), itemId);
}

/**
 * Deshacer una eleccion y volver a lo que haya en la carpeta de la pelicula.
 *
 * El fichero descargado no se borra —aqui no se borra nada sin pedirlo— solo
 * se deja de usar. Si se vuelve a elegir la misma imagen, se baja otra vez y ya.
 */
export function soltarArte(itemId: number, papel: Papel) {
  const item = db.prepare('SELECT arte_fijado FROM items WHERE id = ?').get(itemId) as
    | { arte_fijado: string | null }
    | undefined;
  if (!item) throw new Error('El titulo ya no existe');

  const papeles = new Set((item.arte_fijado ?? '').split(',').filter(Boolean));
  papeles.delete(papel);
  // A NULL: el proximo escaneo lo rellena con lo que encuentre en la carpeta.
  db.prepare(`UPDATE items SET ${COLUMNA_DE[papel]} = NULL, arte_fijado = ?, arte_actualizado = ? WHERE id = ?`)
    .run(papeles.size ? [...papeles].join(',') : null, new Date().toISOString(), itemId);
  return { papel, soltado: true };
}

export type ApplyRequest = {
  itemId: number;
  tmdbId: number;
  kind: 'movie' | 'show';
  fields: ('poster' | 'fanart' | 'logo' | 'plot' | 'rating' | 'genres')[];
  overwrite?: boolean;
  /**
   * Instalacion sin .nfo: ademas de rellenar huecos, TMDb pasa a ser la
   * identidad del titulo (nombre, ano, clasificacion...) y se marca con
   * `meta_origen = 'tmdb'` para que el escaneo no lo borre.
   */
  identidad?: boolean;
};

/** Writes only the requested fields, and only into gaps unless `overwrite` is set. */
export async function applyProposal(request: ApplyRequest) {
  const item = db.prepare('SELECT id, poster, fanart, clearlogo, plot, rating, arte_fijado FROM items WHERE id = ?').get(request.itemId) as any;
  if (!item) throw new Error('El título ya no existe');

  const proposal = await details(request.tmdbId, request.kind);
  const dir = join(ARTWORK_DIR, String(request.itemId));
  mkdirSync(dir, { recursive: true });

  const updates: Record<string, string | number> = {};
  const wants = (field: string, current: unknown) => request.fields.includes(field as never) && (request.overwrite || current == null);

  if (wants('poster', item.poster) && proposal.posterUrl) updates.poster = await descargar(proposal.posterUrl, join(dir, 'poster.jpg'));
  if (wants('fanart', item.fanart) && proposal.backdropUrl) updates.fanart = await descargar(proposal.backdropUrl, join(dir, 'fanart.jpg'));
  if (wants('logo', item.clearlogo) && proposal.logoUrl) updates.clearlogo = await descargar(proposal.logoUrl, join(dir, 'logo.png'));
  if (wants('plot', item.plot) && proposal.overview) updates.plot = proposal.overview;
  if (wants('rating', item.rating) && proposal.rating != null) updates.rating = proposal.rating;

  if (request.fields.includes('genres') && proposal.genres.length > 0) {
    const genreStmt = db.prepare('INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id');
    const link = db.prepare('INSERT OR IGNORE INTO item_genres (item_id, genre_id) VALUES (?,?)');
    for (const name of proposal.genres) link.run(request.itemId, (genreStmt.get(name) as { id: number }).id);
  }

  /*
   * Lo que se elige a mano se marca, para que el escaner no lo pise en la
   * siguiente pasada. Es el motivo de que cambiar una caratula no durase nada.
   */
  const papeles = new Set((item.arte_fijado ?? '').split(',').filter(Boolean));
  if (updates.poster) papeles.add('poster');
  if (updates.fanart) papeles.add('fanart');
  if (updates.clearlogo) papeles.add('clearlogo');
  if (papeles.size) updates.arte_fijado = [...papeles].join(',');
  if (updates.poster || updates.fanart || updates.clearlogo) updates.arte_actualizado = new Date().toISOString();

  updates.tmdb_id = String(request.tmdbId);

  if (request.identidad) {
    if (proposal.title) {
      updates.title = proposal.title;
      updates.search_title = normalize(proposal.title);
    }
    if (proposal.year != null) updates.year = proposal.year;
    if (proposal.originalTitle) updates.original_title = proposal.originalTitle;
    if (proposal.votos != null) updates.votes = proposal.votos;
    if (proposal.tagline) updates.tagline = proposal.tagline;
    if (proposal.runtime) updates.runtime = proposal.runtime;
    if (proposal.imdbId) updates.imdb_id = proposal.imdbId;
    if (proposal.estreno) updates.premiered = proposal.estreno;
    if (proposal.coleccion) updates.collection = proposal.coleccion;
    if (proposal.certificacion) updates.mpaa = proposal.certificacion;
    updates.meta_origen = 'tmdb';
  }

  const keys = Object.keys(updates);
  if (keys.length > 0) {
    db.prepare(`UPDATE items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => updates[k]), request.itemId);
  }

  return { applied: keys.filter((k) => k !== 'tmdb_id'), title: proposal.title };
}
