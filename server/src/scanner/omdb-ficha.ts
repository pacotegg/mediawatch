/*
 * OMDb como segunda fuente del scraper, al lado de TMDb: buscar un titulo por nombre o id de IMDb y aplicar sus datos.
 *
 * Lo que OMDb NO tiene (y se nota en la pantalla): fondo, logo, reparto con fotos, estudios en varios idiomas; y la sinopsis y el titulo
 * llegan en INGLES. Por eso aqui no se toca la identidad (titulo, ano) y la sinopsis solo entra si se pide; lo que aporta de verdad
 * son la nota de IMDb, la edad, los generos y un cartel de reserva.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { descargarWebp, DIR_ARTE, type Proposal } from './tmdb.ts';
import { tomarInstantanea } from './historial.ts';

/** Direccion base; se puede cambiar solo para las pruebas (servidor falso en local). */
const BASE = process.env.MEDIAWATCH_OMDB_URL || 'https://www.omdbapi.com/';

export class OmdbError extends Error {}

type Ficha = Record<string, string | undefined> & { Response?: string; Error?: string };

async function pedir(params: Record<string, string>): Promise<Ficha> {
  if (!config.omdbApiKey) throw new OmdbError('Falta la clave de OMDb (Ajustes del servidor)');
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apikey', config.omdbApiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const j = (await res.json()) as Ficha;
  if (j.Response !== 'True') throw new OmdbError(j.Error || 'OMDb no responde');
  return j;
}

const dato = (v: string | undefined) => (v && v !== 'N/A' ? v : null);
const lista = (v: string | undefined) => (dato(v) ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** «Rated»: solo sirve lo que es una edad; «Not Rated», «Unrated» y «Approved» no dicen nada. */
function edad(v: string | undefined): string | null {
  const d = dato(v);
  return d && !/^(not rated|unrated|approved|passed|n\/a)$/i.test(d) ? d : null;
}

function aPropuesta(f: Ficha, kind: 'movie' | 'show'): Proposal & { fuente: 'omdb' } {
  const nota = Number(dato(f.imdbRating));
  const votos = Number((dato(f.imdbVotes) ?? '').replace(/[^\d]/g, ''));
  const minutos = Number((dato(f.Runtime) ?? '').match(/\d+/)?.[0]);
  return {
    fuente: 'omdb',
    tmdbId: 0,
    kind,
    title: f.Title ?? '',
    year: Number((f.Year ?? '').match(/\d{4}/)?.[0]) || null,
    overview: dato(f.Plot),
    rating: Number.isFinite(nota) && nota > 0 ? nota : null,
    posterUrl: dato(f.Poster),
    backdropUrl: null,
    logoUrl: null,
    genres: lista(f.Genre),
    certificacion: edad(f.Rated),
    imdbId: f.imdbID ?? null,
    runtime: Number.isFinite(minutos) && minutos > 0 ? minutos : null,
    votos: votos || null,
    directores: lista(f.Director),
    paises: lista(f.Country),
  };
}

export async function detallesOmdb(imdbId: string, kind: 'movie' | 'show') {
  return aPropuesta(await pedir({ i: imdbId, plot: 'full' }), kind);
}

/** Busca por titulo y trae la ficha de los primeros resultados (cada una es una consulta: el cupo gratuito es de 1.000 al dia). */
export async function buscarOmdb(texto: string, kind: 'movie' | 'show', year?: number | null, maximo = 4) {
  let hallados: Ficha[];
  try {
    const r = (await pedir({ s: texto, type: kind === 'show' ? 'series' : 'movie', ...(year ? { y: String(year) } : {}) })) as unknown as { Search?: Ficha[] };
    hallados = r.Search ?? [];
  } catch (e) {
    if (e instanceof OmdbError && /not found/i.test(e.message)) return [];
    throw e;
  }
  const fichas = await Promise.all(hallados.slice(0, maximo).map((h) => pedir({ i: h.imdbID ?? '', plot: 'full' }).catch(() => null)));
  return fichas.filter((f): f is Ficha => f !== null).map((f) => aPropuesta(f, kind));
}

export type AplicarOmdb = {
  itemId: number;
  imdbId: string;
  kind: 'movie' | 'show';
  fields: ('poster' | 'plot' | 'rating' | 'genres')[];
  overwrite?: boolean;
};

/** Escribe solo lo pedido y, salvo `overwrite`, solo en huecos. Se deshace desde el historial del scraper. */
export async function aplicarOmdb(req: AplicarOmdb) {
  const item = db.prepare('SELECT id, poster, plot, rating, imdb_id, arte_fijado FROM items WHERE id = ?').get(req.itemId) as
    | { id: number; poster: string | null; plot: string | null; rating: number | null; imdb_id: string | null; arte_fijado: string | null } | undefined;
  if (!item) throw new OmdbError('El título ya no existe');
  const p = await detallesOmdb(req.imdbId, req.kind);
  tomarInstantanea(req.itemId, `Aplicar ${req.fields.join(', ')} desde OMDb ${req.imdbId}`);

  const updates: Record<string, string | number> = {};
  const quiere = (c: string, actual: unknown) => req.fields.includes(c as never) && (req.overwrite || actual == null || actual === '');
  if (quiere('poster', item.poster) && p.posterUrl) {
    const dir = join(DIR_ARTE, String(req.itemId));
    mkdirSync(dir, { recursive: true });
    updates.poster = await descargarWebp(p.posterUrl, join(dir, 'poster'), 82);
    updates.arte_fijado = [...new Set([...(item.arte_fijado ?? '').split(',').filter(Boolean), 'poster'])].join(',');
    updates.arte_actualizado = new Date().toISOString();
  }
  if (quiere('plot', item.plot) && p.overview) updates.plot = p.overview;
  if (quiere('rating', item.rating) && p.rating != null) updates.rating = p.rating;
  if (!item.imdb_id && p.imdbId) updates.imdb_id = p.imdbId;

  const claves = Object.keys(updates);
  if (claves.length) db.prepare(`UPDATE items SET ${claves.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...claves.map((k) => updates[k]), req.itemId);

  if (req.fields.includes('genres') && p.genres.length) {
    const genero = db.prepare('INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id');
    const enlazar = db.prepare('INSERT OR IGNORE INTO item_genres (item_id, genre_id) VALUES (?,?)');
    for (const g of p.genres) enlazar.run(req.itemId, (genero.get(g) as { id: number }).id);
  }
  return { applied: [...claves.filter((k) => !['arte_fijado', 'arte_actualizado'].includes(k)), ...(req.fields.includes('genres') && p.genres.length ? ['genres'] : [])], title: p.title };
}
