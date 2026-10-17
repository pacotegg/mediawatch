import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import type HlsInstancia from 'hls.js';
import { api, enRedLocal, hlsUrl, img, streamUrl, subtitleSync, subtitleUrl, trickplaySheet, type PlayInfo, type Trickplay } from '../lib/api.ts';
import { escritorio } from '../lib/escritorio.ts';
import { clock, languageName } from '../lib/format.ts';
import { subtitleCss, usePreferences } from '../lib/preferences.tsx';
import { applyCues, parseVtt, type Cue } from '../lib/vtt.ts';
import { volver } from '../lib/volver.ts';
import { ChapterTray } from '../components/ChapterTray.tsx';

const HIDE_AFTER_MS = 3200;
const SAVE_EVERY_MS = 10_000;

const QUALITIES = [
  { label: 'Original', value: 0 },
  { label: '1080p', value: 1080 },
  { label: '720p', value: 720 },
  { label: '480p', value: 480 },
];

function Icon({ path, size = 22 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/** Nearest tile to a time, over an unevenly spaced strip (tiles follow keyframes). */
function nearestTile(times: number[], target: number): number {
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low > 0 && Math.abs(times[low - 1] - target) < Math.abs(times[low] - target) ? low - 1 : low;
}

function ScrubPreview({ trickplay, fileId, time, x }: { trickplay: Trickplay; fileId: number; time: number; x: number }) {
  const index = nearestTile(trickplay.times, time);
  const sheet = Math.floor(index / (trickplay.columns * trickplay.rows));
  const within = index % (trickplay.columns * trickplay.rows);
  const col = within % trickplay.columns;
  const row = Math.floor(within / trickplay.columns);

  return (
    <div
      className="pointer-events-none absolute bottom-full mb-3 -translate-x-1/2"
      style={{ left: `${x}px` }}
    >
      <div
        className="overflow-hidden rounded-lg ring-1 ring-white/25 shadow-[var(--shadow-3)]"
        style={{
          width: trickplay.tileWidth,
          height: trickplay.tileHeight,
          backgroundImage: `url(${trickplaySheet(fileId, sheet)})`,
          backgroundPosition: `-${col * trickplay.tileWidth}px -${row * trickplay.tileHeight}px`,
        }}
      />
      <div className="mt-1 text-center font-mono text-[11px] text-white tabular-nums text-shadow-hero">{clock(time)}</div>
    </div>
  );
}

function Menu({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="glass-strong absolute right-0 bottom-14 z-50 max-h-[52vh] w-64 overflow-y-auto rounded-2xl p-2"
      >
        <div className="px-3 py-2 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">{title}</div>
        {children}
      </motion.div>
    </>
  );
}

function MenuItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/8 ${
        active ? 'text-accent' : 'text-mist-200'
      }`}
    >
      <span className="truncate">{children}</span>
      {active && <Icon path="M4 12.5 9.5 18 20 6.5" size={14} />}
    </button>
  );
}

/**
 * Dentro del cliente de escritorio la película se abre en mpv, que lee casi todo sin que el servidor transcodifique.
 * Si no se puede (sin mpv, sin sesión…) o se pide `?web=1`, se cae al reproductor del navegador de siempre.
 */
/** Reintentar la información solo si es un fallo de red o del servidor: un 403, 404 o 410 no va a cambiar. */
const reintentarInfo = (veces: number, e: unknown) => {
  const status = (e as { status?: number }).status;
  return veces < 2 && (status === undefined || status >= 500);
};

export default function Player() {
  const { fileId: fileIdParam } = useParams<{ fileId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fileId = Number(fileIdParam);
  const itemId = Number(params.get('item'));
  const lanzado = useRef(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const enVentanaDeVideo = params.get('escritorio') === '1';
  const aEscritorio = Boolean(escritorio()) && !enVentanaDeVideo && params.get('web') !== '1' && itemId > 0 && fallo === null;
  const { data: info, error: errorInfo } = useQuery<PlayInfo>({ queryKey: ['play', fileId], queryFn: () => api.playInfo(fileId), staleTime: Infinity, enabled: aEscritorio, retry: reintentarInfo });
  // Sin esto, un fallo al pedir la información dejaba «Abriendo el vídeo…» para siempre.
  // Solo en el cliente de escritorio: la consulta es la misma que la del reproductor y su error llegaba aquí también.
  useEffect(() => { if (errorInfo && escritorio() && !enVentanaDeVideo) setFallo((errorInfo as Error).message); }, [errorInfo, enVentanaDeVideo]);

  useEffect(() => {
    if (!aEscritorio || !info || lanzado.current) return;
    lanzado.current = true;
    const guardadoAudio = Number(info.savedAudio);
    escritorio()!
      .reproducir({
        fileId,
        itemId,
        episodeId: params.get('ep') ? Number(params.get('ep')) : null,
        start: Number(params.get('t') ?? 0),
        title: info.title,
        audio: Number.isInteger(guardadoAudio) ? guardadoAudio : null,
        subtitulo: info.savedSubtitle ?? null,
        externos: info.subtitles.filter((s) => s.source === 'external').map((s) => ({ id: s.id })),
      })
      // La ventana de vídeo se abre aparte y se cierra sola; aquí se vuelve a la ficha.
      .then((r) => { if (r.ok) volver(navigate, `/titulo/${itemId}`); else setFallo(r.error ?? 'No se pudo abrir el vídeo'); })
      .catch((e) => setFallo(String(e)));
  }, [aEscritorio, info, fileId, itemId, params, navigate]);

  if (enVentanaDeVideo) return <PlayerWeb aviso={null} conMpv />;
  if (!aEscritorio) return <PlayerWeb aviso={fallo} />;
  return <div className="flex h-screen items-center justify-center bg-black text-white/70">Abriendo el vídeo…</div>;
}

/**
 * El mismo reproductor para los dos sitios. En el navegador pinta un `<video>`; en la ventana de vídeo del
 * cliente de escritorio (`conMpv`) la imagen la pone mpv por detrás y esto son solo los controles, que son
 * los mismos. Las órdenes van por el puente y el estado vuelve por él.
 */
function PlayerWeb({ aviso, conMpv = false }: { aviso: string | null; conMpv?: boolean }) {
  const { fileId: fileIdParam } = useParams<{ fileId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fileId = Number(fileIdParam);
  const itemId = Number(params.get('item'));
  const episodeId = params.get('ep') ? Number(params.get('ep')) : null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>(0);
  const cuesRef = useRef<Cue[]>([]);
  const trackRef = useRef<TextTrack | null>(null);

  const { prefs, update } = usePreferences();
  // El puente con mpv. Fuera de la ventana de vídeo no existe y todo va por el `<video>` de siempre.
  const mpv = conMpv ? escritorio() : undefined;
  const playingRef = useRef(false);

  // Always honour an explicit `t`: it also carries deep links from a dialogue
  // search, which must jump to the line whatever the resume preference says.
  const [offset, setOffset] = useState(Number(params.get('t') ?? 0));
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  // El volumen se recuerda en este equipo (no en el perfil: lo que suena bien en el PC no es lo de la tele del salón).
  const [volume, setVolume] = useState(() => {
    try {
      const v = Number(localStorage.getItem('mw.volumen'));
      if (localStorage.getItem('mw.volumen') !== null && Number.isFinite(v) && v >= 0 && v <= 1) return v;
    } catch { /* sin almacenamiento: el de siempre */ }
    return prefs.audio.defaultVolume;
  });
  // Solo cuando se toca el volumen: guardar el de arranque dejaría fijo el valor por defecto de Ajustes en este equipo.
  const volumenInicial = useRef(true);
  useEffect(() => {
    if (volumenInicial.current) { volumenInicial.current = false; return; }
    try { localStorage.setItem('mw.volumen', String(volume)); } catch { /* sin almacenamiento */ }
  }, [volume]);
  const [muted, setMuted] = useState(false);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<'audio' | 'subs' | 'quality' | 'chapters' | 'info' | null>(null);
  const [audioTrack, setAudioTrack] = useState<number | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [maxHeight, setMaxHeight] = useState(prefs.playback.maxHeight);
  const [scrubbing, setScrubbing] = useState(false);
  const [hover, setHover] = useState<{ time: number; x: number } | null>(null);
  const trackInitRef = useRef(false);
  const audioTrackRef = useRef(audioTrack);
  audioTrackRef.current = audioTrack;
  const subtitleRef = useRef(subtitle);
  subtitleRef.current = subtitle;
  const [subDelayMs, setSubDelayMs] = useState(0);
  const [audioDelayMs, setAudioDelayMs] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  const { data: info, refetch: refetchInfo, error: errorInfo } = useQuery<PlayInfo>({ queryKey: ['play', fileId], queryFn: () => api.playInfo(fileId), staleTime: Infinity, retry: reintentarInfo });
  // La busqueda en internet necesita subsfetch.py, que solo existe en el HTPC.
  const { data: subsDisp } = useQuery({ queryKey: ['subs-available'], queryFn: () => api.subtitlesAvailable(), staleTime: Infinity });
  interface CandidatoSubtitulo {
    id: string;
    provider: string;
    providerId: number;
    language: string;
    release: string;
    downloads: number;
    rating: number;
    forced: boolean;
    hearingImpaired: boolean;
    comment: string;
  }
  const [modalCandidatos, setModalCandidatos] = useState(false);
  const [candidatos, setCandidatos] = useState<CandidatoSubtitulo[]>([]);
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [buscandoSubs, setBuscandoSubs] = useState(false);
  const [watchNextCancelado, setWatchNextCancelado] = useState(false);
  const [cuentaAtrasNext, setCuentaAtrasNext] = useState(12);

  const buscarSubtitulos = async () => {
    setBuscandoSubs(true);
    setModalCandidatos(true);
    setCandidatos([]);
    try {
      const res = await api.subtitlesSearch<{ ok: boolean; candidates: CandidatoSubtitulo[] }>({
        fileId,
        languages: 'es,en',
      });
      if (res.ok && res.candidates) {
        setCandidatos(res.candidates);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBuscandoSubs(false);
    }
  };

  const descargarCandidato = async (c: CandidatoSubtitulo) => {
    setDescargandoId(c.id);
    try {
      const res = await api.subtitlesDownload<{ ok: boolean; trackId?: string }>({
        fileId,
        provider: c.provider,
        subId: c.providerId,
        language: c.language,
        release: c.release,
        forced: c.forced,
      });
      if (res.ok) {
        await refetchInfo();
        if (res.trackId) {
          setSubtitle(res.trackId);
        }
        setModalCandidatos(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDescargandoId(null);
    }
  };
  // Quién mira: la medición automática de subtítulos se guarda para todos, así que es cosa del administrador.
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });

  /*
   * Avisos del administrador mientras se ve algo: un mensaje que se enseña
   * ocho segundos, o «para», que devuelve a la ficha. Se pregunta cada cinco
   * segundos; si el servidor no contesta, no pasa nada.
   */
  /** Salir del reproductor: en la ventana de vídeo del escritorio se cierra la ventana entera. */
  const salir = useCallback(() => {
    if (mpv) void mpv.video('cerrar');
    else volver(navigate, itemId ? `/titulo/${itemId}` : '/');
  }, [mpv, navigate, itemId]);

  const [avisoAdmin, setAvisoAdmin] = useState('');
  const parandoRef = useRef(false);
  useEffect(() => {
    const t = window.setInterval(async () => {
      try {
        const r = await api.mando();
        if (r.mensaje) {
          setAvisoAdmin(r.mensaje);
          window.setTimeout(() => setAvisoAdmin(''), 8000);
        }
        if (r.parar && !parandoRef.current) {
          // Una sola salida: con el límite agotado, cada pregunta (cada 5 s) vuelve a traer «parar».
          parandoRef.current = true;
          videoRef.current?.pause();
          if (mpv) void mpv.video('pausa', true);
          // Con motivo (p. ej. «Se ha acabado el tiempo de hoy»), que se lea antes de salir.
          if (r.mensaje) window.setTimeout(salir, 4000);
          else salir();
        }
      } catch { /* sin red, sin avisos */ }
    }, 5000);
    return () => window.clearInterval(t);
  }, [salir]);
  const { data: show } = useQuery({ queryKey: ['item', itemId], queryFn: () => api.item(itemId), enabled: Boolean(itemId && episodeId) });
  // La ficha entera solo para saber si hay disco; es la misma consulta que la ficha, así que suele estar en caché.
  const { data: ficha } = useQuery({ queryKey: ['item', itemId], queryFn: () => api.item(itemId), enabled: Boolean(itemId) });

  const { data: skip } = useQuery({
    queryKey: ['skip', episodeId],
    queryFn: () => api.skipRanges(episodeId!),
    enabled: Boolean(episodeId),
    staleTime: Infinity,
  });

  /*
   * Una sola pregunta. Antes se repetía cada 5 s hasta que hubiera miniaturas, pensando que pedirlas las
   * fabricaba; no es así —las hace el lote, que además se aparta mientras alguien ve algo—, así que en
   * una película sin ellas se preguntaba toda la sesión: medido en el registro de Caddy, 5.142 respuestas
   * 404 desde el navegador, 2.815 de ellas para un único fichero (15/10/2026). Si el lote las hace luego,
   * se ven la próxima vez que se abra.
   */
  const { data: trickplay } = useQuery({
    queryKey: ['trickplay', fileId],
    queryFn: () => api.trickplay(fileId),
    staleTime: 10 * 60_000,
  });

  const nextEpisode = (() => {
    if (!episodeId || !show?.episodes) return null;
    const index = show.episodes.findIndex((e) => e.id === episodeId);
    return index >= 0 ? (show.episodes.slice(index + 1).find((e) => e.file_id) ?? null) : null;
  })();

  /*
   * HLS solo cuando hace falta. Dentro de casa la tubería directa gana: una
   * conexión, sin trocear y sin recodificar. Fuera, HLS baja la calidad sola si
   * la línea no da y reintenta trozo a trozo en vez de tumbar la película.
   */
  const adaptativo = prefs.playback.adaptativo ?? 'auto';
  const usaHls = adaptativo === 'siempre' || (adaptativo === 'auto' && !enRedLocal());

  // Con HLS la lista cubre la película entera, así que saltar es instantáneo y
  // no hay que recargar la fuente como con la tubería transcodificada.
  const isTimeshift = conMpv ? false : usaHls ? false : info ? info.plan.mode !== 'direct' : true;
  const virtual = (isTimeshift ? offset : 0) + current;
  const duration = info?.duration ?? 0;
  const finishTime = (() => {
    if (!duration || duration <= virtual) return null;
    const remainingSecs = Math.max(0, duration - virtual);
    const date = new Date(Date.now() + remainingSecs * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  })();

  // Arrancar con la pista guardada, la marcada por defecto o la primera; restaurar subtítulos si se eligieron.
  useEffect(() => {
    if (!info) return;
    if (audioTrack === null) {
      const savedId = info.savedAudio != null ? Number(info.savedAudio) : null;
      const exists = savedId !== null && info.audio.some((a) => a.id === savedId);
      setAudioTrack(exists ? savedId! : (info.audio.find((a) => a.default)?.id ?? info.audio[0]?.id ?? 0));
    }
    if (!trackInitRef.current) {
      trackInitRef.current = true;
      if (info.savedSubtitle && info.savedSubtitle !== 'off') {
        const exists = info.subtitles.some((s) => s.id === info.savedSubtitle);
        if (exists) setSubtitle(info.savedSubtitle);
      }
    }
  }, [info, audioTrack]);

  const src =
    info && audioTrack !== null
      ? usaHls
        ? hlsUrl(fileId, {
            audio: audioTrack,
            downmix: prefs.audio.downmixStereo,
            normalize: prefs.audio.normalize,
            audioMode: prefs.audio.mode,
            audioDelayMs,
          })
        : streamUrl(fileId, {
          t: isTimeshift ? offset : 0,
          audio: audioTrack,
          maxHeight: maxHeight || undefined,
          downmix: prefs.audio.downmixStereo,
          normalize: prefs.audio.normalize,
          audioMode: prefs.audio.mode,
            audioDelayMs,
          })
      : '';

  /*
   * Dónde empezar cada vez que se carga la fuente. Con el flujo transcodificado la posición va dentro de la URL (`t`);
   * con reproducción directa y con HLS no, y la fuente arrancaba SIEMPRE en el segundo cero: «Continuar viendo»
   * (`?t=`), una búsqueda de diálogos y cambiar de pista de audio o de calidad a mitad de película volvían al principio.
   * Medido con un vídeo directo y `t=60`: a los 6 s iba por el segundo 7,6.
   */
  const inicioRef = useRef(offset);
  inicioRef.current = offset;
  const timeshiftRef = useRef(isTimeshift);
  timeshiftRef.current = isTimeshift;

  // Reloading the source is how seeking works while transcoding, so restore playback after it lands.
  useEffect(() => {
    const video = videoRef.current;
    if (conMpv || !video || !src) return;

    const inicio = timeshiftRef.current ? 0 : inicioRef.current;
    let alCargar: (() => void) | null = null;
    // Para `<video>` (directo y HLS nativo): al conocer la duración, saltar al sitio. hls.js usa `startPosition`.
    const irAlInicio = () => {
      if (inicio <= 1) return;
      alCargar = () => {
        alCargar = null;
        video.currentTime = Number.isFinite(video.duration) && video.duration > 3 ? Math.min(inicio, video.duration - 2) : inicio;
      };
      video.addEventListener('loadedmetadata', alCargar, { once: true });
    };
    const quitarInicio = () => { if (alCargar) video.removeEventListener('loadedmetadata', alCargar); };

    if (!usaHls) {
      video.src = src;
      irAlInicio();
      video.load();
      video.play().catch(() => undefined);
      return quitarInicio;
    }

    // hls.js pesa ~500 KB y solo hace falta fuera de casa (o con «adaptativo: siempre»): se baja
    // aquí, no con el reproductor. `cancelado` cubre cerrar el reproductor mientras aún carga.
    let cancelado = false;
    let hls: HlsInstancia | null = null;
    const nativo = () => {
      video.src = src;
      irAlInicio();
      video.load();
      video.play().catch(() => undefined);
    };

    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelado) return;
        // Safari y iOS reproducen HLS de fábrica y lo hacen mejor que la biblioteca.
        if (!Hls.isSupported()) {
          nativo();
          return;
        }

        const h = new Hls({
          // Un trozo tarda en fabricarse: sin margen, el reproductor lo da por
          // perdido antes de que el servidor lo haya terminado de codificar.
          fragLoadingTimeOut: 45_000,
          manifestLoadingTimeOut: 20_000,
          fragLoadingMaxRetry: 6,
          levelLoadingMaxRetry: 6,
          // Empezar por abajo y subir: es preferible que arranque enseguida a que
          // se quede pensando para acabar bajando igual.
          startLevel: -1,
          maxBufferLength: 30,
          startPosition: inicio > 1 ? inicio : -1,
        });
        hls = h;

        h.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          // Un fallo de red no debe tumbar la reproducción: se reintenta, que es
          // justamente para lo que se trocea.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
          else h.destroy();
        });

        h.loadSource(src);
        h.attachMedia(video);
        h.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => undefined));
      })
      // Si no se pudo bajar la biblioteca (sin conexión, despliegue nuevo), se intenta el HLS nativo.
      .catch(() => {
        if (!cancelado) nativo();
      });

    return () => {
      cancelado = true;
      quitarInicio();
      hls?.destroy();
      // Libera la GPU en el servidor en cuanto se cierra el reproductor.
      navigator.sendBeacon?.(`/api/play/${fileId}/hls/cerrar`);
    };
  }, [src, usaHls, fileId, conMpv]);

  const seek = useCallback(
    (target: number) => {
      const video = videoRef.current;
      if (!info) return;
      const clamped = Math.max(0, Math.min(duration - 1, target));
      if (mpv) {
        setCurrent(clamped);
        void mpv.video('buscar', clamped);
        return;
      }
      if (!video) return;
      if (!isTimeshift) {
        video.currentTime = clamped;
        return;
      }
      setBuffering(true);
      setOffset(clamped);
      setCurrent(0);
    },
    [duration, info, isTimeshift, mpv],
  );

  const togglePlay = useCallback(() => {
    if (mpv) { void mpv.video('pausa', playingRef.current); return; }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }, [mpv]);

  // Imagen sobre imagen: el vídeo sigue en una ventanita mientras se usa otra cosa. Solo con `<video>` (no con mpv).
  const hayPip = !mpv && typeof document !== 'undefined' && document.pictureInPictureEnabled;
  const togglePip = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else void video.requestPictureInPicture().catch(() => undefined);
  }, []);

  const changeDelay = useCallback(
    (nextMs: number) => {
      setSubDelayMs(nextMs);
      setSyncNote(nextMs === 0 ? '' : 'ajustado a mano');
      if (subtitle) subtitleSync.setOffset(fileId, subtitle, nextMs).catch(() => undefined);
    },
    [fileId, subtitle],
  );

  const [isFullscreen, setIsFullscreen] = useState(false);

  const showControls = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (playingRef.current || !videoRef.current?.paused) setControls(false);
    }, HIDE_AFTER_MS);
  }, []);

  const hideControls = useCallback(() => {
    setControls(false);
    window.clearTimeout(hideTimer.current);
    setMenu(null);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current as any;
    const video = videoRef.current as any;
    const doc = document as any;

    const isFs = Boolean(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement ||
      video?.webkitDisplayingFullscreen
    );

    if (isFs) {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => undefined);
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      } else if (video?.webkitExitFullscreen) {
        video.webkitExitFullscreen();
      }
    } else {
      if (container?.requestFullscreen) {
        container.requestFullscreen().catch(() => {
          video?.webkitEnterFullscreen?.();
        });
      } else if (container?.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      } else if (video?.webkitEnterFullscreen) {
        // Fallback para iOS Safari (iPhone)
        video.webkitEnterFullscreen();
      }
    }
  }, []);

  useEffect(() => {
    const checkFs = () => {
      const doc = document as any;
      const video = videoRef.current as any;
      const isFs = Boolean(
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement ||
        video?.webkitDisplayingFullscreen
      );
      setIsFullscreen(isFs);
    };

    const doc = document;
    doc.addEventListener('fullscreenchange', checkFs);
    doc.addEventListener('webkitfullscreenchange', checkFs);

    const video = videoRef.current;
    if (video) {
      video.addEventListener('webkitbeginfullscreen', checkFs);
      video.addEventListener('webkitendfullscreen', checkFs);
    }

    return () => {
      doc.removeEventListener('fullscreenchange', checkFs);
      doc.removeEventListener('webkitfullscreenchange', checkFs);
      if (video) {
        video.removeEventListener('webkitbeginfullscreen', checkFs);
        video.removeEventListener('webkitendfullscreen', checkFs);
      }
    };
  }, []);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      showControls();
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          seek(virtual + (e.shiftKey ? prefs.playback.seekStepLarge : prefs.playback.seekStep));
          break;
        case 'ArrowLeft':
          seek(virtual - (e.shiftKey ? prefs.playback.seekStepLarge : prefs.playback.seekStep));
          break;
        case 'ArrowUp':
          setVolume((v) => Math.min(1, v + 0.1));
          break;
        case 'ArrowDown':
          setVolume((v) => Math.max(0, v - 0.1));
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          setMuted((m) => !m);
          break;
        case 'p':
          if (hayPip) togglePip();
          break;
        case 'g':
          if (subtitle) changeDelay(subDelayMs - 100);
          break;
        case 'h':
          if (subtitle) changeDelay(subDelayMs + 100);
          break;
        case 'c':
        case 'C':
          if (info?.chapters && info.chapters.length > 1) {
            setMenu((m) => (m === 'chapters' ? null : 'chapters'));
          }
          break;
        case 'Escape':
          if (menu !== null) {
            setMenu(null);
          } else if (mpv || !isFullscreen) {
            salir();
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, seek, showControls, togglePlay, virtual, prefs.playback.seekStep, prefs.playback.seekStepLarge, changeDelay, subDelayMs, subtitle, mpv, hayPip, togglePip, menu, info?.chapters, toggleFullscreen, isFullscreen]);

  useEffect(() => {
    if (mpv) {
      void mpv.video('volumen', volume);
      void mpv.video('silencio', muted);
      return;
    }
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = muted;
    }
  }, [volume, muted, mpv]);

  // Al pasar al siguiente episodio con el botón, este queda visto: el guardado de limpieza al desmontar (92 % de la
  // película, no «visto») lo desharía. La marca se apaga al cambiar de fichero.
  const marcadoVistoRef = useRef(false);
  useEffect(() => { marcadoVistoRef.current = false; }, [fileId]);

  // Persist position so "continue watching" survives a reload or a jump to another device.
  useEffect(() => {
    if (!itemId || conMpv) return;
    const save = () => {
      if (marcadoVistoRef.current) return;
      const position = (isTimeshift ? offset : 0) + (videoRef.current?.currentTime ?? 0);
      if (position > 5) {
        api.saveProgress({
          itemId,
          episodeId,
          position,
          duration,
          audio: audioTrackRef.current,
          subtitle: subtitleRef.current ?? 'off',
        }).catch(() => undefined);
      }
    };
    const timer = window.setInterval(save, SAVE_EVERY_MS);
    window.addEventListener('beforeunload', save);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [duration, episodeId, isTimeshift, itemId, offset, conMpv]);

  // Subtitle cues are fetched once, then re-applied whenever the timeline shifts.
  useEffect(() => {
    if (mpv) { void mpv.video('subtitulo', subtitle ?? 'off'); return; }
    const video = videoRef.current;
    if (!video) return;

    if (!subtitle) {
      cuesRef.current = [];
      if (trackRef.current) trackRef.current.mode = 'hidden';
      return;
    }

    let cancelled = false;
    fetch(subtitleUrl(fileId, subtitle))
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return;
        cuesRef.current = parseVtt(text);
        if (!trackRef.current) trackRef.current = video.addTextTrack('subtitles', 'Subtítulos', 'es');
        trackRef.current.mode = 'showing';
        applyCues(trackRef.current, cuesRef.current, isTimeshift ? offset : 0);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [fileId, subtitle, mpv]);

  useEffect(() => {
    if (mpv) { void mpv.video('subDelay', subDelayMs); return; }
    if (trackRef.current && cuesRef.current.length > 0) {
      applyCues(trackRef.current, cuesRef.current, isTimeshift ? offset : 0, subDelayMs / 1000);
    }
  }, [offset, isTimeshift, subDelayMs, mpv]);

  // A stored correction belongs to the file/track pair, so pick it up on switch.
  useEffect(() => {
    setSyncNote('');
    if (!subtitle) {
      setSubDelayMs(0);
      return;
    }
    subtitleSync
      .state(fileId, subtitle)
      .then((s) => {
        setSubDelayMs(s.offsetMs ?? 0);
        if (s.offsetMs) setSyncNote(s.method === 'auto' ? `medido (${s.sigma?.toFixed(1)} sigma)` : 'ajustado a mano');
      })
      .catch(() => undefined);
  }, [fileId, subtitle]);

  const autoSync = useCallback(async () => {
    if (!subtitle || audioTrack === null) return;
    setSyncing(true);
    setSyncNote('midiendo contra el audio…');
    try {
      await subtitleSync.start(fileId, subtitle, audioTrack);
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((r) => setTimeout(r, 3000));
        const state = await subtitleSync.state(fileId, subtitle);
        if (state.measuring) continue;
        if (state.offsetMs !== null && state.method === 'auto') {
          setSubDelayMs(state.offsetMs);
          setSyncNote(`medido: ${(state.offsetMs / 1000).toFixed(2)} s (${state.sigma?.toFixed(1)} sigma)`);
        } else {
          setSyncNote('no se pudo demostrar la sincronía; ajústalo a mano');
        }
        break;
      }
    } finally {
      setSyncing(false);
    }
  }, [audioTrack, fileId, subtitle]);

  /*
   * Pasar al siguiente episodio dentro de la ventana de vídeo del escritorio: se piden las pistas guardadas del
   * siguiente, el proceso principal relanza mpv en el mismo marco y la página se recarga entera (así no queda
   * nada del anterior: pistas, retardo, miniaturas). Devuelve si lo ha conseguido.
   */
  const abrirSiguienteMpvRef = useRef<() => Promise<boolean>>(async () => false);
  abrirSiguienteMpvRef.current = async () => {
    const sig = nextEpisode;
    if (!mpv?.siguiente || !sig?.file_id) return false;
    try {
      const i = await api.playInfo(sig.file_id);
      const audio = Number(i.savedAudio);
      const r = await mpv.siguiente({
        fileId: sig.file_id, itemId, episodeId: sig.id, start: 0, title: i.title,
        audio: Number.isInteger(audio) ? audio : null,
        subtitulo: i.savedSubtitle ?? null,
        externos: i.subtitles.filter((x) => x.source === 'external').map((x) => ({ id: x.id })),
      });
      if (!r.ok) return false;
      window.location.replace(`/ver/${sig.file_id}?item=${itemId}&ep=${sig.id}&t=0&escritorio=1`);
      return true;
    } catch {
      return false;
    }
  };

  // El fichero llegó a su final en mpv (el escritorio ya lo ha dado por visto): como en el navegador, si el perfil
  // encadena episodios y hay otro se abre; si no, se cierra.
  const alAcabarRef = useRef<() => void>(() => undefined);
  alAcabarRef.current = () => {
    if (!prefs.playback.autoPlayNext) { salir(); return; }
    void abrirSiguienteMpvRef.current().then((ok) => { if (!ok) salir(); });
  };

  /*
   * «Siguiente episodio» a mano, desde el botón de los créditos: da este por visto y pasa al siguiente sin esperar a que
   * acabe (con mpv, en la misma ventana de vídeo).
   */
  const irAlSiguiente = () => {
    if (!nextEpisode?.file_id) return;
    marcadoVistoRef.current = true;
    if (itemId) {
      api.saveProgress({
        itemId, episodeId, position: duration, duration, watched: true,
        audio: audioTrackRef.current, subtitle: subtitleRef.current ?? 'off',
      }).catch(() => undefined);
    }
    if (mpv) { void abrirSiguienteMpvRef.current().then((ok) => { if (!ok) salir(); }); return; }
    navigate(`/ver/${nextEpisode.file_id}?item=${itemId}&ep=${nextEpisode.id}&t=0`, { replace: true });
  };

  // Tecla multimedia «siguiente» (teclado, auriculares) mientras se ve algo con mpv.
  useEffect(() => {
    if (!mpv?.alTecla) return;
    return mpv.alTecla((t) => { if (t === 'siguiente') void abrirSiguienteMpvRef.current(); });
  }, [mpv]);

  /*
   * Teclas multimedia, auriculares Bluetooth y controles del sistema (pantalla de bloqueo, centro de control):
   * título y carátula, saltar, y siguiente episodio. Con mpv no hay `<video>` y el navegador no lo ve; ahí las
   * teclas las atiende el proceso principal del escritorio.
   */
  const accionesRef = useRef({ virtual, seek, paso: prefs.playback.seekStep, siguiente: () => undefined as void });
  accionesRef.current = {
    virtual, seek, paso: prefs.playback.seekStep,
    siguiente: () => { if (nextEpisode?.file_id) navigate(`/ver/${nextEpisode.file_id}?item=${itemId}&ep=${nextEpisode.id}&t=0`, { replace: true }); },
  };
  const haySiguiente = Boolean(nextEpisode?.file_id);
  useEffect(() => {
    if (mpv || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const ep = episodeId ? ficha?.episodes?.find((e) => e.id === episodeId) : undefined;
    ms.metadata = new MediaMetadata({
      title: ep ? `T${ep.season}E${ep.episode} · ${ep.title ?? ''}`.trim() : info?.title ?? '',
      artist: ep ? ficha?.title ?? 'Media Watch' : ficha?.title && ficha.title !== info?.title ? ficha.title : 'Media Watch',
      artwork: itemId ? [{ src: img.poster(itemId, 512), sizes: '512x768', type: 'image/webp' }] : [],
    });
    const acciones: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => void videoRef.current?.play().catch(() => undefined)],
      ['pause', () => videoRef.current?.pause()],
      ['seekbackward', (d) => accionesRef.current.seek(accionesRef.current.virtual - (d.seekOffset ?? accionesRef.current.paso))],
      ['seekforward', (d) => accionesRef.current.seek(accionesRef.current.virtual + (d.seekOffset ?? accionesRef.current.paso))],
      ['seekto', (d) => { if (typeof d.seekTime === 'number') accionesRef.current.seek(d.seekTime); }],
      ['nexttrack', haySiguiente ? () => accionesRef.current.siguiente() : null],
    ];
    for (const [nombre, h] of acciones) { try { ms.setActionHandler(nombre, h); } catch { /* acción no soportada en este navegador */ } }
    return () => {
      for (const [nombre] of acciones) { try { ms.setActionHandler(nombre, null); } catch { /* idem */ } }
      ms.metadata = null;
    };
  }, [mpv, info?.title, ficha, itemId, episodeId, haySiguiente]);

  // Lo que va contando mpv: posición, pausa, carga y qué pistas tiene puestas.
  useEffect(() => {
    if (!mpv) return;
    return mpv.alEstado((e: unknown) => {
      const s = e as { tiempo: number; pausado: boolean; cargando: boolean; audio: number | null; subtitulo: string; fin?: boolean; acabado?: boolean };
      if (s.fin) { if (s.acabado) alAcabarRef.current(); return; }
      if (!scrubbing) setCurrent(s.tiempo ?? 0);
      playingRef.current = !s.pausado;
      setPlaying(!s.pausado);
      setBuffering(Boolean(s.cargando));
      if (typeof s.audio === 'number') setAudioTrack(s.audio);
      setSubtitle(s.subtitulo && s.subtitulo !== 'off' ? s.subtitulo : null);
    });
  }, [mpv, scrubbing]);

  // Cambiar de pista de audio: con mpv es inmediato, sin recargar la fuente.
  useEffect(() => {
    if (mpv && audioTrack !== null) void mpv.video('audio', audioTrack);
  }, [mpv, audioTrack]);

  const progressPct = duration ? (virtual / duration) * 100 : 0;

  // The button only offers itself while you are actually inside the segment,
  // and stops a couple of seconds early so it never covers the first shot.
  // Los episodios piden sus rangos aparte; una película no tiene `episodeId`, así
  // que los toma de la información de reproducción.
  const activeSkip = (skip?.ranges ?? info?.skip)?.find((r) => virtual >= r.start_s && virtual < r.end_s - 2);
  const lastAutoSkipped = useRef<number | null>(null);

  /*
   * En una serie, al llegar a los créditos se activa la experiencia «Watch Next» (pantalla reducida y tarjeta del siguiente episodio).
   * Solo el 60 % de los episodios tiene el tramo de créditos detectado: sin él, los últimos 40 s hacen de créditos de respaldo.
   */
  const sinCreditos = !(skip?.ranges ?? info?.skip ?? []).some((r) => r.kind === 'credits');
  const siguienteEnCreditos = haySiguiente && activeSkip?.kind === 'credits';
  const siguienteEnCola = haySiguiente && !activeSkip && sinCreditos && duration > 300 && duration - virtual < 40 && duration - virtual > 1;
  const enModoWatchNext = (siguienteEnCreditos || siguienteEnCola) && !watchNextCancelado;

  // Cuenta atrás para reproducir el siguiente episodio si está en modo Watch Next
  useEffect(() => {
    if (!enModoWatchNext) {
      setCuentaAtrasNext(12);
      return;
    }
    const t = window.setInterval(() => {
      setCuentaAtrasNext((c) => {
        if (c <= 1) {
          window.clearInterval(t);
          irAlSiguiente();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [enModoWatchNext]);

  useEffect(() => {
    // El resumen («Anteriormente en…») se salta igual que la cabecera, con el mismo ajuste.
    if (!prefs.playback.autoSkipIntro || !activeSkip || (activeSkip.kind !== 'intro' && activeSkip.kind !== 'recap')) return;
    if (lastAutoSkipped.current === activeSkip.start_s) return;
    lastAutoSkipped.current = activeSkip.start_s;
    seek(activeSkip.end_s);
  }, [activeSkip, prefs.playback.autoSkipIntro]);

  // Con metraje detrás de los créditos (escena post-créditos), el botón lleva a ella.
  const escenaFinal = activeSkip?.kind === 'credits' && duration - activeSkip.end_s > 20;

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  const handlePlayerTap = useCallback(
    (e?: React.MouseEvent | React.TouchEvent) => {
      if (enModoWatchNext) {
        setWatchNextCancelado(true);
        return;
      }
      if (menu !== null) {
        setMenu(null);
        return;
      }
      const isTouch =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        (e as any)?.nativeEvent?.pointerType === 'touch';

      if (!controls) {
        showControls();
      } else {
        if (isTouch) {
          hideControls();
        } else {
          togglePlay();
        }
      }
    },
    [enModoWatchNext, menu, controls, showControls, hideControls, togglePlay],
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={showControls}
      onDoubleClick={toggleFullscreen}
      data-reproductor
      className={`fixed inset-0 z-100 ${conMpv ? 'bg-transparent' : 'bg-black'} ${controls ? '' : 'md:cursor-none'}`}
    >
      <style>{subtitleCss(prefs.subtitles)}</style>
      {/* La ventana del escritorio es transparente: el vídeo lo pinta mpv por detrás y esto va encima. */}
      {conMpv && <style>{'html,body,#root{background:transparent !important}'}</style>}
      {aviso && <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg bg-black/80 px-4 py-2 text-sm text-amber-300">{aviso}</div>}
      {/* Si no se puede ni pedir la información (perfil sin permiso, tiempo de hoy agotado, fichero que ya no
          está, servidor caído), se dice por qué y se puede salir; antes se quedaba girando para siempre. */}
      {errorInfo && !info && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center">
          <div className="max-w-md text-[15px] text-mist-100">{(errorInfo as Error).message || 'No se pudo abrir el vídeo'}</div>
          <button onClick={salir} className="rounded-xl bg-white/12 px-5 py-2 text-[13px] text-white hover:bg-white/20">Volver</button>
        </div>
      )}
      {!conMpv && (
      <div
        className={`relative h-full w-full transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] cursor-pointer ${
          enModoWatchNext
            ? 'origin-top-right scale-[0.48] translate-x-[-2vw] translate-y-[4vh] rounded-2xl shadow-2xl ring-2 ring-white/20 overflow-hidden z-20'
            : ''
        }`}
        onClick={(e) => {
          handlePlayerTap(e);
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="h-full w-full object-contain cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            handlePlayerTap(e);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onTimeUpdate={(e) => !scrubbing && setCurrent(e.currentTarget.currentTime)}
          onEnded={() => {
            if (itemId) {
              api.saveProgress({
                itemId,
                episodeId,
                position: duration,
                duration,
                watched: true,
                audio: audioTrackRef.current,
                subtitle: subtitleRef.current ?? 'off',
              }).catch(() => undefined);
            }
            if (prefs.playback.autoPlayNext && nextEpisode?.file_id) {
              navigate(`/ver/${nextEpisode.file_id}?item=${itemId}&ep=${nextEpisode.id}&t=0`, { replace: true });
            } else {
              salir();
            }
          }}
        />
        {enModoWatchNext && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <span className="glass-strong rounded-full px-4 py-2 text-xs font-semibold text-white">⤢ Maximizar créditos</span>
          </div>
        )}
      </div>
      )}

      <AnimatePresence>
        {avisoAdmin && (
          <motion.div
            key="aviso-admin"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="pointer-events-none absolute left-1/2 top-8 z-20 max-w-[80vw] -translate-x-1/2 rounded-2xl bg-black/75 px-6 py-3 text-center text-[16px] text-mist-100 ring-1 ring-white/15 backdrop-blur"
          >
            <div className="text-[11px] uppercase tracking-wide text-accent">Mensaje del administrador</div>
            <div className="whitespace-pre-line">{avisoAdmin}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tarjeta «Watch Next» interactiva estilo Netflix / Plex cuando el vídeo entra en créditos */}
      <AnimatePresence>
        {enModoWatchNext && nextEpisode && (
          <motion.div
            key="watch-next-card"
            initial={{ opacity: 0, x: -40, y: 20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-8 md:left-14 bottom-14 md:bottom-20 z-30 max-w-[460px] rounded-3xl bg-[#0c0d12]/92 p-6 md:p-7 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl"
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              <span className="text-[11px] font-bold tracking-widest text-accent uppercase">Siguiente episodio</span>
            </div>

            {nextEpisode.has_thumb ? (
              <div className="relative mb-3.5 aspect-video w-full overflow-hidden rounded-2xl border border-white/10 shadow-lg bg-black">
                <img
                  src={`/api/episodes/${nextEpisode.id}/thumb`}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <div className="absolute right-2.5 bottom-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-md border border-white/20">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                  </svg>
                </div>
              </div>
            ) : null}

            <div className="text-xl md:text-2xl font-bold text-white mb-1 leading-snug truncate">
              {nextEpisode.title ? `${nextEpisode.title}` : `Episodio ${nextEpisode.episode}`}
            </div>
            <div className="text-xs font-semibold text-mist-400 mb-2.5">
              Temporada {nextEpisode.season} · Episodio {nextEpisode.episode}
            </div>

            {nextEpisode.plot && (
              <p className="text-xs text-mist-300 line-clamp-2 leading-relaxed mb-5">
                {nextEpisode.plot}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={irAlSiguiente}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-[13px] font-bold text-ink-950 transition-transform hover:scale-[1.03] active:scale-[0.98] shadow-lg shadow-accent/25"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                </svg>
                <span>Ver ahora ({cuentaAtrasNext}s)</span>
              </button>
              <button
                onClick={() => setWatchNextCancelado(true)}
                className="rounded-xl bg-white/10 px-4 py-3 text-[13px] font-semibold text-mist-200 hover:bg-white/15 hover:text-white transition-colors"
              >
                Ver créditos
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Botón clásico de salto (para intros, resumen o si se minimiza la tarjeta) */}
      <AnimatePresence>
        {((activeSkip && !enModoWatchNext) || (siguienteEnCola && watchNextCancelado)) && (
          <motion.button
            key="boton-de-salto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            onClick={() => {
              if (siguienteEnCreditos || siguienteEnCola) {
                irAlSiguiente();
              } else if (activeSkip) {
                if (activeSkip.kind === 'credits' && !escenaFinal) {
                  marcadoVistoRef.current = true;
                  if (itemId) {
                    api.saveProgress({
                      itemId,
                      episodeId,
                      position: duration,
                      duration,
                      watched: true,
                      audio: audioTrackRef.current,
                      subtitle: subtitleRef.current ?? 'off',
                    }).catch(() => undefined);
                  }
                  salir();
                } else {
                  seek(activeSkip.end_s + 0.4);
                }
              }
            }}
            className="glass-strong absolute right-8 bottom-28 z-20 rounded-full px-5 py-2.5 text-[13px] font-semibold transition-transform hover:scale-105 active:scale-95"
          >
            {siguienteEnCreditos || siguienteEnCola
              ? 'Siguiente episodio'
              : activeSkip?.kind === 'intro' ? 'Saltar cabecera' : activeSkip?.kind === 'recap' ? 'Saltar resumen' : escenaFinal ? 'Ver escena final' : 'Saltar créditos'}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {buffering && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white/90" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {controls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-0 flex flex-col justify-between bg-linear-to-b from-black/75 via-transparent to-black/85"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                handlePlayerTap(e);
              }
            }}
          >
            <div className="flex items-start gap-4 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]">
              <button onClick={salir} className="glass grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform hover:scale-110">
                <Icon path="M15 5 8 12l7 7" size={18} />
              </button>
              <div className="min-w-0 pt-1.5">
                <div className="truncate text-lg font-semibold text-shadow-hero">{info?.title}</div>
                {info && (
                  <div className="mt-0.5 text-[11px] text-mist-400 flex flex-wrap items-center gap-x-2">
                    <span>
                      {info.plan.mode === 'direct' ? 'Reproducción directa' : info.plan.mode === 'remux' ? 'Remultiplexado' : 'Transcodificando'}
                      {info.video ? ` · ${info.video.width}×${info.video.height} ${info.video.codec.toUpperCase()}` : ''}
                    </span>
                    {finishTime && (
                      <span className="text-mist-200 font-medium">· Termina a las {finishTime}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Zona central interactiva (tocar para ocultar controles en iOS/móvil o pausar/reanudar en PC) */}
            <div
              className="flex-1 cursor-pointer select-none"
              onClick={(e) => {
                e.stopPropagation();
                handlePlayerTap(e);
              }}
            />

            <div className="pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]">
              <AnimatePresence>
                {menu === 'chapters' && info?.chapters && info.chapters.length > 1 && (
                  <ChapterTray
                    chapters={info.chapters}
                    currentTime={virtual}
                    duration={duration}
                    trickplay={trickplay}
                    fileId={fileId}
                    onSelect={(time) => {
                      seek(time);
                      setMenu(null);
                    }}
                    onClose={() => setMenu(null)}
                  />
                )}
              </AnimatePresence>

              {/* El disco, quieto, justo encima de la barra: va con los controles y en pausa se queda con ellos. */}
              {ficha?.has_discart === 1 && !buffering && (
                <img src={img.discart(itemId, 600)} alt="" className="pointer-events-none mb-3 w-28 md:w-40 drop-shadow-[0_18px_30px_rgba(0,0,0,0.6)]" />
              )}
              <div
                onClick={scrub}
                onMouseDown={() => setScrubbing(true)}
                onMouseUp={() => setScrubbing(false)}
                onTouchStart={() => setScrubbing(true)}
                onTouchEnd={() => setScrubbing(false)}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                  setHover({ time: (x / rect.width) * duration, x });
                }}
                onMouseLeave={() => setHover(null)}
                className="group/bar relative mb-3 cursor-pointer py-3 touch-none select-none"
              >
                {hover && trickplay && trickplay.times.length > 0 && (
                  <ScrubPreview trickplay={trickplay} fileId={fileId} time={hover.time} x={hover.x} />
                )}
                <div className="h-2 sm:h-1.5 overflow-hidden rounded-full bg-white/25 transition-[height] duration-200 group-hover/bar:h-2.5">
                  <div className="h-full w-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${progressPct / 100})` }} />
                </div>
                {/* Translating a full-width wrapper keeps the handle on the compositor:
                    a percentage transform resolves against the track's own width. */}
                <div className="pointer-events-none absolute inset-x-0 top-1/2" style={{ transform: `translate3d(${progressPct}%, -50%, 0)` }}>
                  <div className="h-4 w-4 -translate-x-1/2 rounded-full bg-white opacity-90 sm:opacity-0 shadow-lg transition-opacity duration-200 group-hover/bar:opacity-100" />
                </div>
              </div>

              <div className="flex items-center gap-2.5 sm:gap-3">
                <button onClick={togglePlay} className="grid h-11 w-11 place-items-center rounded-full bg-white/95 text-ink-950 transition-transform hover:scale-110 active:scale-95">
                  {playing ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5h3.5v15H7v-15Zm6.5 0H17v15h-3.5v-15Z" /></svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5Z" /></svg>
                  )}
                </button>

                <button onClick={() => seek(virtual - 10)} className="text-mist-200 transition-transform hover:scale-110 hover:text-white">
                  <Icon path="M11 8 6 12l5 4M18 8l-5 4 5 4" size={20} />
                </button>
                <button onClick={() => seek(virtual + 30)} className="text-mist-200 transition-transform hover:scale-110 hover:text-white">
                  <Icon path="M13 8l5 4-5 4M6 8l5 4-5 4" size={20} />
                </button>

                <div className="group/vol flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setMuted((m) => !m)} className="text-mist-200 hover:text-white p-1">
                    <Icon path={muted || volume === 0 ? 'M11 5 6 9H3v6h3l5 4V5ZM17 9l4 6M21 9l-4 6' : 'M11 5 6 9H3v6h3l5 4V5ZM16 8.5a5 5 0 0 1 0 7'} size={19} />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      setVolume(Number(e.target.value));
                      setMuted(false);
                    }}
                    className="hidden sm:block h-1 w-0 cursor-pointer accent-accent transition-all duration-300 group-hover/vol:w-20 overflow-hidden"
                  />
                </div>

                <div className="ml-1 shrink-0 font-mono text-[12px] sm:text-[12.5px] text-mist-300 tabular-nums flex items-center gap-2">
                  <span>{clock(virtual)} <span className="text-mist-600">/ {clock(duration)}</span></span>
                  {finishTime && (
                    <span className="hidden sm:inline-flex items-center rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-sans text-mist-200">
                      Termina {finishTime}
                    </span>
                  )}
                </div>

                <div className="flex-1" />

                <div className="relative">
                  <button
                    onClick={() => setMenu(menu === 'audio' ? null : 'audio')}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] transition-colors hover:bg-white/10 ${menu === 'audio' ? 'bg-white/10' : ''}`}
                  >
                    Audio
                  </button>
                  <Menu open={menu === 'audio'} onClose={() => setMenu(null)} title="Pista de audio">
                    {info?.audio.map((track) => (
                      <MenuItem
                        key={track.id}
                        active={audioTrack === track.id}
                        onClick={() => {
                          setOffset(virtual);
                          setCurrent(0);
                          setAudioTrack(track.id);
                          setMenu(null);
                        }}
                      >
                        {languageName(track.language)} · {track.codec.toUpperCase()} {track.channels === 6 ? '5.1' : track.channels === 2 ? '2.0' : ''}
                      </MenuItem>
                    ))}

                    <div className="mt-2 border-t border-white/8 pt-2">
                      <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">Modo de escucha</div>
                      {(['normal', 'night', 'dialogue'] as const).map((m) => (
                        <MenuItem
                          key={m}
                          active={(prefs.audio.mode ?? 'normal') === m}
                          onClick={() => {
                            update('audio', { mode: m });
                            setOffset(virtual);
                            setCurrent(0);
                            setMenu(null);
                          }}
                        >
                          {m === 'normal' ? 'Normal (original)' : m === 'night' ? 'Nocturno (comprime)' : 'Voces claras (realza)'}
                        </MenuItem>
                      ))}
                    </div>

                    <div className="mt-2 border-t border-white/8 pt-2">
                      <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">Desfase de audio</div>
                      <div className="flex items-center justify-between px-3 py-1.5">
                        <button
                          onClick={() => { setOffset(virtual); setCurrent(0); setAudioDelayMs((d) => Math.max(-10000, d - 100)); }}
                          className="h-7 w-9 rounded-lg bg-white/8 text-[13px] hover:bg-white/16"
                          title="Adelantar el audio"
                        >
                          −
                        </button>
                        <span className="font-mono text-[13px] tabular-nums">
                          {audioDelayMs > 0 ? '+' : ''}
                          {(audioDelayMs / 1000).toFixed(1)} s
                        </span>
                        <button
                          onClick={() => { setOffset(virtual); setCurrent(0); setAudioDelayMs((d) => Math.min(10000, d + 100)); }}
                          className="h-7 w-9 rounded-lg bg-white/8 text-[13px] hover:bg-white/16"
                          title="Retrasar el audio"
                        >
                          +
                        </button>
                      </div>
                      {audioDelayMs !== 0 && (
                        <button
                          onClick={() => { setOffset(virtual); setCurrent(0); setAudioDelayMs(0); }}
                          className="w-full rounded-xl px-3 py-2 text-left text-[13px] text-mist-400 hover:bg-white/8"
                        >
                          Quitar desfase
                        </button>
                      )}
                    </div>
                  </Menu>
                </div>

                <div className="relative">
                  <button
                    onClick={() => setMenu(menu === 'subs' ? null : 'subs')}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] transition-colors hover:bg-white/10 ${subtitle ? 'text-accent' : ''} ${menu === 'subs' ? 'bg-white/10' : ''}`}
                  >
                    Subtítulos
                  </button>
                  <Menu open={menu === 'subs'} onClose={() => setMenu(null)} title="Subtítulos">
                    <MenuItem active={!subtitle} onClick={() => { setSubtitle(null); setMenu(null); }}>
                      Desactivados
                    </MenuItem>
                    {info?.subtitles.map((track) => (
                      <MenuItem key={track.id} active={subtitle === track.id} onClick={() => { setSubtitle(track.id); setMenu(null); }}>
                        {languageName(track.language)}
                        {track.forced ? ' (forzados)' : ''} · {track.source === 'external' ? 'externo' : 'interno'}
                      </MenuItem>
                    ))}

                    {subtitle && (
                      <div className="mt-2 border-t border-white/8 pt-2">
                        <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-mist-500 uppercase">Sincronía</div>

                        <div className="flex items-center justify-between px-3 py-1.5">
                          <button
                            onClick={() => changeDelay(subDelayMs - 100)}
                            className="h-7 w-9 rounded-lg bg-white/8 text-[13px] hover:bg-white/16"
                            title="Adelantar 100 ms"
                          >
                            −
                          </button>
                          <span className="font-mono text-[13px] tabular-nums">
                            {subDelayMs > 0 ? '+' : ''}
                            {(subDelayMs / 1000).toFixed(1)} s
                          </span>
                          <button
                            onClick={() => changeDelay(subDelayMs + 100)}
                            className="h-7 w-9 rounded-lg bg-white/8 text-[13px] hover:bg-white/16"
                            title="Retrasar 100 ms"
                          >
                            +
                          </button>
                        </div>

                        {yo?.is_admin === 1 && (
                          <button
                            onClick={autoSync}
                            disabled={syncing}
                            className="w-full rounded-xl px-3 py-2 text-left text-[13px] text-mist-200 hover:bg-white/8 disabled:opacity-50"
                          >
                            {syncing ? 'Midiendo…' : 'Sincronizar automáticamente'}
                          </button>
                        )}
                        {subDelayMs !== 0 && (
                          <button onClick={() => changeDelay(0)} className="w-full rounded-xl px-3 py-2 text-left text-[13px] text-mist-400 hover:bg-white/8">
                            Quitar ajuste
                          </button>
                        )}
                        {syncNote && <div className="px-3 pt-1 pb-2 text-[11px] leading-relaxed text-mist-500">{syncNote}</div>}
                      </div>
                    )}

                    {subsDisp?.available && yo?.is_admin === 1 && (
                      <div className="mt-2 border-t border-white/8 pt-2">
                        <button
                          onClick={buscarSubtitulos}
                          disabled={buscandoSubs}
                          className="w-full rounded-xl px-3 py-2 text-left text-[13px] text-accent hover:bg-white/8 disabled:opacity-50"
                        >
                          {buscandoSubs ? 'Buscando en internet…' : '🔍 Buscar subtítulos en internet'}
                        </button>
                      </div>
                    )}
                  </Menu>
                </div>

                {/* Con mpv el fichero va en crudo: elegir calidad no haría nada, así que no se enseña. */}
                {!conMpv && (
                <div className="relative">
                  <button
                    onClick={() => setMenu(menu === 'quality' ? null : 'quality')}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] transition-colors hover:bg-white/10 ${menu === 'quality' ? 'bg-white/10' : ''}`}
                  >
                    Calidad
                  </button>
                  <Menu open={menu === 'quality'} onClose={() => setMenu(null)} title="Calidad">
                    {QUALITIES.map((q) => (
                      <MenuItem
                        key={q.value}
                        active={maxHeight === q.value}
                        onClick={() => {
                          setOffset(virtual);
                          setCurrent(0);
                          setMaxHeight(q.value);
                          setMenu(null);
                        }}
                      >
                        {q.label}
                      </MenuItem>
                    ))}
                  </Menu>
                </div>
                )}

                {info?.chapters && info.chapters.length > 1 && (
                  <button
                    onClick={() => setMenu(menu === 'chapters' ? null : 'chapters')}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                      menu === 'chapters' ? 'bg-white/20 text-white ring-1 ring-white/30' : 'text-mist-200 hover:bg-white/10 hover:text-white'
                    }`}
                    title="Ver capítulos visuales (tecla c)"
                  >
                    Capítulos ({info.chapters.length})
                  </button>
                )}

                <div className="relative">
                  <button
                    onClick={() => setMenu(menu === 'info' ? null : 'info')}
                    className={`rounded-lg px-2.5 py-1.5 text-[12px] transition-colors hover:bg-white/10 ${menu === 'info' ? 'bg-white/10' : ''}`}
                    title="Información técnica"
                  >
                    Info
                  </button>
                  <Menu open={menu === 'info'} onClose={() => setMenu(null)} title="Información técnica">
                    <div className="px-3 py-2 space-y-2 text-[12px] font-mono">
                      <div className="flex justify-between text-mist-400"><span>Contenedor</span><span className="text-white">{info?.container || 'MKV'}</span></div>
                      {info?.bitrate ? <div className="flex justify-between text-mist-400"><span>Bitrate</span><span className="text-white">{Math.round(info.bitrate / 1000000)} Mb/s</span></div> : null}
                      {info?.video ? <div className="flex justify-between text-mist-400"><span>Vídeo</span><span className="text-white">{info.video.codec.toUpperCase()} · {info.video.width}×{info.video.height} {info.video.hdr || ''}</span></div> : null}
                      {info?.size ? <div className="flex justify-between text-mist-400"><span>Tamaño</span><span className="text-white">{(info.size / (1024**3)).toFixed(2)} GB</span></div> : null}
                      <div className="flex justify-between text-mist-400"><span>Modo</span><span className="text-accent">{usaHls ? 'HLS Adaptativo' : info?.plan.mode === 'direct' ? 'Directo' : 'Transcodificado'}</span></div>
                    </div>
                  </Menu>
                </div>

                {hayPip && (
                  <button
                    onClick={togglePip}
                    title="Imagen sobre imagen (P)"
                    className="text-mist-200 transition-transform hover:scale-110 hover:text-white"
                  >
                    <Icon path="M3 6h18v12H3zM12 12h7v4h-7z" size={19} />
                  </button>
                )}
                <button
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Salir de pantalla completa (F)' : 'Pantalla completa (F)'}
                  className="text-mist-200 transition-transform hover:scale-110 hover:text-white"
                >
                  <Icon
                    path={isFullscreen ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'}
                    size={19}
                  />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {modalCandidatos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl max-h-[80vh] flex flex-col rounded-2xl bg-[#14151b] border border-white/10 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
              <h3 className="text-base font-semibold text-white">Subtítulos en internet (ES / EN)</h3>
              <button
                onClick={() => setModalCandidatos(false)}
                className="text-mist-400 hover:text-white text-sm"
              >
                ✕ Cerrar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {buscandoSubs ? (
                <div className="py-12 text-center text-sm text-mist-400">
                  <div className="animate-spin inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full mb-3" />
                  <div>Buscando en SubSource y OpenSubtitles…</div>
                </div>
              ) : candidatos.length === 0 ? (
                <div className="py-12 text-center text-sm text-mist-400">
                  No se encontraron subtítulos para este título.
                </div>
              ) : (
                candidatos.map((c) => (
                  <button
                    key={c.id}
                    disabled={descargandoId !== null}
                    onClick={() => descargarCandidato(c)}
                    className="w-full text-left rounded-xl p-3 bg-white/4 hover:bg-white/8 border border-white/6 transition-colors flex items-center justify-between gap-3 disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">{c.language === 'es' ? '🇪🇸' : '🇬🇧'}</span>
                        <span className="text-xs font-bold text-accent">
                          {c.language.toUpperCase()}
                          {c.forced ? ' (forzados)' : ''}
                          {c.hearingImpaired ? ' [SDH]' : ''}
                        </span>
                        <span className="text-[11px] text-mist-400">[{c.provider}]</span>
                        {c.rating > 0 && <span className="text-[11px] text-amber-400 font-medium">⭐ {c.rating}</span>}
                        {c.downloads > 0 && <span className="text-[11px] text-mist-400">📥 {c.downloads}</span>}
                      </div>
                      <div className="text-xs text-mist-200 truncate font-mono">
                        {c.release || c.comment || 'Subtítulo estándar'}
                      </div>
                    </div>
                    {descargandoId === c.id ? (
                      <div className="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full shrink-0" />
                    ) : (
                      <span className="text-xs text-accent font-medium shrink-0">Descargar</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
