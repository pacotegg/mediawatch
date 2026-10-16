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

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function traducirConGemini(texto: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !texto.trim()) return null;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
      signal: AbortSignal.timeout(30_000),
      method: 'POST',
      // La clave por cabecera y no en la URL: las URL acaban en registros de proxys y de errores.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Traduce al español de España de forma natural y profesional la siguiente biografía. NO uses formato Markdown, negritas ni asteriscos (*) para los títulos ni nombres. Devuelve únicamente el texto traducido limpio:\n\n${texto}` }] }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    return raw ? raw.replace(/\*+([^*]+)\*+/g, '$1').trim() : null;
  } catch {
    return null;
  }
}

function esTextoEnIngles(texto: string): boolean {
  if (!texto || texto.trim().length < 15) return false;
  const tieneEspanol = /[áéíóúñ¿¡]/.test(texto) ||
    /\b(nació|nacer|película|películas|conocido|conocida|hijo|hija|estadounidense|español|española|británico|británica|fue|estudió|comenzó)\b/i.test(texto);
  if (tieneEspanol) return false;
  const tieneIngles = /\b(born|is an?|was an?|known for|directed|starred|actor|actress|filmmaker|career|graduated|appeared|best known|in|the|and|of)\b/i.test(texto);
  return tieneIngles;
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
  if (guardado) {
    if (guardado.biography && esTextoEnIngles(guardado.biography)) {
      const traducida = await traducirConGemini(guardado.biography);
      if (traducida) {
        guardado.biography = traducida;
        db.prepare('UPDATE people_details SET biography = ? WHERE person_id = ?').run(guardado.biography, personId);
      }
    }
    if (guardado.biography !== null || guardado.birthday || !guardado.tmdb_id) return guardado;
  }

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

  // TMDb deja la biografía vacía en español muchas veces; en ese caso se traduce
  // de la versión en inglés usando Gemini para mostrarla en español.
  let biografia = ficha.biography || null;
  if (!biografia) {
    const enIngles = await tmdb<{ biography: string }>(`/person/${encontrado.id}`, { language: 'en-US' });
    if (enIngles?.biography) {
      biografia = (await traducirConGemini(enIngles.biography)) ?? enIngles.biography;
    }
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
