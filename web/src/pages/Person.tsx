import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import PosterCard from '../components/PosterCard.tsx';
import { api, img } from '../lib/api.ts';

export default function Person() {
  const { id } = useParams<{ id: string }>();
  const personId = Number(id);
  const navigate = useNavigate();
  const [expandirBio, setExpandirBio] = useState(false);
  const { data, isLoading, refetch } = useQuery({ queryKey: ['person', personId], queryFn: () => api.person(personId) });

  if (isLoading) {
    return (
      <div className="page-pt mx-auto max-w-[1800px] px-4 sm:px-8">
        <div className="skeleton mb-8 h-28 w-96 rounded-2xl" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton aspect-2/3 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-pt mx-auto max-w-[800px] px-6 py-24 text-center">
        <h2 className="mb-3 text-2xl font-bold text-white">No se pudo cargar esta persona</h2>
        <p className="mb-6 text-[14px] text-mist-500">Hubo un problema de conexión con el servidor.</p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => refetch()}
            className="rounded-xl bg-accent px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-accent-hover"
          >
            Reintentar
          </button>
          <button
            onClick={() => navigate(-1)}
            className="rounded-xl bg-white/10 px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-white/16"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  const bio = data.detalle?.biography?.trim();
  const fechas = [
    data.detalle?.birthday ? `Nacimiento: ${data.detalle.birthday}` : null,
    data.detalle?.deathday ? `Fallecimiento: ${data.detalle.deathday}` : null,
    data.detalle?.place_of_birth ? data.detalle.place_of_birth : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="mx-auto max-w-[1800px] px-4 page-pt page-pb sm:px-8">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-8"
      >
        <div className="flex items-center gap-5 mb-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full bg-ink-800 ring-1 ring-white/10">
            {data.has_thumb ? (
              <img src={img.person(personId, 240)} alt={data.name} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-3xl text-mist-600">{data.name.charAt(0)}</div>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{data.name}</h1>
            <p className="mt-1 text-sm text-mist-500">
              {data.credits.length} títulos en tu biblioteca
              {fechas ? ` · ${fechas}` : ''}
            </p>
          </div>
        </div>

        {bio && (
          <div className="max-w-4xl rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
            <p className={`text-[13.5px] leading-relaxed text-mist-300 ${!expandirBio && bio.length > 300 ? 'line-clamp-3' : ''}`}>
              {bio}
            </p>
            {bio.length > 300 && (
              <button
                onClick={() => setExpandirBio(!expandirBio)}
                className="mt-2 text-[12px] font-medium text-accent hover:underline"
              >
                {expandirBio ? 'Mostrar menos' : 'Leer biografía completa'}
              </button>
            )}
          </div>
        )}
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
