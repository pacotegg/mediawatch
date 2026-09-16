import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { config } from '../config.ts';
import type { MediaInfo } from './probe.ts';

export type ClientCaps = {
  hevc: boolean;
  ac3: boolean;
  eac3: boolean;
  maxHeight: number;
  /*
   * Hasta qué altura descodifica HEVC, que no tiene por qué ser la misma que en
   * H.264. Un móvil corriente descodifica H.264 a 4K y HEVC solo hasta 1080p, y
   * con un único tope para los dos se elige mal en la mitad de los casos: o se
   * transcodifica un H.264 que iba bien, o se manda un HEVC 4K que el aparato
   * no puede con él. Cero significa «no lo sé, usa el tope general».
   */
  maxHeightHevc?: number;
  /*
   * Tope de tasa de bits en kb/s, elegido a mano por quien ve desde fuera de
   * casa: «1080p a 8 Mb/s», «720p a 4». Cero es «sin tope». Si el fichero lo
   * supera se recodifica aunque el aparato pudiera con él tal cual, que es
   * justo lo que se quiere con datos del móvil.
   */
  maxKbps?: number;
};

export type PlaybackPlan = {
  mode: 'direct' | 'remux' | 'transcode';
  videoAction: 'copy' | 'encode';
  audioAction: 'copy' | 'encode';
  reasons: string[];
  targetHeight: number;
  /** Tope de vídeo en kb/s si se pidió uno; si no, cero. */
  maxKbps: number;
};

const MP4_CONTAINERS = /mp4|m4v|mov/;
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'flac', 'opus', 'vorbis']);

export function planPlayback(info: MediaInfo, caps: ClientCaps, audioIndex: number, bitrateBps = 0): PlaybackPlan {
  const reasons: string[] = [];
  const video = info.video;
  const audio = info.audio.find((a) => a.streamIndex === audioIndex) ?? info.audio[0];

  // Un 15 % de margen: la tasa media del fichero incluye audio y subtítulos,
  // y no merece la pena recodificar un 7.800 kb/s para quedarse en 8.000.
  const maxKbps = caps.maxKbps ?? 0;
  const demasiadoPesado = Boolean(video && maxKbps && bitrateBps > maxKbps * 1000 * 1.15);
  if (demasiadoPesado) reasons.push(`${Math.round(bitrateBps / 1000)} kb/s supera el tope pedido (${maxKbps} kb/s)`);

  const videoOk =
    !video ||
    video.codec === 'h264' ||
    (video.codec === 'hevc' && caps.hevc) ||
    video.codec === 'vp9' ||
    video.codec === 'av1';
  if (!videoOk) reasons.push(`vídeo ${video?.codec} no soportado por el cliente`);

  const tope = video?.codec === 'hevc' && caps.maxHeightHevc ? caps.maxHeightHevc : caps.maxHeight;
  const tooTall = Boolean(video && tope && video.height > tope);
  if (tooTall) reasons.push(`${video!.height}p supera el máximo del cliente (${tope}p)`);

  const audioCodec = audio?.codec ?? '';
  const audioOk =
    !audio ||
    BROWSER_AUDIO.has(audioCodec) ||
    (audioCodec === 'ac3' && caps.ac3) ||
    (audioCodec === 'eac3' && caps.eac3);
  if (!audioOk) reasons.push(`audio ${audioCodec} no soportado por el cliente`);

  const containerOk = MP4_CONTAINERS.test(info.container);
  if (!containerOk) reasons.push(`contenedor ${info.container} no reproducible en navegador`);

  const videoAction: 'copy' | 'encode' = videoOk && !tooTall && !demasiadoPesado ? 'copy' : 'encode';

  // Por debajo de 4 Mb/s, un AC3 de 640 kb/s copiado tal cual es un tercio del
  // presupuesto: se recodifica a AAC estéreo, que con la calidad baja ya
  // pedida es lo coherente.
  const audioPesado = Boolean(audio && maxKbps && maxKbps < 4000 && !['aac', 'opus', 'mp3', 'vorbis'].includes(audioCodec));
  if (audioPesado) reasons.push(`audio ${audioCodec} recodificado para caber en ${maxKbps} kb/s`);
  const audioAction: 'copy' | 'encode' = audioOk && !audioPesado ? 'copy' : 'encode';

  if (containerOk && videoAction === 'copy' && audioAction === 'copy') {
    return { mode: 'direct', videoAction, audioAction, reasons: ['compatible tal cual'], targetHeight: video?.height ?? 0, maxKbps: 0 };
  }
  return {
    mode: videoAction === 'encode' ? 'transcode' : 'remux',
    videoAction,
    audioAction,
    reasons,
    targetHeight: tooTall ? tope : video?.height ?? 0,
    maxKbps: videoAction === 'encode' ? maxKbps : 0,
  };
}

/**
 * Tope de tasa para el codificador. Sin tope, calidad constante (como hasta
 * ahora); con él, VBR con techo, que es lo único que garantiza que por 4G no
 * se pare a cargar. El búfer del doble del tope deja que las escenas de acción
 * pidan prestado a las quietas.
 */
function topeDeTasa(plan: PlaybackPlan): string[] {
  if (!plan.maxKbps) return [];
  return ['-maxrate', `${plan.maxKbps}k`, '-bufsize', `${plan.maxKbps * 2}k`];
}

function videoArgs(plan: PlaybackPlan, info: MediaInfo): string[] {
  if (plan.videoAction === 'copy') return ['-c:v', 'copy'];

  const filters: string[] = [];
  const qsv = config.hwaccel === 'qsv';
  const needsScale = plan.targetHeight > 0 && info.video && info.video.height > plan.targetHeight;

  if (qsv) {
    // h264_qsv only accepts 8-bit input, so 10-bit sources (HEVC Main 10) must be
    // converted on the GPU or the encoder refuses to open.
    const vpp: string[] = [];
    if (needsScale && info.video) {
      const width = Math.round((info.video.width * plan.targetHeight) / info.video.height / 2) * 2;
      vpp.push(`w=${width}`, `h=${plan.targetHeight}`);
    }
    if (info.video?.hdr && config.tonemap) vpp.push('tonemap=1');
    vpp.push('format=nv12');
    filters.push(`vpp_qsv=${vpp.join(':')}`);

    return [
      '-vf', filters.join(','),
      '-c:v', 'h264_qsv',
      '-preset', 'veryfast',
      // Con tope, h264_qsv necesita `-b:v` para entrar en VBR; `-global_quality`
      // solo (ICQ) ignora el `-maxrate`, medido.
      ...(plan.maxKbps ? ['-b:v', `${plan.maxKbps}k`] : ['-global_quality', String(config.transcodeQuality)]),
      ...topeDeTasa(plan),
      '-look_ahead', '0',
      '-profile:v', 'high',
      '-g', '120',
    ];
  }

  if (needsScale) filters.push(`scale=-2:${plan.targetHeight}`);
  return [
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '21',
    ...topeDeTasa(plan),
    '-g', '120',
  ];
}

export type AudioMode = 'normal' | 'dialogue' | 'night';

export type AudioOptions = {
  /** Force a 2.0 downmix; browsers handle multichannel AAC inconsistently. */
  downmixStereo: boolean;
  /** EBU R128 loudness normalisation, evens out level between films. */
  normalize: boolean;
  mode: AudioMode;
  sourceChannels: number;
};

/**
 * A plain 5.1 downmix buries dialogue: the centre channel gets folded in at
 * -3 dB and then competes with music and effects from every other channel.
 * These weights lift the centre and pull the surrounds back instead.
 *
 * Channels are addressed by index, not by name (c2 rather than FC): the
 * pipeline has hit six-channel tracks with no declared layout, where the
 * by-name filter refuses to build. Index order is L R C LFE ... in both
 * 5.1 and 7.1, so c2 is the centre either way.
 */
export function dialogueDownmix(channels: number, mode: AudioMode): string | null {
  if (mode === 'normal' || channels < 6) return null;
  const surroundL = channels >= 6 ? '+0.22*c4' : '';
  const surroundR = channels >= 6 ? '+0.22*c5' : '';
  return `pan=stereo|c0=0.45*c0+1.0*c2+0.12*c3${surroundL}|c1=0.45*c1+1.0*c2+0.12*c3${surroundR}`;
}

export type StreamOptions = {
  path: string;
  info: MediaInfo;
  plan: PlaybackPlan;
  startSeconds: number;
  audioStreamIndex: number;
  audioOptions: AudioOptions;
  /** Positive delays the audio relative to the picture. */
  audioDelayMs?: number;
};

function audioArgs(plan: PlaybackPlan, options: AudioOptions, delayMs = 0): string[] {
  const downmix = options.downmixStereo ? dialogueDownmix(options.sourceChannels, options.mode) : null;
  const needsFiltering = options.normalize || Boolean(downmix) || delayMs !== 0;

  if (plan.audioAction === 'copy' && !needsFiltering) return ['-c:a', 'copy'];

  const filters: string[] = [];
  if (downmix) filters.push(downmix);

  /*
   * A deliberate offset has to be built into the audio itself. Doing it with
   * `-itsoffset` on a second input does not survive: `aresample=async=1` exists
   * precisely to pull audio back onto the video's timeline and quietly undoes
   * it, so the correction is dropped whenever the viewer asked for a shift.
   */
  if (delayMs > 0) filters.push(`adelay=${Math.round(delayMs)}:all=1`);
  else if (delayMs < 0) filters.push(`atrim=start=${(-delayMs / 1000).toFixed(3)}`, 'asetpts=PTS-STARTPTS');
  else filters.push('aresample=async=1');

  // Night mode also tames the explosions, which is the other half of the
  // "I can't hear the dialogue without waking the house" problem.
  if (options.mode === 'night') filters.push('acompressor=threshold=-20dB:ratio=4:attack=20:release=250:makeup=2');

  // The boosted mix can sum past full scale on loud scenes, so cap it.
  // `level=false` matters: the limiter otherwise auto-levels back up to ~0 dBFS,
  // which measured -0.1 dB peaks and defeats the point of leaving headroom.
  if (downmix) filters.push(`alimiter=limit=${options.mode === 'night' ? '0.89' : '0.95'}:level=false`);

  if (options.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  return [
    '-c:a', 'aac',
    // `pan` already produced two channels; asking for -ac again would re-downmix.
    ...(downmix ? [] : ['-ac', options.downmixStereo ? '2' : '6']),
    '-b:a', options.downmixStereo ? '256k' : '448k',
    '-af', filters.join(','),
  ];
}

export function buildFfmpegArgs(opts: StreamOptions): string[] {
  const { plan, info, startSeconds, audioStreamIndex } = opts;
  const hwDecode =
    plan.videoAction === 'encode' && config.hwaccel === 'qsv'
      ? ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv']
      : [];

  const seek = startSeconds > 0 ? ['-ss', String(startSeconds)] : [];

  return [
    '-hide_banner',
    '-loglevel', 'error',
    ...seek,
    ...hwDecode,
    '-i', opts.path,
    '-map', '0:v:0',
    '-map', `0:${audioStreamIndex}`,
    '-sn', '-dn',
    '-map_chapters', '-1',
    ...videoArgs(plan, info),
    ...audioArgs(plan, opts.audioOptions, opts.audioDelayMs ?? 0),
    '-max_muxing_queue_size', '4096',
    '-avoid_negative_ts', 'make_zero',
    /*
     * `delay_moov`: sin él, copiar AC3 (o E-AC3) a MP4 fragmentado falla al
     * escribir la cabecera —«Cannot write moov atom before AC3 packets»— y
     * el flujo muere sin un solo byte. Salía en cualquier móvil que descodifica
     * AC3 al recodificar solo el vídeo de una película con audio AC3.
     */
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof+delay_moov',
    '-f', 'mp4',
    'pipe:1',
  ];
}

export type Session = {
  id: string;
  fileId: number;
  userId: number;
  /** El aparato (ocho caracteres del token), para poder pararle solo a él. */
  sesion?: string | null;
  proc: ChildProcessWithoutNullStreams;
  plan: PlaybackPlan;
  startedAt: number;
  startSeconds: number;
  title: string;
};

export const sessions = new Map<string, Session>();

export function startStream(opts: StreamOptions & { fileId: number; userId: number; title: string; sesion?: string | null }): Session {
  const args = buildFfmpegArgs(opts);
  const proc = spawn(config.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const id = `${opts.fileId}-${Date.now().toString(36)}`;

  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  /*
 * Un `spawn` que no arranca —ffmpeg movido, bloqueado por el antivirus, disco
 * sin responder— emite «error» en el proceso hijo, y un «error» sin nadie
 * escuchando en Node no es un aviso: tumba el servidor entero. Estando viendo
 * una película eso es la película cortada y la aplicación sin servidor.
 */
  proc.on('error', (e) => {
    console.error(`[ffmpeg ${id}] no arrancó: ${e.message}`);
    sessions.delete(id);
  });
  proc.on('close', (code) => {
    if (code && code !== 255) console.error(`[ffmpeg ${id}] salida ${code}: ${stderr.trim()}`);
    sessions.delete(id);
  });

  const session: Session = {
    id,
    fileId: opts.fileId,
    userId: opts.userId,
    sesion: opts.sesion ?? null,
    proc,
    plan: opts.plan,
    startedAt: Date.now(),
    startSeconds: opts.startSeconds,
    title: opts.title,
  };
  sessions.set(id, session);
  return session;
}

export function stopSession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  s.proc.kill('SIGKILL');
  sessions.delete(id);
}
