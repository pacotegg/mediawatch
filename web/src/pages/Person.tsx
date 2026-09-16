import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import PosterCard from '../components/PosterCard.tsx';
import { api, img } from '../lib/api.ts';

export default function Person() {
  const { id } = useParams<{ id: string }>();
  const personId = Number(id);
  const { data } = useQuery({ queryKey: ['person', personId], queryFn: () => api.person(personId) });

  if (!data) return <div className="pt-32 text-center text-mist-500">Cargando…</div>;

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-24 pb-24 sm:px-8">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-10 flex items-center gap-5"
      >
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-ink-800 ring-1 ring-white/10">
          {data.has_thumb ? (
            <img src={img.person(personId, 240)} alt={data.name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-3xl text-mist-600">{data.name.charAt(0)}</div>
          )}
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{data.name}</h1>
          <p className="mt-1 text-sm text-mist-500">{data.credits.length} títulos en tu biblioteca</p>
        </div>
      </motion.div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
        {data.credits.map((item, i) => (
          <div key={`${item.id}-${item.role}`} className="cull">
            <PosterCard item={item} index={i} />
            {item.character && <div className="mt-0.5 truncate px-0.5 text-[11px] text-mist-600">{item.character}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
