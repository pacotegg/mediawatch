import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { img, type ItemSummary } from '../lib/api.ts';
import { certification, runtime } from '../lib/format.ts';

const ROTATE_MS = 11_000;

export default function Hero({ items }: { items: ItemSummary[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;
  const item = items[index];

  return (
    <div className="relative h-[62vh] min-h-[420px] w-full overflow-hidden">
      <AnimatePresence mode="sync">
        <motion.div
          key={item.id}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 1.1 }, scale: { duration: ROTATE_MS / 1000, ease: 'linear' } }}
          className="absolute inset-0"
        >
          <img src={img.fanart(item.id, 1920)} alt="" className="h-full w-full object-cover" />
        </motion.div>
      </AnimatePresence>

      <div className="scrim-b absolute inset-0" />
      <div className="scrim-l absolute inset-0" />

      <div className="relative flex h-full items-end pb-14">
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
              <img src={img.logo(item.id, 520)} alt={item.title} className="mb-4 max-h-28 w-auto max-w-[min(440px,80vw)] object-contain drop-shadow-[0_6px_24px_rgba(0,0,0,0.85)]" />
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
                Reproducir
              </Link>
              <Link to={`/titulo/${item.id}`} className="glass rounded-full px-5 py-2.5 text-sm font-medium transition-transform duration-200 hover:scale-105 active:scale-95">
                Más información
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {items.length > 1 && (
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
      )}
    </div>
  );
}
