/*
 * Ficha completa desde TMDb: reparto y equipo, estudios, pais y valoracion.
 *
 * Es lo que antes solo traia el .nfo de tinyMediaManager. Escribe en la base de datos, nunca en la biblioteca.
 *
 * Marca el titulo con `meta_origen = 'servidor'`: «a partir de ahora este titulo lo gestiona el servidor y su .nfo ya no
 * manda». Sin esa marca el siguiente escaneo reescribiria reparto y estudios con lo del .nfo (o los borraria, si no hay),
 * que es justo lo que `saveGenresAndPeople` hace con todo titulo que no sea de TMDb. Solo para peliculas: los episodios de
 * una serie con .nfo se rellenan desde el .nfo y habria que copiarlos antes de dejar de leerlo.
 */
import { db, normalize } from '../db.ts';
import type { Proposal } from './tmdb.ts';

export type CampoFicha = 'cast' | 'studio' | 'ratings';
export const CAMPOS_FICHA: CampoFicha[] = ['cast', 'studio', 'ratings'];

export class FichaError extends Error {}

export function escribirFicha(itemId: number, p: Proposal, campos: CampoFicha[], sobrescribir = true): CampoFicha[] {
  const item = db.prepare('SELECT id, kind FROM items WHERE id = ?').get(itemId) as { id: number; kind: string } | undefined;
  if (!item) throw new FichaError('El título ya no existe');
  if (campos.length === 0) return [];
  if (item.kind !== 'movie') throw new FichaError('Reparto, estudios y valoración solo se aplican a películas por ahora');

  const hechos: CampoFicha[] = [];
  db.exec('BEGIN');
  try {
    if (campos.includes('cast') && (p.reparto?.length || p.directores?.length || p.guionistas?.length)) {
      const hay = (db.prepare('SELECT COUNT(*) AS n FROM item_people WHERE item_id = ?').get(itemId) as { n: number }).n > 0;
      if (sobrescribir || !hay) {
        db.prepare('DELETE FROM item_people WHERE item_id = ?').run(itemId);
        const persona = db.prepare(`INSERT INTO people (name, search_name) VALUES (?, ?)
                                    ON CONFLICT(name) DO UPDATE SET search_name = excluded.search_name RETURNING id`);
        const enlazar = db.prepare('INSERT OR REPLACE INTO item_people (item_id, person_id, role, character, ord) VALUES (?,?,?,?,?)');
        const poner = (nombre: string, rol: string, personaje: string | null, orden: number | null) => {
          const fila = persona.get(nombre, normalize(nombre) || null) as { id: number };
          enlazar.run(itemId, fila.id, rol, personaje, orden);
        };
        (p.reparto ?? []).forEach((a, i) => poner(a.nombre, 'actor', a.personaje || null, i));
        for (const d of p.directores ?? []) poner(d, 'director', null, null);
        for (const w of p.guionistas ?? []) poner(w, 'writer', null, null);
        hechos.push('cast');
      }
    }
    if (campos.includes('studio') && (p.estudios?.length || p.paises?.length)) {
      db.prepare('UPDATE items SET studio = COALESCE(?, studio), country = COALESCE(?, country) WHERE id = ?')
        .run(p.estudios?.length ? p.estudios.join(', ') : null, p.paises?.length ? p.paises.join(', ') : null, itemId);
      hechos.push('studio');
    }
    if (campos.includes('ratings') && p.rating != null) {
      db.prepare("INSERT OR REPLACE INTO item_ratings (item_id, fuente, valor, maximo, votos, origen) VALUES (?,?,?,?,?,'tmdb')")
        .run(itemId, 'themoviedb', p.rating, 10, p.votos ?? 0);
      hechos.push('ratings');
    }
    if (hechos.length > 0) db.prepare("UPDATE items SET meta_origen = 'servidor' WHERE id = ?").run(itemId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return hechos;
}
