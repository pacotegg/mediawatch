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

-- Reseñas de otras fuentes (SensaCine), por id de IMDb y no por items.id: los
-- ids internos se renumeran en cada escaneo y el borrado en cascada se las
-- llevaría. No se borran ni se sobrescriben nunca (cli/resenas-sensacine.ts).
CREATE TABLE IF NOT EXISTS resenas_externas (
  imdb_id   TEXT NOT NULL,
  fuente    TEXT NOT NULL,
  autor     TEXT NOT NULL,
  contenido TEXT NOT NULL,
  valor     REAL,
  url       TEXT,
  fecha     TEXT,
  guardada  TEXT NOT NULL,
  PRIMARY KEY (imdb_id, fuente, autor)
);
-- Lo ya mirado en cada fuente, tenga reseñas o no: el lote no lo vuelve a pedir.
CREATE TABLE IF NOT EXISTS resenas_revisadas (
  imdb_id     TEXT NOT NULL,
  fuente      TEXT NOT NULL,
  revisada    TEXT NOT NULL,
  encontradas INTEGER NOT NULL,
  PRIMARY KEY (imdb_id, fuente)
);
`);

export type Review = {
  fuente: string;
  autor: string;
  contenido: string;
  valor: number | null;
  url: string | null;
};

const CACHE_DIAS = 30;

/*
 * TMDb no dice en qué idioma está cada reseña: se cuenta. Probado el 07/10
 * con las 111 guardadas: 19 de 19 en castellano detectadas, ninguna inglesa
 * colada (las palabras cortas comunes a los dos idiomas no están en ninguna).
 */
const PALABRAS_ES = /\b(que|los|las|el|la|de|es|en|un|una|del|muy|me|mi|pero|película|pelicula|también|porque|está|esta|sus|nos|hay|cuando|sobre|creo)\b/gi;
const PALABRAS_EN = /\b(the|and|this|that|with|movie|film|was|is|but|it|of|to|in|you|i|a)\b/gi;
function enCastellano(texto: string): boolean {
  const t = texto.slice(0, 800);
  return (t.match(PALABRAS_ES) || []).length > (t.match(PALABRAS_EN) || []).length;
}

/**
 * Las de TMDb y las de SensaCine juntas. Si hay alguna en castellano, solo
 * esas; las inglesas, únicamente cuando no hay ninguna en castellano.
 */
export async function obtenerResenas(itemId: number): Promise<Review[]> {
  const deTmdb = await resenasTmdb(itemId);
  const item = db.prepare('SELECT imdb_id FROM items WHERE id = ?').get(itemId) as { imdb_id: string | null } | undefined;
  const externas = item?.imdb_id
    ? (db
        .prepare('SELECT fuente, autor, contenido, valor, url FROM resenas_externas WHERE imdb_id = ? ORDER BY rowid')
        .all(item.imdb_id) as Review[])
    : [];
  // El mismo filtro que aplica el lote al elegir, para las que guardó antes de
  // tenerlo: nada de una línea ni textos copiados entre autores.
  const vistas = new Set<string>();
  const utiles = externas.filter((r) => {
    const huella = r.contenido.toLowerCase().replace(/[^a-záéíóúüñ0-9]/g, '').slice(0, 60);
    if (r.contenido.length < 80 || vistas.has(huella)) return false;
    vistas.add(huella);
    return true;
  });
  const todas = [...utiles, ...deTmdb];
  const castellano = todas.filter((r) => r.fuente === 'sensacine' || enCastellano(r.contenido));
  return castellano.length ? castellano : todas;
}

async function resenasTmdb(itemId: number): Promise<Review[]> {
  const guardadas = db
    .prepare('SELECT fuente, autor, contenido, valor, url, actualizado FROM item_reviews WHERE item_id = ?')
    .all(itemId) as (Review & { actualizado: string })[];

  if (guardadas.length > 0) {
    // La más reciente, no la más vieja: una reseña que TMDb ya no devuelve se
    // queda con su fecha antigua para siempre, y con la más vieja se volvía a
    // preguntar a TMDb en cada apertura de la ficha.
    const masNueva = guardadas.reduce((max, r) => (r.actualizado > max ? r.actualizado : max), guardadas[0].actualizado);
    const dias = (Date.now() - new Date(masNueva).getTime()) / (1000 * 86400);
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
