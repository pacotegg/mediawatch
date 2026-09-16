import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { img, type ItemSummary } from '../lib/api.ts';

/**
 * Deliberately free of `motion`: a library grid mounts hundreds of these, and
 * CSS transforms keep hover and entrance animations on the compositor.
 */
function PosterCard({ item, width, index = 0 }: { item: ItemSummary; width?: number; index?: number }) {
  const [loaded, setLoaded] = useState(false);
  const duration = item.progressDuration ?? (item.runtime ? item.runtime * 60 : 0);
  const showProgress = Boolean(item.position && duration && !item.watched);
  const progress = showProgress ? Math.min(1, Math.max(0.02, item.position! / duration)) : 0;

  return (
    <Link
      to={`/titulo/${item.id}`}
      className={`group fade-up block ${width ? 'shrink-0' : 'w-full'}`}
      style={{ ...(width ? { width } : {}), ['--i' as string]: index }}
    >
      <div
        className="relative aspect-2/3 overflow-hidden rounded-[var(--radius-card)] bg-ink-800 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/8 transition-[transform,box-shadow,outline-color] duration-[420ms] ease-[cubic-bezier(0.34,1.4,0.64,1)] will-change-transform group-hover:-translate-y-1.5 group-hover:scale-[1.045] group-hover:shadow-[0_22px_50px_-16px_rgba(0,0,0,0.95)] group-active:scale-[0.99] group-active:duration-150"
      >
        {!loaded && <div className="skeleton absolute inset-0" />}
        {item.has_poster ? (
          <img
            src={img.poster(item.id, !width || width >= 200 ? 400 : 300)}
            alt={item.title}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-mist-500">{item.title}</div>
        )}

        <div className="absolute inset-0 rounded-[var(--radius-card)] ring-1 ring-white/0 transition-[--tw-ring-color] duration-300 group-hover:ring-white/20" />
        <div className="absolute inset-0 bg-linear-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {item.watched === 1 && (
          <div className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-ink-950 shadow-lg">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5 9.5 18 20 6.5" />
            </svg>
          </div>
        )}

        {showProgress && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/55">
            <div className="h-full origin-left bg-accent" style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}
      </div>

      <div className="mt-2 px-0.5">
        <div className="truncate text-[13px] leading-tight font-medium text-mist-100 transition-colors duration-200 group-hover:text-white">
          {item.title}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mist-500">
          {item.year && <span>{item.year}</span>}
          {item.rating != null && item.rating > 0 && (
            <>
              <span className="text-mist-600">·</span>
              <span className="flex items-center gap-0.5">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                  <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
                </svg>
                {item.rating.toFixed(1)}
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

export default memo(PosterCard);
