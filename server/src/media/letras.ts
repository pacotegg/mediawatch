/**
 * Abecedario de una biblioteca: en que posicion de la lista ordenada por titulo
 * empieza cada letra, para saltar a ella desde la tele.
 *
 * El orden lo pone SQLite con `COLLATE NOCASE`, que solo pliega las mayusculas
 * ASCII y compara bytes. Eso deja fuera de sitio a todo titulo que empiece por
 * algo que no sea A-Z: «¡Rompe Ralph!» (`¡` es U+00A1, mayor que `z`) y «Ícaro»
 * caen AL FINAL de la lista, despues de la Z. Si el offset de cada letra fuera
 * la primera aparicion, «R» apuntaria al final; por eso se recorren las letras
 * en orden y cada una se busca a partir de donde empezo la anterior. Los que
 * estan descolocados se quedan donde el orden los pone, y se llega a ellos
 * bajando, como hasta ahora.
 */

export type Letra = { letra: string; offset: number };

const ORDEN = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/** «Ñu» -> N, «(500) dias» -> #, «¡Rompe!» -> R: la primera letra o cifra que hay. */
export function inicialDe(titulo: string): string {
  const limpio = titulo.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = /[A-Za-z0-9]/.exec(limpio);
  if (!m) return '#';
  const c = m[0].toUpperCase();
  return c >= '0' && c <= '9' ? '#' : c;
}

/** `titulos` ha de venir en el mismo orden en que se sirve la biblioteca. */
export function letrasDe(titulos: string[]): Letra[] {
  const iniciales = titulos.map(inicialDe);
  const salida: Letra[] = [];
  let desde = 0;
  for (const letra of ORDEN) {
    const i = iniciales.indexOf(letra, desde);
    if (i < 0) continue;
    salida.push({ letra, offset: i });
    desde = i;
  }
  return salida;
}
