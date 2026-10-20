/*
 * Lo que se escribe en la caja de busqueda del Scraper: un titulo, un id de TMDb, un id de IMDb o la
 * direccion pegada de una de sus paginas. Puro (sin red) para poder probarlo.
 */
export type Busqueda =
  | { tipo: 'tmdb'; id: number; kind?: 'movie' | 'show' }
  | { tipo: 'imdb'; id: string }
  | { tipo: 'texto'; texto: string };

export function interpretarBusqueda(entrada: string): Busqueda {
  const t = entrada.trim();
  // themoviedb.org/movie/241-natural-born-killers  |  themoviedb.org/tv/1396
  const tmdbUrl = t.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
  if (tmdbUrl) return { tipo: 'tmdb', id: Number(tmdbUrl[2]), kind: tmdbUrl[1].toLowerCase() === 'tv' ? 'show' : 'movie' };
  // imdb.com/title/tt0110632/  |  tt0110632
  const imdb = t.match(/\btt\d{6,10}\b/i);
  if (imdb) return { tipo: 'imdb', id: imdb[0].toLowerCase() };
  // «tmdb:241», «tmdb 241» o solo digitos
  const tmdbId = t.match(/^(?:tmdb[\s:=-]*)?(\d{1,9})$/i);
  if (tmdbId) return { tipo: 'tmdb', id: Number(tmdbId[1]) };
  return { tipo: 'texto', texto: t };
}
