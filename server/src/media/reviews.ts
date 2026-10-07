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
  /** Solo en las de prensa: crítico y dónde está la crítica entera. */
  pie?: string | null;
};

// La columna `pie` llegó después de crear la tabla (07/10).
if (!(db.prepare('PRAGMA table_info(resenas_externas)').all() as { name: string }[]).some((c) => c.name === 'pie')) {
  db.exec('ALTER TABLE resenas_externas ADD COLUMN pie TEXT');
}

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
 * Las de TMDb y las de SensaCine juntas: primero hasta 4 en castellano y
 * después hasta 4 en inglés.
 */
export async function obtenerResenas(itemId: number): Promise<Review[]> {
  const deTmdb = await resenasTmdb(itemId);
  const item = db.prepare('SELECT imdb_id FROM items WHERE id = ?').get(itemId) as { imdb_id: string | null } | undefined;
  const externas = item?.imdb_id
    ? (db
        .prepare('SELECT fuente, autor, contenido, valor, url, pie FROM resenas_externas WHERE imdb_id = ? ORDER BY rowid')
        .all(item.imdb_id) as Review[])
    : [];
  // El mismo filtro que aplica el lote al elegir, para las que guardó antes de
  // tenerlo: nada de una línea ni textos copiados entre autores.
  const vistas = new Set<string>();
  const utiles = externas.filter((r) => {
    const huella = r.contenido.toLowerCase().replace(/[^a-záéíóúüñ0-9]/g, '').slice(0, 60);
    // La prensa son extractos y alguno es corto pero bueno: 40 en vez de 80.
    if (r.contenido.length < (r.fuente === 'sensacine-prensa' ? 40 : 80) || vistas.has(huella)) return false;
    vistas.add(huella);
    return true;
  });
  // El mínimo de 80 caracteres vale también para las de TMDb («Masterpiece.»).
  const todas = [...utiles, ...deTmdb.filter((r) => r.contenido.length >= 80)];
  const esPrensa = (r: Review) => r.fuente === 'sensacine-prensa';
  const esCastellano = (r: Review) => esPrensa(r) || r.fuente === 'sensacine' || enCastellano(r.contenido);
  // Hasta 4 de prensa, 4 de espectadores en castellano (SensaCine primero) y
  // 4 en inglés, en ese orden.
  return [
    ...todas.filter(esPrensa).slice(0, 4),
    ...todas.filter((r) => esCastellano(r) && !esPrensa(r)).slice(0, 4),
    ...todas.filter((r) => !esCastellano(r)).slice(0, 4),
  ];
}

async function resenasTmdb(itemId: number): Promise<Review[]> {
  const guardadas = db
    .prepare('SELECT fuente, autor, contenido, valor, url, actualizado FROM item_reviews WHERE item_id = ?')
    .all(itemId) as (Review & { actualizado: string })[];

  const item = db.prepare('SELECT tmdb_id, kind FROM items WHERE id = ?').get(itemId) as { tmdb_id: string | null; kind: string } | undefined;
  const tipo = item?.kind === 'show' ? 'tv' : 'movie';
  /*
   * Hasta el 07/10 se pedían las de castellano y las de cualquier idioma solo
   * si no había ninguna en castellano: con una sola en castellano, las inglesas
   * no se pedían nunca. Esta marca (clave `tmdb:<tipo>:<id>`, porque las series
   * no tienen id de IMDb) dice que ya se pidieron las dos; lo guardado antes
   * se vuelve a pedir una vez para completar el inglés.
   */
  const marca = item?.tmdb_id ? `tmdb:${tipo}:${item.tmdb_id}` : null;
  const ambas = marca ? !!db.prepare("SELECT 1 FROM resenas_revisadas WHERE imdb_id = ? AND fuente = 'tmdb-ambas'").get(marca) : true;

  if (guardadas.length > 0 && ambas) {
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
  if (!item || !item.tmdb_id) return guardadas;

  const urlBase = `https://api.themoviedb.org/3/${tipo}/${item.tmdb_id}/reviews?api_key=${config.tmdbApiKey}`;

  try {
    // Las dos siempre: castellano e inglés.
    const pedir = async (idioma: string) => {
      const res = await fetch(`${urlBase}&language=${idioma}`, { signal: AbortSignal.timeout(6000) });
      const data = res.ok ? ((await res.json()) as { results?: any[] }) : null;
      if (!res.ok) throw new Error(`TMDb ${res.status}`);
      return data?.results || [];
    };
    const results: any[] = [...(await pedir('es')), ...(await pedir('en-US'))];
    if (marca) {
      db.prepare("INSERT OR IGNORE INTO resenas_revisadas (imdb_id, fuente, revisada, encontradas) VALUES (?, 'tmdb-ambas', ?, ?)")
        .run(marca, new Date().toISOString(), results.length);
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

      for (const r of results.slice(0, 20)) {
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
