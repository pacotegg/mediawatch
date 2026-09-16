import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PosterCard from '../components/PosterCard.tsx';
import { api, img, type CollectionSummary } from '../lib/api.ts';

function CollectionCard({ collection, index }: { collection: CollectionSummary; index: number }) {
  const years = collection.first_year
    ? collection.last_year && collection.last_year !== collection.first_year
      ? `${collection.first_year}–${collection.last_year}`
      : String(collection.first_year)
    : '';

  return (
    <Link
      to={`/saga/${encodeURIComponent(collection.name)}`}
      className="group fade-up block"
      style={{ ['--i' as string]: index }}
    >
      <div className="relative aspect-16/9 overflow-hidden rounded-[var(--radius-card)] bg-ink-800 shadow-[var(--shadow-2)] ring-1 ring-white/8 transition-transform duration-[420ms] ease-[cubic-bezier(0.34,1.4,0.64,1)] will-change-transform group-hover:-translate-y-1 group-hover:scale-[1.02] group-hover:ring-white/20">
        {collection.fanart_id && (
          <img src={img.fanart(collection.fanart_id, 640)} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
        <div className="scrim-b absolute inset-0" />

        {collection.poster_id && (
          <img
            src={img.poster(collection.poster_id, 200)}
            alt=""
            loading="lazy"
            className="absolute bottom-3 left-3 h-20 w-auto rounded-md shadow-[var(--shadow-2)] ring-1 ring-white/20"
          />
        )}

        <div className="absolute right-3 bottom-3 left-28 text-right">
          <div className="truncate text-[13px] font-semibold text-shadow-hero">{collection.name}</div>
          <div className="text-[11px] text-mist-300">
            {collection.count} títulos{years && ` · ${years}`}
          </div>
          {collection.seen ? (
            <div className="mt-1 text-[11px] text-accent">
              {collection.seen} de {collection.count} vistas
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function CollectionsIndex() {
  const { data, isLoading } = useQuery({ queryKey: ['collections'], queryFn: api.collections });

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-24 pb-24 sm:px-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sagas</h1>
      <p className="mb-8 text-sm text-mist-500">
        {data ? `${data.length} colecciones con más de un título` : 'Cargando…'}
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {data?.map((collection, i) => (
          <div key={collection.name} className="cull">
            <CollectionCard collection={collection} index={i} />
          </div>
        ))}
        {isLoading && Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton aspect-16/9 rounded-[var(--radius-card)]" />)}
      </div>
    </div>
  );
}

export function CollectionDetail() {
  const { name } = useParams<{ name: string }>();
  const { data } = useQuery({ queryKey: ['collection', name], queryFn: () => api.collection(name!) });

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-24 pb-24 sm:px-8">
      <Link to="/sagas" className="text-[12px] text-mist-500 transition-colors hover:text-mist-100">
        ← Todas las sagas
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold tracking-tight">{data?.name ?? name}</h1>
      <p className="mb-8 text-sm text-mist-500">{data ? `${data.items.length} títulos, en orden cronológico` : ''}</p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
        {data?.items.map((item, i) => (
          <div key={item.id} className="cull">
            <PosterCard item={item} index={i} />
          </div>
        ))}
      </div>
    </div>
  );
}
