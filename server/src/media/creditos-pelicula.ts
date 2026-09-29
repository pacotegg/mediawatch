import type { Capitulo } from './probe.ts';

/**
 * Créditos de una película a partir de los capítulos del propio fichero.
 *
 * Medido sobre las 1.746 películas de la biblioteca (29/09/2026): 843 traen
 * capítulos, pero solo 124 (7 %) llevan uno con nombre tipo «End Credits». En
 * esas 124, el capítulo de créditos es exactamente el último en 116 (93,5 %), y
 * en las que solo traen «Capítulo 12», «Chapter 30» o una hora suelta, lo que
 * queda tras el último capítulo se reparte igual (mediana 6,6 min contra 5,6).
 * Por eso el último capítulo vale de pista cuando no hay otra cosa, con menos
 * confianza y sin ver todavía cuántos falsos positivos deja: no hay verdad
 * terreno para esas 611.
 */

const NOMBRE_CREDITOS = /(end\s*(credits?|titles?)|closing\s*credits?|cr[eé]ditos?\s*(finales?|final)?|final\s*credits?|rodillo)/i;
/** «Capítulo 3», «Chapter 30», «Scene 4» o una marca de tiempo suelta. */
const NOMBRE_GENERICO = /^(chapter|cap[ií]tulo|scene|escena|part|parte)?\s*[-–]?\s*\d+/i;

/** Créditos plausibles: entre 2 y 12 minutos hasta el final. */
const MIN_RESTANTE_S = 120;
const MAX_RESTANTE_S = 720;

export type RangoCreditos = {
  kind: 'credits';
  start_s: number;
  end_s: number;
  confidence: number;
  source: 'capitulo' | 'ultimo-capitulo' | 'texto-sube';
};

export function creditosDePelicula(capitulos: Capitulo[], duracion: number): RangoCreditos[] {
  if (capitulos.length < 2 || !(duracion > 0)) return [];

  // Un capítulo nombrado como créditos manda. Termina donde acaba ese capítulo:
  // si detrás hay escena final, el cliente lo sabe porque queda metraje.
  const nombrado = capitulos.find((c) => NOMBRE_CREDITOS.test(c.title) && c.start > duracion * 0.5);
  if (nombrado) {
    const fin = nombrado.end > nombrado.start ? Math.min(nombrado.end, duracion) : duracion;
    return [{ kind: 'credits', start_s: nombrado.start, end_s: fin, confidence: 95, source: 'capitulo' }];
  }

  // Sin nombre: el último capítulo, pero solo si todos son genéricos (con
  // nombres de escena de verdad, el último suele ser una escena) y si deja un
  // rodillo de duración verosímil.
  const todosGenericos = capitulos.every((c) => NOMBRE_GENERICO.test(c.title.trim()));
  if (!todosGenericos) return [];
  const ultimo = capitulos[capitulos.length - 1];
  const restante = duracion - ultimo.start;
  if (restante < MIN_RESTANTE_S || restante > MAX_RESTANTE_S) return [];
  return [{ kind: 'credits', start_s: ultimo.start, end_s: duracion, confidence: 70, source: 'ultimo-capitulo' }];
}
