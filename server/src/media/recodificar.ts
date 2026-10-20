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
 * Motivo para NO sustituir el original por la salida, o null si se puede: duración del contenedor y de la pista de
 * vídeo (vOrig/vNuevo; NaN si no se pudo leer), HEVC, misma resolución, paridad pista a pista y ahorro >= 15 %.
 */
export function verificarRecodificado(orig: Pick<MediaInfo, 'duration' | 'video' | 'audio' | 'subs'>, nuevo: Pick<MediaInfo, 'duration' | 'video' | 'audio' | 'subs'>,
  tamOrig: number, tamNuevo: number, vOrig: number, vNuevo: number): string | null {
  const dif = Math.abs(orig.duration - nuevo.duration);
  if (dif > Math.max(3, orig.duration * 0.01)) return `duración ${orig.duration.toFixed(1)} -> ${nuevo.duration.toFixed(1)} s`;
  // La del contenedor la marca la pista más larga (el audio): Casino Royale tiene el vídeo 7 min más corto y no se nota.
  // Si la del original no se puede leer, se compara contra la del contenedor; la de la salida tiene que leerse sí o sí.
  const vRef = Number.isFinite(vOrig) ? vOrig : orig.duration;
  if (!Number.isFinite(vNuevo) || Math.abs(vRef - vNuevo) > Math.max(3, vRef * 0.01)) {
    return `duración del vídeo ${vRef.toFixed(1)} -> ${Number.isFinite(vNuevo) ? vNuevo.toFixed(1) : '?'} s`;
  }
  if (!nuevo.video || nuevo.video.codec !== 'hevc') return 'la salida no es HEVC';
  if (orig.video && (orig.video.width !== nuevo.video.width || orig.video.height !== nuevo.video.height)) {
    return `resolución ${orig.video.width}x${orig.video.height} -> ${nuevo.video.width}x${nuevo.video.height}`;
  }
  // Paridad pista por pista, no por idioma: encode.ps1 descarta a propósito pistas «redundantes» del mismo idioma
  // (dedup), y eso también es perder una pista. Cada audio del original necesita uno propio en la salida, del mismo
  // idioma y con al menos sus canales (de más a menos canales, cada uno se queda el más justo que le sirva).
  const norm = (l?: string) => (l || 'und').toLowerCase();
  const libres = [...nuevo.audio];
  for (const p of [...orig.audio].sort((x, y) => (y.channels ?? 0) - (x.channels ?? 0))) {
    const vale = libres.filter((q) => norm(q.language) === norm(p.language) && (q.channels ?? 0) >= (p.channels ?? 0))
      .sort((x, y) => (x.channels ?? 0) - (y.channels ?? 0))[0];
    if (!vale) return `pista de audio perdida: ${norm(p.language)} ${p.channels ?? '?'} canales (${orig.audio.length} -> ${nuevo.audio.length} pistas)`;
    libres.splice(libres.indexOf(vale), 1);
  }
  const subsLibres = [...nuevo.subs];
  for (const s of orig.subs) {
    const i = subsLibres.findIndex((q) => norm(q.language) === norm(s.language) && q.forced === s.forced);
    if (i < 0) return `subtítulo perdido: ${norm(s.language)}${s.forced ? ' forzado' : ''} (${orig.subs.length} -> ${nuevo.subs.length})`;
    subsLibres.splice(i, 1);
  }
  // El orden también cuenta: el audio y el subtítulo elegidos en cada perfil se guardan por índice de pista (`embedded-3`),
  // y si la salida las reordena (visto el 20/10/2026: spa,eng,cat -> eng,spa,cat) el perfil abriría otro idioma.
  const enOrden = (o: { language?: string }[], n: { language?: string }[]) => {
    let i = 0;
    for (const x of o) {
      while (i < n.length && norm(n[i].language) !== norm(x.language)) i++;
      if (i >= n.length) return false;
      i++;
    }
    return true;
  };
  const idiomasDe = (l: { language?: string }[]) => l.map((x) => norm(x.language)).join(',');
  if (!enOrden(orig.audio, nuevo.audio)) return `audio en otro orden: ${idiomasDe(orig.audio)} -> ${idiomasDe(nuevo.audio)}`;
  if (!enOrden(orig.subs, nuevo.subs)) return `subtítulos en otro orden: ${idiomasDe(orig.subs)} -> ${idiomasDe(nuevo.subs)}`;
  if (tamNuevo > tamOrig * 0.85) return `ahorra menos del 15 % (${(tamOrig / 1e6).toFixed(0)} -> ${(tamNuevo / 1e6).toFixed(0)} MB)`;
  return null;
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
