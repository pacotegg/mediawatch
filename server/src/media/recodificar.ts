/**
 * Piezas comunes de los lotes que recodifican ficheros de la biblioteca a HEVC (`cli/recodificar-*.ts`).
 *
 * El 18/10/2026 esos lotes se lanzaron sin `-map 0`: ffmpeg se queda entonces con UN audio y UN subtítulo, y la
 * verificación solo miraba duración, códec y tamaño. 101 ficheros perdieron el castellano o la VO, con el original
 * ya borrado. Por eso aquí: todas las pistas, comprobación pista a pista antes de sustituir, y el original se
 * aparta a una carpeta de la misma unidad en vez de borrarse (borrar es solo a mano).
 */
import { mkdirSync, renameSync } from 'node:fs';
import { dirname, join, parse, relative } from 'node:path';
import type { MediaInfo } from './probe.ts';

/**
 * Argumentos de ffmpeg para pasar el vídeo a HEVC por QSV conservando TODO lo demás.
 * `0:V` (mayúscula) es el vídeo sin las carátulas incrustadas de los MP4, que como «vídeo» romperían el encoder.
 * `mov_text` (subtítulos de MP4) no cabe en MKV: se pasa a SRT, que es texto igual.
 */
export function argumentosHevc(entrada: string, salida: string, original: Pick<MediaInfo, 'subs'>): string[] {
  const movText = original.subs.some((s) => s.codec === 'mov_text');
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-i', entrada,
    '-map', '0:V', '-map', '0:a?', '-map', '0:s?', '-map', '0:t?',
    '-c', 'copy',
    '-c:v', 'hevc_qsv', '-global_quality', '24', '-preset', 'medium',
    ...(movText ? ['-c:s', 'srt'] : []),
    salida,
  ];
}

/** Qué falta en el fichero nuevo respecto al original; null si están todas las pistas. */
export function pistasQueFaltan(original: Pick<MediaInfo, 'audio' | 'subs'>, nuevo: Pick<MediaInfo, 'audio' | 'subs'>): string | null {
  const faltan: string[] = [];
  if (nuevo.audio.length < original.audio.length) faltan.push(`audio ${original.audio.length} -> ${nuevo.audio.length}`);
  if (nuevo.subs.length < original.subs.length) faltan.push(`subtítulos ${original.subs.length} -> ${nuevo.subs.length}`);
  return faltan.length ? faltan.join(', ') : null;
}

/**
 * Aparta el original a `<unidad>\_retirados\<AAAA-MM-DD>\<ruta relativa>`. Es un renombrado en la misma unidad
 * (instantáneo, sin copiar) y se deshace moviéndolo de vuelta. Devuelve dónde ha quedado.
 */
export function retirarOriginal(ruta: string, hoy = new Date(), raiz = parse(ruta).root): string {
  const destino = join(raiz, '_retirados', hoy.toISOString().slice(0, 10), relative(raiz, ruta));
  mkdirSync(dirname(destino), { recursive: true });
  renameSync(ruta, destino);
  return destino;
}
