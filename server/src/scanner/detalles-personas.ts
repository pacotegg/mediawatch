/**
 * Segunda pasada sobre el reparto: la ficha de cada persona y las fotos que
 * TMDb no tenía.
 *
 * La primera pasada (`personas.ts`) dejó a 60.000 personas con su id de TMDb
 * pero sin biografía: la ficha solo se traía al abrirla. Esto la trae para
 * todas, por id (nada de adivinar por nombre):
 *
 * 1. `/person/{id}` en español; si la biografía viene vacía —pasa la mitad de
 *    las veces—, en inglés. Se guardan biografía, fechas, lugar de nacimiento,
 *    el id de IMDb y la foto si aún no la tenía.
 * 2. A quien TMDb no le pone cara se le busca en TheTVDB por nombre, y solo
 *    vale el resultado cuyo id de IMDb coincide con el que dio TMDb. Sin esa
 *    comprobación, un homónimo se llevaría la foto de otro.
 *
 * Una persona sin nada en ninguna fuente queda con la biografía en cadena
 * vacía (no NULL): así la siguiente pasada no vuelve a pedirla.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { descargar } from './tmdb.ts';
import { buscarPersonaTvdb } from './tvdb.ts';

const API = 'https://api.themoviedb.org/3';
const IMAGENES = 'https://image.tmdb.org/t/p';
const DIR = join(DATA_DIR, 'artwork', 'personas');
/** Peticiones a la vez contra TMDb: su tope ronda las 50 por segundo; con cuatro se queda muy por debajo. */
const HILOS_TMDB = 4;
const HILOS_TVDB = 2;

export type EstadoDetalles = {
  enCurso: boolean;
  fase: 'tmdb' | 'tvdb' | '';
  hechos: number;
  total: number;
  biografias: number;
  fotos: number;
  fotosTvdb: number;
  error: string | null;
  ultimo: string;
};

const estado: EstadoDetalles = { enCurso: false, fase: '', hechos: 0, total: 0, biografias: 0, fotos: 0, fotosTvdb: 0, error: null, ultimo: '' };
export const estadoDetalles = (): EstadoDetalles => ({ ...estado });

async function tmdb<T>(path: string, idioma: string): Promise<T | null> {
  if (!config.tmdbApiKey) throw new Error('Falta la clave de TMDb');
  for (let intento = 0; intento < 4; intento++) {
    const res = await fetch(`${API}${path}?api_key=${config.tmdbApiKey}&language=${idioma}`, { headers: { accept: 'application/json' } });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2_000 * (intento + 1))); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDb respondió ${res.status}`);
    return (await res.json()) as T;
  }
  return null;
}

type Persona = { id: number; name: string; tmdb_id: number; thumb: string | null };

type FichaTmdb = {
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  imdb_id: string | null;
};

/** Reparte una lista entre N trabajadores que van cogiendo del montón. */
async function enParalelo<T>(lista: T[], hilos: number, tarea: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabajador = async () => {
    while (i < lista.length && estado.enCurso) {
      const x = lista[i++];
      await tarea(x);
      estado.hechos++;
    }
  };
  await Promise.all(Array.from({ length: hilos }, trabajador));
}

export async function completarDetalles(): Promise<void> {
  if (estado.enCurso) return;
  Object.assign(estado, { enCurso: true, fase: 'tmdb', hechos: 0, total: 0, biografias: 0, fotos: 0, fotosTvdb: 0, error: null, ultimo: '' });
  mkdirSync(DIR, { recursive: true });

  const guardar = db.prepare(`UPDATE people_details SET biography = ?, birthday = ?, deathday = ?, birthplace = ?, profile = ?, imdb_id = ?, fetched_at = ?
                              WHERE person_id = ?`);
  const ponerFoto = db.prepare('UPDATE people SET thumb = ? WHERE id = ? AND thumb IS NULL');
  const apuntarTvdb = db.prepare('UPDATE people_details SET tvdb_id = ? WHERE person_id = ?');

  try {
    // ---- 1. la ficha por id de TMDb
    const pendientes = db
      .prepare(`SELECT p.id, p.name, d.tmdb_id, p.thumb FROM people_details d JOIN people p ON p.id = d.person_id
                WHERE d.tmdb_id IS NOT NULL AND d.biography IS NULL AND d.birthday IS NULL ORDER BY p.id`)
      .all() as Persona[];
    estado.total = pendientes.length;

    await enParalelo(pendientes, HILOS_TMDB, async (p) => {
      try {
        const ficha = await tmdb<FichaTmdb>(`/person/${p.tmdb_id}`, config.tmdbLanguage);
        if (!ficha) { guardar.run('', null, null, null, null, null, new Date().toISOString(), p.id); return; }
        let biografia = ficha.biography?.trim() || '';
        if (!biografia) {
          const enIngles = await tmdb<FichaTmdb>(`/person/${p.tmdb_id}`, 'en-US');
          biografia = enIngles?.biography?.trim() || '';
        }
        const perfil = ficha.profile_path ? `${IMAGENES}/w300${ficha.profile_path}` : null;
        guardar.run(biografia, ficha.birthday || null, ficha.deathday || null, ficha.place_of_birth || null, perfil, ficha.imdb_id || null, new Date().toISOString(), p.id);
        if (biografia) estado.biografias++;
        if (!p.thumb && perfil) {
          try {
            const destino = await descargar(perfil, join(DIR, `${p.id}.jpg`));
            ponerFoto.run(destino, p.id);
            estado.fotos++;
          } catch { /* una foto que no baja no para nada */ }
        }
        estado.ultimo = p.name;
      } catch (err) {
        estado.ultimo = `${p.name}: ${(err as Error).message}`;
        if (/clave/i.test((err as Error).message)) throw err;
      }
    });

    // ---- 2. la foto por TheTVDB, para quien TMDb no la tiene
    if (!config.tvdbApiKey || !estado.enCurso) return;
    estado.fase = 'tvdb';
    estado.hechos = 0;
    const sinFoto = db
      .prepare(`SELECT p.id, p.name, d.imdb_id FROM people p JOIN people_details d ON d.person_id = p.id
                WHERE p.thumb IS NULL AND d.imdb_id IS NOT NULL AND d.tvdb_id IS NULL ORDER BY p.id`)
      .all() as { id: number; name: string; imdb_id: string }[];
    estado.total = sinFoto.length;

    await enParalelo(sinFoto, HILOS_TVDB, async (p) => {
      try {
        const encontrada = await buscarPersonaTvdb(p.name, p.imdb_id);
        // 0 = buscada y sin resultado válido; así no se repite en la próxima pasada.
        apuntarTvdb.run(encontrada?.id ?? 0, p.id);
        if (encontrada?.foto) {
          const destino = await descargar(encontrada.foto, join(DIR, `${p.id}.jpg`));
          ponerFoto.run(destino, p.id);
          estado.fotosTvdb++;
        }
        estado.ultimo = p.name;
      } catch (err) {
        estado.ultimo = `${p.name}: ${(err as Error).message}`;
        if (/clave/i.test((err as Error).message)) throw err;
      }
    });
  } catch (err) {
    estado.error = (err as Error).message;
  } finally {
    estado.enCurso = false;
  }
}
