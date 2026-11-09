/*
 * Las propuestas de OMDb y TVDB no siempre traen id de TMDb (OMDb nunca), y el Asistente aplica con TMDb (reparto, estudios, episodios).
 * Aqui se cruzan por IMDb: lo que TMDb conoce se sustituye por SU ficha (lo que se ve es lo que se aplicara) y lo que no, se descarta
 * contando cuantas fueron, para avisar en vez de perderlas en silencio.
 */
import { detallesDe, tmdbGet, type Proposal } from './tmdb.ts';

export type Enlazador = {
  porImdb: (imdbId: string, kind: 'movie' | 'show') => Promise<number | null>;
  ficha: (tmdbId: number, kind: 'movie' | 'show') => Promise<Proposal>;
};

export const enlazadorReal: Enlazador = {
  porImdb: async (imdbId, kind) => {
    const r = await tmdbGet<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(`/find/${imdbId}`, { external_source: 'imdb_id' });
    return (kind === 'movie' ? r.movie_results : r.tv_results)?.[0]?.id ?? null;
  },
  ficha: (id, kind) => detallesDe(id, kind),
};

export async function enlazarConTmdb(propuestas: Proposal[], kind: 'movie' | 'show', e: Enlazador = enlazadorReal): Promise<{ propuestas: Proposal[]; sinEnlace: number }> {
  const salida: Proposal[] = [];
  let sinEnlace = 0;
  for (const p of propuestas) {
    try {
      const id = p.tmdbId > 0 ? p.tmdbId : p.imdbId ? await e.porImdb(p.imdbId, kind) : null;
      if (!id) { sinEnlace++; continue; }
      if (salida.some((s) => s.tmdbId === id)) continue;
      salida.push(p.tmdbId > 0 ? p : await e.ficha(id, kind));
    } catch {
      sinEnlace++;
    }
  }
  return { propuestas: salida, sinEnlace };
}
