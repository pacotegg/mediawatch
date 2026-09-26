/**
 * TheTVDB (v4): segunda fuente de logotipos, fondos y carteles.
 *
 * Donde fanart.tv no tiene nada —series pequeñas, cosas españolas— TVDB a
 * veces sí, y cada imagen suya trae el idioma puesto, que es justo lo que
 * hace falta para preferir español e inglés. No tiene apaisadas ni discos:
 * para eso solo está fanart.tv.
 *
 * La clave se cambia por un token que dura un mes; se pide al primer uso y se
 * renueva sola si TVDB contesta 401.
 */
import { config } from '../config.ts';

const API = 'https://api4.thetvdb.com/v4';

/** Tipos de imagen de TVDB (de `/artwork/types`), los que se usan aquí. */
const TIPOS = {
  series: { clearlogo: 23, fanart: 3, poster: 2 },
  movie: { clearlogo: 25, fanart: 15, poster: 14 },
} as const;

/** TVDB habla en códigos de tres letras; el resto de la casa en dos. */
const IDIOMA: Record<string, string> = { spa: 'es', eng: 'en', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', jpn: 'ja', rus: 'ru', zho: 'zh', kor: 'ko' };

let token: string | null = null;

async function entrar(): Promise<string> {
  const res = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ apikey: config.tvdbApiKey }),
  });
  if (!res.ok) throw new Error(`TVDB no acepta la clave (${res.status})`);
  const datos = (await res.json()) as { data?: { token?: string } };
  if (!datos.data?.token) throw new Error('TVDB no devolvió token');
  token = datos.data.token;
  return token;
}

async function tvdb<T>(path: string): Promise<T | null> {
  if (!config.tvdbApiKey) return null;
  for (let intento = 0; intento < 2; intento++) {
    const t = token ?? (await entrar());
    const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${t}`, accept: 'application/json' } });
    if (res.status === 401) { token = null; continue; }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TVDB respondió ${res.status}`);
    return ((await res.json()) as { data: T }).data;
  }
  return null;
}

export type ImagenTvdb = { url: string; vista: string; idioma: string; votos: number };

type Arte = { type: number; image: string; thumbnail?: string; language?: string | null; score?: number };

function aImagen(a: Arte): ImagenTvdb {
  return {
    url: a.image,
    vista: a.thumbnail ?? a.image,
    idioma: a.language ? (IDIOMA[a.language] ?? a.language.slice(0, 2)) : '',
    votos: Number(a.score ?? 0),
  };
}

/** El id de TVDB de una película, buscándola por su IMDb. */
export async function idDePeliculaTvdb(imdbId: string): Promise<number | null> {
  const r = await tvdb<{ movie?: { id: number } }[]>(`/search/remoteid/${imdbId}`);
  const m = r?.find((x) => x.movie)?.movie;
  return m?.id ?? null;
}

/**
 * Las imágenes de un título, por papeles. Series por su id de TVDB;
 * películas por el suyo (que sale de `idDePeliculaTvdb`).
 */
export async function imagenesDeTvdb(kind: 'movie' | 'show', tvdbId: number): Promise<Record<'clearlogo' | 'fanart' | 'poster', ImagenTvdb[]> | null> {
  const tipos = kind === 'show' ? TIPOS.series : TIPOS.movie;
  const ext = kind === 'show'
    ? await tvdb<{ artworks?: Arte[] }>(`/series/${tvdbId}/artworks`)
    : await tvdb<{ artworks?: Arte[] }>(`/movies/${tvdbId}/extended`);
  if (!ext) return null;
  const arts = ext.artworks ?? [];
  const de = (tipo: number) => arts.filter((a) => a.type === tipo && a.image).map(aImagen).sort((a, b) => b.votos - a.votos);
  return { clearlogo: de(tipos.clearlogo), fanart: de(tipos.fanart), poster: de(tipos.poster) };
}

/**
 * Una persona, buscada por nombre y **confirmada por su id de IMDb**: la
 * búsqueda devuelve homónimos y hasta erratas («Telly Salavas»), y solo el
 * IMDb distingue al bueno. La foto de relleno de TVDB (`images/missing`) no
 * cuenta como foto.
 */
export async function buscarPersonaTvdb(nombre: string, imdbId: string): Promise<{ id: number; foto: string | null } | null> {
  type Resultado = { tvdb_id: string; image_url?: string; remote_ids?: { id: string; sourceName: string }[] };
  const r = await tvdb<Resultado[]>(`/search?type=people&query=${encodeURIComponent(nombre)}`);
  const buena = r?.find((x) => x.remote_ids?.some((rid) => rid.sourceName === 'IMDB' && rid.id === imdbId));
  if (!buena) return null;
  const foto = buena.image_url && !/\/missing\//.test(buena.image_url) ? buena.image_url : null;
  return { id: Number(buena.tvdb_id), foto };
}
