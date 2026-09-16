/**
 * Identificación de anime.
 *
 * TMDb falla mucho con anime: no conoce el título romaji, mezcla las películas
 * con la serie y parte las temporadas de otra manera. Aquí se consultan fuentes
 * especializadas, que además devuelven los títulos alternativos —lo que hace
 * falta para reconocer una carpeta llamada «Musculman» cuando la serie figura
 * como «Kinnikuman».
 *
 * Hay tres fuentes y se prueban en orden porque ninguna es de fiar por sí sola.
 * Comprobado el 2026-09-06: AniList devuelve 403 («temporarily disabled due to
 * severe stability issues») y Jikan devuelve 504 porque no alcanza a
 * MyAnimeList. La única en pie era Kitsu, así que va primero. Las tres
 * devuelven la misma propuesta y el resto del servidor no se entera de cuál
 * contestó; si mañana vuelve otra, sigue funcionando sin tocar nada.
 *
 * Solo se usan para identificar y para la portada: la sinopsis en español la
 * sigue poniendo TMDb, porque estas fuentes solo la tienen en inglés.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { db, normalize } from '../db.ts';
import { descargar, type Confidence } from './tmdb.ts';

const ARTWORK_DIR = join(DATA_DIR, 'artwork');

export class AnimeError extends Error {}

export type Fuente = 'kitsu' | 'mal' | 'anilist';

export type PropuestaAnime = {
  /** `kitsu:2013` o `mal:3287`: la fuente va dentro para no confundirlas. */
  id: string;
  fuente: Fuente;
  titulo: string;
  tituloOriginal: string | null;
  anio: number | null;
  formato: string | null;
  episodios: number | null;
  sinopsis: string | null;
  nota: number | null;
  portadaUrl: string | null;
  fondoUrl: string | null;
  generos: string[];
  sinonimos: string[];
};

/** Cada aspirante viaja con su nota y con la razón, para que se pueda juzgar. */
export type Aspirante = { propuesta: PropuestaAnime; confianza: Confidence; porque: string };

export type CandidatoAnime = {
  itemId: number;
  titulo: string;
  anio: number | null;
  episodiosEnDisco: number;
  confianza: Confidence;
  coincidePor: string;
  propuesta: PropuestaAnime | null;
  alternativas: Aspirante[];
};

// Los géneros llegan en inglés; la biblioteca los tiene en español.
const GENEROS: Record<string, string> = {
  Action: 'Acción',
  Adventure: 'Aventura',
  Comedy: 'Comedia',
  Drama: 'Drama',
  Ecchi: 'Ecchi',
  Fantasy: 'Fantasía',
  Horror: 'Terror',
  'Mahou Shoujo': 'Mahou Shoujo',
  Mecha: 'Mecha',
  Music: 'Música',
  Mystery: 'Misterio',
  Psychological: 'Psicológico',
  Romance: 'Romance',
  'Sci-Fi': 'Ciencia Ficción',
  'Slice of Life': 'Recuentos de la vida',
  'Award Winning': 'Premiada',
  Sports: 'Deporte',
  Supernatural: 'Sobrenatural',
  Suspense: 'Suspense',
  Thriller: 'Suspense',
  Hentai: 'Hentai',
};

const traducirGeneros = (nombres: string[]) => [...new Set(nombres.map((g) => GENEROS[g] ?? g))];
const limpiar = (texto: unknown) => (texto ? String(texto).replace(/<[^>]+>/g, '').trim() || null : null);

// --- Kitsu ------------------------------------------------------------------

const KITSU = 'https://kitsu.app/api/edge';

async function kitsu<T>(ruta: string): Promise<T> {
  const res = await fetch(KITSU + ruta, { headers: { accept: 'application/vnd.api+json' } });
  if (!res.ok) throw new AnimeError(`Kitsu respondió ${res.status}`);
  return (await res.json()) as T;
}

function deKitsu(raw: any): PropuestaAnime {
  const at = raw.attributes ?? {};
  const titulos = at.titles ?? {};
  const nota = at.averageRating ? Number(at.averageRating) / 10 : null;
  return {
    id: `kitsu:${raw.id}`,
    fuente: 'kitsu',
    titulo: at.canonicalTitle ?? titulos.en ?? titulos.en_jp ?? '',
    tituloOriginal: titulos.ja_jp ?? titulos.en_jp ?? null,
    anio: at.startDate ? Number(String(at.startDate).slice(0, 4)) : null,
    // Kitsu llama «TV» a las series y «movie», «OVA» o «special» al resto.
    formato: at.subtype ? String(at.subtype).toUpperCase() : null,
    episodios: at.episodeCount ?? null,
    sinopsis: limpiar(at.synopsis),
    nota: nota && nota > 0 ? Math.round(nota * 10) / 10 : null,
    portadaUrl: at.posterImage?.original ?? at.posterImage?.large ?? null,
    fondoUrl: at.coverImage?.original ?? null,
    // Los géneros de Kitsu van en otra petición; no compensa, ya los pone TMDb.
    generos: [],
    sinonimos: [...new Set([...Object.values(titulos), ...(at.abbreviatedTitles ?? [])])].filter(Boolean) as string[],
  };
}

async function buscarEnKitsu(titulo: string, _anio?: number | null): Promise<PropuestaAnime[]> {
  // Kitsu no filtra bien por año: se piden más resultados y ya se ordenan luego.
  const params = new URLSearchParams({ 'filter[text]': titulo, 'page[limit]': '8' });
  const data = await kitsu<{ data: any[] }>(`/anime?${params}`);
  return (data.data ?? []).map(deKitsu);
}

const detalleKitsu = async (id: string) => deKitsu((await kitsu<{ data: any }>(`/anime/${id}`)).data);

// --- Jikan (MyAnimeList) ----------------------------------------------------

const JIKAN = 'https://api.jikan.moe/v4';
let ultimaJikan = 0;

/** Jikan permite 3 por segundo. Se espacian sin más: no hay prisa y así no corta. */
async function jikan<T>(ruta: string): Promise<T> {
  for (let intento = 0; intento < 3; intento++) {
    const espera = 400 - (Date.now() - ultimaJikan);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaJikan = Date.now();

    const res = await fetch(JIKAN + ruta, { headers: { accept: 'application/json' } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) throw new AnimeError(`MyAnimeList respondió ${res.status}`);
    return (await res.json()) as T;
  }
  throw new AnimeError('MyAnimeList está limitando las peticiones; inténtalo más tarde');
}

function deJikan(raw: any): PropuestaAnime {
  const otros = (raw.titles ?? []).map((t: any) => t.title).filter(Boolean);
  return {
    id: `mal:${raw.mal_id}`,
    fuente: 'mal',
    titulo: raw.title ?? raw.title_english ?? '',
    tituloOriginal: raw.title_japanese ?? raw.title_english ?? null,
    anio: raw.year ?? (raw.aired?.from ? Number(String(raw.aired.from).slice(0, 4)) : null),
    formato: raw.type ?? null,
    episodios: raw.episodes ?? null,
    sinopsis: limpiar(raw.synopsis),
    nota: typeof raw.score === 'number' && raw.score > 0 ? raw.score : null,
    portadaUrl: raw.images?.jpg?.large_image_url ?? raw.images?.jpg?.image_url ?? null,
    // MyAnimeList no publica fondos panorámicos; el fanart lo pone TMDb.
    fondoUrl: null,
    generos: traducirGeneros([...(raw.genres ?? []), ...(raw.themes ?? [])].map((g: any) => g.name)),
    sinonimos: [...new Set([...(raw.title_synonyms ?? []), ...otros])] as string[],
  };
}

async function buscarEnJikan(titulo: string, anio?: number | null): Promise<PropuestaAnime[]> {
  const params = new URLSearchParams({ q: titulo, limit: '8', sfw: 'false' });
  if (anio) {
    params.set('start_date', `${anio - 1}-01-01`);
    params.set('end_date', `${anio + 2}-12-31`);
  }
  const data = await jikan<{ data: any[] }>(`/anime?${params}`);
  return (data.data ?? []).map(deJikan);
}

const detalleJikan = async (malId: number) => deJikan((await jikan<{ data: any }>(`/anime/${malId}`)).data);

// --- AniList ----------------------------------------------------------------

const ANILIST = 'https://graphql.anilist.co';
const CAMPOS_ANILIST = `
  id
  title { romaji english native }
  startDate { year }
  format
  episodes
  description(asHtml: false)
  averageScore
  genres
  synonyms
  coverImage { extraLarge }
  bannerImage
`;

async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const cuerpo = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (cuerpo.errors?.length) throw new AnimeError(cuerpo.errors[0].message);
  if (!res.ok || !cuerpo.data) throw new AnimeError(`AniList respondió ${res.status}`);
  return cuerpo.data;
}

function deAniList(raw: any): PropuestaAnime {
  const titulos = raw.title ?? {};
  return {
    id: `anilist:${raw.id}`,
    fuente: 'anilist',
    titulo: titulos.romaji || titulos.english || titulos.native || '',
    tituloOriginal: titulos.native || titulos.english || null,
    anio: raw.startDate?.year ?? null,
    formato: raw.format ?? null,
    episodios: raw.episodes ?? null,
    sinopsis: limpiar(raw.description),
    nota: typeof raw.averageScore === 'number' && raw.averageScore > 0 ? Math.round(raw.averageScore) / 10 : null,
    portadaUrl: raw.coverImage?.extraLarge ?? null,
    fondoUrl: raw.bannerImage ?? null,
    generos: traducirGeneros(raw.genres ?? []),
    sinonimos: raw.synonyms ?? [],
  };
}

async function buscarEnAniList(titulo: string, anio?: number | null): Promise<PropuestaAnime[]> {
  const data = await anilist<{ Page: { media: any[] } }>(
    `query ($busqueda: String, $anio: Int) {
       Page(page: 1, perPage: 8) {
         media(search: $busqueda, type: ANIME, seasonYear: $anio, sort: SEARCH_MATCH) { ${CAMPOS_ANILIST} }
       }
     }`,
    { busqueda: titulo, anio: anio ?? null },
  );
  return (data.Page?.media ?? []).map(deAniList);
}

const detalleAniList = async (id: number) =>
  deAniList((await anilist<{ Media: any }>(`query ($id: Int) { Media(id: $id, type: ANIME) { ${CAMPOS_ANILIST} } }`, { id })).Media);

// --- Fachada ----------------------------------------------------------------

/** Prueba las fuentes en orden y se queda con la primera que conteste. */
export async function buscarAnime(titulo: string, anio?: number | null): Promise<PropuestaAnime[]> {
  const fallos: string[] = [];
  for (const buscar of [buscarEnKitsu, buscarEnJikan, buscarEnAniList]) {
    try {
      const resultados = await buscar(titulo, anio);
      if (resultados.length > 0) return resultados;
    } catch (err) {
      fallos.push((err as Error).message);
    }
  }
  if (fallos.length === 3) throw new AnimeError(`Ninguna fuente de anime responde (${fallos.join('; ')})`);
  return [];
}

export async function detalleAnime(id: string): Promise<PropuestaAnime> {
  const [fuente, numero] = id.split(':');
  if (fuente === 'kitsu') return detalleKitsu(numero);
  if (fuente === 'mal') return detalleJikan(Number(numero));
  if (fuente === 'anilist') return detalleAniList(Number(numero));
  throw new AnimeError(`Fuente de anime desconocida: ${fuente}`);
}

type Ficha = { title: string; original_title: string | null; year: number | null; episodiosEnDisco: number };

/**
 * Un título solo se da por bueno si coincide alguno de sus nombres, no por
 * salir el primero de la lista.
 *
 * Con anime el número de episodios desempata mejor que el año: buscando
 * «Dr. Slump» salen la serie de 1997 con 74 capítulos y la de 1981 con 243, y
 * en disco hay 243. El recuento acierta donde el título, idéntico, no dice nada.
 */
function puntuar(item: Ficha, p: PropuestaAnime): { confianza: Confidence; porque: string } {
  const nombres = [p.titulo, p.tituloOriginal ?? '', ...p.sinonimos].filter(Boolean).map(normalize);
  const mios = [item.title, item.original_title ?? ''].filter(Boolean).map(normalize);
  const mismoTitulo = mios.some((m) => nombres.includes(m));
  const mismoAnio = item.year != null && p.anio != null && Math.abs(item.year - p.anio) <= 1;
  const mismosEpisodios = item.episodiosEnDisco > 0 && p.episodios === item.episodiosEnDisco;

  const pruebas = [
    mismoTitulo && 'mismo título',
    mismoAnio && 'mismo año',
    mismosEpisodios && `los ${item.episodiosEnDisco} episodios cuadran`,
  ].filter(Boolean) as string[];
  const porque = pruebas.length > 0 ? pruebas.join(', ') : 'solo se parece el nombre';

  // Las películas de una saga comparten nombre corto con la serie: buscando
  // «Dr. Slump» salen sus seis películas, todas con el título abreviado igual.
  // Una obra de un solo episodio no puede ser una serie de 243, por mucho que
  // coincidan el nombre y el año, así que no compite.
  if (item.episodiosEnDisco > 1 && (p.episodios ?? 0) <= 1) {
    return { confianza: 'weak', porque: `es ${p.formato === 'MOVIE' ? 'una película' : 'una obra suelta'} de la misma saga, no la serie` };
  }

  if (mismosEpisodios && (mismoTitulo || mismoAnio)) return { confianza: 'exact', porque };
  if (mismoTitulo && mismoAnio) return { confianza: 'exact', porque };
  if (mismoTitulo || mismosEpisodios) return { confianza: 'strong', porque };
  return { confianza: 'weak', porque };
}

export async function candidatoAnime(itemId: number): Promise<CandidatoAnime> {
  const row = db.prepare('SELECT id, title, original_title, year FROM items WHERE id = ?').get(itemId) as any;
  if (!row) throw new AnimeError('Título no encontrado');
  row.episodiosEnDisco = (db.prepare('SELECT COUNT(*) AS n FROM episodes WHERE show_id = ?').get(itemId) as any).n;

  let resultados = await buscarAnime(row.title, row.year);
  // Si la carpeta lleva el nombre traducido, el original del NFO suele acertar.
  if (resultados.length === 0 && row.original_title && row.original_title !== row.title) {
    resultados = await buscarAnime(row.original_title, row.year);
  }
  // Buscar sin año rescata a las series largas, fechadas por su primera emisión.
  if (resultados.length === 0) resultados = await buscarAnime(row.title, null);

  // La mejor no es la primera que devuelve la fuente, sino la que más se parece.
  const orden: Record<Confidence, number> = { exact: 0, strong: 1, weak: 2 };
  const ordenadas: Aspirante[] = resultados
    .map((propuesta) => ({ propuesta, ...puntuar(row, propuesta) }))
    .sort((a, b) => orden[a.confianza] - orden[b.confianza]);

  const mejor = ordenadas[0] ?? null;
  const FUENTES: Record<Fuente, string> = { kitsu: 'Kitsu', mal: 'MyAnimeList', anilist: 'AniList' };

  return {
    itemId: row.id,
    titulo: row.title,
    anio: row.year,
    episodiosEnDisco: row.episodiosEnDisco,
    confianza: mejor ? mejor.confianza : 'weak',
    coincidePor: mejor ? `${FUENTES[mejor.propuesta.fuente]}: ${mejor.porque}` : 'sin resultados',
    propuesta: mejor ? mejor.propuesta : null,
    alternativas: ordenadas.slice(1, 7),
  };
}

export type AplicarAnime = {
  itemId: number;
  animeId: string;
  campos: ('poster' | 'fanart' | 'plot' | 'rating' | 'genres')[];
  overwrite?: boolean;
};

/** Igual que el agente de TMDb: escribe solo lo pedido, y solo en huecos salvo que se fuerce. */
export async function aplicarAnime(peticion: AplicarAnime) {
  const item = db.prepare('SELECT id, poster, fanart, plot, rating FROM items WHERE id = ?').get(peticion.itemId) as any;
  if (!item) throw new AnimeError('El título ya no existe');

  const p = await detalleAnime(peticion.animeId);
  const dir = join(ARTWORK_DIR, String(peticion.itemId));
  mkdirSync(dir, { recursive: true });

  const cambios: Record<string, string | number> = {};
  const quiere = (campo: string, actual: unknown) => peticion.campos.includes(campo as never) && (peticion.overwrite || actual == null);

  if (quiere('poster', item.poster) && p.portadaUrl) cambios.poster = await descargar(p.portadaUrl, join(dir, 'poster.jpg'));
  if (quiere('fanart', item.fanart) && p.fondoUrl) cambios.fanart = await descargar(p.fondoUrl, join(dir, 'fanart.jpg'));
  if (quiere('plot', item.plot) && p.sinopsis) cambios.plot = p.sinopsis;
  if (quiere('rating', item.rating) && p.nota != null) cambios.rating = p.nota;

  if (peticion.campos.includes('genres') && p.generos.length > 0) {
    const genero = db.prepare('INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id');
    const enlazar = db.prepare('INSERT OR IGNORE INTO item_genres (item_id, genre_id) VALUES (?,?)');
    for (const nombre of p.generos) enlazar.run(peticion.itemId, (genero.get(nombre) as { id: number }).id);
  }

  cambios.anime_id = peticion.animeId;

  const claves = Object.keys(cambios);
  db.prepare(`UPDATE items SET ${claves.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...claves.map((k) => cambios[k]), peticion.itemId);

  return { aplicado: claves.filter((k) => k !== 'anime_id'), titulo: p.titulo, fuente: p.fuente };
}
