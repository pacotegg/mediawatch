/*
 * Nombres de carpeta y fichero «como los dejaba tinyMediaManager».
 *
 * Reglas leidas de su configuracion real (renamerProfiles de movies.json/tvShows.json) y comprobadas contra la biblioteca (el informe
 * `cli/organizar-informe.ts` mide cuantos nombres actuales reproduce):
 *   pelicula  carpeta  `${title}${ - ,edition,} (${year})`
 *             fichero  `${title}${ - ,edition,} (${year}) ${videoFormat} ${audioCodec}`
 *   serie     carpeta  `${showTitle} (${showYear})`   temporada `Season ${seasonNr}`   episodio `${showTitle} - S${seasonNr2}E${episodeNr2} - ${title}`
 *
 * Caracteres que Windows no admite. tMM tiene DOS comportamientos y se mantienen, porque los nombres de la biblioteca los tienen:
 *   PELICULAS (`unicodeReplacement = true`): cambia por parecidos de Unicode. Medido: `:` -> `∶` (U+2236, 171 casos), `/` -> `⁄` (U+2044, 5),
 *     `?` -> `❓` (U+2753, 2 de 3 casos con `?`; el tercero lo quito). El apostrofo se queda (22 de 29 titulos con apostrofo; los 7 con `ˈ` son la minoria).
 *   SERIES (sin esa opcion): quita `:` y `?` (`JFK: Destiny Betrayed` -> `JFK Destiny Betrayed`, 5 casos) y deja el apostrofo (210 episodios).
 * Sin ver en la biblioteca (suposicion, NO verificado): `|` -> `¦` y `"` `*` `<` `>` `\` en peliculas; en series se quitan.
 *
 * Windows no admite punto ni espacio al FINAL del nombre completo, pero el punto de un titulo si vale en medio («L.A. (1996)»).
 *
 * Puro: sin base de datos ni disco.
 */

export type Perfil = 'pelicula' | 'serie';

const PARECIDOS: Record<string, string> = {
  ':': '∶', '/': '⁄', '\\': '⁄', '?': '❓', '|': '¦', '"': 'ˮ', '*': '∗', '<': '‹', '>': '›',
};

/** Un titulo como puede ir dentro de un nombre de Windows (sin recortar el final: eso lo hace `finalDeNombre`). */
export function limpiarParaDisco(texto: string, perfil: Perfil = 'pelicula'): string {
  const t = perfil === 'pelicula'
    ? texto.replace(/[:/\\?|"*<>]/g, (c) => PARECIDOS[c])
    : texto.replace(/[:?|"*<>]/g, '').replace(/[/\\]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** El nombre completo no puede acabar en punto ni en espacio. */
export const finalDeNombre = (nombre: string) => nombre.replace(/[. ]+$/, '');

/** «1080p» aunque la imagen venga recortada (1920x800): manda el ANCHO. Medido: 800 de alto con 1920 de ancho -> 1080p. */
export function formatoDeVideo(width: number | null | undefined, height: number | null | undefined): string | null {
  const w = width ?? 0;
  const h = height ?? 0;
  if (!w && !h) return null;
  if (w >= 3000) return '2160p';
  if (w >= 2400) return '1440p';
  if (w >= 1800) return '1080p';
  if (w >= 1200) return '720p';
  if (h >= 540) return '576p';
  if (h >= 400) return '480p';
  return '360p';
}

/** El codec de la primera pista de audio como lo escribia tMM: `AC3`, `EAC3`, `EAC3⁄Atmos`, `TrueHD Atmos`... */
export function codecDeAudio(codec: string | null | undefined, titulo?: string | null): string | null {
  const c = (codec ?? '').toLowerCase();
  if (!c) return null;
  const atmos = /atmos/i.test(titulo ?? '');
  const base = ({ ac3: 'AC3', eac3: 'EAC3', aac: 'AAC', mp3: 'MP3', flac: 'FLAC', opus: 'Opus', vorbis: 'Vorbis', truehd: 'TrueHD', mlp: 'TrueHD' } as Record<string, string>)[c]
    ?? (c.startsWith('dts') ? 'DTS' : c.startsWith('pcm') ? 'PCM' : c.toUpperCase());
  if (!atmos) return base;
  return base === 'TrueHD' ? 'TrueHD Atmos' : `${base}⁄Atmos`;
}

export type DatosPelicula = { titulo: string; anio: number | null; edicion?: string | null; formato?: string | null; audio?: string | null };

export function carpetaDePelicula(d: DatosPelicula): string {
  const edicion = d.edicion?.trim() ? ` - ${limpiarParaDisco(d.edicion)}` : '';
  return finalDeNombre(`${limpiarParaDisco(d.titulo)}${edicion}${d.anio ? ` (${d.anio})` : ''}`);
}

/** Nombre del fichero SIN extension. */
export function ficheroDePelicula(d: DatosPelicula): string {
  return finalDeNombre([carpetaDePelicula(d), d.formato, d.audio].filter(Boolean).join(' '));
}

export const carpetaDeSerie = (titulo: string, anio: number | null) => finalDeNombre(`${limpiarParaDisco(titulo, 'serie')}${anio ? ` (${anio})` : ''}`);
export const carpetaDeTemporada = (n: number) => (n === 0 ? 'Specials' : `Season ${n}`);
const dos = (n: number) => String(n).padStart(2, '0');
/** Nombre del episodio SIN extension: `Serie - S01E02 - Titulo` (`Serie - S01E02` si no hay titulo). */
export function ficheroDeEpisodio(serie: string, temporada: number, episodio: number, titulo?: string | null): string {
  const t = titulo?.trim() ? ` - ${limpiarParaDisco(titulo, 'serie')}` : '';
  return finalDeNombre(`${limpiarParaDisco(serie, 'serie')} - S${dos(temporada)}E${dos(episodio)}${t}`);
}
