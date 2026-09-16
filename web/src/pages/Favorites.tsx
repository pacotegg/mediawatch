import { useQuery } from '@tanstack/react-query';
import PosterCard from '../components/PosterCard.tsx';
import { api } from '../lib/api.ts';

export default function Favorites() {
  const { data, isLoading } = useQuery({ queryKey: ['favorites'], queryFn: api.favorites });

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-24 pb-24 sm:px-8">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Favoritos</h1>
      {!isLoading && data?.length === 0 && (
        <p className="mt-16 text-center text-mist-500">Todavía no has marcado ningún título como favorito.</p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
        {data?.map((item, i) => (
          <div key={item.id} className="cull">
            <PosterCard item={item} index={i} />
          </div>
        ))}
      </div>
    </div>
  );
}
