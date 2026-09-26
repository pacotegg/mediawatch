/**
 * HLS con bitrate adaptativo.
 *
 * La reproducción normal es una tubería de MP4 fragmentado: una sola conexión,
 * una sola calidad. En la red de casa va perfecta, pero fuera —por Tailscale, o
 * con datos del móvil— basta con que la línea baje un momento para que se corte
 * y haya que volver a empezar.
 *
 * Con HLS el vídeo se parte en trozos de 4 segundos y se ofrecen tres calidades.
 * Eso arregla dos cosas a la vez:
 *  - si la red baja, el reproductor se pasa solo a una calidad menor;
 *  - si un trozo falla, se reintenta ese trozo, no la película entera.
 *
 * Dos decisiones que hacen que esto funcione de verdad:
 *
 * 1. **La lista de reproducción se calcula entera de antemano.** Se sabe la
 *    duración, así que se pueden enumerar todos los trozos desde el principio y
 *    el reproductor puede saltar a donde quiera al instante. Los trozos se
 *    fabrican cuando alguien los pide, no antes.
 * 2. **Los cortes caen en un número entero de fotogramas**, igual en las tres
 *    calidades. Sin eso, al cambiar de calidad los trozos no encajan y se oye
 *    el salto; ver `troceado()` para por qué no vale pedirlos por tiempo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import type { MediaInfo } from './probe.ts';
import type { AudioOptions } from './transcode.ts';

/** Duración objetivo de cada trozo. Cuatro segundos es el punto medio habitual:
 *  más corto reacciona antes a la caída de red pero multiplica las peticiones. */
const SEG_OBJETIVO = 4;

/**
 * Duración real de un trozo, redondeada a un número entero de fotogramas.
 *
 * Esto no es una manía: h264_qsv **ignora `-force_key_frames`** (medido: pedía
 * cortes cada 4 s y salían trozos de 10,677 s, que son los 256 fotogramas de su
 * GOP por defecto). La única forma de mandar es fijar el GOP en fotogramas con
 * `-g` y `-forced_idr`, y entonces el trozo dura GOP/fps exactos. A 24000/1001
 * son 96 fotogramas = 4,004 s, no 4,000: si la lista dijera 4,000 el desfase
 * acumulado a lo largo de una película de dos horas rompería los saltos.
 */
export function troceado(info: MediaInfo) {
  const fps = info.video?.fps && info.video.fps > 0 ? info.video.fps : 24;
  const gop = Math.max(1, Math.round(fps * SEG_OBJETIVO));
  return { fps, gop, duracion: gop / fps };
}

const RAIZ = join(config.transcodeDir, 'hls');
mkdirSync(RAIZ, { recursive: true });

export type Calidad = { nombre: string; alto: number; bitrate: number; nombreLegible: string };

/*
 * Escalera de calidades. Los bitrates son de vídeo; el audio va aparte y es el
 * mismo en las tres, para que al cambiar de calidad no se corte el sonido.
 */
export const CALIDADES: Calidad[] = [
  { nombre: 'alta', alto: 1080, bitrate: 6_000_000, nombreLegible: '1080p' },
  { nombre: 'media', alto: 720, bitrate: 3_000_000, nombreLegible: '720p' },
  { nombre: 'baja', alto: 480, bitrate: 1_200_000, nombreLegible: '480p' },
];

const AUDIO_BITRATE = 128_000;

/** No se ofrece más alto que el original: subir de escala no añade detalle. */
export function escalera(info: MediaInfo): Calidad[] {
  const alto = info.video?.height ?? 1080;
  // Con margen: un 1036p (2,40:1 en 1920) es un 1080p a todos los efectos.
  const utiles = CALIDADES.filter((c) => c.alto <= alto * 1.08);
  return utiles.length > 0 ? utiles : [CALIDADES[CALIDADES.length - 1]];
}

export function numeroDeSegmentos(duracion: number, paso: number) {
  return Math.max(1, Math.ceil(duracion / paso));
}

/**
 * Sonido envolvente para el Chromecast (`surround=1`).
 *
 * El HLS normal lleva AAC estéreo porque va a un navegador. Un Chromecast
 * conectado a una tele o una barra que descodifique Dolby pasa AC3 y DD+ tal
 * cual por HDMI, así que si la pista original ya es AC3 o DD+ **se copia**
 * —y un DD+ con Atmos llega con su Atmos— y si es otra cosa (DTS, TrueHD) se
 * convierte a DD+ 5.1. Solo entra cuando el cliente lo pide, porque en un
 * aparato que no lo descodifica el resultado es silencio.
 */
export function audioEnvolvente(info: MediaInfo, audioStreamIndex: number, surround: boolean): { codec: string; canales: number; copiar: boolean } | null {
  if (!surround) return null;
  const pista = info.audio.find((a) => a.streamIndex === audioStreamIndex) ?? info.audio[0];
  if (!pista || (pista.channels ?? 2) <= 2) return null;
  if (pista.codec === 'ac3' || pista.codec === 'eac3') return { codec: pista.codec, canales: pista.channels ?? 6, copiar: true };
  return { codec: 'eac3', canales: 6, copiar: false };
}

const SURROUND_BITRATE = 640_000;

export function listaMaestra(fileId: number, info: MediaInfo, consulta: string, envolvente: { codec: string } | null = null) {
  const lineas = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXT-X-INDEPENDENT-SEGMENTS'];
  const codecAudio = envolvente ? (envolvente.codec === 'ac3' ? 'ac-3' : 'ec-3') : 'mp4a.40.2';
  const tasaAudio = envolvente ? SURROUND_BITRATE : AUDIO_BITRATE;
  for (const c of escalera(info)) {
    const ancho = info.video ? Math.round((info.video.width * c.alto) / info.video.height / 2) * 2 : 0;
    lineas.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${c.bitrate + tasaAudio},RESOLUTION=${ancho}x${c.alto},CODECS="avc1.640029,${codecAudio}",NAME="${c.nombreLegible}"`,
      `/api/play/${fileId}/hls/${c.nombre}.m3u8${consulta}`,
    );
  }
  return lineas.join('\n') + '\n';
}

export function listaDeCalidad(fileId: number, calidad: string, info: MediaInfo, consulta: string) {
  const { duracion: paso } = troceado(info);
  const duracion = info.duration;
  const total = numeroDeSegmentos(duracion, paso);
  const lineas = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    `#EXT-X-TARGETDURATION:${Math.ceil(paso)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  for (let i = 0; i < total; i++) {
    const dura = i === total - 1 ? duracion - i * paso : paso;
    lineas.push(`#EXTINF:${Math.max(0.001, dura).toFixed(6)},`, `/api/play/${fileId}/hls/${calidad}/${i}.ts${consulta}`);
  }
  lineas.push('#EXT-X-ENDLIST');
  return lineas.join('\n') + '\n';
}

// --- Sesiones ---------------------------------------------------------------

type Sesion = {
  clave: string;
  dir: string;
  proc: ChildProcess;
  desde: number;
  ultimoUso: number;
  muerta: boolean;
  dispositivo?: string;
};

const sesiones = new Map<string, Sesion>();

/** Cuántos trozos por delante puede ir ffmpeg antes de que valga la pena esperarle
 *  en vez de reiniciarlo en otro punto. */
const ALCANCE = 12;
const CADUCIDAD_MS = 90_000;

const rutaSegmento = (dir: string, n: number) => join(dir, `${n}.ts`);

function matar(s: Sesion) {
  s.muerta = true;
  try {
    s.proc.kill('SIGKILL');
  } catch {
    /* ya estaba muerto */
  }
  sesiones.delete(s.clave);
  try {
    rmSync(s.dir, { recursive: true, force: true });
  } catch {
    /* lo borrará la próxima limpieza */
  }
}

setInterval(() => {
  const ahora = Date.now();
  for (const s of sesiones.values()) if (ahora - s.ultimoUso > CADUCIDAD_MS) matar(s);
}, 30_000).unref();

export type PeticionSegmento = {
  fileId: number;
  path: string;
  info: MediaInfo;
  calidad: Calidad;
  segmento: number;
  audioStreamIndex: number;
  audioOptions: AudioOptions;
  audioDelayMs?: number;
  /** AC3/DD+ 5.1 en vez de AAC estéreo: para un Chromecast con Dolby detrás. */
  surround?: boolean;
  /** Token de sesión del aparato que pide el trozo, para poder cortarlo desde Actividad. */
  dispositivo?: string;
};

function clave(p: PeticionSegmento) {
  const a = p.audioOptions;
  return [p.fileId, p.calidad.nombre, p.audioStreamIndex, a.mode, a.downmixStereo, a.normalize, p.audioDelayMs ?? 0, p.surround ? 's' : ''].join('|');
}

function argumentos(p: PeticionSegmento, desde: number, dir: string): string[] {
  const qsv = config.hwaccel === 'qsv';
  const { gop, duracion: paso } = troceado(p.info);
  const alto = Math.min(p.calidad.alto, p.info.video?.height ?? p.calidad.alto);
  const ancho = p.info.video ? Math.round((p.info.video.width * alto) / p.info.video.height / 2) * 2 : 0;
  const bitrate = String(Math.round(p.calidad.bitrate / 1000)) + 'k';

  const video = qsv
    ? [
        // El tonemapping va aquí porque h264_qsv solo acepta 8 bits: un HEVC de
        // 10 bits o cualquier HDR hay que bajarlo en la GPU o el codificador
        // ni siquiera abre.
        '-vf', `vpp_qsv=w=${ancho}:h=${alto}${p.info.video?.hdr && config.tonemap ? ':tonemap=1' : ''}:format=nv12`,
        '-c:v', 'h264_qsv',
        '-preset', 'veryfast',
        '-b:v', bitrate,
        '-maxrate', bitrate,
        '-bufsize', String(Math.round(p.calidad.bitrate / 500)) + 'k',
        '-look_ahead', '0',
        '-profile:v', 'high',
        // QSV no atiende a `-force_key_frames`; el GOP en fotogramas sí.
        '-g', String(gop),
        '-forced_idr', '1',
      ]
    : [
        '-vf', `scale=-2:${alto}`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-b:v', bitrate,
        '-maxrate', bitrate,
        '-bufsize', String(Math.round(p.calidad.bitrate / 500)) + 'k',
        '-g', String(gop),
        '-keyint_min', String(gop),
        '-sc_threshold', '0',
      ];

  const filtrosAudio: string[] = [];
  const retardo = p.audioDelayMs ?? 0;
  if (retardo > 0) filtrosAudio.push(`adelay=${Math.round(retardo)}:all=1`);
  else if (retardo < 0) filtrosAudio.push(`atrim=start=${(-retardo / 1000).toFixed(3)}`, 'asetpts=PTS-STARTPTS');
  if (p.audioOptions.mode === 'night') {
    filtrosAudio.push('acompressor=threshold=-20dB:ratio=4:attack=20:release=250:makeup=2');
  }
  if (p.audioOptions.normalize) filtrosAudio.push('loudnorm=I=-18:TP=-1.5:LRA=11');
  filtrosAudio.push(`alimiter=limit=${p.audioOptions.mode === 'night' ? '0.89' : '0.95'}:level=false`);

  // Envolvente: copiar si ya es Dolby y no hay que filtrar nada; si no, DD+ 5.1.
  // Con filtros (noche, normalizar, retardo) no se puede copiar.
  const envolvente = audioEnvolvente(p.info, p.audioStreamIndex, Boolean(p.surround));
  const hayFiltros = retardo !== 0 || p.audioOptions.mode !== 'normal' || p.audioOptions.normalize;
  const audio = envolvente
    ? envolvente.copiar && !hayFiltros
      ? ['-c:a', 'copy']
      : ['-c:a', 'eac3', '-ac', String(Math.min(6, envolvente.canales)), '-b:a', String(SURROUND_BITRATE / 1000) + 'k', ...(filtrosAudio.length ? ['-af', filtrosAudio.join(',')] : [])]
    : ['-c:a', 'aac', '-ac', '2', '-b:a', String(AUDIO_BITRATE / 1000) + 'k', ...(filtrosAudio.length ? ['-af', filtrosAudio.join(',')] : [])];

  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...(desde > 0 ? ['-ss', (desde * paso).toFixed(6)] : []),
    ...(qsv ? ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'] : []),
    '-i', p.path,
    '-map', '0:v:0', '-map', `0:${p.audioStreamIndex}`,
    '-sn', '-dn', '-map_chapters', '-1',
    ...video,
    ...audio,
    '-max_muxing_queue_size', '4096',
    // Los tiempos del trozo tienen que coincidir con su posición real en la
    // película, o el reproductor la coloca donde no es al cambiar de calidad.
    '-output_ts_offset', (desde * paso).toFixed(6),
    '-f', 'hls',
    '-hls_time', paso.toFixed(6),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'mpegts',
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_list_size', '0',
    '-start_number', String(desde),
    '-hls_segment_filename', join(dir, '%d.ts'),
    join(dir, 'interna.m3u8'),
  ];
}

function arrancar(p: PeticionSegmento, desde: number): Sesion {
  const k = clave(p);
  const anterior = sesiones.get(k);
  if (anterior) matar(anterior);

  const dir = join(RAIZ, `${k.replace(/[|]/g, '_')}-${desde}`);
  mkdirSync(dir, { recursive: true });

  const proc = spawn(config.ffmpeg, argumentos(p, desde, dir), { stdio: ['ignore', 'ignore', 'pipe'] });
  const sesion: Sesion = { clave: k, dir, proc, desde, ultimoUso: Date.now(), muerta: false, dispositivo: p.dispositivo };

  let errores = '';
  proc.stderr.on('data', (d) => {
    errores = (errores + d.toString()).slice(-1500);
  });
  proc.on('error', (e) => {
    sesion.muerta = true;
    console.error('[hls] no arrancó ffmpeg:', e.message);
  });
  proc.on('close', (code) => {
    if (code !== 0 && !sesion.muerta && errores.trim()) {
      console.error(`[hls] ffmpeg salió con ${code}: ${errores.trim()}`);
    }
  });

  sesiones.set(k, sesion);
  return sesion;
}

/**
 * Devuelve el trozo pedido, fabricándolo si hace falta.
 *
 * Si el trozo está por detrás de donde va la sesión, o muy por delante, es que
 * alguien ha saltado: se reinicia ffmpeg en ese punto en vez de esperar a que
 * llegue codificando, que podrían ser minutos.
 */
export async function segmento(p: PeticionSegmento, esperaMs = 40_000): Promise<Buffer> {
  const k = clave(p);
  let sesion = sesiones.get(k);

  const sirve = sesion && !sesion.muerta && p.segmento >= sesion.desde && p.segmento < sesion.desde + ALCANCE + 400;
  const yaEstaba = sesion && existsSync(rutaSegmento(sesion.dir, p.segmento));

  if (!sesion || (!sirve && !yaEstaba)) sesion = arrancar(p, p.segmento);
  sesion.ultimoUso = Date.now();

  const ruta = rutaSegmento(sesion.dir, p.segmento);
  const limite = Date.now() + esperaMs;

  while (Date.now() < limite) {
    // ffmpeg escribe a un temporal y renombra (`temp_file`), así que si el
    // fichero existe con su nombre definitivo está completo.
    if (existsSync(ruta)) {
      sesion.ultimoUso = Date.now();
      return readFileSync(ruta);
    }
    if (sesion.proc.exitCode !== null && !existsSync(ruta)) {
      throw new Error('La conversión terminó sin producir ese trozo');
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('El trozo tardó demasiado en prepararse');
}

/** Para liberar la GPU cuando alguien cierra el reproductor. */
export function cerrarSesiones(fileId: number) {
  for (const s of sesiones.values()) if (s.clave.startsWith(`${fileId}|`)) matar(s);
}

/**
 * Corta las sesiones HLS de un aparato. Sin esto, pulsar «parar» en Actividad
 * sobre alguien viendo por HLS —el modo pensado justo para fuera de casa— no
 * hacía nada: ese ffmpeg vive aquí, no en `sessions` ni en `flujosCrudos`, y
 * seguía consumiendo GPU sirviendo trozos al aparato que se creía cortado.
 */
export function cerrarSesionesDe(dispositivo: string) {
  for (const s of sesiones.values()) if (s.dispositivo === dispositivo) matar(s);
}

export const sesionesActivas = () => sesiones.size;
