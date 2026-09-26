import { config } from '../config.ts';
import { db } from '../db.ts';

const API = 'https://api.themoviedb.org/3';
const IMAGES = 'https://image.tmdb.org/t/p/w300';

export type DetallePersona = {
  tmdb_id: number | null;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  birthplace: string | null;
  profile: string | null;
  fetched_at: string;
};

async function tmdb<T>(path: string, params: Record<string, string>): Promise<T | null> {
  if (!config.tmdbApiKey) return null;
  const url = new URL(API + path);
  url.searchParams.set('api_key', config.tmdbApiKey);
  url.searchParams.set('language', config.tmdbLanguage);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/**
 * Ficha de una persona. Se guarda en la base al traerla, así que solo se pide a
 * TMDb la primera vez que alguien la abre — abrir un reparto entero no dispara
 * diez peticiones cada vez.
 */
export async function detallePersona(personId: number): Promise<DetallePersona | null> {
  const guardado = db
    .prepare('SELECT tmdb_id, biography, birthday, deathday, birthplace, profile, fetched_at FROM people_details WHERE person_id = ?')
    .get(personId) as DetallePersona | undefined;
  // Completa del todo: ya está. `biography` a cadena vacía (no NULL) es la
  // marca de "ya comprobado en TMDb, no tenía biografía" que pone la pasada
  // masiva (detalles-personas.ts); tratarla como "falta" volvía a preguntar a
  // TMDb en cada visita a esa ficha. Solo con el id (lo apunta la pasada de
  // personas) y sin haber comprobado aún el resto: se trae por ese id, sin
  // adivinar por nombre.
  if (guardado && (guardado.biography !== null || guardado.birthday || !guardado.tmdb_id)) return guardado;

  const persona = db.prepare('SELECT name FROM people WHERE id = ?').get(personId) as { name: string } | undefined;
  if (!persona) return null;

  let encontrado: { id: number } | undefined = guardado?.tmdb_id ? { id: guardado.tmdb_id } : undefined;
  if (!encontrado) {
    const busqueda = await tmdb<{ results: { id: number }[] }>('/search/person', { query: persona.name });
    encontrado = busqueda?.results?.[0];
  }
  if (!encontrado) return guardado ?? null;

  const ficha = await tmdb<{
    id: number;
    biography: string;
    birthday: string | null;
    deathday: string | null;
    place_of_birth: string | null;
    profile_path: string | null;
  }>(`/person/${encontrado.id}`, {});
  if (!ficha) return null;

  // TMDb deja la biografía vacía en español muchas veces; en ese caso vale más
  // la inglesa que un hueco.
  let biografia = ficha.biography || null;
  if (!biografia) {
    const enIngles = await tmdb<{ biography: string }>(`/person/${encontrado.id}`, { language: 'en-US' });
    biografia = enIngles?.biography || null;
  }

  const detalle: DetallePersona = {
    tmdb_id: ficha.id,
    biography: biografia,
    birthday: ficha.birthday,
    deathday: ficha.deathday,
    birthplace: ficha.place_of_birth,
    profile: ficha.profile_path ? IMAGES + ficha.profile_path : null,
    fetched_at: new Date().toISOString(),
  };

  db.prepare(`INSERT INTO people_details (person_id, tmdb_id, biography, birthday, deathday, birthplace, profile, fetched_at)
              VALUES (?,?,?,?,?,?,?,?)
              ON CONFLICT(person_id) DO UPDATE SET
                tmdb_id=excluded.tmdb_id, biography=excluded.biography, birthday=excluded.birthday,
                deathday=excluded.deathday, birthplace=excluded.birthplace, profile=excluded.profile,
                fetched_at=excluded.fetched_at`)
    .run(personId, detalle.tmdb_id, detalle.biography, detalle.birthday, detalle.deathday, detalle.birthplace, detalle.profile, detalle.fetched_at);

  return detalle;
}
