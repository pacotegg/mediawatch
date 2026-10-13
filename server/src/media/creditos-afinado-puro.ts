/**
 * Piezas puras del afinado de créditos (sin base de datos ni ffmpeg): se prueban sin tocar nada.
 * Ver creditos-afinado.ts.
 */
export type Tramo = { start_s: number; end_s: number };

/** Instantes (s) de todas las líneas de un subtítulo .srt/.vtt/.ass. */
export function instantesDeSubtitulo(texto: string): number[] {
  const t: number[] = [];
  for (const m of texto.matchAll(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->/g)) t.push(+m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000);
  for (const m of texto.matchAll(/^Dialogue:\s*\d+,(\d+):(\d{2}):(\d{2})\.(\d{2})/gm)) t.push(+m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100);
  return t;
}

/** El último diálogo anterior a `limite`; null si hay pocas líneas (un subtítulo de pistas sueltas no vale). */
export function ultimoDialogoAntes(instantes: number[], limite: number): number | null {
  const antes = instantes.filter((x) => x < limite);
  return antes.length > 20 ? Math.max(...antes) : null;
}

/** Primer `black_start` de la salida de blackdetect (relativo al `-ss`) dentro de [minimo, maximo] en tiempo absoluto. */
export function primerNegro(salida: string, desde: number, minimo: number, maximo: number): number | null {
  const negros = [...salida.matchAll(/black_start:([\d.]+)/g)].map((m) => desde + Number(m[1]));
  const dentro = negros.filter((t) => t >= minimo && t <= maximo);
  return dentro.length ? Math.min(...dentro) : null;
}

/**
 * Un negro solo vale como inicio de créditos si es plausible: quedan como mucho 12 minutos de película (el
 * mismo tope que usa creditos-pelicula.ts) y no se adelanta más de 5 minutos al detector. Sin esto, el 13/10/2026
 * 3 de 321 películas afinadas salieron adelantadas 7–19 minutos (un negro cualquiera de la escena final).
 */
export const MAX_RESTANTE_S = 720;
export const MAX_ADELANTO_S = 300;

export function negroPlausible(negro: number, inicioDetector: number, duracion: number): boolean {
  return negro >= duracion * 0.5 && duracion - negro <= MAX_RESTANTE_S && inicioDetector - negro <= MAX_ADELANTO_S;
}

/** El primer bloque de créditos arranca en `negro`; los demás (escenas extra en medio) no se tocan. */
export function adelantarPrimerRango(rangos: Tramo[], negro: number): Tramo[] {
  if (!rangos.length) return rangos;
  const primero = rangos.reduce((a, b) => (b.start_s < a.start_s ? b : a));
  return rangos.map((r) => (r === primero ? { ...r, start_s: Math.round(negro * 10) / 10 } : r));
}
