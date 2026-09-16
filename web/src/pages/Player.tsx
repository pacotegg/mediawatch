import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import Hls from 'hls.js';
import { api, enRedLocal, hlsUrl, img, streamUrl, subtitleSync, subtitleUrl, trickplaySheet, type PlayInfo, type Trickplay } from '../lib/api.ts';
import { clock, languageName } from '../lib/format.ts';
import { subtitleCss, usePreferences } from '../lib/preferences.tsx';
import { applyCues, parseVtt, type Cue } from '../lib/vtt.ts';

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

export default function Player() {
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

  const { prefs } = usePreferences();

  // Always honour an explicit `t`: it also carries deep links from a dialogue
  // search, which must jump to the line whatever the resume preference says.
  const [offset, setOffset] = useState(Number(params.get('t') ?? 0));
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [volume, setVolume] = useState(prefs.audio.defaultVolume);
  const [muted, setMuted] = useState(false);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<'audio' | 'subs' | 'quality' | null>(null);
  const [audioTrack, setAudioTrack] = useState<number | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [maxHeight, setMaxHeight] = useState(prefs.playback.maxHeight);
  const [scrubbing, setScrubbing] = useState(false);
  const [autoSubApplied, setAutoSubApplied] = useState(false);
  const [hover, setHover] = useState<{ time: number; x: number } | null>(null);
  const [subDelayMs, setSubDelayMs] = useState(0);
  const [audioDelayMs, setAudioDelayMs] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');

  const { data: info } = useQuery<PlayInfo>({ queryKey: ['play', fileId], queryFn: () => api.playInfo(fileId), staleTime: Infinity });
  // Quién mira: la medición automática de subtítulos se guarda para todos, así que es cosa del administrador.
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  const { data: show } = useQuery({ queryKey: ['item', itemId], queryFn: () => api.item(itemId), enabled: Boolean(itemId && episodeId) });
  // La ficha entera solo para saber si hay disco; es la misma consulta que la ficha, así que suele estar en caché.
  const { data: ficha } = useQuery({ queryKey: ['item', itemId], queryFn: () => api.item(itemId), enabled: Boolean(itemId) });

  const { data: skip } = useQuery({
    queryKey: ['skip', episodeId],
    queryFn: () => api.skipRanges(episodeId!),
    enabled: Boolean(episodeId),
    staleTime: Infinity,
  });

  // The first request kicks off generation server-side; poll until the strip lands.
  const { data: trickplay } = useQuery({
    queryKey: ['trickplay', fileId],
    queryFn: () => api.trickplay(fileId),
    refetchInterval: (q) => (q.state.data ? false : 5000),
    staleTime: Infinity,
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
  const isTimeshift = usaHls ? false : info ? info.plan.mode !== 'direct' : true;
  const virtual = (isTimeshift ? offset : 0) + current;
  const duration = info?.duration ?? 0;

  // Preferred language wins over the file's own default flag, which is often
  // just whatever the release group happened to set.
  useEffect(() => {
    if (!info || audioTrack !== null) return;
    const preferred = info.audio.find((a) => a.language === prefs.audio.preferredLanguage);
    setAudioTrack(preferred?.id ?? info.audio.find((a) => a.default)?.id ?? info.audio[0]?.id ?? 0);
  }, [info, audioTrack, prefs.audio.preferredLanguage]);

  useEffect(() => {
    if (!info || autoSubApplied || audioTrack === null) return;
    setAutoSubApplied(true);

    const mode = prefs.subtitles.mode;
    if (mode === 'never') return;

    const spokenLanguage = info.audio.find((a) => a.id === audioTrack)?.language;
    const audioIsPreferred = spokenLanguage === prefs.audio.preferredLanguage;
    if (mode === 'auto' && audioIsPreferred && !prefs.subtitles.preferForced) return;

    const wanted = info.subtitles.filter((s) => s.language === prefs.subtitles.preferredLanguage);
    const pick = prefs.subtitles.preferForced
      ? (wanted.find((s) => s.forced) ?? wanted[0])
      : (wanted.find((s) => !s.forced) ?? wanted[0]);
    if (pick) setSubtitle(pick.id);
  }, [info, audioTrack, autoSubApplied, prefs.audio.preferredLanguage, prefs.subtitles]);

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

  // Reloading the source is how seeking works while transcoding, so restore playback after it lands.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (!usaHls) {
      video.src = src;
      video.load();
      video.play().catch(() => undefined);
      return;
    }

    // Safari y iOS reproducen HLS de fábrica y lo hacen mejor que la biblioteca.
    if (!Hls.isSupported()) {
      video.src = src;
      video.load();
      video.play().catch(() => undefined);
      return;
    }

    const hls = new Hls({
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
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      // Un fallo de red no debe tumbar la reproducción: se reintenta, que es
      // justamente para lo que se trocea.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else hls.destroy();
    });

    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => undefined));

    return () => {
      hls.destroy();
      // Libera la GPU en el servidor en cuanto se cierra el reproductor.
      navigator.sendBeacon?.(`/api/play/${fileId}/hls/cerrar`);
    };
  }, [src, usaHls, fileId]);

  const seek = useCallback(
    (target: number) => {
      const video = videoRef.current;
      if (!video || !info) return;
      const clamped = Math.max(0, Math.min(duration - 1, target));
      if (!isTimeshift) {
        video.currentTime = clamped;
        return;
      }
      setBuffering(true);
      setOffset(clamped);
      setCurrent(0);
    },
    [duration, info, isTimeshift],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const changeDelay = useCallback(
    (nextMs: number) => {
      setSubDelayMs(nextMs);
      setSyncNote(nextMs === 0 ? '' : 'ajustado a mano');
      if (subtitle) subtitleSync.setOffset(fileId, subtitle, nextMs).catch(() => undefined);
    },
    [fileId, subtitle],
  );

  const showControls = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setControls(false);
    }, HIDE_AFTER_MS);
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
          if (document.fullscreenElement) document.exitFullscreen();
          else containerRef.current?.requestFullscreen();
          break;
        case 'm':
          setMuted((m) => !m);
          break;
        case 'g':
          if (subtitle) changeDelay(subDelayMs - 100);
          break;
        case 'h':
          if (subtitle) changeDelay(subDelayMs + 100);
          break;
        case 'Escape':
          if (!document.fullscreenElement) navigate(-1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, seek, showControls, togglePlay, virtual, prefs.playback.seekStep, prefs.playback.seekStepLarge, changeDelay, subDelayMs, subtitle]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = muted;
    }
  }, [volume, muted]);

  // Persist position so "continue watching" survives a reload or a jump to another device.
  useEffect(() => {
    if (!itemId) return;
    const save = () => {
      const position = (isTimeshift ? offset : 0) + (videoRef.current?.currentTime ?? 0);
      if (position > 5) api.saveProgress({ itemId, episodeId, position, duration }).catch(() => undefined);
    };
    const timer = window.setInterval(save, SAVE_EVERY_MS);
    window.addEventListener('beforeunload', save);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [duration, episodeId, isTimeshift, itemId, offset]);

  // Subtitle cues are fetched once, then re-applied whenever the timeline shifts.
  useEffect(() => {
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
  }, [fileId, subtitle]);

  useEffect(() => {
    if (trackRef.current && cuesRef.current.length > 0) {
      applyCues(trackRef.current, cuesRef.current, isTimeshift ? offset : 0, subDelayMs / 1000);
    }
  }, [offset, isTimeshift, subDelayMs]);

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

  const progressPct = duration ? (virtual / duration) * 100 : 0;

  // The button only offers itself while you are actually inside the segment,
  // and stops a couple of seconds early so it never covers the first shot.
  const activeSkip = skip?.ranges.find((r) => virtual >= r.start_s && virtual < r.end_s - 2);

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={showControls}
      onDoubleClick={() => (document.fullscreenElement ? document.exitFullscreen() : containerRef.current?.requestFullscreen())}
      className={`fixed inset-0 z-100 bg-black ${controls ? '' : 'cursor-none'}`}
    >
      <style>{subtitleCss(prefs.subtitles)}</style>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onClick={togglePlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onTimeUpdate={(e) => !scrubbing && setCurrent(e.currentTarget.currentTime)}
        onEnded={() => {
          if (itemId) api.saveProgress({ itemId, episodeId, position: duration, duration, watched: true }).catch(() => undefined);
          if (prefs.playback.autoPlayNext && nextEpisode?.file_id) {
            navigate(`/ver/${nextEpisode.file_id}?item=${itemId}&ep=${nextEpisode.id}&t=0`, { replace: true });
          } else {
            navigate(-1);
          }
        }}
        className="h-full w-full"
      />

      {/* El disco de la pausa: la carátula redonda, arriba a la derecha, girando despacio. */}
      <AnimatePresence>
        {!playing && !buffering && ficha?.has_discart === 1 && (
          <motion.img
            key="disco"
            src={img.discart(itemId, 600)}
            alt=""
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="disco-pausa pointer-events-none absolute right-8 top-16 w-40 md:w-56 drop-shadow-[0_18px_30px_rgba(0,0,0,0.6)]"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeSkip && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => seek(activeSkip.end_s + 0.4)}
            className="glass-strong absolute right-8 bottom-28 z-20 rounded-full px-5 py-2.5 text-[13px] font-semibold transition-transform hover:scale-105 active:scale-95"
          >
            {activeSkip.kind === 'intro' ? 'Saltar cabecera' : 'Saltar créditos'}
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
          >
            <div className="flex items-start gap-4 p-5">
              <button onClick={() => navigate(-1)} className="glass grid h-10 w-10 shrink-0 place-items-center rounded-full transition-transform hover:scale-110">
                <Icon path="M15 5 8 12l7 7" size={18} />
              </button>
              <div className="min-w-0 pt-1.5">
                <div className="truncate text-lg font-semibold text-shadow-hero">{info?.title}</div>
                {info && (
                  <div className="mt-0.5 text-[11px] text-mist-400">
                    {info.plan.mode === 'direct' ? 'Reproducción directa' : info.plan.mode === 'remux' ? 'Remultiplexado' : 'Transcodificando'}
                    {info.video ? ` · ${info.video.width}×${info.video.height} ${info.video.codec.toUpperCase()}` : ''}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 pb-5">
              <div
                onClick={scrub}
                onMouseDown={() => setScrubbing(true)}
                onMouseUp={() => setScrubbing(false)}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                  setHover({ time: (x / rect.width) * duration, x });
                }}
                onMouseLeave={() => setHover(null)}
                className="group/bar relative mb-3 cursor-pointer py-2"
              >
                {hover && trickplay && trickplay.times.length > 0 && (
                  <ScrubPreview trickplay={trickplay} fileId={fileId} time={hover.time} x={hover.x} />
                )}
                <div className="h-1 overflow-hidden rounded-full bg-white/25 transition-[height] duration-200 group-hover/bar:h-1.5">
                  <div className="h-full w-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${progressPct / 100})` }} />
                </div>
                {/* Translating a full-width wrapper keeps the handle on the compositor:
                    a percentage transform resolves against the track's own width. */}
                <div className="pointer-events-none absolute inset-x-0 top-1/2" style={{ transform: `translate3d(${progressPct}%, -50%, 0)` }}>
                  <div className="h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white opacity-0 shadow-lg transition-opacity duration-200 group-hover/bar:opacity-100" />
                </div>
              </div>

              <div className="flex items-center gap-3">
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

                <div className="group/vol flex items-center gap-2">
                  <button onClick={() => setMuted((m) => !m)} className="text-mist-200 hover:text-white">
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
                    className="h-1 w-0 cursor-pointer accent-accent transition-all duration-300 group-hover/vol:w-20"
                  />
                </div>

                <div className="ml-1 font-mono text-[12.5px] text-mist-300 tabular-nums">
                  {clock(virtual)} <span className="text-mist-600">/ {clock(duration)}</span>
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
                  </Menu>
                </div>

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

                <button
                  onClick={() => (document.fullscreenElement ? document.exitFullscreen() : containerRef.current?.requestFullscreen())}
                  className="text-mist-200 transition-transform hover:scale-110 hover:text-white"
                >
                  <Icon path="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" size={19} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
