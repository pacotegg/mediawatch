import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import PosterCard from '../components/PosterCard.tsx';
import { api } from '../lib/api.ts';

const PAGE = 60;

const SORTS = [
  { key: 'title', label: 'Título' },
  { key: 'added', label: 'Añadido' },
  { key: 'year', label: 'Año' },
  { key: 'rating', label: 'Valoración' },
  { key: 'random', label: 'Aleatorio' },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap transition-all duration-200 ${
        active ? 'bg-mist-100 font-medium text-ink-950' : 'bg-white/6 text-mist-300 hover:bg-white/12 hover:text-mist-100'
      }`}
    >
      {children}
    </button>
  );
}

export default function Library() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const libraryId = Number(id);
  const genre = params.get('genero') ?? '';
  const sort = params.get('orden') ?? 'title';

  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const { data: genres } = useQuery({ queryKey: ['genres', libraryId], queryFn: () => api.genres(libraryId) });
  const library = libraries?.find((l) => l.id === libraryId);

  const query = useInfiniteQuery({
    queryKey: ['items', libraryId, genre, sort],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.items({ library: libraryId, genre: genre || undefined, sort, limit: PAGE, offset: pageParam as number }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
      },
      { rootMargin: '900px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage, query]);

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="pt-20 pb-24">
      <div className="glass-strong layer-promote sticky top-14 z-30 border-b border-white/6">
        <div className="mx-auto max-w-[1800px] px-4 py-3 sm:px-8">
          <div className="mb-3 flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{library?.name ?? 'Biblioteca'}</h1>
            <span className="text-sm text-mist-500">{total.toLocaleString('es-ES')} títulos</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
              <Chip active={!genre} onClick={() => update('genero', '')}>Todos</Chip>
              {genres?.map((g) => (
                <Chip key={g.id} active={genre === g.name} onClick={() => update('genero', g.name)}>
                  {g.name}
                </Chip>
              ))}
            </div>

            <select
              value={sort}
              onChange={(e) => update('orden', e.target.value)}
              className="shrink-0 rounded-full border border-white/8 bg-white/6 px-3 py-1.5 text-[13px] text-mist-300 outline-none hover:bg-white/10"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key} className="bg-ink-800">
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1800px] px-4 pt-6 sm:px-8">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
          {items.map((item, i) => (
            <div key={item.id} className="cull">
              <PosterCard item={item} index={i % PAGE} />
            </div>
          ))}
          {query.isFetching &&
            Array.from({ length: query.isFetchingNextPage ? 12 : 24 }).map((_, i) => (
              <div key={`sk-${i}`} className="skeleton aspect-2/3 rounded-[var(--radius-card)]" />
            ))}
        </div>
        <div ref={sentinel} className="h-10" />
      </div>
    </div>
  );
}
