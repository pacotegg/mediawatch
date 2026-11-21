/**
 * Qué subtítulos mapear al servir un fichero en crudo cortado con ffmpeg (`-c copy -f matroska`).
 *
 * Los de un MP4 (`mov_text`) ni se copian ni se convierten a Matroska: ffmpeg falla con
 * «Subtitle codec mov_text is not supported… Could not write header» y la tele recibe un
 * CONNECTION_FAILED al saltar o reanudar. La tele pide los suyos aparte por `/subtitle/`,
 * así que en MP4/M4V/MOV se dejan fuera.
 */
export function mapaSubtitulos(container: string): string[] {
  return /mp4|m4v|mov/.test(container) ? [] : ['-map', '0:s?'];
}
