import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { api, img, type ItemSummary } from '../lib/api.ts';
import { certification, runtime } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { usePreferences } from '../lib/preferences.tsx';

const ROTATE_MS = 11_000;

export default function Hero({ items }: { items: ItemSummary[] }) {
  const { prefs } = usePreferences();
  const lang = prefs.interface.language;
  const [index, setIndex] = useState(0);
  const [trailerYoutube, setTrailerYoutube] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [trailerError, setTrailerError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (items.length < 2 || trailerYoutube) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [items.length, trailerYoutube]);

  if (items.length === 0) return null;
  const item = items[index];

  useEffect(() => {
    setTrailerYoutube(null);
    setIsPlaying(false);
    setTrailerError(false);
    setIsMuted(true);
    if (!item || prefs.interface.heroTrailer === false) return;
    let cancelado = false;
    const timer = setTimeout(() => {
      api.trailer(item.id)
        .then((res) => {
          if (!cancelado && res.trailer?.youtube) {
            setTrailerYoutube(res.trailer.youtube);
          }
        })
        .catch(() => {});
    }, 800);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [item?.id, prefs.interface.heroTrailer]);

  useEffect(() => {
    if (!trailerYoutube) return;
    const handleMsg = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const state = data?.info?.playerState !== undefined ? data.info.playerState : data?.info;
        if (data?.event === 'onStateChange' || data?.event === 'infoDelivery') {
          if (state === 1) {
            setIsPlaying(true);
          } else if (state === 0) {
            setTrailerYoutube(null);
            setIndex((i) => (i + 1) % items.length);
          }
        } else if (data?.event === 'onError' || data?.info?.errorCode) {
          setTrailerError(true);
          setTrailerYoutube(null);
        }
      } catch {}
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [trailerYoutube, items.length]);

  const toggleMute = () => {
    if (!iframeRef.current?.contentWindow) return;
    const nextMuted = !isMuted;
    iframeRef.current.contentWindow.postMessage(
      JSON.stringify({
        event: 'command',
        func: nextMuted ? 'mute' : 'unMute',
      }),
      '*',
    );
    setIsMuted(nextMuted);
  };

  const [touchStart, setTouchStart] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        setIndex((i) => (i + 1) % items.length);
      } else {
        setIndex((i) => (i - 1 + items.length) % items.length);
      }
    }
    setTouchStart(null);
  };

  return (
    <div
      className="group/hero relative h-[62vh] min-h-[420px] w-full overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <AnimatePresence mode="sync">
        <motion.div
          key={item.id}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 1.1 }, scale: { duration: ROTATE_MS / 1000, ease: 'linear' } }}
          className="absolute inset-0"
        >
          <img src={img.fanart(item.id, 1920, item.arte_actualizado)} alt="" className="h-full w-full object-cover" />
        </motion.div>
      </AnimatePresence>

      {trailerYoutube && !trailerError && (
        <div className={`absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-1000 z-[1] ${isPlaying ? 'opacity-70' : 'opacity-0'}`}>
          <iframe
            ref={iframeRef}
            src={`https://www.youtube-nocookie.com/embed/${trailerYoutube}?autoplay=1&mute=1&controls=0&loop=1&playlist=${trailerYoutube}&playsinline=1&showinfo=0&rel=0&modestbranding=1&enablejsapi=1`}
            allow="autoplay; encrypted-media; picture-in-picture"
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120vw] h-[120vh] min-w-[100%] min-h-[100%] object-cover pointer-events-none"
            tabIndex={-1}
            title="Tráiler de fondo"
            onLoad={() => {
              iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), '*');
              setTimeout(() => setIsPlaying(true), 1200);
            }}
          />
        </div>
      )}

      <div className="scrim-b pointer-events-none absolute inset-0 z-[2]" />
      <div className="scrim-l pointer-events-none absolute inset-0 z-[2]" />

      <div className="relative z-[3] flex h-full items-end pb-14 pointer-events-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl px-4 sm:px-8"
          >
            {item.has_logo ? (
              <img src={img.logo(item.id, 520, item.arte_actualizado)} alt={item.title} className="mb-4 max-h-28 w-auto max-w-[min(440px,80vw)] object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.85)]" />
            ) : (
              <h1 className="mb-4 text-4xl font-bold tracking-tight text-shadow-hero sm:text-5xl">{item.title}</h1>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2.5 text-[13px] text-mist-300">
              {item.year && <span>{item.year}</span>}
              {item.runtime ? <span>{runtime(item.runtime)}</span> : null}
              {certification(item.mpaa) && (
                <span className="rounded border border-white/25 px-1.5 py-px text-[11px]">{certification(item.mpaa)}</span>
              )}
              {item.rating != null && item.rating > 0 && (
                <span className="flex items-center gap-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
                  </svg>
                  {item.rating.toFixed(1)}
                </span>
              )}
            </div>

            {item.plot && <p className="mb-6 line-clamp-3 max-w-xl text-sm leading-relaxed text-mist-300 text-shadow-hero">{item.plot}</p>}

            <div className="flex items-center gap-3">
              <Link
                to={`/titulo/${item.id}`}
                className="flex items-center gap-2 rounded-full bg-mist-100 px-6 py-2.5 text-sm font-semibold text-ink-950 transition-transform duration-200 hover:scale-105 active:scale-95"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                </svg>
                {t('play', lang)}
              </Link>
              <Link to={`/titulo/${item.id}`} className="glass rounded-full px-5 py-2.5 text-sm font-medium transition-transform duration-200 hover:scale-105 active:scale-95">
                {t('viewDetails', lang)}
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {items.length > 1 && (
        <>
          <button
            onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)}
            aria-label="Película anterior"
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 hidden sm:flex h-11 w-11 items-center justify-center rounded-full bg-ink-950/40 text-mist-100 backdrop-blur-md transition-all hover:bg-ink-950/70 hover:scale-110 active:scale-95 opacity-0 group-hover/hero:opacity-100 focus:opacity-100 border border-white/10"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            onClick={() => setIndex((i) => (i + 1) % items.length)}
            aria-label="Película siguiente"
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 hidden sm:flex h-11 w-11 items-center justify-center rounded-full bg-ink-950/40 text-mist-100 backdrop-blur-md transition-all hover:bg-ink-950/70 hover:scale-110 active:scale-95 opacity-0 group-hover/hero:opacity-100 focus:opacity-100 border border-white/10"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <div className="absolute right-8 bottom-14 hidden gap-1.5 sm:flex">
            {items.map((it, i) => (
              <button
                key={it.id}
                onClick={() => setIndex(i)}
                aria-label={`Ir a ${it.title}`}
                className={`h-1 rounded-full transition-all duration-300 ${i === index ? 'w-7 bg-mist-100' : 'w-3 bg-white/30 hover:bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}

      {trailerYoutube && !trailerError && isPlaying && (
        <button
          onClick={toggleMute}
          aria-label={isMuted ? 'Activar sonido del tráiler' : 'Silenciar tráiler'}
          title={isMuted ? 'Activar sonido' : 'Silenciar'}
          className="absolute right-6 bottom-20 sm:bottom-20 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-ink-950/60 text-white backdrop-blur-md transition-all hover:bg-ink-950/90 hover:scale-110 active:scale-95 border border-white/20 shadow-lg"
        >
          {isMuted ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
