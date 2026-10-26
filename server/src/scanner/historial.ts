/*
 * Deshacer el ultimo cambio del Scraper en un titulo.
 *
 * Antes de aplicar se guarda una instantanea de TODO lo que aplicar puede tocar: los campos de la ficha, el reparto, los generos,
 * la valoracion de TMDb y el arte propio (copiado a `data/artwork/<id>/_previo/`, porque el arte nuevo se escribe en el mismo
 * nombre de fichero). Se conservan las 5 ultimas por titulo. Deshacer devuelve todo, incluida la marca `meta_origen`: un titulo
 * que vuelve a su estado anterior vuelve tambien a leer su .nfo si lo tenia.
 *
 * Solo toca la base de datos y data/: la biblioteca no se toca nunca desde aqui. Las copias de `_previo` no se borran solas.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { db, normalize } from '../db.ts';

const COLUMNAS = [
  'title', 'search_title', 'year', 'original_title', 'plot', 'tagline', 'runtime', 'rating', 'votes', 'mpaa', 'premiered',
  'studio', 'country', 'collection', 'coleccion_fijada', 'imdb_id', 'tmdb_id', 'meta_origen', 'arte_fijado', 'arte_actualizado',
] as const;
const ARTE = ['poster', 'fanart', 'clearlogo', 'landscape', 'discart'] as const;
const CONSERVAR = 5;

type Instantanea = {
  items: Record<string, unknown>;
  arte: Record<string, { original: string | null; copia: string | null }>;
  gente: { name: string; role: string; character: string | null; ord: number | null }[];
  generos: string[];
  valoracion: { valor: number; maximo: number; votos: number; origen: string } | null;
};

export class HistorialError extends Error {}

const dentroDeArtwork = (ruta: string) => ruta.startsWith(join(DATA_DIR, 'artwork'));

export function tomarInstantanea(itemId: number, etiqueta: string): void {
  const fila = db.prepare(`SELECT ${[...COLUMNAS, ...ARTE].join(', ')} FROM items WHERE id = ?`).get(itemId) as Record<string, unknown> | undefined;
  if (!fila) throw new HistorialError('El título ya no existe');

  const arte: Instantanea['arte'] = {};
  const ts = Date.now();
  for (const papel of ARTE) {
    const original = (fila[papel] as string | null) ?? null;
    let copia: string | null = null;
    // Solo el arte que vive en data/ se sobrescribe; el de la biblioteca no se toca y basta con recordar su ruta.
    if (original && dentroDeArtwork(original) && existsSync(original)) {
      const dir = join(dirname(original), '_previo');
      mkdirSync(dir, { recursive: true });
      copia = join(dir, `${ts}-${papel}${extname(original)}`);
      copyFileSync(original, copia);
    }
    arte[papel] = { original, copia };
  }
  const instantanea: Instantanea = {
    items: Object.fromEntries(COLUMNAS.map((c) => [c, fila[c] ?? null])),
    arte,
    gente: db.prepare('SELECT p.name, ip.role, ip.character, ip.ord FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ?').all(itemId) as Instantanea['gente'],
    generos: (db.prepare('SELECT g.name FROM item_genres ig JOIN genres g ON g.id = ig.genre_id WHERE ig.item_id = ?').all(itemId) as { name: string }[]).map((g) => g.name),
    valoracion: (db.prepare("SELECT valor, maximo, votos, origen FROM item_ratings WHERE item_id = ? AND fuente = 'themoviedb'").get(itemId) as Instantanea['valoracion']) ?? null,
  };
  db.prepare('INSERT INTO scrape_historial (item_id, fecha, etiqueta, datos) VALUES (?,?,?,?)').run(itemId, new Date().toISOString(), etiqueta, JSON.stringify(instantanea));
  db.prepare(`DELETE FROM scrape_historial WHERE item_id = ? AND id NOT IN (SELECT id FROM scrape_historial WHERE item_id = ? ORDER BY id DESC LIMIT ${CONSERVAR})`).run(itemId, itemId);
}

export function ultimaInstantanea(itemId: number): { id: number; fecha: string; etiqueta: string } | null {
  return (db.prepare('SELECT id, fecha, etiqueta FROM scrape_historial WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(itemId) as { id: number; fecha: string; etiqueta: string } | undefined) ?? null;
}

export function deshacerUltima(itemId: number): { fecha: string; etiqueta: string } {
  const fila = db.prepare('SELECT id, fecha, etiqueta, datos FROM scrape_historial WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(itemId) as
    | { id: number; fecha: string; etiqueta: string; datos: string } | undefined;
  if (!fila) throw new HistorialError('No hay nada que deshacer en este título');
  const s = JSON.parse(fila.datos) as Instantanea;

  // Primero los ficheros (si falla, la base no ha cambiado); la copia vuelve a su nombre original.
  for (const papel of ARTE) {
    const a = s.arte[papel];
    if (a?.original && a.copia && existsSync(a.copia)) copyFileSync(a.copia, a.original);
  }

  db.exec('BEGIN');
  try {
    const sets = COLUMNAS.map((c) => `${c} = ?`).concat(ARTE.map((c) => `${c} = ?`));
    db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(
      ...COLUMNAS.map((c) => (s.items[c] ?? null) as never), ...ARTE.map((c) => (s.arte[c]?.original ?? null) as never), itemId);

    db.prepare('DELETE FROM item_people WHERE item_id = ?').run(itemId);
    const persona = db.prepare('INSERT INTO people (name, search_name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id');
    const enlazar = db.prepare('INSERT OR REPLACE INTO item_people (item_id, person_id, role, character, ord) VALUES (?,?,?,?,?)');
    for (const g of s.gente) enlazar.run(itemId, (persona.get(g.name, normalize(g.name) || null) as { id: number }).id, g.role, g.character, g.ord);

    db.prepare('DELETE FROM item_genres WHERE item_id = ?').run(itemId);
    const genero = db.prepare('INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id');
    for (const n of s.generos) db.prepare('INSERT OR IGNORE INTO item_genres (item_id, genre_id) VALUES (?,?)').run(itemId, (genero.get(n) as { id: number }).id);

    db.prepare("DELETE FROM item_ratings WHERE item_id = ? AND fuente = 'themoviedb'").run(itemId);
    if (s.valoracion) db.prepare("INSERT INTO item_ratings (item_id, fuente, valor, maximo, votos, origen) VALUES (?, 'themoviedb', ?, ?, ?, ?)").run(itemId, s.valoracion.valor, s.valoracion.maximo, s.valoracion.votos, s.valoracion.origen);

    // Una serie que deja de estar adoptada: sus episodios vuelven a seguir a los .nfo.
    if (s.items.meta_origen !== 'servidor') db.prepare("UPDATE episodes SET meta_origen = NULL WHERE show_id = ? AND meta_origen = 'servidor'").run(itemId);

    db.prepare('DELETE FROM scrape_historial WHERE id = ?').run(fila.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { fecha: fila.fecha, etiqueta: fila.etiqueta };
}
