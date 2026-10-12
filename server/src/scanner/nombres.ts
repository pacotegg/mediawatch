/*
 * Nombre de carpeta o de fichero -> titulo y ano presentables.
 *
 * Sin .nfo (MediaWatch Server) el titulo sale del nombre, y de eso depende que
 * TMDb lo encuentre. Funcion pura, sin base de datos ni disco.
 *
 * Reglas, en este orden:
 *   1. Los corchetes `[...]` son etiquetas de release: fuera.
 *   2. Un parentesis con un ano `(1997)` fija el ano; uno con etiquetas tecnicas
 *      sale. Con ano entre parentesis no se busca otro: «Blade Runner 2049 (2017)».
 *   3. `.` y `_` pasan a espacio (no en `5.1`, `H.264` ni en «Mr. Robot»).
 *   4. El titulo acaba en la primera etiqueta tecnica (1080p, BluRay, x264...).
 *      Sin ano entre parentesis, el ano es el ultimo numero 19xx/20xx anterior a
 *      esa etiqueta. La primera palabra nunca se corta: «1917», «2012», «Dual».
 */

const TECNICA =
  /^(2160p|1080[pi]|720p|576p|480p|4k|uhd|hdr10?\+?|bluray|blu-ray|bdrip|brrip|bdremux|remux|dvdrip|dvdscr|webrip|web-dl|webdl|hdtv|hdrip|x26[45]|h\.?26[45]|hevc|xvid|divx|avc|aac\d*|ac3|eac3|dd[p+]?\d.*|dts(-hd)?|truehd|atmos|proper|repack|multi|dual|vose|extended|unrated|remastered)$/i;

const GENERICOS = /^(cd\s?\d|disc\s?\d|dvd|bluray|blu-ray|movies?|pel[ií]culas?|films?|videos?|new folder|nueva carpeta)$/i;

const esTecnica = (t: string) => TECNICA.test(t) || TECNICA.test(t.split('-')[0]);

function anoValido(t: string): number | null {
  if (!/^(19|20)\d{2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1900 && n <= new Date().getFullYear() + 1 ? n : null;
}

export function limpiarNombre(crudo: string): { title: string; year?: number } {
  let s = crudo.trim();
  let anoParentesis: number | undefined;

  s = s.replace(/\[[^\]]*\]/g, ' ');
  s = s.replace(/\(([^)]*)\)/g, (_todo, dentro: string) => {
    const t = dentro.trim();
    const a = anoValido(t);
    if (a !== null) {
      anoParentesis = a;
      return ' \u0001 ';
    }
    const palabras = t.split(/[\s._-]+/).filter(Boolean);
    return palabras.some(esTecnica) ? ' ' : ` (${t}) `;
  });
  // Se protegen `5.1`, `7.1`, `2.0` y `H.264`/`x.265`; el resto de puntos pegados a
  // una palabra son separadores. «Mr. Robot» (punto + espacio) se queda igual.
  s = s
    .replace(/_/g, ' ')
    .replace(/(?<![\d.])\d{1,2}\.\d{1,2}(?![\d.])|\b[hx]\.26[45]\b/gi, (m) => m.replace('.', '\u0002'))
    .replace(/\.(?=\S)/g, ' ')
    .replace(/\u0002/g, '.');

  const tokens = s.split(/\s+/).filter(Boolean);
  const marca = tokens.indexOf('\u0001');
  let corte = tokens.length;
  let year = anoParentesis;

  if (marca > 0) {
    corte = marca;
  } else {
    const t = tokens.findIndex((tok, i) => i > 0 && esTecnica(tok.replace(/^[(\-]+|[)\-,]+$/g, '')));
    const limite = t === -1 ? tokens.length : t;
    let a = -1;
    for (let i = 1; i < limite; i++) if (anoValido(tokens[i]) !== null) a = i;
    if (a > 0) {
      year = anoValido(tokens[a])!;
      corte = a;
    } else {
      corte = limite;
    }
  }

  const title = tokens
    .slice(0, corte)
    .filter((tok) => tok !== '\u0001')
    .join(' ')
    .replace(/[\s\-–:,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return title ? { title, year } : { title: crudo.trim(), year };
}

/** ¿Un nombre de carpeta que no dice nada (CD1, Movies...)? Entonces vale el del fichero. */
export const esNombreGenerico = (nombre: string) => GENERICOS.test(nombre.trim()) || /^\d{1,2}$/.test(nombre.trim());

/**
 * El titulo del episodio cuando el nombre trae `SxxExx` o `1x05` en cualquier
 * sitio: lo que va despues, sin etiquetas tecnicas. `null` si no queda nada
 * (`Breaking.Bad.S01E01.720p`, `S02E03`): entonces vale «Episodio N».
 */
export function tituloDespuesDeNumeracion(base: string): string | null {
  const m = base.match(/s\d{1,3}[\s._-]*e\d{1,3}|\b\d{1,2}x\d{1,3}\b/i);
  if (!m || m.index === undefined) return null;
  const resto = base.slice(m.index + m[0].length).replace(/\[[^\]]*\]/g, ' ').replace(/[._]/g, ' ');
  const tokens = resto.split(/\s+/).filter(Boolean);
  const corte = tokens.findIndex((t) => esTecnica(t));
  const util = (corte === -1 ? tokens : tokens.slice(0, corte)).join(' ').replace(/^[\s\-–:]+|[\s\-–:]+$/g, '').trim();
  return util || null;
}
