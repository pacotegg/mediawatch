import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { promisify } from 'node:util';
import { config } from '../config.ts';
import { db } from '../db.ts';

const run = promisify(execFile);

export type ProbeStream = {
  index: number;
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  tags?: Record<string, string>;
  disposition?: Record<string, number>;
  color_transfer?: string;
  color_primaries?: string;
  profile?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
};

export type Capitulo = { start: number; end: number; title: string };

export type MediaInfo = {
  duration: number;
  container: string;
  /** Marcas del contenedor; la mayoria de MKV de la biblioteca las traen. */
  chapters: Capitulo[];
  video: { codec: string; width: number; height: number; hdr?: string; profile?: string; fps: number } | null;
  audio: { index: number; streamIndex: number; codec: string; language?: string; channels?: number; title?: string; default: boolean; profile?: string; atmos: boolean }[];
  subs: { index: number; streamIndex: number; codec: string; language?: string; title?: string; forced: boolean; textual: boolean }[];
};

/**
 * Los fotogramas por segundo vienen como fracción («24000/1001»), no como
 * decimal. Hacen falta exactos para trocear en HLS: un trozo tiene que durar un
 * número entero de fotogramas o los cortes se van desplazando poco a poco.
 */
function fotogramasPorSegundo(s: ProbeStream): number {
  for (const campo of [s.avg_frame_rate, s.r_frame_rate]) {
    if (!campo) continue;
    const [num, den] = campo.split('/').map(Number);
    if (num > 0 && den > 0) return num / den;
  }
  return 24;
}

const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);

function hdrOf(s: ProbeStream): string | undefined {
  const t = s.color_transfer;
  if (t === 'smpte2084') return s.profile?.includes('Dolby') ? 'DV' : 'HDR10';
  if (t === 'arib-std-b67') return 'HLG';
  return undefined;
}

/**
 * Duración en la que se puede confiar.
 *
 * La del contenedor miente más de lo que parece: en esta biblioteca 105
 * ficheros la traían a cero o desbordada (4.294.967 s, que es 2^32/1000), y
 * como el código antiguo hacía `info.duration || anterior`, un cero se
 * conservaba para siempre. Sin duración no hay barra de progreso, ni reanudar,
 * ni «Seguir viendo», ni lista de HLS.
 *
 * Se prueban por orden el contenedor y las pistas, y solo se acepta un valor
 * que pueda ser el de una película.
 */
/** `02:05:02.453000000` -> 7502.45. Es como Matroska guarda la duración real. */
function deEtiqueta(texto: string | undefined): number {
  if (!texto) return NaN;
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(texto.trim());
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/*
 * Valores que delatan un desbordamiento y no una película larga: 2^32/1000 y el
 * entorno de 2^16. Se descartan por lo que son, no por ser grandes, porque hay
 * grabaciones que duran de verdad más de seis horas —el concierto de despedida
 * de Ozzy son 9 h 31 min, medidas— y el tope viejo las tiraba a la basura.
 */
function esDesbordamiento(d: number): boolean {
  return Math.abs(d - 4294967.296) < 1 || (d > 65500 && d < 65560);
}

function duracionFiable(formato: string | undefined, streams: ProbeStream[]): number {
  const candidatos = [
    Number(formato),
    ...streams.map((s) => Number(s.duration)),
    // Matroska deja la duración de cada pista en una etiqueta de texto; cuando
    // la cabecera del contenedor miente, esta suele estar bien.
    ...streams.map((s) => deEtiqueta(s.tags?.DURATION ?? (s.tags as Record<string, string> | undefined)?.duration)),
  ];
  for (const d of candidatos) {
    if (Number.isFinite(d) && d > 0 && d < 86400 && !esDesbordamiento(d)) return d;
  }
  return 0;
}

export async function probeFile(path: string): Promise<MediaInfo> {
  const { stdout } = await run(
    config.ffprobe,
    // `-show_chapters` sale gratis en la misma llamada: no hay que abrir el
    // fichero dos veces para saber si trae capitulos.
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', '-show_chapters', path],
    { maxBuffer: 12 * 1024 * 1024, windowsHide: true },
  );
  const json = JSON.parse(stdout) as {
    streams: ProbeStream[];
    format: { duration?: string; format_name?: string };
    chapters?: { start_time?: string; end_time?: string; tags?: { title?: string } }[];
  };
  const streams = json.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);

  const audio = streams
    .filter((s) => s.codec_type === 'audio')
    .map((s, i) => {
      // ffprobe no distingue Atmos en `codec_name`: un DD+ con JOC sigue siendo
      // «eac3». Lo dice en `profile` («Dolby Digital Plus + Dolby Atmos»), y
      // eso es lo que decide si la barra lo recibe como Atmos.
      const atmos = /atmos/i.test(s.profile ?? '');
      return {
        index: i,
        streamIndex: s.index,
        codec: s.codec_name ?? 'unknown',
        language: s.tags?.language,
        channels: s.channels,
        title: s.tags?.title,
        default: Boolean(s.disposition?.default),
        profile: s.profile,
        atmos,
      };
    });

  const subs = streams
    .filter((s) => s.codec_type === 'subtitle')
    .map((s, i) => ({
      index: i,
      streamIndex: s.index,
      codec: s.codec_name ?? 'unknown',
      language: s.tags?.language,
      title: s.tags?.title,
      forced: Boolean(s.disposition?.forced),
      textual: TEXT_SUB_CODECS.has(s.codec_name ?? ''),
    }));

  // Un capitulo sin titulo se numera: «Capitulo 3» es mas util que una linea en
  // blanco, y hay MKV que solo traen los tiempos.
  const chapters: Capitulo[] = (json.chapters ?? [])
    .map((c, i) => ({
      start: Number(c.start_time ?? 0),
      end: Number(c.end_time ?? 0),
      title: c.tags?.title?.trim() || `Capítulo ${i + 1}`,
    }))
    .filter((c) => Number.isFinite(c.start) && c.start >= 0);

  return {
    duration: duracionFiable(json.format?.duration, streams),
    container: json.format?.format_name ?? '',
    chapters,
    video: v
      ? {
          codec: v.codec_name ?? 'unknown',
          width: v.width ?? 0,
          height: v.height ?? 0,
          hdr: hdrOf(v),
          profile: v.profile,
          fps: fotogramasPorSegundo(v),
        }
      : null,
    audio,
    subs,
  };
}

/** La marca es tamaño y fecha: si cambia, lo guardado ya no vale. */
const cache = new Map<number, { info: MediaInfo; marca: string }>();

/** Probes on first use and persists real ffmpeg stream indices, which NFO data does not carry. */
export async function mediaInfo(fileId: number): Promise<MediaInfo & { path: string }> {
  const file = db.prepare('SELECT id, path, probed, duration FROM media_files WHERE id = ?').get(fileId) as
    | { id: number; path: string; probed: number; duration: number | null }
    | undefined;
  if (!file) throw new Error(`Fichero ${fileId} no encontrado`);

  /*
   * La cache tiene que caducar cuando el fichero cambia. El pipeline de
   * codificacion reescribe peliculas en su sitio, con la misma ruta: sin esta
   * comprobacion el servidor seguiria creyendo que es HEVC 4K despues de
   * haberlo recodificado, y decidiria mal como reproducirlo.
   */
  const cached = cache.get(fileId);
  if (cached) {
    let sigueIgual = true;
    try {
      const st = statSync(file.path);
      sigueIgual = cached.marca === st.size + ':' + Math.round(st.mtimeMs);
    } catch {
      sigueIgual = false;
    }
    if (sigueIgual) return { ...cached.info, path: file.path };
    cache.delete(fileId);
  }

  const info = await probeFile(file.path);
  try {
    const st = statSync(file.path);
    cache.set(fileId, { info, marca: st.size + ':' + Math.round(st.mtimeMs) });
  } catch {
    cache.set(fileId, { info, marca: '' });
  }

  db.prepare(`UPDATE media_files SET probed = 1, duration = ?, video_codec = ?, width = ?, height = ?, hdr = COALESCE(?, hdr) WHERE id = ?`)
    .run(info.duration || file.duration || null, info.video?.codec ?? null, info.video?.width ?? null, info.video?.height ?? null, info.video?.hdr ?? null, fileId);

  db.prepare('DELETE FROM audio_tracks WHERE file_id = ?').run(fileId);
  const insA = db.prepare('INSERT INTO audio_tracks (file_id, idx, codec, language, channels, title) VALUES (?,?,?,?,?,?)');
  for (const a of info.audio) {
    const nombre = a.atmos ? (a.codec === 'truehd' ? 'truehd_atmos' : a.codec === 'eac3' ? 'eac3_ddp_atmos' : a.codec) : a.codec;
    insA.run(fileId, a.streamIndex, nombre, a.language ?? null, a.channels ?? null, a.title ?? null);
  }

  db.prepare('DELETE FROM sub_tracks WHERE file_id = ? AND external IS NULL').run(fileId);
  const insS = db.prepare('INSERT INTO sub_tracks (file_id, idx, codec, language, title, forced, external) VALUES (?,?,?,?,?,?,NULL)');
  for (const s of info.subs) insS.run(fileId, s.streamIndex, s.codec, s.language ?? null, s.title ?? null, s.forced ? 1 : 0);

  return { ...info, path: file.path };
}
