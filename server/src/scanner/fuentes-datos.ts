/*
 * Todas las fuentes de datos de un titulo, lado a lado, para que el administrador elija de CUAL toma cada dato.
 *
 *   TMDb    español; la principal (reparto, fondo, logo)
 *   TVDB    español (traduccion de titulo y sinopsis); a veces tiene lo que TMDb no
 *   OMDb    ingles; nota de IMDb, edad y generos
 *   TVmaze  ingles; solo series; nota, generos y cartel
 *
 * Se parte de los ids que ya se conocen y se enlazan entre si (TMDb conoce el IMDb y el TVDB; OMDb y TVmaze se piden por IMDb), asi que
 * no se adivina por el nombre: cada fuente habla del MISMO titulo. Cada una se consulta por su cuenta: si una falla, el resto sigue y se avisa.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { descargarWebp, DIR_ARTE, detallesDe, tmdbExternalIds, tmdbGet, type Proposal } from './tmdb.ts';
import { detallesOmdb } from './omdb-ficha.ts';
import { fichaTvdb } from './tvdb.ts';
import { tomarInstantanea } from './historial.ts';

export type FuenteId = 'tmdb' | 'tvdb' | 'omdb' | 'tvmaze';

export type FichaFuente = {
  fuente: FuenteId;
  id: string;
  enlace: string | null;
  /** Idioma de titulo, sinopsis y generos. */
  idioma: 'es' | 'en';
  title: string | null;
  year: number | null;
  overview: string | null;
  rating: number | null;
  votos: number | null;
  genres: string[];
  certificacion: string | null;
  runtime: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
};

export class FuentesError extends Error {
  readonly codigo: number;
  constructor(mensaje: string, codigo = 400) { super(mensaje); this.codigo = codigo; }
}

const TVMAZE = process.env.MEDIAWATCH_TVMAZE_URL || 'https://api.tvmaze.com';

const limpiarHtml = (h: string | null | undefined): string | null => {
  const t = (h ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
  return t || null;
};

type Tvmaze = { id: number; url?: string; name: string; premiered?: string | null; summary?: string | null; genres?: string[]; runtime?: number | null; averageRuntime?: number | null; rating?: { average: number | null }; image?: { original?: string; medium?: string } | null };

async function tvmazeFicha(imdbId: string | null, tvdbId: number | null): Promise<FichaFuente | null> {
  const consulta = imdbId ? `imdb=${encodeURIComponent(imdbId)}` : tvdbId ? `thetvdb=${tvdbId}` : null;
  if (!consulta) return null;
  const res = await fetch(`${TVMAZE}/lookup/shows?${consulta}`, { signal: AbortSignal.timeout(15_000), redirect: 'follow' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TVmaze respondio ${res.status}`);
  const s = (await res.json()) as Tvmaze;
  const nota = s.rating?.average;
  return {
    fuente: 'tvmaze', id: String(s.id), enlace: s.url ?? null, idioma: 'en',
    title: s.name, year: Number((s.premiered ?? '').slice(0, 4)) || null, overview: limpiarHtml(s.summary),
    rating: typeof nota === 'number' && nota > 0 ? nota : null, votos: null, genres: s.genres ?? [], certificacion: null,
    runtime: s.runtime ?? s.averageRuntime ?? null, posterUrl: s.image?.original ?? s.image?.medium ?? null, backdropUrl: null, logoUrl: null,
  };
}

const deTmdb = (p: Proposal, kind: 'movie' | 'show'): FichaFuente => ({
  fuente: 'tmdb', id: String(p.tmdbId), enlace: `https://www.themoviedb.org/${kind === 'show' ? 'tv' : 'movie'}/${p.tmdbId}`, idioma: 'es',
  title: p.title || null, year: p.year, overview: p.overview || null, rating: p.rating, votos: p.votos ?? null, genres: p.genres,
  certificacion: p.certificacion ?? null, runtime: p.runtime ?? null, posterUrl: p.posterUrl, backdropUrl: p.backdropUrl, logoUrl: p.logoUrl,
});

export type IdsConocidos = { tmdbId?: number | null; imdbId?: string | null };

/** Consulta todas las fuentes que puedan hablar de este titulo. Devuelve lo que halle y, aparte, por que alguna no contesto. */
export async function consultarFuentes(kind: 'movie' | 'show', conocidos: IdsConocidos): Promise<{ ids: { tmdbId: number | null; imdbId: string | null; tvdbId: number | null }; fichas: FichaFuente[]; avisos: string[] }> {
  const avisos: string[] = [];
  const fichas: FichaFuente[] = [];
  let tmdbId = conocidos.tmdbId ?? null;
  let imdbId = conocidos.imdbId ?? null;
  let tvdbId: number | null = null;

  if (!tmdbId && imdbId && config.tmdbApiKey) {
    try {
      const r = await tmdbGet<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(`/find/${imdbId}`, { external_source: 'imdb_id' });
      tmdbId = (kind === 'movie' ? r.movie_results : r.tv_results)?.[0]?.id ?? null;
    } catch (e) { avisos.push(`TMDb: ${(e as Error).message}`); }
  }
  if (tmdbId && config.tmdbApiKey) {
    try {
      const p = await detallesDe(tmdbId, kind);
      fichas.push(deTmdb(p, kind));
      imdbId = imdbId ?? p.imdbId ?? null;
      const ext = await tmdbExternalIds(tmdbId, kind).catch(() => null);
      tvdbId = ext?.tvdb_id ?? null;
      imdbId = imdbId ?? ext?.imdb_id ?? null;
    } catch (e) { avisos.push(`TMDb: ${(e as Error).message}`); }
  } else if (!config.tmdbApiKey) avisos.push('TMDb: falta la clave');

  const pedidas: [FuenteId, Promise<FichaFuente | null>][] = [];
  if (config.omdbApiKey && imdbId) {
    pedidas.push(['omdb', detallesOmdb(imdbId, kind).then((p) => ({
      fuente: 'omdb' as const, id: p.imdbId ?? imdbId!, enlace: `https://www.imdb.com/title/${imdbId}/`, idioma: 'en' as const,
      title: p.title || null, year: p.year, overview: p.overview, rating: p.rating, votos: p.votos ?? null, genres: p.genres,
      // La biblioteca guarda la edad con su pais delante (ES:18, US:R): OMDb da la de EE. UU.
      certificacion: p.certificacion ? 'US:' + p.certificacion : null, runtime: p.runtime ?? null, posterUrl: p.posterUrl, backdropUrl: null, logoUrl: null,
    }))]);
  }
  if (config.tvdbApiKey && (tvdbId || imdbId)) {
    pedidas.push(['tvdb', fichaTvdb(kind, { tvdbId, imdbId }).then((t) => (t ? {
      fuente: 'tvdb' as const, id: String(t.id), enlace: null, idioma: t.idioma, title: t.title, year: t.year, overview: t.overview,
      rating: null, votos: null, genres: t.genres, certificacion: t.certificacion ? 'ES:' + t.certificacion : null, runtime: t.runtime, posterUrl: t.posterUrl, backdropUrl: null, logoUrl: null,
    } : null))]);
  }
  if (kind === 'show' && (imdbId || tvdbId)) pedidas.push(['tvmaze', tvmazeFicha(imdbId, tvdbId)]);

  const resultados = await Promise.allSettled(pedidas.map(([, p]) => p));
  resultados.forEach((r, i) => {
    const nombre = { omdb: 'OMDb', tvdb: 'TVDB', tvmaze: 'TVmaze', tmdb: 'TMDb' }[pedidas[i][0]];
    if (r.status === 'fulfilled') { if (r.value) fichas.push(r.value); else avisos.push(`${nombre}: no tiene este título`); }
    else avisos.push(`${nombre}: ${(r.reason as Error).message}`);
  });
  return { ids: { tmdbId, imdbId, tvdbId }, fichas, avisos };
}

/* ------------------------------------------------------------------ aplicar eligiendo fuente por dato */

export const CAMPOS_MEZCLA = ['poster', 'fanart', 'logo', 'plot', 'rating', 'genres', 'mpaa'] as const;
export type CampoMezcla = (typeof CAMPOS_MEZCLA)[number];
export type Elecciones = Partial<Record<CampoMezcla, FuenteId>>;

/**
 * Pone en el titulo cada dato de LA FUENTE ELEGIDA para ese dato. Se vuelven a pedir las fuentes aqui (no se fia de nada que mande el
 * cliente, ni direcciones de imagen), se toma UNA instantanea (un solo «Deshacer») y los generos se SUSTITUYEN por los de esa fuente.
 */
export async function aplicarMezcla(itemId: number, kind: 'movie' | 'show', conocidos: IdsConocidos, elecciones: Elecciones) {
  const item = db.prepare('SELECT id, tmdb_id, imdb_id, arte_fijado FROM items WHERE id = ?').get(itemId) as { id: number; tmdb_id: string | null; imdb_id: string | null; arte_fijado: string | null } | undefined;
  if (!item) throw new FuentesError('El título ya no existe', 404);
  const campos = Object.keys(elecciones) as CampoMezcla[];
  if (campos.length === 0) throw new FuentesError('No has elegido nada que aplicar');
  const { ids, fichas } = await consultarFuentes(kind, conocidos);
  const de = (c: CampoMezcla) => {
    const f = fichas.find((x) => x.fuente === elecciones[c]);
    const valor = !f ? null : { poster: f.posterUrl, fanart: f.backdropUrl, logo: f.logoUrl, plot: f.overview, rating: f.rating, genres: f.genres.length ? f.genres : null, mpaa: f.certificacion }[c];
    if (valor == null) throw new FuentesError(`${elecciones[c]?.toUpperCase()} no tiene ${c === 'mpaa' ? 'la edad' : c} para este título`);
    return valor;
  };
  const valores = Object.fromEntries(campos.map((c) => [c, de(c)])) as Record<CampoMezcla, string | number | string[]>;

  tomarInstantanea(itemId, `Mezclar fuentes: ${campos.map((c) => `${c} de ${elecciones[c]}`).join(', ')}`);
  const updates: Record<string, string | number> = {};
  const dir = join(DIR_ARTE, String(itemId));
  const fijados = new Set((item.arte_fijado ?? '').split(',').filter(Boolean));
  for (const [campo, columna, base, calidad] of [['poster', 'poster', 'poster', 82], ['fanart', 'fanart', 'fanart', 82], ['logo', 'clearlogo', 'logo', 90]] as const) {
    if (!(campo in valores)) continue;
    mkdirSync(dir, { recursive: true });
    updates[columna] = await descargarWebp(String(valores[campo]), join(dir, base), calidad);
    fijados.add(columna);
  }
  if (fijados.size && ('poster' in valores || 'fanart' in valores || 'logo' in valores)) { updates.arte_fijado = [...fijados].join(','); updates.arte_actualizado = new Date().toISOString(); }
  if ('plot' in valores) updates.plot = String(valores.plot);
  if ('rating' in valores) updates.rating = Number(valores.rating);
  if ('mpaa' in valores) updates.mpaa = String(valores.mpaa);
  if (!item.tmdb_id && ids.tmdbId) updates.tmdb_id = String(ids.tmdbId);
  if (!item.imdb_id && ids.imdbId) updates.imdb_id = ids.imdbId;

  const claves = Object.keys(updates);
  db.exec('BEGIN');
  try {
    if (claves.length) db.prepare(`UPDATE items SET ${claves.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...claves.map((k) => updates[k]), itemId);
    if ('genres' in valores) {
      db.prepare('DELETE FROM item_genres WHERE item_id = ?').run(itemId);
      const genero = db.prepare('INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id');
      const enlazar = db.prepare('INSERT OR IGNORE INTO item_genres (item_id, genre_id) VALUES (?,?)');
      for (const g of valores.genres as string[]) enlazar.run(itemId, (genero.get(g) as { id: number }).id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { aplicado: campos.map((c) => ({ campo: c, fuente: elecciones[c]! })) };
}
