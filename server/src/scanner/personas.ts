/**
 * Fotos e identidad del reparto desde TMDb, título a título.
 *
 * Buscar a 26.000 personas por nombre sería impreciso (homónimos) y lento.
 * En cambio, el reparto de cada título ya lo tiene TMDb con su foto y su id:
 * se pide una vez por título (`/credits`) y se casa con los nombres que el
 * escáner sacó del NFO. Con eso:
 *
 * - a quien no tenga foto se le baja la de TMDb a `data/artwork/personas/`;
 * - se apunta su id de TMDb en `people_details`, y con él la biografía se
 *   completa sola la primera vez que alguien abre su ficha, sin adivinar por
 *   nombre.
 *
 * Las fotos que ya había en las carpetas `.actors` de la biblioteca no se
 * tocan. Un título ya revisado se salta un mes.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db, normalize } from '../db.ts';
import { descargar } from './tmdb.ts';

const API = 'https://api.themoviedb.org/3';
const IMAGENES = 'https://image.tmdb.org/t/p';
const DIR = join(DATA_DIR, 'artwork', 'personas');

export type EstadoPersonas = {
  enCurso: boolean;
  hechos: number;
  total: number;
  fotos: number;
  identificadas: number;
  sinCredits: number;
  error: string | null;
  ultimo: string;
};

const estado: EstadoPersonas = { enCurso: false, hechos: 0, total: 0, fotos: 0, identificadas: 0, sinCredits: 0, error: null, ultimo: '' };
export const estadoPersonas = (): EstadoPersonas => ({ ...estado });

async function tmdb<T>(path: string): Promise<T | null> {
  if (!config.tmdbApiKey) throw new Error('Falta la clave de TMDb');
  for (let intento = 0; intento < 3; intento++) {
    const res = await fetch(`${API}${path}?api_key=${config.tmdbApiKey}&language=${config.tmdbLanguage}`, { headers: { accept: 'application/json' } });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1_500)); continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDb respondió ${res.status}`);
    return (await res.json()) as T;
  }
  return null;
}

type Credito = { id: number; name: string; profile_path: string | null };

async function creditosDe(kind: string, tmdbId: number): Promise<Credito[]> {
  if (kind === 'show') {
    const r = await tmdb<{ cast?: Credito[] }>(`/tv/${tmdbId}/aggregate_credits`);
    return r?.cast ?? [];
  }
  const r = await tmdb<{ cast?: Credito[]; crew?: Credito[] }>(`/movie/${tmdbId}/credits`);
  return [...(r?.cast ?? []), ...(r?.crew ?? [])];
}

export async function completarPersonas(): Promise<void> {
  if (estado.enCurso) return;
  const reciente = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const items = db
    .prepare(`SELECT id, kind, title, tmdb_id FROM items WHERE tmdb_id IS NOT NULL AND (personas_revisadas IS NULL OR personas_revisadas < ?) ORDER BY kind, title`)
    .all(reciente) as { id: number; kind: string; title: string; tmdb_id: number }[];
  Object.assign(estado, { enCurso: true, hechos: 0, total: items.length, fotos: 0, identificadas: 0, sinCredits: 0, error: null, ultimo: '' });
  mkdirSync(DIR, { recursive: true });

  const gente = db.prepare('SELECT p.id, p.name, p.search_name, p.thumb FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ?');
  const conDetalle = db.prepare('SELECT tmdb_id FROM people_details WHERE person_id = ?');
  const apuntar = db.prepare(`INSERT INTO people_details (person_id, tmdb_id, profile, fetched_at) VALUES (?,?,?,?)
                              ON CONFLICT(person_id) DO UPDATE SET tmdb_id = COALESCE(people_details.tmdb_id, excluded.tmdb_id), profile = COALESCE(people_details.profile, excluded.profile)`);
  const ponerFoto = db.prepare('UPDATE people SET thumb = ? WHERE id = ? AND thumb IS NULL');
  const revisado = db.prepare('UPDATE items SET personas_revisadas = ? WHERE id = ?');

  try {
    for (const it of items) {
      try {
        const creditos = await creditosDe(it.kind, it.tmdb_id);
        if (creditos.length === 0) estado.sinCredits++;
        const porNombre = new Map<string, Credito>();
        for (const c of creditos) porNombre.set(normalize(c.name), c);

        const personas = gente.all(it.id) as { id: number; name: string; search_name: string | null; thumb: string | null }[];
        for (const p of personas) {
          const c = porNombre.get(p.search_name ?? normalize(p.name));
          if (!c) continue;
          const detalle = conDetalle.get(p.id) as { tmdb_id: number | null } | undefined;
          if (!detalle?.tmdb_id) {
            apuntar.run(p.id, c.id, c.profile_path ? `${IMAGENES}/w300${c.profile_path}` : null, new Date().toISOString());
            estado.identificadas++;
          }
          if (!p.thumb && c.profile_path) {
            try {
              const destino = await descargar(`${IMAGENES}/w300${c.profile_path}`, join(DIR, `${p.id}.jpg`));
              ponerFoto.run(destino, p.id);
              estado.fotos++;
            } catch { /* una foto que no baja no para nada */ }
          }
        }
        revisado.run(new Date().toISOString(), it.id);
        estado.ultimo = `${it.title}: ${personas.length} personas`;
      } catch (err) {
        estado.ultimo = `${it.title}: ${(err as Error).message}`;
        if (/clave/i.test((err as Error).message)) throw err;
      }
      estado.hechos++;
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (err) {
    estado.error = (err as Error).message;
  } finally {
    estado.enCurso = false;
  }
}
