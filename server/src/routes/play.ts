import { comenzar, nombreCliente } from '../media/historial.ts';
import { audioEnvolvente, cerrarSesiones, cerrarSesionesDe, escalera, listaDeCalidad, listaMaestra, segmento, CALIDADES } from '../media/hls.ts';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { mediaInfo, type MediaInfo } from '../media/probe.ts';
import { dialogueDownmix, planPlayback, sessions, startStream, stopSession, type AudioMode, type ClientCaps } from '../media/transcode.ts';
import { clearOffset, isMeasuring, measure, offsetFor, saveOffset } from '../media/resync.ts';
import { ensure, generarLote, isGenerating, lote, pararLote, readManifest, sheetPath } from '../media/trickplay.ts';
import { marcarActividad } from '../media/ocupado.ts';
import { detectForShow, detectarTodas, job, pararDeteccion, showsWithRanges, skipRangesFor } from '../media/intros.ts';
import { currentUser, requireUser, sesionDe } from './auth.ts';
import type { ServerResponse } from 'node:http';

function caps(req: FastifyRequest): ClientCaps {
  const q = req.query as Record<string, string | undefined>;
  return {
    hevc: q.hevc === '1',
    ac3: q.ac3 === '1',
    eac3: q.eac3 === '1',
    maxHeight: Number(q.maxHeight ?? 0) || 0,
    maxHeightHevc: Number(q.maxHeightHevc ?? 0) || 0,
    maxKbps: Number(q.maxKbps ?? 0) || 0,
  };
}

/** Tasa media del fichero en bits por segundo, para el tope de calidad. */
function tasaDe(path: string, info: MediaInfo): number {
  return info.duration > 0 ? Math.round((statSync(path).size * 8) / info.duration) : 0;
}

/**
 * Los flujos que salen tal cual (el fichero por rangos o una tubería de ffmpeg
 * que no pasa por `sessions`), por aparato: para poder cortarlos desde la
 * pestaña de actividad. Se apuntan al empezar y se olvidan al cerrarse.
 */
export const flujosCrudos = new Map<string, Set<ServerResponse>>();

function rastrear(req: FastifyRequest, reply: { raw: ServerResponse }) {
  const sesion = sesionDe(req);
  if (!sesion) return;
  const conjunto = flujosCrudos.get(sesion) ?? new Set<ServerResponse>();
  conjunto.add(reply.raw);
  flujosCrudos.set(sesion, conjunto);
  const soltar = () => {
    conjunto.delete(reply.raw);
    if (conjunto.size === 0) flujosCrudos.delete(sesion);
  };
  reply.raw.on('close', soltar);
  reply.raw.on('finish', soltar);
}

/** Cortar todo lo que un aparato tenga abierto: tuberías de ffmpeg, HLS y flujos en crudo. */
export function cortarAparato(sesion: string) {
  for (const s of sessions.values()) if (s.sesion === sesion) stopSession(s.id);
  cerrarSesionesDe(sesion);
  for (const r of flujosCrudos.get(sesion) ?? []) r.destroy();
  flujosCrudos.delete(sesion);
}

/**
 * Un flujo en crudo (el fichero servido por rangos) que el cliente deja de
 * leer no se cierra solo — pausar en la tele no corta la conexión HTTP, solo
 * deja de pedir más rango. Medido el 24/09: una pausa de la noche anterior
 * seguía «en vuelo» más de 10 horas después (fileId 5630), justo antes de un
 * bloqueo real del bucle de eventos de 90 s. Se cierra solo tras
 * `INACTIVO_MIN` minutos sin que el flujo de lectura entregue ni un byte más
 * (el evento 'data' del ReadStream solo se dispara cuando el pipe interno
 * avanza; si el cliente no drena, deja de dispararse por el backpressure de
 * Node — sin inventar nada, comprobado).
 *
 * Probado el 24/09 en la QN93A real: con la peli en pausa 10 min seguidos,
 * AVPlay seguía drenando la conexión (sigue bufferizando en segundo plano
 * aunque esté en pausa) y el corte nunca llegó a dispararse — no se pudo
 * confirmar si reanuda bien tras un corte real. 20 min da margen de sobra a
 * cualquier pausa normal; si algún día se ve `[crudo] cerrado` en
 * `data/server.err` y algo no reanuda bien en la tele, es la primera
 * sospechosa.
 *
 * De paso, ese mismo evento 'data' es la señal honrada de «se está leyendo
 * del disco», así que también marca actividad para `ocupado.ts`. Hacía falta:
 * `marcarActividad()` solo se llamaba al abrir el flujo (una vez en toda la
 * película) y en cada `/api/progress`, que la tele deja de mandar en cuanto
 * pausa porque el reloj no avanza. A los cinco minutos de pausa el servidor
 * daba la casa por tranquila y los lotes de fondo se ponían a leer el mismo
 * plato del que la tele seguía tirando —justo el escenario que `ocupado.ts`
 * existe para evitar, y que su comentario dice que ya pasó una vez en el
 * salón—. Es un `Date.now()` en una variable, sin E/S, así que llamarlo por
 * cada trozo no cuesta nada.
 */
const INACTIVO_MIN = 20;
function cerrarSiInactivo(stream: ReturnType<typeof createReadStream>, res: ServerResponse) {
  let ultimoAvance = Date.now();
  stream.on('data', () => {
    ultimoAvance = Date.now();
    marcarActividad();
  });
  const vigia = setInterval(() => {
    if (Date.now() - ultimoAvance > INACTIVO_MIN * 60_000) {
      console.log(`[crudo] cerrado por ${INACTIVO_MIN} min sin leer`);
      stream.destroy();
      res.destroy();
    }
  }, 60_000).unref();
  res.on('close', () => clearInterval(vigia));
}

function fileRow(fileId: number) {
  return db
    .prepare(`SELECT f.id, f.path, f.item_id, f.episode_id,
                COALESCE(i.title, s.title) AS title, COALESCE(f.item_id, e.show_id) AS parent_id
              FROM media_files f
              LEFT JOIN items i ON i.id = f.item_id
              LEFT JOIN episodes e ON e.id = f.episode_id
              LEFT JOIN items s ON s.id = e.show_id
              WHERE f.id = ?`)
    .get(fileId) as { id: number; path: string; item_id: number | null; episode_id: number | null; title: string; parent_id: number } | undefined;
}

function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/**
 * Correr todos los tiempos de un WebVTT `segundos` segundos, en cualquiera de
 * los dos sentidos. Positivo los retrasa (aparecen más tarde), negativo los
 * adelanta. Los cues que se salen por delante del cero se tiran, y el que
 * queda a caballo se recorta.
 *
 * Nació solo para restar: cuando el vídeo sale por tubería cortado en el
 * segundo `desde`, ese flujo empieza en cero para el reproductor y unos
 * subtítulos con los tiempos de la película entera irían adelantados
 * exactamente `desde`. Ahora lleva además el desfase que pide el usuario —un
 * `.srt` descargado que va corrido—, que puede ir en los dos sentidos; por eso
 * el parámetro pasó a ser con signo y los dos ajustes se suman antes de
 * llamar.
 */
function desplazarVtt(text: string, segundos: number): string {
  if (segundos === 0) return text;
  const aSeg = (h: string, m: string, sg: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(sg) + Number(ms) / 1000;
  const aTexto = (t: number) => {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sg = Math.floor(t % 60), ms = Math.round((t % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sg).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  const bloques = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const salida: string[] = [];
  for (const b of bloques) {
    const m = /(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})/.exec(b);
    if (!m) { salida.push(b); continue; }
    const ini = aSeg(m[1] ?? '00', m[2], m[3], m[4]) + segundos;
    const fin = aSeg(m[5] ?? '00', m[6], m[7], m[8]) + segundos;
    if (fin <= 0) continue;
    salida.push(b.replace(m[0], `${aTexto(Math.max(0, ini))} --> ${aTexto(fin)}`));
  }
  return salida.join('\n\n');
}

/** Recoger la salida entera de un proceso como texto. */
function recoger(proc: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve) => {
    const trozos: Buffer[] = [];
    proc.stdout?.on('data', (d) => trozos.push(d));
    proc.on('close', () => resolve(Buffer.concat(trozos).toString('utf8')));
    proc.on('error', () => resolve(''));
  });
}

function srtToVtt(text: string): string {
  const body = text
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2})/gm, '');
  return `WEBVTT\n\n${body}`;
}

/*
 * Perfiles de dispositivo: que audio decodifica cada cliente de verdad.
 *
 * Samsung 2021 (Tizen 6.0), segun su especificacion oficial: AC3, DD+ (con
 * Atmos por JOC), AAC, HE-AAC, MP3, Opus, WMA, LPCM. Y literalmente: «The DTS
 * Audio codec is not supported on 2021 TVs». TrueHD y FLAC tampoco aparecen.
 *
 * Si el cliente pide una pista que su hardware no lee, el servidor la convierte
 * a DD+ 5.1 y copia el video tal cual: es lo unico que hace falta transcodificar,
 * y DD+ lo pasa la tele al receptor por eARC sin perder canales.
 */
const PERFILES: Record<string, { audio: Set<string> }> = {
  samsung2021: {
    audio: new Set(['aac', 'ac3', 'eac3', 'eac3_ddp_atmos', 'eac3/atmos', 'mp3', 'opus', 'wmav2', 'wmapro', 'pcm_s16le', 'pcm_s24le', 'ac4']),
  },
};

/**
 * Qué audio lee el cliente que pregunta.
 *
 * Hay dos formas de decirlo. Un nombre de perfil —`samsung2021`— vale cuando el
 * aparato es siempre el mismo y su ficha técnica está publicada. Un móvil no:
 * dos Android de la misma marca traen decodificadores distintos según el chip,
 * así que la aplicación mira su propio `MediaCodecList` y manda la lista real,
 * `lista:aac,mp3,opus,flac`. Adivinarlo desde aquí sería inventárselo.
 */
function audioDelCliente(perfil: string | undefined): Set<string> | null {
  if (!perfil) return null;
  if (perfil.startsWith('lista:')) {
    const codecs = perfil.slice(6).split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
    return codecs.length ? new Set(codecs) : null;
  }
  return PERFILES[perfil]?.audio ?? null;
}

function audioCompatible(perfil: string | undefined, codec: string | undefined): boolean {
  const p = audioDelCliente(perfil);
  if (!p) return true; // sin perfil no se sabe: no se estorba
  return p.has(String(codec ?? '').toLowerCase());
}

/**
 * A qué convertir una pista que el cliente no sabe leer.
 *
 * No hay una respuesta única y por eso esto existe. A la tele se le manda DD+,
 * que pasa por eARC a la barra con sus 5.1 intactos. A un móvil, DD+ no le sirve
 * de nada —no lo decodifica y encima va a unos auriculares— así que AAC en
 * estéreo, que lo lee cualquier cosa y ocupa la tercera parte.
 *
 * Antes esto estaba fijo en DD+ porque el único cliente era la tele; con el
 * móvil delante, convertir a un códec que tampoco entiende sería cambiar un
 * silencio por otro.
 */
function salidaDeAudio(perfil: string | undefined): { codec: string; maxCanales: number; bitrate: string } {
  const p = audioDelCliente(perfil);
  if (p && !p.has('eac3') && !p.has('ac3')) {
    return { codec: 'aac', maxCanales: 2, bitrate: '192k' };
  }
  return { codec: 'eac3', maxCanales: 6, bitrate: '640k' };
}

export default async function playRoutes(app: FastifyInstance) {
  app.get('/api/play/:fileId/info', async (req, reply) => {
    const fileId = Number((req.params as { fileId: string }).fileId);
    const row = fileRow(fileId);
    if (!row) return reply.code(404).send({ error: 'Fichero no encontrado' });
    if (!existsSync(row.path)) return reply.code(410).send({ error: 'El fichero ya no está en disco; se retirará en el próximo escaneo' });

    const info = await mediaInfo(fileId);
    const audioIndex = info.audio[0]?.streamIndex ?? 0;
    const plan = planPlayback(info, caps(req), audioIndex, tasaDe(row.path, info));

    const external = db
      .prepare('SELECT id, language, forced, external FROM sub_tracks WHERE file_id = ? AND external IS NOT NULL ORDER BY language')
      .all(fileId) as any[];

    // Tamaño y tasa de bits para la pantalla de informacion del reproductor:
    // es lo que Plex ensena ahi y lo unico que no estaba ya en `mediaInfo`.
    const bytes = statSync(row.path).size;

    return {
      fileId,
      title: row.title,
      duration: info.duration,
      container: info.container,
      chapters: info.chapters,
      // Cabecera y creditos del episodio, si se han detectado. Van aqui para que
      // el cliente no tenga que hacer una segunda peticion al empezar a ver.
      skip: row.episode_id ? skipRangesFor(row.episode_id) : [],
      size: bytes,
      bitrate: info.duration > 0 ? Math.round((bytes * 8) / info.duration) : 0,
      video: info.video,
      plan,
      audio: info.audio.map((a) => ({
        id: a.streamIndex,
        codec: a.codec,
        language: a.language,
        channels: a.channels,
        title: a.title,
        default: a.default,
        atmos: a.atmos,
        compatible: audioCompatible((req.query as { perfil?: string }).perfil, a.codec),
      })),
      subtitles: [
        /*
         * Un incrustado se omite si ya hay un externo del mismo idioma y del
         * mismo tipo (forzado o no): antes se concatenaban sin más, y desde
         * que se pueden extraer incrustados a `.srt` (24/09) eso significaba
         * ver «Español» dos veces en el menú, sin forma de distinguirlos. El
         * externo gana porque es el que se puede desajustar.
         */
        ...info.subs
          .filter((s) => s.textual)
          .filter((s) => !external.some((e) => (e.language ?? null) === (s.language ?? null) && Boolean(e.forced) === s.forced))
          .map((s) => ({
            id: `embedded-${s.streamIndex}`,
            language: s.language,
            title: s.title,
            forced: s.forced,
            source: 'embedded' as const,
          })),
        ...external.map((s) => ({
          id: `external-${s.id}`,
          language: s.language,
          title: s.external.split(/[\\/]/).pop(),
          forced: Boolean(s.forced),
          source: 'external' as const,
        })),
      ],
    };
  });

  app.get('/api/play/:fileId/stream', async (req, reply) => {
    const fileId = Number((req.params as { fileId: string }).fileId);
    const q = req.query as Record<string, string | undefined>;
    const row = fileRow(fileId);
    if (!row) return reply.code(404).send({ error: 'Fichero no encontrado' });
    if (!existsSync(row.path)) return reply.code(410).send({ error: 'El fichero ya no está en disco' });

    // Alguien está viendo algo: los trabajos de fondo se apartan del disco.
    marcarActividad();

    const info = await mediaInfo(fileId);
    const audioIndex = q.audio !== undefined ? Number(q.audio) : info.audio.find((a) => a.default)?.streamIndex ?? info.audio[0]?.streamIndex ?? 0;
    const plan = planPlayback(info, caps(req), audioIndex, tasaDe(row.path, info));
    const start = Math.max(0, Number(q.t ?? 0));
    const audioDelayMs = Math.max(-10_000, Math.min(10_000, Number(q.audiodelay ?? 0)));

    /*
     * `raw=1` is for players that decode more than a browser does — the
     * television's AVPlay handles MKV, HEVC and AC3 natively, so remuxing for
     * it would burn CPU and lose the original audio for nothing.
     */
    const raw = q.raw === '1';

    // El historial se anota aquí, no en `/api/progress`: un fichero servido en
    // crudo puede reproducirse entero sin que el cliente informe ni una vez.
    const quienVe = currentUser(req);
    if (quienVe) {
      comenzar({
        userId: quienVe.id,
        // En un episodio `item_id` viene vacío: el título es la serie.
        itemId: row.parent_id,
        episodeId: row.episode_id ?? null,
        fileId,
        duracion: info.duration ?? null,
        modo: raw ? 'raw' : plan.mode,
        cliente: nombreCliente(req.headers['user-agent'] as string | undefined),
        sesion: sesionDe(req),
      });
    }
    rastrear(req, reply);

    /*
     * Pista que la tele no decodifica (DTS, TrueHD, FLAC): video copiado tal
     * cual y solo el audio convertido a DD+ 5.1, en Matroska por tuberia, que
     * AVPlay reproduce. Es lo minimo que hay que tocar para que suene.
     */
    const perfil = q.perfil;
    const pistaElegida = info.audio.find((a) => a.streamIndex === audioIndex);

    /*
     * Modo de escucha sobre el fichero en crudo.
     *
     * «Normal» es intocable: la pista DD+ JOC llega entera a la barra y suena
     * como Atmos. Los otros dos modos obligan a recodificar el audio —no hay
     * forma de comprimir el rango dinamico sin decodificarlo—, asi que solo
     * entran cuando se piden a mano, y se avisa en el cliente de lo que cuesta.
     */
    const modoAudio: AudioMode = q.audiomode === 'night' || q.audiomode === 'dialogue' ? q.audiomode : 'normal';
    const normalizar = q.normalize === '1';
    const incompatible = Boolean(perfil && pistaElegida && !audioCompatible(perfil, pistaElegida.codec));

    if (raw && pistaElegida && (incompatible || modoAudio !== 'normal' || normalizar)) {
      const salida = salidaDeAudio(perfil);
      const origen = pistaElegida.channels ?? 2;
      // «Voces claras» mezcla a estereo subiendo el canal central; el resto
      // conserva los canales que traia, hasta donde llegue el cliente: 5.1 en
      // la tele, que los pasa por eARC sin perder nada, y estereo en un movil.
      const downmix = modoAudio === 'dialogue' ? dialogueDownmix(origen, 'dialogue') : null;
      const canales = downmix ? 2 : Math.min(origen, salida.maxCanales);

      // Los mismos filtros que usa la transcodificacion completa, para que
      // «modo noche» suene igual se llegue por donde se llegue.
      const filtros: string[] = [];
      if (downmix) filtros.push(downmix);
      if (modoAudio === 'night') filtros.push('acompressor=threshold=-20dB:ratio=4:attack=20:release=250:makeup=2');
      if (downmix || modoAudio === 'night') filtros.push(`alimiter=limit=${modoAudio === 'night' ? '0.89' : '0.95'}:level=false`);
      if (normalizar) filtros.push('loudnorm=I=-16:TP=-1.5:LRA=11');

      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        ...(start > 0 ? ['-ss', String(start)] : []),
        '-i', row.path,
        '-map', '0:v:0', '-map', `0:${audioIndex}`, '-map', '0:s?',
        '-c:v', 'copy', '-c:s', 'copy',
        '-c:a', salida.codec,
        // `pan` ya ha dejado dos canales; pedir -ac otra vez volveria a mezclar.
        ...(downmix ? [] : ['-ac', String(canales)]),
        '-b:a', canales > 2 ? salida.bitrate : '224k',
        ...(filtros.length ? ['-af', filtros.join(',')] : []),
        '-max_muxing_queue_size', '4096',
        '-f', 'matroska', 'pipe:1',
      ];
      /*
       * ffmpeg escribe a `pipe:1`. Cuando el cliente cierra -parar el vídeo,
       * saltar, cambiar de pista-, la tubería muere y ffmpeg escupe «Error
       * submitting a packet to the muxer: Invalid argument» antes de que le
       * llegue el SIGKILL. Eso NO es una avería: es lo normal al parar. Pero
       * caía en `server.err`, que es justo el fichero al que manda mirar el
       * CLAUDE.md cuando algo falla de verdad -47 líneas falsas contadas el
       * 26/09/2026-. Tras el cierre, su stderr ya no interesa.
       */
      let cerrado = false;
      const proc = spawn(config.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stderr.on('data', (d) => { if (!cerrado) console.error('[remux-audio]', String(d).trim()); });
      /*
 * Un `spawn` que no arranca —ffmpeg movido, bloqueado por el antivirus, disco
 * sin responder— emite «error» en el proceso hijo, y un «error» sin nadie
 * escuchando en Node no es un aviso: tumba el servidor entero. Estando viendo
 * una película eso es la película cortada y la aplicación sin servidor.
 */
      proc.on('error', (e) => console.error('[remux-audio] no arrancó ffmpeg:', e.message));
      req.raw.on('close', () => { cerrado = true; proc.kill('SIGKILL'); });
      return reply
        .header('Content-Type', 'video/x-matroska')
        .header('Cache-Control', 'no-store')
        .header('X-TvWatch-Mode', modoAudio === 'normal' ? 'remux-audio' : 'remux-audio-' + modoAudio)
        .send(proc.stdout);
    }

    /*
     * Pista de audio elegida que no es la primera del contenedor.
     *
     * AVPlay arranca siempre con la primera pista, y cambiarla después con
     * `setSelectTrack` deja el audio descuadrado del vídeo (visto en «¡Rompe
     * Ralph!»: Atmos inglés primero, español AC3 segundo). Jellyfin en Tizen
     * hace lo mismo que aquí: no fiarse del cambio nativo y servir el fichero
     * con esa pista sola, copiada tal cual —ni el vídeo ni el Atmos se
     * tocan—. Cuesta un ffmpeg que solo copia, como al saltar.
     */
    const pistaNoPrimera = raw && q.audio !== undefined && !!pistaElegida && pistaElegida.streamIndex !== info.audio[0]?.streamIndex;
    if (pistaNoPrimera && audioDelayMs === 0) {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        ...(start > 0 ? ['-ss', String(start)] : []),
        '-i', row.path,
        '-map', '0:v:0', '-map', `0:${audioIndex}`, '-map', '0:s?',
        '-c', 'copy',
        '-max_muxing_queue_size', '4096',
        '-f', 'matroska', 'pipe:1',
      ];
      /*
       * ffmpeg escribe a `pipe:1`. Cuando el cliente cierra -parar el vídeo,
       * saltar, cambiar de pista-, la tubería muere y ffmpeg escupe «Error
       * submitting a packet to the muxer: Invalid argument» antes de que le
       * llegue el SIGKILL. Eso NO es una avería: es lo normal al parar. Pero
       * caía en `server.err`, que es justo el fichero al que manda mirar el
       * CLAUDE.md cuando algo falla de verdad -47 líneas falsas contadas el
       * 26/09/2026-. Tras el cierre, su stderr ya no interesa.
       */
      let cerrado = false;
      const proc = spawn(config.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stderr.on('data', (d) => { if (!cerrado) console.error('[copia-pista]', String(d).trim()); });
      proc.on('error', (e) => console.error('[copia-pista] no arrancó ffmpeg:', e.message));
      req.raw.on('close', () => { cerrado = true; proc.kill('SIGKILL'); });
      return reply
        .header('Content-Type', 'video/x-matroska')
        .header('Cache-Control', 'no-store')
        .header('X-TvWatch-Mode', 'copia-pista')
        .send(proc.stdout);
    }

    /*
     * Saltar dentro de un fichero servido en crudo.
     *
     * Medido en la QN93A: AVPlay **no sabe buscar** en un MKV que le llega por
     * HTTP progresivo. `seekTo` responde `InvalidValuesError` aunque el destino
     * sea válido y el servidor conteste 206 a los rangos, `jumpForward` se
     * acepta pero no mueve nada, y en los dos casos la reproducción se queda
     * clavada: estado PLAYING, búfer lleno y el reloj parado.
     *
     * Así que el salto se hace aquí: se vuelve a pedir la película ya cortada
     * en el segundo que toca. Con `-c copy` no se recodifica nada —ni el vídeo
     * ni el Atmos— y se mandan todas las pistas, para que se pueda seguir
     * cambiando de audio o de subtítulos después de saltar. El corte cae en el
     * fotograma clave anterior, así que puede quedarse un par de segundos
     * corto; es lo mismo que hace Plex al saltar en reproducción directa.
     */
    if (raw && start > 0 && audioDelayMs === 0) {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-ss', String(start),
        '-i', row.path,
        '-map', '0:v:0', '-map', '0:a?', '-map', '0:s?',
        '-c', 'copy',
        '-max_muxing_queue_size', '4096',
        '-f', 'matroska', 'pipe:1',
      ];
      /*
       * ffmpeg escribe a `pipe:1`. Cuando el cliente cierra -parar el vídeo,
       * saltar, cambiar de pista-, la tubería muere y ffmpeg escupe «Error
       * submitting a packet to the muxer: Invalid argument» antes de que le
       * llegue el SIGKILL. Eso NO es una avería: es lo normal al parar. Pero
       * caía en `server.err`, que es justo el fichero al que manda mirar el
       * CLAUDE.md cuando algo falla de verdad -47 líneas falsas contadas el
       * 26/09/2026-. Tras el cierre, su stderr ya no interesa.
       */
      let cerrado = false;
      const proc = spawn(config.ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stderr.on('data', (d) => { if (!cerrado) console.error('[copia-desde]', String(d).trim()); });
      proc.on('error', (e) => console.error('[copia-desde] no arrancó ffmpeg:', e.message));
      req.raw.on('close', () => { cerrado = true; proc.kill('SIGKILL'); });
      return reply
        .header('Content-Type', 'video/x-matroska')
        .header('Cache-Control', 'no-store')
        .header('X-TvWatch-Mode', 'copia-desde')
        .send(proc.stdout);
    }

    // A delay has to be applied while muxing, so it rules out serving the raw file.
    if ((raw || plan.mode === 'direct') && start === 0 && audioDelayMs === 0) {
      const stat = statSync(row.path);
      const range = req.headers.range;
      const mime =
        /\.mkv$/i.test(row.path) ? 'video/x-matroska' :
        /\.avi$/i.test(row.path) ? 'video/x-msvideo' :
        /\.(mov)$/i.test(row.path) ? 'video/quicktime' : 'video/mp4';
      reply.header('Accept-Ranges', 'bytes').header('Content-Type', mime);
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        const startByte = Number(match?.[1] || 0);
        const endByte = match?.[2] ? Number(match[2]) : stat.size - 1;
        const stream = createReadStream(row.path, { start: startByte, end: endByte });
        cerrarSiInactivo(stream, reply.raw);
        return reply
          .code(206)
          .header('Content-Range', `bytes ${startByte}-${endByte}/${stat.size}`)
          .header('Content-Length', endByte - startByte + 1)
          .send(stream);
      }
      const streamCompleto = createReadStream(row.path);
      cerrarSiInactivo(streamCompleto, reply.raw);
      return reply.header('Content-Length', stat.size).send(streamCompleto);
    }

    const user = quienVe;
    const session = startStream({
      sesion: sesionDe(req),
      path: row.path,
      info,
      plan,
      startSeconds: start,
      audioStreamIndex: audioIndex,
      audioDelayMs,
      audioOptions: {
        downmixStereo: q.downmix !== '0',
        normalize: q.normalize === '1',
        mode: q.audiomode === 'dialogue' || q.audiomode === 'night' ? q.audiomode : 'normal',
        sourceChannels: info.audio.find((a) => a.streamIndex === audioIndex)?.channels ?? 2,
      },
      fileId,
      userId: user?.id ?? 0,
      title: row.title,
    });

    reply
      .header('Content-Type', 'video/mp4')
      .header('Cache-Control', 'no-store')
      .header('X-TvWatch-Mode', plan.mode)
      .header('X-TvWatch-Session', session.id);

    req.raw.on('close', () => stopSession(session.id));
    return reply.send(session.proc.stdout);
  });

  /*
   * HLS: para ver fuera de casa. La lista maestra ofrece tres calidades y el
   * reproductor elige según lo que aguante la línea; los trozos se fabrican
   * cuando se piden.
   *
   * Los parámetros de la consulta se arrastran a las listas hijas porque el
   * modo de audio y el desfase tienen que seguir aplicándose trozo a trozo.
   */
  const opcionesAudio = (q: Record<string, string | undefined>, canales: number) => ({
    downmixStereo: q.downmix !== '0',
    normalize: q.normalize === '1',
    mode: (q.audiomode === 'dialogue' || q.audiomode === 'night' ? q.audiomode : 'normal') as 'normal' | 'dialogue' | 'night',
    sourceChannels: canales,
  });

  const arrastrar = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const k of ['audio', 'audiomode', 'downmix', 'normalize', 'audiodelay', 'token', 'surround']) {
      if (q[k] !== undefined) p.set(k, String(q[k]));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  app.get('/api/play/:fileId/hls/master.m3u8', async (req, reply) => {
    const fileId = Number((req.params as { fileId: string }).fileId);
    const row = fileRow(fileId);
    if (!row) return reply.code(404).send({ error: 'Fichero no encontrado' });
    const info = await mediaInfo(fileId);
    const q = req.query as Record<string, string | undefined>;
    const audioIndexMaestro = q.audio !== undefined ? Number(q.audio) : info.audio.find((a) => a.default)?.streamIndex ?? info.audio[0]?.streamIndex ?? 0;

    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'no-store')
      .send(listaMaestra(fileId, info, arrastrar(q), audioEnvolvente(info, audioIndexMaestro, q.surround === '1')));
  });

  app.get('/api/play/:fileId/hls/:calidad.m3u8', async (req, reply) => {
    const fileId = Number((req.params as { fileId: string }).fileId);
    const calidad = (req.params as { calidad: string }).calidad;
    const row = fileRow(fileId);
    if (!row) return reply.code(404).send({ error: 'Fichero no encontrado' });
    const info = await mediaInfo(fileId);
    if (!escalera(info).some((c) => c.nombre === calidad)) return reply.code(404).send({ error: 'Calidad desconocida' });

    return reply
      .header('Content-Type', 'application/vnd.apple.mpegurl')
      .header('Cache-Control', 'no-store')
      .send(listaDeCalidad(fileId, calidad, info, arrastrar(req.query as Record<string, string | undefined>)));
  });

  app.get('/api/play/:fileId/hls/:calidad/:n.ts', async (req, reply) => {
    const fileId = Number((req.params as { fileId: string }).fileId);
    const { calidad, n } = req.params as { calidad: string; n: string };
    const q = req.query as Record<string, string | undefined>;

    const row = fileRow(fileId);
    if (!row) return reply.code(404).send({ error: 'Fichero no encontrado' });
    const info = await mediaInfo(fileId);

    const cal = CALIDADES.find((c) => c.nombre === calidad);
    if (!cal) return reply.code(404).send({ error: 'Calidad desconocida' });

    const audioIndex = q.audio !== undefined ? Number(q.audio) : info.audio.find((a) => a.default)?.streamIndex ?? info.audio[0]?.streamIndex ?? 0;

    try {
      const datos = await segmento({
        fileId,
        path: row.path,
        info,
        calidad: cal,
        segmento: Number(n),
        audioStreamIndex: audioIndex,
        audioOptions: opcionesAudio(q, info.audio.find((a) => a.streamIndex === audioIndex)?.channels ?? 2),
        audioDelayMs: Math.max(-10_000, Math.min(10_000, Number(q.audiodelay ?? 0))),
        surround: q.surround === '1',
        dispositivo: sesionDe(req),
      });
      return reply.header('Content-Type', 'video/mp2t').header('Cache-Control', 'no-store').send(datos);
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  app.post('/api/play/:fileId/hls/cerrar', async (req) => {
    cerrarSesiones(Number((req.params as { fileId: string }).fileId));
    return { ok: true };
  });

  app.get('/api/play/:fileId/subtitle/:trackId', async (req, reply) => {
    const { fileId, trackId } = req.params as { fileId: string; trackId: string };
    const id = trackId.replace(/\.vtt$/, '');
    // `desde`: el vídeo va por tubería cortado en ese segundo, y los tiempos
    // tienen que ir restados para que cuadren. Sin él, tal cual.
    const consulta = req.query as { desde?: string; retardo?: string };
    const desde = Math.max(0, Number(consulta.desde ?? 0) || 0);
    /*
     * `retardo`: el desfase que pide el usuario, en milisegundos y con signo
     * (positivo = más tarde). Mismo tope de ±10 s que el desfase de audio y
     * que el ajuste de la tele. Se suma al corte de la tubería, que va
     * restado, así que el ajuste final es uno solo.
     */
    const retardoMs = Math.max(-10_000, Math.min(10_000, Number(consulta.retardo ?? 0) || 0));
    const ajuste = retardoMs / 1000 - desde;
    reply.header('Content-Type', 'text/vtt; charset=utf-8').header('Cache-Control', 'public, max-age=86400');

    if (id.startsWith('external-')) {
      // Sin el `file_id = ?`, adivinar el id (autoincremental y pequeño) de la
      // pista de subtítulo externo de OTRO fichero la servía igual aunque el
      // fileId de la URL fuera distinto.
      const row = db.prepare('SELECT external FROM sub_tracks WHERE id = ? AND file_id = ?').get(Number(id.slice(9)), Number(fileId)) as { external: string } | undefined;
      if (!row?.external) return reply.code(404).send('');
      const text = decodeText(readFileSync(row.external));
      if (row.external.toLowerCase().endsWith('.vtt')) return reply.send(desplazarVtt(text, ajuste));
      if (/\.(ass|ssa)$/i.test(row.external)) {
        const proc = spawn(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', row.external, '-f', 'webvtt', 'pipe:1'], { windowsHide: true });
        proc.on('error', (e) => console.error('[subtitulos] no arrancó ffmpeg:', e.message));
        // Si el cliente se va antes de terminar, que no quede ffmpeg suelto.
        req.raw.on('close', () => proc.kill('SIGKILL'));
        if (ajuste !== 0) return reply.send(desplazarVtt(await recoger(proc), ajuste));
        return reply.send(proc.stdout);
      }
      return reply.send(desplazarVtt(srtToVtt(text), ajuste));
    }

    if (id.startsWith('embedded-')) {
      const streamIndex = Number(id.slice(9));
      const file = db.prepare('SELECT path FROM media_files WHERE id = ?').get(Number(fileId)) as { path: string } | undefined;
      if (!file) return reply.code(404).send('');
      const proc = spawn(
        config.ffmpeg,
        ['-hide_banner', '-loglevel', 'error', '-i', file.path, '-map', `0:${streamIndex}`, '-f', 'webvtt', 'pipe:1'],
        { windowsHide: true },
      );
      proc.on('error', (e) => console.error('[subtitulos] no arrancó ffmpeg:', e.message));
      req.raw.on('close', () => proc.kill('SIGKILL'));
      if (ajuste !== 0) return reply.send(desplazarVtt(await recoger(proc), ajuste));
      return reply.send(proc.stdout);
    }

    return reply.code(400).send('');
  });

  app.get('/api/play/:fileId/trickplay', async (req, reply) => {
    const fileId = Number((req.params as { fileId: string }).fileId);

    /*
     * `solo=1`: mirar sin fabricar. Lo usa el reproductor, porque generar la
     * tira de una película obliga a recorrerla entera leyendo fotogramas clave
     * y eso, en el disco del que se está sirviendo el vídeo, deja la
     * reproducción sin datos. Las tiras se hacen por lotes, cuando no hay nadie
     * viendo nada.
     */
    const soloLeer = (req.query as { solo?: string }).solo === '1';
    const manifest = soloLeer ? readManifest(fileId) : ensure(fileId);
    if (manifest) return reply.header('Cache-Control', 'public, max-age=86400').send(manifest);
    return reply.code(202).send({ generating: isGenerating(fileId) });
  });

  app.get('/api/play/:fileId/trickplay/:index', async (req, reply) => {
    const { fileId, index } = req.params as { fileId: string; index: string };
    const path = sheetPath(Number(fileId), Number(index.replace(/\.jpg$/, '')));
    if (!existsSync(path)) return reply.code(404).send({ error: 'Hoja no generada' });
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'public, max-age=2592000')
      .send(createReadStream(path));
  });

  app.get('/api/trickplay/estado', async (req) => {
    requireUser(req);
    return { lote };
  });

  app.post('/api/trickplay/lote', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede generarlas' });
    const { todo } = (req.body ?? {}) as { todo?: boolean };
    try {
      const total = generarLote(Boolean(todo));
      return { started: true, total };
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.post('/api/trickplay/parar', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede pararlo' });
    return { parando: pararLote() };
  });

  app.get('/api/play/:fileId/offsets', async (req) => {
    const fileId = Number((req.params as { fileId: string }).fileId);
    const rows = db.prepare('SELECT track_id, offset_ms, sigma, method FROM sub_offsets WHERE file_id = ?').all(fileId) as any[];
    return Object.fromEntries(rows.map((r) => [r.track_id, { offsetMs: r.offset_ms, sigma: r.sigma, method: r.method }]));
  });

  /*
   * El desfase de audio y la remedición son de todos: se guardan por fichero,
   * no por perfil, así que un invitado no puede tocarlos. Lo mismo con cortar
   * sesiones ajenas.
   */
  app.post('/api/play/:fileId/offsets/:trackId', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    const { fileId, trackId } = req.params as { fileId: string; trackId: string };
    const { offsetMs } = req.body as { offsetMs: number };
    if (offsetMs === 0) clearOffset(Number(fileId), trackId);
    else saveOffset(Number(fileId), trackId, offsetMs, 'manual', null);
    return { ok: true, offsetMs };
  });

  app.post('/api/play/:fileId/resync/:trackId', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    const { fileId, trackId } = req.params as { fileId: string; trackId: string };
    const { audio } = req.body as { audio?: number };
    const id = Number(fileId);

    if (isMeasuring(id, trackId)) return reply.code(409).send({ error: 'Ya se está midiendo esta pista' });

    const info = await mediaInfo(id);
    const audioIndex = audio ?? info.audio.find((a) => a.default)?.streamIndex ?? info.audio[0]?.streamIndex ?? 1;
    // Measuring reads the whole audio track, so it runs long; the client polls.
    measure(id, trackId, audioIndex).catch(() => undefined);
    return { started: true };
  });

  app.get('/api/play/:fileId/resync/:trackId', async (req) => {
    const { fileId, trackId } = req.params as { fileId: string; trackId: string };
    const id = Number(fileId);
    const stored = offsetFor(id, trackId);
    return {
      measuring: isMeasuring(id, trackId),
      offsetMs: stored?.offset_ms ?? null,
      sigma: stored?.sigma ?? null,
      method: stored?.method ?? null,
    };
  });

  app.get('/api/episodes/:id/skip', async (req) => {
    return { ranges: skipRangesFor(Number((req.params as { id: string }).id)) };
  });

  app.get('/api/skip/status', async () => ({ job, shows: showsWithRanges() }));

  app.post('/api/skip/detect', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede lanzar la detección' });
    const { showId, kind } = req.body as { showId: number; kind?: 'cabecera' | 'creditos' };
    try {
      detectForShow(showId, kind ?? 'cabecera');
      return { started: true };
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.post('/api/skip/detect-todo', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede lanzar la detección' });
    const { todas } = (req.body ?? {}) as { todas?: boolean };
    try {
      detectarTodas(!todas);
      return { started: true, total: job.total };
    } catch (err) {
      return reply.code(409).send({ error: (err as Error).message });
    }
  });

  app.post('/api/skip/parar', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede pararla' });
    return { parando: pararDeteccion() };
  });

  app.get('/api/sessions', async () => {
    return [...sessions.values()].map((s) => ({
      id: s.id,
      title: s.title,
      mode: s.plan.mode,
      reasons: s.plan.reasons,
      startedAt: new Date(s.startedAt).toISOString(),
      startSeconds: s.startSeconds,
      userId: s.userId,
    }));
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    stopSession((req.params as { id: string }).id);
    return { ok: true };
  });
}
