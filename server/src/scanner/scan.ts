import { existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { db, normalize } from '../db.ts';
import { config, type LibraryConfig } from '../config.ts';
import { parseNfo, type NfoData } from './nfo.ts';

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.mpg', '.mpeg', '.ts', '.webm']);
const SUB_EXT = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sub']);
const SKIP_DIRS = new Set(['.actors', 'extrathumbs', 'extras', 'extra', 'featurettes', 'behind the scenes', 'trailers', '.trickplay']);
const JUNK = /\b(trailer|sample|muestra|teaser)\b/i;
const MIN_VIDEO_BYTES = 20 * 1024 * 1024;

const LANG_MAP: Record<string, string> = {
  es: 'spa', esp: 'spa', spanish: 'spa', castellano: 'spa', español: 'spa', spa: 'spa',
  en: 'eng', eng: 'eng', english: 'eng', ingles: 'eng',
  ca: 'cat', cat: 'cat', catalan: 'cat',
  gl: 'glg', glg: 'glg', eu: 'eus', eus: 'eus', baq: 'eus',
  fr: 'fre', fre: 'fre', fra: 'fre', french: 'fre',
  de: 'ger', ger: 'ger', deu: 'ger', german: 'ger',
  it: 'ita', ita: 'ita', italian: 'ita',
  pt: 'por', por: 'por', ja: 'jpn', jpn: 'jpn', japanese: 'jpn',
  ko: 'kor', kor: 'kor', zh: 'chi', chi: 'chi', ru: 'rus', rus: 'rus',
};

const lang = (raw?: string): string | undefined => {
  if (!raw) return undefined;
  const key = raw.toLowerCase().trim();
  return LANG_MAP[key] ?? (key.length <= 3 ? key : undefined);
};

type Entry = { name: string; isDir: boolean; path: string };

function listDir(dir: string): Entry[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((d) => ({
      name: d.name,
      isDir: d.isDirectory(),
      path: join(dir, d.name),
    }));
  } catch {
    return [];
  }
}

/*
 * Papeles que sabe tener una imagen en una carpeta al estilo Kodi. Se usan para
 * dos cosas: reconocer la que toca, y —sobre todo— para NO coger una de otro
 * papel cuando falta la buena.
 */
const PAPELES = /-(poster|banner|clearart|clearlogo|logo|discart|keyart|landscape|thumb|fanart\d*|characterart|spine|backdrop\d*)\.(jpg|jpeg|png|webp)$/i;

const ES_IMAGEN = /\.(jpg|jpeg|png|webp)$/i;

/**
 * La imagen que hace de `papel` en esta carpeta.
 *
 * Suena a tontería y no lo es. El fichero de vídeo puede llamarse «Magnolia
 * (1999).mkv» mientras las imágenes se llaman «Magnolia (1999) 1080p
 * AC3-poster.jpg», porque se descargaron cuando el fichero tenía el nombre
 * largo. Buscando solo por el nombre del vídeo no se encuentra ninguna.
 *
 * El fallo que esto arregla: había un comodín `.jpg` cuyo sufijo, al quitarle
 * la extensión, quedaba en **cadena vacía**, así que cualquier `.jpg` que
 * empezara por el nombre de la película valía como carátula. En «Magnolia» la
 * primera por orden alfabético era el *banner* —una tira ancha— y eso es lo que
 * salía como cartel, sin forma de cambiarlo. Su `-poster.jpg` de verdad estaba
 * ahí al lado.
 *
 * Ahora: primero el nombre exacto, luego los nombres desnudos de siempre
 * (`poster.jpg`, `folder.jpg`), y si no, **cualquier imagen de ese papel** en la
 * carpeta, prefiriendo la que más se parezca al nombre del vídeo. El comodín
 * final solo vale para la carátula y nunca coge una imagen de otro papel.
 */
function findArt(
  files: Entry[],
  base: string,
  suffixes: string[],
  bare: string[],
  /*
   * Como se llama este papel de verdad, con sus variantes. Hace falta porque
   * las hay numeradas: nueve peliculas de la biblioteca traen `-fanart1.jpg` y
   * `-fanart2.jpg` pero ningun `-fanart.jpg` a secas, y con una lista de
   * sufijos fijos se quedaban sin fondo.
   */
  papel?: RegExp,
  comodinJpg = false,
): string | undefined {
  const lower = files.map((f) => ({ f, l: f.name.toLowerCase() }));
  const baseLower = base.toLowerCase();

  for (const s of suffixes) {
    const hit = lower.find(({ l }) => l === `${baseLower}${s}`);
    if (hit) return hit.f.path;
  }
  for (const b of bare) {
    const hit = lower.find(({ l }) => l === b);
    if (hit) return hit.f.path;
  }

  // Cualquier fichero de este papel, venga con el nombre que venga. Si hay
  // varios, gana el que comparta más principio con el nombre del vídeo: en una
  // carpeta con dos versiones de la misma película, cada una se queda la suya.
  const delPapel = lower.filter(({ l }) => (papel ? papel.test(l) : suffixes.some((s) => l.endsWith(s))));
  if (delPapel.length) {
    delPapel.sort((a, b) => prefijoComun(b.l, baseLower) - prefijoComun(a.l, baseLower));
    return delPapel[0].f.path;
  }

  /*
   * Último recurso, y solo para la carátula: una imagen suelta que empiece por
   * el nombre y que no sea de ningún otro papel. Sin esa segunda condición es
   * como se colaba el banner.
   */
  if (comodinJpg) {
    const hit = lower.find(({ l }) => l.startsWith(baseLower) && ES_IMAGEN.test(l) && !PAPELES.test(l));
    if (hit) return hit.f.path;
  }
  return undefined;
}

/** Cuántos caracteres comparten desde el principio. */
function prefijoComun(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/*
 * `\d*` en el fanart y en el fondo: las carpetas suelen traer varios y no
 * siempre hay uno sin numero. Se coge el que mas se parezca al nombre del
 * video, que con `-fanart1`, `-fanart2`... acaba siendo el primero.
 */
const COMO_SE_LLAMA = {
  poster: /-poster\.(jpg|jpeg|png|webp)$/i,
  fanart: /-(fanart|backdrop)\d*\.(jpg|jpeg|png|webp)$/i,
  clearlogo: /-(clearlogo|logo)\.(png|webp)$/i,
  landscape: /-(landscape|thumb)\.(jpg|jpeg|png|webp)$/i,
};

function artworkFor(files: Entry[], base: string) {
  return {
    poster: findArt(files, base, ['-poster.jpg', '-poster.png', '-poster.webp'], ['poster.jpg', 'folder.jpg', 'cover.jpg', 'poster.png'], COMO_SE_LLAMA.poster, true),
    fanart: findArt(files, base, ['-fanart.jpg', '-fanart.png', '-backdrop.jpg'], ['fanart.jpg', 'backdrop.jpg', 'backdrop1.jpg', 'fanart1.jpg'], COMO_SE_LLAMA.fanart),
    clearlogo: findArt(files, base, ['-clearlogo.png', '-logo.png'], ['clearlogo.png', 'logo.png'], COMO_SE_LLAMA.clearlogo),
    landscape: findArt(files, base, ['-landscape.jpg', '-thumb.jpg'], ['landscape.jpg', 'thumb.jpg'], COMO_SE_LLAMA.landscape),
  };
}

function externalSubs(files: Entry[], base: string) {
  const baseLower = base.toLowerCase();
  const out: { language?: string; forced: boolean; path: string; codec: string }[] = [];
  for (const f of files) {
    const ext = extname(f.name).toLowerCase();
    if (!SUB_EXT.has(ext)) continue;
    const l = f.name.toLowerCase();
    if (!l.startsWith(baseLower)) continue;
    const middle = l.slice(baseLower.length, l.length - ext.length).replace(/^\./, '');
    const parts = middle.split('.').filter(Boolean);
    const forced = parts.some((p) => p === 'forced' || p === 'forzado');
    const code = parts.find((p) => p !== 'forced' && p !== 'forzado' && p !== 'sdh' && p !== 'default');
    out.push({ language: lang(code), forced, path: f.path, codec: ext.slice(1) });
  }
  return out;
}

function actorThumbs(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of listDir(join(dir, '.actors'))) {
    if (f.isDir) continue;
    map.set(normalize(basename(f.name, extname(f.name)).replace(/_/g, ' ')), f.path);
  }
  return map;
}

function videoFiles(files: Entry[]): Entry[] {
  return files
    .filter((f) => !f.isDir && VIDEO_EXT.has(extname(f.name).toLowerCase()) && !JUNK.test(f.name))
    .filter((f) => {
      try {
        return statSync(f.path).size >= MIN_VIDEO_BYTES;
      } catch {
        return false;
      }
    });
}

function parseTitleYear(folderName: string): { title: string; year?: number } {
  const m = folderName.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (m) return { title: m[1].trim(), year: Number(m[2]) };
  return { title: folderName.trim() };
}

const stmt = {
  upsertItem: db.prepare(`
    INSERT INTO items (library_id, kind, folder, title, search_title, sort_title, original_title, year, plot,
      tagline, runtime, rating, votes, mpaa, premiered, studio, country, collection, trailer, imdb_id, tmdb_id,
      poster, fanart, clearlogo, landscape, added_at, scanned_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(folder) DO UPDATE SET
      library_id=excluded.library_id, kind=excluded.kind, title=excluded.title, search_title=excluded.search_title,
      sort_title=excluded.sort_title, original_title=excluded.original_title, year=excluded.year, plot=excluded.plot,
      tagline=excluded.tagline, runtime=excluded.runtime, rating=excluded.rating, votes=excluded.votes,
      mpaa=excluded.mpaa, premiered=excluded.premiered, studio=excluded.studio, country=excluded.country,
      collection=excluded.collection, trailer=excluded.trailer, imdb_id=excluded.imdb_id, tmdb_id=excluded.tmdb_id,
      -- Las imagenes elegidas a mano no se tocan; el resto se actualiza con lo
      -- que haya ahora en la carpeta. Sin esto, cambiar una caratula desde la
      -- ficha duraba hasta el siguiente escaneo.
      poster=CASE WHEN instr(COALESCE(items.arte_fijado,''), 'poster') > 0 THEN items.poster ELSE excluded.poster END,
      fanart=CASE WHEN instr(COALESCE(items.arte_fijado,''), 'fanart') > 0 THEN items.fanart ELSE excluded.fanart END,
      clearlogo=CASE WHEN instr(COALESCE(items.arte_fijado,''), 'clearlogo') > 0 THEN items.clearlogo ELSE excluded.clearlogo END,
      landscape=CASE WHEN instr(COALESCE(items.arte_fijado,''), 'landscape') > 0 THEN items.landscape ELSE excluded.landscape END,
      added_at=excluded.added_at, scanned_at=excluded.scanned_at
    RETURNING id`),
  upsertEpisode: db.prepare(`
    INSERT INTO episodes (show_id, season, episode, title, plot, aired, runtime, rating, thumb)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(show_id, season, episode) DO UPDATE SET
      title=excluded.title, plot=excluded.plot, aired=excluded.aired,
      runtime=excluded.runtime, rating=excluded.rating, thumb=excluded.thumb
    RETURNING id`),
  upsertFile: db.prepare(`
    INSERT INTO media_files (item_id, episode_id, path, size, container, duration, video_codec, width, height, hdr)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    -- COALESCE y no asignacion directa: estos valores vienen del .nfo, que
    -- muchas veces no trae duracion ni resolucion. Asignando a pelo, cada
    -- reescaneo borraba lo que ffprobe habia medido y lo dejaba a NULL; asi es
    -- como 166 ficheros acabaron sin resolucion y otros con duracion cero.
    -- NULLIF ademas del COALESCE: hay .nfo que no traen el hueco vacio sino un
    -- cero escrito, y un cero pasa el COALESCE tan campante. Es el motivo de
    -- que 107 ficheros perdieran la duracion medida en cada escaneo.
    -- El tamano y el contenedor si se pisan: esos salen del disco, no del .nfo.
    ON CONFLICT(path) DO UPDATE SET
      item_id=excluded.item_id, episode_id=excluded.episode_id, size=excluded.size, container=excluded.container,
      duration=COALESCE(NULLIF(excluded.duration, 0), media_files.duration),
      video_codec=COALESCE(excluded.video_codec, media_files.video_codec),
      width=COALESCE(NULLIF(excluded.width, 0), media_files.width),
      height=COALESCE(NULLIF(excluded.height, 0), media_files.height),
      hdr=COALESCE(excluded.hdr, media_files.hdr),
      -- Si el fichero ha cambiado de tamano es otro fichero: probed=0 obliga a medirlo
    -- de nuevo (la columna es NOT NULL; con NULL el escaneo entero se deshacia).
      probed=CASE WHEN excluded.size <> media_files.size THEN 0 ELSE media_files.probed END
    RETURNING id`),
  clearTracks: db.prepare('DELETE FROM audio_tracks WHERE file_id = ?'),
  clearSubs: db.prepare('DELETE FROM sub_tracks WHERE file_id = ?'),
  addAudio: db.prepare('INSERT INTO audio_tracks (file_id, idx, codec, language, channels) VALUES (?,?,?,?,?)'),
  addSub: db.prepare('INSERT INTO sub_tracks (file_id, idx, codec, language, forced, external) VALUES (?,?,?,?,?,?)'),
  genre: db.prepare('INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id'),
  linkGenre: db.prepare('INSERT OR IGNORE INTO item_genres (item_id, genre_id) VALUES (?,?)'),
  clearGenres: db.prepare('DELETE FROM item_genres WHERE item_id = ?'),
  clearRatings: db.prepare("DELETE FROM item_ratings WHERE item_id = ? AND origen = 'nfo'"),
  addRating: db.prepare("INSERT OR REPLACE INTO item_ratings (item_id, fuente, valor, maximo, votos, origen) VALUES (?,?,?,?,?,'nfo')"),
  // `search_name` es el nombre sin tildes: es lo que permite encontrar a
  // «Adrián Colón» escribiendo «adrian colon», que es como se escribe cuando
  // se busca con prisa. Lo mismo que `search_title` hace con las películas.
  person: db.prepare(`INSERT INTO people (name, search_name, thumb) VALUES (?,?,?)
                      ON CONFLICT(name) DO UPDATE SET
                        search_name=excluded.search_name,
                        thumb=COALESCE(excluded.thumb, people.thumb) RETURNING id`),
  linkPerson: db.prepare('INSERT OR REPLACE INTO item_people (item_id, person_id, role, character, ord) VALUES (?,?,?,?,?)'),
  clearPeople: db.prepare('DELETE FROM item_people WHERE item_id = ?'),
  library: db.prepare('INSERT INTO libraries (name, path, kind) VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name, kind=excluded.kind RETURNING id'),
  staleItems: db.prepare('SELECT id FROM items WHERE library_id = ? AND scanned_at < ?'),
  deleteItem: db.prepare('DELETE FROM items WHERE id = ?'),
};

function saveTracks(fileId: number, nfo: NfoData | null, subs: ReturnType<typeof externalSubs>) {
  stmt.clearTracks.run(fileId);
  stmt.clearSubs.run(fileId);
  nfo?.audio.forEach((a, i) => stmt.addAudio.run(fileId, i, a.codec ?? null, lang(a.language) ?? null, a.channels ?? null));

  /*
   * Los `<subtitle>` del `<streamdetails>` de tinyMediaManager **no son solo
   * las pistas del contenedor**: incluyen los `.srt` que hay al lado del
   * vídeo. Apuntarlos todos como incrustados (`external = NULL`) creaba una
   * pista fantasma por cada subtítulo externo.
   *
   * Comprobado el 25/09 contra la biblioteca real: «Doc of the Dead» tenía
   * dos filas de incrustadas en la base y `ffprobe` decía que el fichero no
   * tiene ninguna — eran sus dos `.srt`. Los datos de vídeo, audio y duración
   * del NFO sí son exactos (6 de 6 en una muestra al azar); el problema era
   * solo esta lectura.
   *
   * Hacía daño de verdad en tres sitios: la lista de la biblioteca enseñaba
   * subtítulos inexistentes, las estadísticas los contaban, y sobre todo
   * `media/transcribe.ts` elige como candidatos los ficheros **sin ninguna**
   * pista — así que se saltaba justo las películas que no tienen subtítulos y
   * habría que transcribir. Además oscilaba: `mediaInfo()` corrige las filas
   * al reproducir y el siguiente escaneo las volvía a pisar.
   *
   * Si el idioma ya lo cubre un fichero de al lado, se da por hecho que la
   * entrada del NFO es ese mismo fichero y no una pista del contenedor. Lo
   * que quede sin `.srt` equivalente sigue apuntándose como antes, para no
   * perder la información de los miles de ficheros que aún no se han probado
   * con `ffprobe`.
   */
  const idiomasExternos = new Set(subs.map((s) => s.language ?? '?'));
  nfo?.subtitles.forEach((s, i) => {
    if (idiomasExternos.has(lang(s.language) ?? '?')) return;
    stmt.addSub.run(fileId, i, s.codec ?? 'embedded', lang(s.language) ?? null, 0, null);
  });
  for (const s of subs) {
    stmt.addSub.run(fileId, null, s.codec, s.language ?? null, s.forced ? 1 : 0, s.path);
  }
}

/** Se reescriben enteras en cada escaneo: mandan los ficheros del disco. */
function saveRatings(itemId: number, nfo: { ratings?: { fuente: string; valor: number; maximo: number; votos: number }[] } | null) {
  if (!nfo || !nfo.ratings || !nfo.ratings.length) return;
  stmt.clearRatings.run(itemId);
  for (const r of nfo.ratings) stmt.addRating.run(itemId, r.fuente, r.valor, r.maximo, r.votos);
}

function saveGenresAndPeople(itemId: number, nfo: NfoData | null, thumbs: Map<string, string>) {
  stmt.clearGenres.run(itemId);
  stmt.clearPeople.run(itemId);
  if (!nfo) return;
  for (const g of nfo.genres) {
    const row = stmt.genre.get(g) as { id: number };
    stmt.linkGenre.run(itemId, row.id);
  }
  const seen = new Set<string>();
  for (const p of nfo.people) {
    const key = `${p.name}|${p.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const localThumb = thumbs.get(normalize(p.name));
    const row = stmt.person.get(p.name, normalize(p.name), localThumb ?? null) as { id: number };
    stmt.linkPerson.run(itemId, row.id, p.role, p.character ?? null, p.order ?? null);
  }
}

function fileMeta(path: string, nfo: NfoData | null) {
  let size = 0;
  let added: string | undefined;
  try {
    const st = statSync(path);
    size = st.size;
    added = st.mtime.toISOString();
  } catch {}
  return {
    size,
    added: nfo?.addedAt ? nfo.addedAt.replace(' ', 'T') : added,
    container: extname(path).slice(1).toLowerCase(),
  };
}

function scanMovieFolder(libId: number, dir: string, files: Entry[], now: string) {
  const videos = videoFiles(files);
  if (videos.length === 0) return 0;
  const main = videos.sort((a, b) => statSync(b.path).size - statSync(a.path).size)[0];
  const base = basename(main.name, extname(main.name));
  const nfoPath =
    files.find((f) => f.name.toLowerCase() === `${base.toLowerCase()}.nfo`)?.path ??
    files.find((f) => f.name.toLowerCase() === 'movie.nfo')?.path;
  const nfo = nfoPath ? parseNfo(nfoPath) : null;
  const fromFolder = parseTitleYear(basename(dir));
  const title = nfo?.title ?? fromFolder.title;
  const art = artworkFor(files, base);
  const meta = fileMeta(main.path, nfo);

  const item = stmt.upsertItem.get(
    libId, 'movie', dir, title, normalize(title), nfo?.sortTitle ?? null, nfo?.originalTitle ?? null,
    nfo?.year ?? fromFolder.year ?? null, nfo?.plot ?? null, nfo?.tagline ?? null, nfo?.runtime ?? null,
    nfo?.rating ?? null, nfo?.votes ?? null, nfo?.mpaa ?? null, nfo?.premiered ?? null, nfo?.studio ?? null,
    nfo?.country ?? null, nfo?.collection ?? null, nfo?.trailer ?? null, nfo?.imdbId ?? null, nfo?.tmdbId ?? null,
    art.poster ?? null, art.fanart ?? null, art.clearlogo ?? null, art.landscape ?? null, meta.added ?? null, now,
  ) as { id: number };

  const file = stmt.upsertFile.get(
    item.id, null, main.path, meta.size, meta.container, nfo?.video?.duration ?? null,
    nfo?.video?.codec ?? null, nfo?.video?.width ?? null, nfo?.video?.height ?? null, nfo?.video?.hdr ?? null,
  ) as { id: number };

  saveTracks(file.id, nfo, externalSubs(files, base));
  saveRatings(item.id, nfo);
  saveGenresAndPeople(item.id, nfo, actorThumbs(dir));
  return 1;
}

function seasonNumber(name: string): number | null {
  const lower = name.toLowerCase();
  if (/^(specials?|especiales?)$/.test(lower)) return 0;
  const m = lower.match(/(?:season|temporada|s)\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function episodeNumbers(name: string): { season: number; episode: number } | null {
  const m = name.match(/s(\d{1,3})[\s._-]*e(\d{1,3})/i) ?? name.match(/(\d{1,2})x(\d{1,3})/i);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
}

function scanShowFolder(libId: number, dir: string, files: Entry[], now: string) {
  const nfoPath = files.find((f) => f.name.toLowerCase() === 'tvshow.nfo')?.path;
  const nfo = nfoPath ? parseNfo(nfoPath) : null;
  const fromFolder = parseTitleYear(basename(dir));
  const title = nfo?.title ?? fromFolder.title;
  const art = artworkFor(files, basename(dir));

  const item = stmt.upsertItem.get(
    libId, 'show', dir, title, normalize(title), nfo?.sortTitle ?? null, nfo?.originalTitle ?? null,
    nfo?.year ?? fromFolder.year ?? null, nfo?.plot ?? null, nfo?.tagline ?? null, nfo?.runtime ?? null,
    nfo?.rating ?? null, nfo?.votes ?? null, nfo?.mpaa ?? null, nfo?.premiered ?? null, nfo?.studio ?? null,
    nfo?.country ?? null, nfo?.collection ?? null, nfo?.trailer ?? null, nfo?.imdbId ?? null, nfo?.tmdbId ?? null,
    art.poster ?? null, art.fanart ?? null, art.clearlogo ?? null, art.landscape ?? null, now, now,
  ) as { id: number };

  saveRatings(item.id, nfo);
  saveGenresAndPeople(item.id, nfo, actorThumbs(dir));

  const seasonDirs = files.filter((f) => f.isDir && seasonNumber(f.name) !== null);
  let episodes = 0;
  let latestAdded: string | undefined;

  for (const sd of seasonDirs) {
    const seasonFiles = listDir(sd.path);
    // Numeración de reserva cuando el nombre no trae SxxExx: por temporada, no
    // por serie entera, o la temporada 2 seguía contando donde dejó la 1.
    let episodeEnEstaTemporada = 0;
    for (const video of videoFiles(seasonFiles)) {
      const base = basename(video.name, extname(video.name));
      const nums = episodeNumbers(video.name) ?? { season: seasonNumber(sd.name) ?? 1, episode: episodeEnEstaTemporada + 1 };
      const epNfoPath = seasonFiles.find((f) => f.name.toLowerCase() === `${base.toLowerCase()}.nfo`)?.path;
      const epNfo = epNfoPath ? parseNfo(epNfoPath) : null;
      const thumb = findArt(seasonFiles, base, ['-thumb.jpg', '-thumb.png'], []);
      const meta = fileMeta(video.path, epNfo);
      if (meta.added && (!latestAdded || meta.added > latestAdded)) latestAdded = meta.added;

      const ep = stmt.upsertEpisode.get(
        item.id, epNfo?.season ?? nums.season, epNfo?.episode ?? nums.episode,
        epNfo?.title ?? base, epNfo?.plot ?? null, epNfo?.premiered ?? null,
        epNfo?.runtime ?? null, epNfo?.rating ?? null, thumb ?? null,
      ) as { id: number };

      const file = stmt.upsertFile.get(
        null, ep.id, video.path, meta.size, meta.container, epNfo?.video?.duration ?? null,
        epNfo?.video?.codec ?? null, epNfo?.video?.width ?? null, epNfo?.video?.height ?? null, epNfo?.video?.hdr ?? null,
      ) as { id: number };

      saveTracks(file.id, epNfo, externalSubs(seasonFiles, base));
      episodes++;
      episodeEnEstaTemporada++;
    }
  }

  if (episodes === 0) {
    stmt.deleteItem.run(item.id);
    return 0;
  }
  if (latestAdded) db.prepare('UPDATE items SET added_at = ? WHERE id = ?').run(latestAdded, item.id);
  return 1;
}

export type ScanProgress = { library: string; done: number; total: number; current: string };

/** Deja que el resto del servidor respire: una petición ya en curso puede seguir. */
function cederElHilo(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/*
 * Trocear en lotes, cada uno en su propia transaccion, y ceder el hilo entre
 * lotes.
 *
 * Antes era una unica transaccion para la biblioteca entera: 1.834 titulos y
 * 5.566 ficheros procesados en un solo tiron sincrono. Medido con el latido
 * del bucle de eventos: 235 segundos seguidos sin que el servidor contestara
 * a nadie, ni a la raiz. `node:sqlite` es sincrono de verdad, asi que la unica
 * forma de que otra peticion se cuele es que no haya ninguna transaccion
 * abierta en el momento de ceder — de ahi que el `await` vaya siempre
 * *despues* del `COMMIT`, nunca en mitad de una transaccion.
 *
 * El tamano del lote (25) es el mismo con el que ya se avisaba del progreso:
 * no es un numero nuevo, es reusar el que ya se habia medido como razonable.
 */
const LOTE = 25;

async function escanearCarpetas(
  lib: LibraryConfig,
  row: { id: number },
  entries: Entry[],
  now: string,
  onProgress?: (p: ScanProgress) => void,
): Promise<number> {
  let count = 0;
  for (let inicio = 0; inicio < entries.length; inicio += LOTE) {
    const lote = entries.slice(inicio, inicio + LOTE);
    db.exec('BEGIN');
    try {
      lote.forEach((entry, j) => {
        const files = listDir(entry.path);
        count += lib.kind === 'movie'
          ? scanMovieFolder(row.id, entry.path, files, now)
          : scanShowFolder(row.id, entry.path, files, now);
        if ((inicio + j) % 25 === 0) {
          onProgress?.({ library: lib.name, done: inicio + j + 1, total: entries.length, current: entry.name });
        }
      });
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (inicio + LOTE < entries.length) await cederElHilo();
  }
  return count;
}

/*
 * Ficheros que ya no estan, en carpetas que siguen. El pipeline recodifica
 * en su sitio y a veces cambia el nombre: la carpeta de la pelicula queda,
 * con su logo y su fondo, pero el .mkv antiguo no. Hasta ahora esa fila se
 * quedaba para siempre y la ficha decia «No se pudieron leer las pistas».
 *
 * Tambien en lotes: una biblioteca puede tener miles de ficheros y cada uno
 * pasa por `existsSync`, que sobre `E:\` en un momento malo del disco no es
 * gratis multiplicado por miles.
 */
async function retirarFicherosAusentes(libraryId: number): Promise<number> {
  const ficheros = db
    .prepare(`SELECT f.id, f.path FROM media_files f
               LEFT JOIN items i ON i.id = f.item_id
               LEFT JOIN episodes e ON e.id = f.episode_id
               LEFT JOIN items s ON s.id = e.show_id
              WHERE COALESCE(i.library_id, s.library_id) = ?`)
    .all(libraryId) as { id: number; path: string }[];
  let retirados = 0;
  const LOTE_FICHEROS = 200;
  for (let inicio = 0; inicio < ficheros.length; inicio += LOTE_FICHEROS) {
    const lote = ficheros.slice(inicio, inicio + LOTE_FICHEROS);
    db.exec('BEGIN');
    try {
      for (const f of lote) {
        if (!existsSync(f.path)) {
          stmt.clearTracks.run(f.id);
          stmt.clearSubs.run(f.id);
          db.prepare('DELETE FROM media_files WHERE id = ?').run(f.id);
          retirados++;
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    if (inicio + LOTE_FICHEROS < ficheros.length) await cederElHilo();
  }
  return retirados;
}

export async function scanLibrary(lib: LibraryConfig, onProgress?: (p: ScanProgress) => void): Promise<number> {
  const now = new Date().toISOString();
  const row = stmt.library.get(lib.name, lib.path, lib.kind) as { id: number };
  const entries = listDir(lib.path).filter((e) => e.isDir && !SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('_'));

  const count = await escanearCarpetas(lib, row, entries, now, onProgress);

  db.exec('BEGIN');
  try {
    for (const stale of stmt.staleItems.all(row.id, now) as { id: number }[]) {
      stmt.deleteItem.run(stale.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const retirados = await retirarFicherosAusentes(row.id);

  onProgress?.({ library: lib.name, done: entries.length, total: entries.length, current: '' });
  if (retirados > 0) console.log(`[escaneo] ${lib.name}: ${retirados} ficheros ya no estan en disco, retirados`);
  return count;
}

/** Re-reads a single title's folder, so a subtitle or artwork drop shows up
 *  without paying for a full library pass. */
export function rescanItem(itemId: number): boolean {
  const row = db
    .prepare('SELECT i.folder, i.library_id, l.kind FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?')
    .get(itemId) as { folder: string; library_id: number; kind: LibraryConfig['kind'] } | undefined;
  if (!row) return false;

  const now = new Date().toISOString();
  const files = listDir(row.folder);
  db.exec('BEGIN');
  try {
    const count = row.kind === 'movie'
      ? scanMovieFolder(row.library_id, row.folder, files, now)
      : scanShowFolder(row.library_id, row.folder, files, now);
    db.exec('COMMIT');
    return count > 0;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export async function scanAll(onProgress?: (p: ScanProgress) => void) {
  const results: { name: string; count: number }[] = [];
  for (const lib of config.libraries) {
    results.push({ name: lib.name, count: await scanLibrary(lib, onProgress) });
  }

  /*
   * Plegar el WAL al acabar. SQLite no encoge nunca el `-wal` por su cuenta:
   * el autocheckpoint lo reutiliza desde el principio, pero el fichero se
   * queda del tamaño de la mayor ráfaga de escrituras que haya visto. Medido
   * el 26/09/2026 tras la tanda de subtítulos: `tvwatch.db` 167,3 MB y
   * `tvwatch.db-wal` 166,6 MB, casi el doble de disco para la misma base.
   *
   * Esto NO es `optimizarBaseDeDatos()`: no hay `VACUUM` ni `ANALYZE`, que sí
   * bloquean y por eso siguen siendo cosa de Ajustes, a mano. Un checkpoint
   * TRUNCATE solo vuelca las páginas pendientes y corta el fichero. Si hay
   * alguien leyendo, devuelve ocupado y no pasa nada: se plegará al siguiente
   * escaneo. Por eso no se comprueba el resultado ni se aborta el escaneo
   * -que ya ha terminado bien- si esto no puede hacerse.
   */
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error('[escaneo] no se pudo plegar el WAL:', (err as Error).message);
  }

  return results;
}

/*
 * `scanAll()` en su propio hilo (scan-worker.ts), para que un escaneo largo
 * no dependa de ceder el hilo bien en cada rincón del código: pase lo que
 * pase ahí dentro, el servidor HTTP no se entera. Ver el comentario de
 * scan-worker.ts para el porqué completo.
 */
export function scanAllEnWorker(onProgress?: (p: ScanProgress) => void): Promise<{ name: string; count: number }[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./scan-worker.ts', import.meta.url));
    let asentado = false;
    worker.on('message', (msg: { type: string; progress?: ScanProgress; results?: { name: string; count: number }[]; message?: string }) => {
      if (msg.type === 'progress' && msg.progress) {
        onProgress?.(msg.progress);
      } else if (msg.type === 'done') {
        asentado = true;
        resolve(msg.results ?? []);
      } else if (msg.type === 'error') {
        asentado = true;
        reject(new Error(msg.message));
      }
    });
    worker.on('error', (err) => {
      if (!asentado) reject(err);
    });
    worker.on('exit', (code) => {
      if (!asentado) reject(new Error(`El worker de escaneo terminó sin avisar (código ${code})`));
    });
  });
}
