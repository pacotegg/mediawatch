import type { Capitulo } from './probe.ts';
import type { SkipRange } from './intros.ts';

const NOMBRE_CREDITOS = /(end\s*(credits?|titles?)|closing\s*credits?|cr[eé]ditos?\s*(finales?|final)?|final\s*credits?|rodillo)/i;
const NOMBRE_GENERICO = /^(chapter|cap[ií]tulo|scene|escena|part|parte)?\s*[-–]?\s*\d+/i;

/** Créditos plausibles en un episodio de serie: entre 25 s y 5 min hasta el final. */
const MIN_RESTANTE_EPISODIO_S = 25;
const MAX_RESTANTE_EPISODIO_S = 300;

/**
 * Créditos de un episodio a partir de los capítulos del contenedor (MKV/MP4).
 * Si un capítulo está nombrado como créditos, tiene alta confianza (95).
 * Si todos son genéricos y el último está cerca del final, sirve de pista (70).
 */
export function creditosDeEpisodio(capitulos: Capitulo[], duracion: number): SkipRange[] {
  if (capitulos.length < 2 || !(duracion > 0)) return [];

  // 1. Capítulo explícitamente nombrado como créditos en la segunda mitad
  const nombrado = capitulos.find((c) => NOMBRE_CREDITOS.test(c.title) && c.start > duracion * 0.5);
  if (nombrado) {
    const fin = nombrado.end > nombrado.start ? Math.min(nombrado.end, duracion) : duracion;
    return [{ kind: 'credits', start_s: nombrado.start, end_s: fin, confidence: 95 }];
  }

  // 2. Último capítulo genérico
  const todosGenericos = capitulos.every((c) => NOMBRE_GENERICO.test(c.title.trim()));
  if (!todosGenericos) return [];
  const ultimo = capitulos[capitulos.length - 1];
  const restante = duracion - ultimo.start;
  if (restante < MIN_RESTANTE_EPISODIO_S || restante > MAX_RESTANTE_EPISODIO_S) return [];
  return [{ kind: 'credits', start_s: ultimo.start, end_s: duracion, confidence: 70 }];
}
