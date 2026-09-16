import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PosterCard from './PosterCard.tsx';
import { img, type ItemSummary } from '../lib/api.ts';
import { remaining } from '../lib/format.ts';

function Arrow({ dir, onClick, visible }: { dir: 'left' | 'right'; onClick: () => void; visible: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === 'left' ? 'Anterior' : 'Siguiente'}
      className={`glass absolute top-0 bottom-10 z-20 hidden w-11 place-items-center rounded-2xl transition-opacity duration-200 md:grid ${
        dir === 'left' ? 'left-0' : 'right-0'
      } ${visible ? 'opacity-90 hover:opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  );
}

function ContinueCard({ item }: { item: ItemSummary }) {
  const duration = item.progressDuration ?? (item.runtime ? item.runtime * 60 : 0);
  const pct = duration ? Math.min(100, ((item.position ?? 0) / duration) * 100) : 0;
  const art = item.has_landscape ? img.landscape(item.id, 640) : item.has_fanart ? img.fanart(item.id, 640) : img.poster(item.id, 400);

  return (
    <Link to={`/titulo/${item.id}`} className="group block w-[300px] shrink-0">
      <div className="relative aspect-16/9 overflow-hidden rounded-[var(--radius-card)] bg-ink-800 shadow-[0_12px_34px_-14px_rgba(0,0,0,0.9)] ring-1 ring-white/8 transition-transform duration-[420ms] ease-[cubic-bezier(0.34,1.4,0.64,1)] will-change-transform group-hover:-translate-y-1 group-hover:scale-[1.025] group-hover:ring-white/20">
        <img src={art} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/25 to-transparent" />

        <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <div className="glass grid h-12 w-12 place-items-center rounded-full">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
              <path d="M8 5.5v13l11-6.5-11-6.5Z" />
            </svg>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="truncate text-[13px] font-semibold text-shadow-hero">{item.title}</div>
          {duration > 0 && <div className="text-[11px] text-mist-300">{remaining(item.position ?? 0, duration)}</div>}
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/25">
            <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function Row({
  title,
  items,
  variant = 'poster',
  to,
}: {
  title: string;
  items: ItemSummary[];
  variant?: 'poster' | 'continue';
  to?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 8, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 });
  }, []);

  useEffect(() => {
    update();
    const el = scroller.current;
    el?.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update, items.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * (el.clientWidth * 0.82), behavior: 'smooth' });
  };

  if (items.length === 0) return null;

  return (
    <section className="group/row relative">
      <div className="mb-3 flex items-baseline justify-between px-4 sm:px-8">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {to && (
          <Link to={to} className="text-xs text-mist-500 opacity-0 transition-opacity hover:text-mist-100 group-hover/row:opacity-100">
            Ver todo →
          </Link>
        )}
      </div>

      <div className="relative">
        <Arrow dir="left" visible={edges.left} onClick={() => scrollBy(-1)} />
        <Arrow dir="right" visible={edges.right} onClick={() => scrollBy(1)} />
        <div ref={scroller} className="no-scrollbar flex gap-3.5 overflow-x-auto scroll-smooth px-4 pb-2 [contain:content] sm:px-8">
          {items.map((item) =>
            variant === 'continue' ? <ContinueCard key={`${item.id}-${item.episode_id ?? 0}`} item={item} /> : <PosterCard key={item.id} item={item} width={168} />,
          )}
        </div>
      </div>
    </section>
  );
}
