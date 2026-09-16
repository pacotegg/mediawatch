import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';

mkdirSync(DATA_DIR, { recursive: true });

// `timeout`: cuánto espera si otro proceso —el servidor escaneando, el
// script de imágenes— tiene la base bloqueada, en vez de fallar al instante
// con «database is locked». Son escrituras cortas: diez segundos sobran.
export const db = new DatabaseSync(join(DATA_DIR, 'tvwatch.db'), { timeout: 10_000 });

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS libraries (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id             INTEGER PRIMARY KEY,
  library_id     INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  folder         TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  search_title   TEXT NOT NULL,
  sort_title     TEXT,
  original_title TEXT,
  year           INTEGER,
  plot           TEXT,
  tagline        TEXT,
  runtime        INTEGER,
  rating         REAL,
  votes          INTEGER,
  mpaa           TEXT,
  premiered      TEXT,
  studio         TEXT,
  country        TEXT,
  collection     TEXT,
  trailer        TEXT,
  imdb_id        TEXT,
  tmdb_id        TEXT,
  poster         TEXT,
  fanart         TEXT,
  clearlogo      TEXT,
  landscape      TEXT,
  added_at       TEXT,
  scanned_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_library ON items(library_id);
-- La pantalla de sagas agrupa por coleccion y ademas busca, por cada grupo, el
-- titulo con caratula y el que tiene mejor fondo: sin indice eran dos recorridos
-- completos de la tabla por cada una de las 117 sagas, 311 ms de consulta.
-- Indice normal y no parcial: con la condicion de no vacio en la definicion,
-- SQLite no puede demostrar que la subconsulta la cumple y entonces no lo usa.
CREATE INDEX IF NOT EXISTS idx_items_coleccion ON items(collection);

-- Valoraciones de cada sitio, cada una con su escala. IMDb y TheMovieDb van
-- sobre 10 y los tomatometros y Metacritic sobre 100: guardar el maximo evita
-- tener que adivinarlo luego. Salen de los propios ficheros .nfo de la biblioteca.
CREATE TABLE IF NOT EXISTS item_ratings (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  fuente  TEXT    NOT NULL,
  valor   REAL    NOT NULL,
  maximo  INTEGER NOT NULL DEFAULT 10,
  votos   INTEGER NOT NULL DEFAULT 0,
  -- De donde salio: 'nfo' del fichero de la pelicula, 'omdb' traida de fuera.
  -- El escaner solo borra las suyas, asi que un reescaneo no se lleva por
  -- delante lo que se ha rellenado por API.
  origen  TEXT    NOT NULL DEFAULT 'nfo',
  PRIMARY KEY (item_id, fuente)
);

-- Las pistas no tenian indice por fichero: contar los ficheros sin subtitulos
-- recorria las 16.370 filas de sub_tracks una vez por cada uno de los 5.566
-- ficheros. Medido: 1.487 ms de los 2.280 que tardaba la pagina de
-- estadisticas; con el indice, 0,7 ms. Ademas el sondeo borra las pistas por
-- fichero antes de reescribirlas, asi que un escaneo completo hacia ese
-- recorrido 5.566 veces.
CREATE INDEX IF NOT EXISTS idx_sub_tracks_file ON sub_tracks(file_id);
CREATE INDEX IF NOT EXISTS idx_audio_tracks_file ON audio_tracks(file_id);
CREATE INDEX IF NOT EXISTS idx_items_search ON items(search_title);

CREATE TABLE IF NOT EXISTS episodes (
  id        INTEGER PRIMARY KEY,
  show_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  season    INTEGER NOT NULL,
  episode   INTEGER NOT NULL,
  title     TEXT,
  plot      TEXT,
  aired     TEXT,
  runtime   INTEGER,
  rating    REAL,
  thumb     TEXT,
  UNIQUE(show_id, season, episode)
);
CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(show_id);

CREATE TABLE IF NOT EXISTS media_files (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER REFERENCES items(id) ON DELETE CASCADE,
  episode_id  INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  path        TEXT NOT NULL UNIQUE,
  size        INTEGER,
  container   TEXT,
  duration    REAL,
  video_codec TEXT,
  width       INTEGER,
  height      INTEGER,
  hdr         TEXT,
  probed      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_item ON media_files(item_id);
CREATE INDEX IF NOT EXISTS idx_files_episode ON media_files(episode_id);

CREATE TABLE IF NOT EXISTS audio_tracks (
  id       INTEGER PRIMARY KEY,
  file_id  INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  idx      INTEGER NOT NULL,
  codec    TEXT,
  language TEXT,
  channels INTEGER,
  title    TEXT
);

CREATE TABLE IF NOT EXISTS sub_tracks (
  id       INTEGER PRIMARY KEY,
  file_id  INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  idx      INTEGER,
  codec    TEXT,
  language TEXT,
  title    TEXT,
  forced   INTEGER NOT NULL DEFAULT 0,
  external TEXT
);

CREATE TABLE IF NOT EXISTS genres (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS item_genres (
  item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, genre_id)
);

CREATE TABLE IF NOT EXISTS people (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  thumb TEXT
);

-- Datos que solo TMDb tiene (biografía, fechas) y la foto actual, que suele
-- ser más reciente que la que quedó guardada al scrapear la película.
CREATE TABLE IF NOT EXISTS people_details (
  person_id  INTEGER PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  tmdb_id    INTEGER,
  biography  TEXT,
  birthday   TEXT,
  deathday   TEXT,
  birthplace TEXT,
  profile    TEXT,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item_people (
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role      TEXT NOT NULL,
  character TEXT,
  ord       INTEGER,
  PRIMARY KEY (item_id, person_id, role)
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  pin        TEXT,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  position   REAL NOT NULL DEFAULT 0,
  duration   REAL,
  watched    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id, episode_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id, updated_at DESC);

-- Desfases de subtítulo por pista. Son una propiedad del emparejamiento
-- fichero/subtítulo, no del espectador, así que no llevan usuario.
CREATE TABLE IF NOT EXISTS sub_offsets (
  file_id    INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
  track_id   TEXT NOT NULL,
  offset_ms  INTEGER NOT NULL,
  sigma      REAL,
  method     TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (file_id, track_id)
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
`);

/*
 * Nombre de cada persona sin tildes, para poder buscarla escribiendo como se
 * escribe de verdad.
 *
 * Los titulos ya tenian su `search_title`; los nombres no, asi que buscar
 * «adrian colon» no encontraba a «Adrián Colón» y «Alvarez» sí encontraba a
 * «Álvarez» solo por casualidad —porque esos estaban guardados sin tilde—. Se
 * rellena aqui al arrancar y lo mantiene el escaner.
 */
function prepararBusquedaDePersonas() {
  const columnas = db.prepare('PRAGMA table_info(people)').all() as { name: string }[];
  if (!columnas.some((c) => c.name === 'search_name')) {
    db.exec('ALTER TABLE people ADD COLUMN search_name TEXT');
  }
  const pendientes = db.prepare('SELECT id, name FROM people WHERE search_name IS NULL').all() as { id: number; name: string }[];
  if (pendientes.length) {
    const poner = db.prepare('UPDATE people SET search_name = ? WHERE id = ?');
    for (const p of pendientes) poner.run(normalize(p.name), p.id);
    console.log(`[base] nombres preparados para buscar: ${pendientes.length}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_people_search ON people(search_name)');
}

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

db.exec(`
CREATE TABLE IF NOT EXISTS playbacks (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES episodes(id) ON DELETE CASCADE,
  file_id    INTEGER,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  position   REAL NOT NULL DEFAULT 0,
  seconds    REAL NOT NULL DEFAULT 0,
  duration   REAL,
  modo       TEXT,
  cliente    TEXT,
  finished   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_playbacks_fecha ON playbacks(started_at);
CREATE INDEX IF NOT EXISTS idx_playbacks_usuario ON playbacks(user_id, item_id, episode_id);

CREATE TABLE IF NOT EXISTS descargas (
  id       INTEGER PRIMARY KEY,
  file_id  INTEGER NOT NULL,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perfil   TEXT NOT NULL,
  estado   TEXT NOT NULL,
  ruta     TEXT,
  bytes    INTEGER,
  progreso INTEGER NOT NULL DEFAULT 0,
  error    TEXT,
  titulo   TEXT NOT NULL,
  creado   TEXT NOT NULL
);
`);

/*
 * Migraciones sueltas. Las tablas se crean con CREATE TABLE IF NOT EXISTS, así
 * que las columnas que llegan después hay que añadirlas a mano; SQLite no tiene
 * ADD COLUMN IF NOT EXISTS, de ahí la comprobación previa.
 */
function anadirColumna(tabla: string, columna: string, definicion: string) {
  const existe = (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[]).some((c) => c.name === columna);
  if (!existe) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}

anadirColumna('items', 'anime_id', 'TEXT');
// El id de TheTVDB, que es el que entiende fanart.tv para las series.
anadirColumna('items', 'tvdb_id', 'INTEGER');
// El disco (carátula del Blu-ray, redonda): se enseña girando en la pausa.
anadirColumna('items', 'discart', 'TEXT');
// Cuándo se revisaron sus imágenes en fanart.tv/TVDB, para no repetir la
// comparación de idiomas (que baja previsualizaciones) en cada pasada.
anadirColumna('items', 'arte_revisado', 'TEXT');

// Cuando y desde donde se uso cada sesion, para poder caducarlas y para que se
// vea que dispositivos tienen acceso.
anadirColumna('sessions', 'last_seen', 'TEXT');
anadirColumna('sessions', 'device', 'TEXT');
db.exec("UPDATE sessions SET last_seen = created_at WHERE last_seen IS NULL");

/*
 * Duplicados en `progress`.
 *
 * La clave primaria incluye `episode_id`, que en las películas va a NULL, y en
 * SQLite dos NULL no son iguales: el `ON CONFLICT` no saltaba nunca y cada
 * guardado insertaba otra fila. Se encontraron 20 filas para una sola película
 * (una por cada informe de posición durante la reproducción) y ninguna en
 * episodios, que sí traen número.
 *
 * Consecuencias: marcar visto parecía no funcionar —se leía la primera fila, no
 * la última— y reanudar una película volvía a una posición vieja.
 *
 * Se conserva la fila más reciente de cada grupo y se añade un índice parcial
 * que sí trata el NULL como un valor, para que no vuelva a pasar.
 */
db.exec(`
DELETE FROM progress WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM progress GROUP BY user_id, item_id, COALESCE(episode_id, -1)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_pelicula
  ON progress(user_id, item_id) WHERE episode_id IS NULL;
`);
// Guarda el número de episodio tal y como venía del disco, para poder deshacer
// una renumeración y para seguir emparejando ficheros después de moverlos.
anadirColumna('episodes', 'absolute', 'INTEGER');

/*
 * Que imagenes se han elegido a mano.
 *
 * El escaner reescribe `poster`, `fanart`, `clearlogo` y `landscape` en cada
 * pasada con lo que encuentra en la carpeta de la pelicula. Eso esta bien —es
 * de donde salen— pero significaba que elegir una caratula distinta desde la
 * ficha duraba hasta el siguiente escaneo, que es cada 24 h y ademas al
 * arrancar. Paso de verdad con «Magnolia»: la caratula elegida el 14 de
 * septiembre seguia guardada en disco y la base ya apuntaba otra vez al
 * fichero de la carpeta.
 *
 * Aqui se apunta cual de los cuatro papeles ha tocado una persona, y el escaner
 * respeta esos y sigue actualizando el resto.
 */
anadirColumna('items', 'arte_fijado', 'TEXT');

prepararBusquedaDePersonas();
