import { config } from '../config.ts';
import { db } from '../db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS item_reviews (
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  fuente      TEXT NOT NULL,
  autor       TEXT NOT NULL,
  contenido   TEXT NOT NULL,
  valor       REAL,
  url         TEXT,
  actualizado TEXT NOT NULL,
  PRIMARY KEY (item_id, fuente, autor)
);
CREATE INDEX IF NOT EXISTS idx_reviews_item ON item_reviews(item_id);
`);

export type Review = {
  fuente: string;
  autor: string;
  contenido: string;
  valor: number | null;
  url: string | null;
};

const CACHE_DIAS = 30;

export async function obtenerResenas(itemId: number): Promise<Review[]> {
  const guardadas = db
    .prepare('SELECT fuente, autor, contenido, valor, url, actualizado FROM item_reviews WHERE item_id = ?')
    .all(itemId) as (Review & { actualizado: string })[];

  if (guardadas.length > 0) {
    const masVieja = guardadas.reduce((min, r) => (r.actualizado < min ? r.actualizado : min), guardadas[0].actualizado);
    const dias = (Date.now() - new Date(masVieja).getTime()) / (1000 * 86400);
    if (dias < CACHE_DIAS) {
      return guardadas.map(({ fuente, autor, contenido, valor, url }) => ({ fuente, autor, contenido, valor, url }));
    }
  }

  if (!config.tmdbApiKey) return guardadas;
  const item = db.prepare('SELECT tmdb_id, kind FROM items WHERE id = ?').get(itemId) as { tmdb_id: string | null; kind: string } | undefined;
  if (!item || !item.tmdb_id) return guardadas;

  const tipo = item.kind === 'show' ? 'tv' : 'movie';
  const urlBase = `https://api.themoviedb.org/3/${tipo}/${item.tmdb_id}/reviews?api_key=${config.tmdbApiKey}`;

  try {
    // Primero intentamos reseñas en español
    let res = await fetch(`${urlBase}&language=es`, { signal: AbortSignal.timeout(6000) });
    let data = res.ok ? ((await res.json()) as { results?: any[] }) : null;
    let results: any[] = data?.results || [];

    // Fallback a cualquier idioma si no hay en español
    if (results.length === 0) {
      res = await fetch(urlBase, { signal: AbortSignal.timeout(6000) });
      data = res.ok ? ((await res.json()) as { results?: any[] }) : null;
      results = data?.results || [];
    }

    if (results.length > 0) {
      const ahora = new Date().toISOString();
      const insert = db.prepare(`
        INSERT INTO item_reviews (item_id, fuente, autor, contenido, valor, url, actualizado)
        VALUES (?, 'tmdb', ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, fuente, autor) DO UPDATE SET
          contenido = excluded.contenido,
          valor = excluded.valor,
          url = excluded.url,
          actualizado = excluded.actualizado
      `);

      for (const r of results.slice(0, 10)) {
        const autor = String(r.author || r.author_details?.username || 'Anónimo').trim();
        const contenido = String(r.content || '').trim();
        const valor = r.author_details?.rating ? Number(r.author_details.rating) : null;
        const url = r.url ? String(r.url) : null;
        if (autor && contenido) {
          insert.run(itemId, autor, contenido, valor, url, ahora);
        }
      }

      const nuevas = db
        .prepare('SELECT fuente, autor, contenido, valor, url FROM item_reviews WHERE item_id = ?')
        .all(itemId) as Review[];
      return nuevas;
    }
  } catch {
    // Si falla la red o da timeout se devuelve la caché previa
  }

  return guardadas;
}
