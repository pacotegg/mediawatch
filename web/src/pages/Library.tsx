import { useEffect, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import PosterCard from '../components/PosterCard.tsx';
import { api } from '../lib/api.ts';

const PAGE = 60;

const SORTS = [
  { key: 'title', label: 'Título (A–Z)' },
  { key: 'added', label: 'Añadido recientemente' },
  { key: 'year', label: 'Año de estreno' },
  { key: 'rating', label: 'Valoración' },
  { key: 'random', label: 'Aleatorio' },
];

const DECADES = [
  { key: '', label: 'Año / Década: Todas' },
  { key: '2020', label: 'Años 2020' },
  { key: '2010', label: 'Años 2010' },
  { key: '2000', label: 'Años 2000' },
  { key: '1990', label: 'Años 90' },
  { key: '1980', label: 'Años 80' },
  { key: '1970', label: 'Años 70' },
  { key: '<1970', label: 'Clásicos (< 1970)' },
];

const QUALITIES = [
  { key: '', label: 'Calidad: Todas' },
  { key: '4k', label: '4K Ultra HD' },
  { key: '1080p', label: '1080p Full HD' },
  { key: '720p', label: '720p HD' },
  { key: 'sd', label: 'Definición estándar (SD)' },
];

const RUNTIMES = [
  { key: '', label: 'Duración: Todas' },
  { key: 'short', label: 'Corta (< 90 min)' },
  { key: 'medium', label: 'Media (90 – 120 min)' },
  { key: 'long', label: 'Larga (> 120 min)' },
];

export default function Library() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const libraryId = Number(id);

  const genre = params.get('genero') ?? '';
  const decade = params.get('decada') ?? '';
  const quality = params.get('calidad') ?? '';
  const runtime = params.get('duracion') ?? '';
  const studio = params.get('estudio') ?? '';
  const unwatched = params.get('sin_ver') ?? '';
  const sort = params.get('orden') ?? 'title';

  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });
  const { data: genres } = useQuery({ queryKey: ['genres', libraryId], queryFn: () => api.genres(libraryId) });
  const { data: studios } = useQuery({ queryKey: ['studios', libraryId], queryFn: () => api.studios(libraryId) });
  const library = libraries?.find((l) => l.id === libraryId);

  const query = useInfiniteQuery({
    queryKey: ['items', libraryId, genre, decade, quality, runtime, studio, unwatched, sort],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.items({
        library: libraryId,
        genre: genre || undefined,
        decade: decade || undefined,
        quality: quality || undefined,
        runtime: runtime || undefined,
        studio: studio || undefined,
        unwatched: unwatched || undefined,
        sort,
        limit: PAGE,
        offset: pageParam as number,
      }),
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

  const hayFiltros = Boolean(genre || decade || quality || runtime || studio || unwatched);

  const limpiarFiltros = () => {
    const next = new URLSearchParams();
    if (sort && sort !== 'title') next.set('orden', sort);
    setParams(next, { replace: true });
  };

  return (
    <div className="page-pt page-pb">
      <div className="glass-strong layer-promote sticky top-[calc(env(safe-area-inset-top,0px)+3.5rem)] z-30 border-b border-white/6 backdrop-blur-xl">
        <div className="mx-auto max-w-[1800px] px-4 py-3.5 sm:px-8">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{library?.name ?? 'Biblioteca'}</h1>
              <span className="text-sm text-mist-400">
                {total.toLocaleString('es-ES')} {total === 1 ? 'título' : 'títulos'}
                {hayFiltros ? ' con este filtro' : ''}
              </span>
            </div>
            {hayFiltros && (
              <button
                onClick={limpiarFiltros}
                className="shrink-0 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300 transition-all hover:bg-red-500/20"
              >
                Limpiar filtros ✕
              </button>
            )}
          </div>

          {/* Barra de filtros completa estilo Plex */}
          <div className="no-scrollbar flex items-center gap-2.5 overflow-x-auto pb-1">
            {/* Orden */}
            <select
              value={sort}
              onChange={(e) => update('orden', e.target.value)}
              className="shrink-0 rounded-full border border-white/10 bg-white/6 px-3.5 py-1.5 text-[13px] text-mist-200 outline-none hover:bg-white/10 cursor-pointer"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key} className="bg-ink-800 text-mist-100">
                  {s.label}
                </option>
              ))}
            </select>

            {/* Género */}
            <select
              value={genre}
              onChange={(e) => update('genero', e.target.value)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] outline-none transition-all cursor-pointer ${
                genre
                  ? 'border-sky-500/60 bg-sky-500/20 text-sky-200 font-medium'
                  : 'border-white/10 bg-white/6 text-mist-300 hover:bg-white/10'
              }`}
            >
              <option value="" className="bg-ink-800 text-mist-100">Género: Todos</option>
              {genres?.map((g) => (
                <option key={g.id} value={g.name} className="bg-ink-800 text-mist-100">
                  {g.name} ({g.count})
                </option>
              ))}
            </select>

            {/* Década / Año */}
            <select
              value={decade}
              onChange={(e) => update('decada', e.target.value)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] outline-none transition-all cursor-pointer ${
                decade
                  ? 'border-sky-500/60 bg-sky-500/20 text-sky-200 font-medium'
                  : 'border-white/10 bg-white/6 text-mist-300 hover:bg-white/10'
              }`}
            >
              {DECADES.map((d) => (
                <option key={d.key} value={d.key} className="bg-ink-800 text-mist-100">
                  {d.label}
                </option>
              ))}
            </select>

            {/* Calidad */}
            <select
              value={quality}
              onChange={(e) => update('calidad', e.target.value)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] outline-none transition-all cursor-pointer ${
                quality
                  ? 'border-sky-500/60 bg-sky-500/20 text-sky-200 font-medium'
                  : 'border-white/10 bg-white/6 text-mist-300 hover:bg-white/10'
              }`}
            >
              {QUALITIES.map((q) => (
                <option key={q.key} value={q.key} className="bg-ink-800 text-mist-100">
                  {q.label}
                </option>
              ))}
            </select>

            {/* Duración */}
            <select
              value={runtime}
              onChange={(e) => update('duracion', e.target.value)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] outline-none transition-all cursor-pointer ${
                runtime
                  ? 'border-sky-500/60 bg-sky-500/20 text-sky-200 font-medium'
                  : 'border-white/10 bg-white/6 text-mist-300 hover:bg-white/10'
              }`}
            >
              {RUNTIMES.map((r) => (
                <option key={r.key} value={r.key} className="bg-ink-800 text-mist-100">
                  {r.label}
                </option>
              ))}
            </select>

            {/* Estudio */}
            {studios && studios.length > 0 && (
              <select
                value={studio}
                onChange={(e) => update('estudio', e.target.value)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] outline-none transition-all cursor-pointer ${
                  studio
                    ? 'border-sky-500/60 bg-sky-500/20 text-sky-200 font-medium'
                    : 'border-white/10 bg-white/6 text-mist-300 hover:bg-white/10'
                }`}
              >
                <option value="" className="bg-ink-800 text-mist-100">Estudio: Todos</option>
                {studios.map((s) => (
                  <option key={s.name} value={s.name} className="bg-ink-800 text-mist-100">
                    {s.name} ({s.count})
                  </option>
                ))}
              </select>
            )}

            {/* Sin ver */}
            <button
              onClick={() => update('sin_ver', unwatched ? '' : '1')}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] whitespace-nowrap transition-all duration-200 cursor-pointer ${
                unwatched
                  ? 'border-sky-500/60 bg-sky-500/20 font-medium text-sky-200'
                  : 'border-white/10 bg-white/6 text-mist-300 hover:bg-white/12 hover:text-mist-100'
              }`}
            >
              {unwatched ? '✓ Solo no vistas' : 'No vistas'}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1800px] px-4 pt-6 sm:px-8">
        {total === 0 && !query.isFetching && (
          <div className="py-20 text-center">
            <p className="text-lg font-medium text-mist-300">No hay títulos que coincidan con estos filtros.</p>
            {hayFiltros && (
              <button
                onClick={limpiarFiltros}
                className="mt-4 rounded-full border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-300 hover:bg-sky-500/25"
              >
                Restablecer todos los filtros
              </button>
            )}
          </div>
        )}

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
