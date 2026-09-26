import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

const ARRAY_TAGS = new Set([
  'genre',
  'studio',
  'country',
  'tag',
  'actor',
  'director',
  'credits',
  'writer',
  'rating',
  'uniqueid',
  'thumb',
  'audio',
  'video',
  'subtitle',
  'namedseason',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export type Person = { name: string; role: string; character?: string; order?: number; thumb?: string };
export type StreamAudio = { codec?: string; language?: string; channels?: number };
export type StreamSub = { language?: string; codec?: string };

/** Una valoracion tal y como viene en el `.nfo`, sin normalizar. */
export type Valoracion = { fuente: string; valor: number; maximo: number; votos: number };

export type NfoData = {
  title?: string;
  originalTitle?: string;
  sortTitle?: string;
  year?: number;
  plot?: string;
  tagline?: string;
  runtime?: number;
  rating?: number;
  votes?: number;
  /** Todas las valoraciones del fichero, no solo la que manda. */
  ratings: Valoracion[];
  mpaa?: string;
  premiered?: string;
  studio?: string;
  country?: string;
  collection?: string;
  trailer?: string;
  imdbId?: string;
  tmdbId?: string;
  addedAt?: string;
  genres: string[];
  people: Person[];
  season?: number;
  episode?: number;
  video?: { codec?: string; width?: number; height?: number; duration?: number; hdr?: string };
  audio: StreamAudio[];
  subtitles: StreamSub[];
};

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Igual que `num`, pero el cero tampoco cuenta.
 *
 * Muchos `.nfo` de esta biblioteca traen literalmente `<width>0</width>`,
 * `<height>0</height>` y `<durationinseconds>0</durationinseconds>`: el
 * programa que los generó no llegó a leer el vídeo. Como cero **no es NULL**,
 * el `COALESCE` del escáner lo daba por bueno y pisaba lo que ffprobe había
 * medido — en cada reescaneo. De ahí los 107 ficheros sin duración, que se
 * reparaban y volvían a romperse solos. Una película no dura cero segundos ni
 * mide cero píxeles: es un hueco, no un dato.
 */
const numPositivo = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object') {
    const t = (v as Record<string, unknown>)['#text'];
    return t === undefined ? undefined : String(t).trim() || undefined;
  }
  const s = String(v).trim();
  return s || undefined;
};

/*
 * Las valoraciones de los `.nfo` de esta biblioteca.
 *
 * Medido sobre los 1.759 ficheros de peliculas: IMDb en el 98 %, TheMovieDb en
 * el 96 %, Rotten Tomatoes (`tomatometerallcritics`) en el 84 % y Metacritic en
 * el 68 %. En las series hay IMDb (90 %) y TheMovieDb (95 %), pero TVDB solo en
 * una de 101 — eso no esta en los ficheros y habria que traerlo de fuera.
 *
 * Se guardan todas tal cual, con su escala: IMDb y TMDb van sobre 10 y los dos
 * porcentajes sobre 100, y mezclarlos en un solo numero seria mentir.
 */
function todasLasValoraciones(node: Record<string, any>): Valoracion[] {
  const lista = node?.ratings?.rating;
  const salida: Valoracion[] = [];
  const crudas = Array.isArray(lista) ? lista : lista ? [lista] : [];
  for (const r of crudas) {
    const fuente = str(r['@_name']);
    const valor = num(r.value);
    if (!fuente || valor === undefined || valor <= 0) continue;
    salida.push({ fuente: fuente.toLowerCase(), valor, maximo: num(r['@_max']) ?? 10, votos: num(r.votes) ?? 0 });
  }
  return salida;
}

function pickRating(node: Record<string, any>): { rating?: number; votes?: number } {
  const list = node?.ratings?.rating;
  if (!Array.isArray(list)) return { rating: num(node?.rating) };
  const isTen = (r: any) => num(r['@_max']) === 10 || r['@_max'] === undefined;
  const byName = (n: string) => list.find((r) => r['@_name'] === n && isTen(r));
  const chosen =
    list.find((r) => r['@_default'] === 'true' && isTen(r)) ??
    byName('imdb') ??
    byName('themoviedb') ??
    list.find(isTen);
  if (!chosen) return {};
  return { rating: num(chosen.value), votes: num(chosen.votes) };
}

function collectPeople(node: Record<string, any>): Person[] {
  const out: Person[] = [];
  /*
   * tinyMediaManager NO escribe <order> en los <actor>: la columna ord de
   * item_people estaba vacia en las 87.590 apariciones (26/09/2026), la API no
   * podia ordenar el reparto y salian secundarios antes que las estrellas. Pero
   * el ORDEN de los <actor> en el .nfo SI es el de reparto, tal como viene de
   * TMDb (comprobado: El club de la lucha -> Norton, Pitt, Bonham Carter;
   * Troya -> Pitt, Bloom, Bana). Se usa esa posicion cuando falta <order>.
   * `??` y no `||`: un <order>0</order> es el protagonista y no debe perderse.
   */
  let posicion = 0;
  for (const a of node.actor ?? []) {
    const name = str(a?.name);
    if (!name) continue;
    out.push({
      name,
      role: 'actor',
      character: str(a?.role),
      order: num(a?.order) ?? posicion,
      thumb: str(a?.thumb),
    });
    posicion++;
  }
  for (const d of node.director ?? []) {
    const name = str(d);
    if (name) out.push({ name, role: 'director' });
  }
  for (const w of [...(node.credits ?? []), ...(node.writer ?? [])]) {
    const name = str(w);
    if (name) out.push({ name, role: 'writer' });
  }
  return out;
}

function streamDetails(node: Record<string, any>): Pick<NfoData, 'video' | 'audio' | 'subtitles'> {
  const sd = node?.fileinfo?.streamdetails;
  const v = sd?.video?.[0];
  const height = numPositivo(v?.height);
  const hdrRaw = str(v?.hdrtype);
  return {
    video: v
      ? {
          codec: str(v.codec)?.toLowerCase(),
          width: numPositivo(v.width),
          height,
          duration: numPositivo(v.durationinseconds),
          hdr: hdrRaw ? hdrRaw.toUpperCase() : undefined,
        }
      : undefined,
    audio: (sd?.audio ?? []).map((a: any) => ({
      codec: str(a.codec)?.toLowerCase(),
      language: str(a.language),
      channels: numPositivo(a.channels),
    })),
    subtitles: (sd?.subtitle ?? []).map((s: any) => ({
      language: str(s.language),
      codec: str(s.codec),
    })),
  };
}

function fromNode(node: Record<string, any>): NfoData {
  const { rating, votes } = pickRating(node);
  const ratings = todasLasValoraciones(node);
  const uniqueIds: Record<string, string> = {};
  for (const u of node.uniqueid ?? []) {
    const type = str(u?.['@_type']);
    const value = str(u?.['#text'] ?? u);
    if (type && value) uniqueIds[type] = value;
  }
  const rawId = str(node.id);
  return {
    title: str(node.title),
    originalTitle: str(node.originaltitle),
    sortTitle: str(node.sorttitle),
    year: num(node.year),
    plot: str(node.plot) ?? str(node.outline),
    tagline: str(node.tagline),
    runtime: num(node.runtime),
    rating,
    ratings,
    votes,
    mpaa: str(node.mpaa) ?? str(node.certification),
    premiered: str(node.premiered) ?? str(node.aired),
    studio: (node.studio ?? []).map(str).filter(Boolean).join(', ') || undefined,
    country: (node.country ?? []).map(str).filter(Boolean).join(', ') || undefined,
    collection: str(node.set?.name) ?? str(node.set),
    trailer: str(node.trailer),
    imdbId: uniqueIds.imdb ?? (rawId?.startsWith('tt') ? rawId : undefined),
    tmdbId: uniqueIds.tmdb ?? str(node.tmdbid),
    addedAt: str(node.dateadded),
    genres: (node.genre ?? []).map(str).filter(Boolean) as string[],
    people: collectPeople(node),
    season: num(node.season),
    episode: num(node.episode),
    ...streamDetails(node),
  };
}

export function parseNfo(path: string): NfoData | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  // Some NFOs carry a trailing URL after the XML block, and a few are URL-only.
  const start = raw.indexOf('<');
  if (start < 0) return null;
  let doc: Record<string, any>;
  try {
    doc = parser.parse(raw.slice(start));
  } catch {
    return null;
  }
  const node = doc.movie ?? doc.tvshow ?? doc.episodedetails ?? doc.musicvideo;
  if (!node) return null;
  return fromNode(node);
}
