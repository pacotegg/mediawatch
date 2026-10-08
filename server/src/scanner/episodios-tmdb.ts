/*
 * Titulo, sinopsis, fecha, duracion, nota y miniatura de cada episodio desde
 * TMDb, para series sin .nfo. Solo toca episodios sin datos propios (sin
 * sinopsis ni fecha: lo que dejaria un .nfo no se pisa) y los marca con
 * `meta_origen = 'tmdb'` para que el escaneo no los borre.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.ts';
import { DIR_ARTE, TMDB_IMAGENES, descargar, tmdbGet } from './tmdb.ts';

type EpisodioTmdb = {
  episode_number: number;
  name?: string;
  overview?: string;
  air_date?: string | null;
  runtime?: number | null;
  vote_average?: number;
  still_path?: string | null;
};

export async function rellenarEpisodios(showId: number, tmdbId: number): Promise<number> {
  const temporadas = db.prepare('SELECT DISTINCT season FROM episodes WHERE show_id = ? ORDER BY season').all(showId) as { season: number }[];
  const dir = join(DIR_ARTE, String(showId));
  const buscar = db.prepare('SELECT id FROM episodes WHERE show_id = ? AND season = ? AND episode = ? AND plot IS NULL AND aired IS NULL');
  const poner = db.prepare(
    `UPDATE episodes SET title = COALESCE(NULLIF(?, ''), title), plot = ?, aired = ?, runtime = ?, rating = ?,
       thumb = COALESCE(?, thumb), meta_origen = 'tmdb' WHERE id = ?`,
  );
  let hechos = 0;

  for (const { season } of temporadas) {
    let datos: { episodes?: EpisodioTmdb[] };
    try {
      datos = await tmdbGet<{ episodes?: EpisodioTmdb[] }>(`/tv/${tmdbId}/season/${season}`);
    } catch {
      continue; // la temporada no existe en TMDb: se queda como esta
    }
    for (const e of datos.episodes ?? []) {
      const fila = buscar.get(showId, season, e.episode_number) as { id: number } | undefined;
      if (!fila) continue;
      let miniatura: string | null = null;
      if (e.still_path) {
        try {
          mkdirSync(dir, { recursive: true });
          miniatura = await descargar(`${TMDB_IMAGENES}/w780${e.still_path}`, join(dir, `ep-${season}x${e.episode_number}.jpg`));
        } catch {
          /* sin miniatura: la ficha sigue valiendo */
        }
      }
      poner.run(
        e.name ?? '', e.overview || null, e.air_date || null, e.runtime ?? null,
        e.vote_average ? e.vote_average : null, miniatura, fila.id,
      );
      hechos++;
    }
  }
  return hechos;
}
