import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, img } from '../lib/api.ts';

/**
 * «Novedades desde tu última visita», arriba de la portada. Solo aparece si hay algo; «Entendido» lo marca
 * como visto para este perfil (en todos sus aparatos).
 */
export default function Novedades({ sinPortada = false }: { sinPortada?: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['novedades'], queryFn: api.novedades, staleTime: 5 * 60_000 });
  const vistas = useMutation({
    mutationFn: api.novedadesVistas,
    onSuccess: () => queryClient.setQueryData(['novedades'], { desde: null, total: 0, items: [] }),
  });
  if (!data || data.total === 0) return null;
  const resto = data.total - data.items.length;
  return (
    <section className={`mx-4 ${sinPortada ? 'mt-24' : ''} rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 sm:mx-10`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-mist-100">Novedades desde tu última visita</div>
          <div className="text-[12px] text-mist-500">
            {data.total === 1 ? 'Ha llegado 1 título' : `Han llegado ${data.total} títulos`} (o episodios nuevos de una serie)
          </div>
        </div>
        <button
          onClick={() => vistas.mutate()}
          disabled={vistas.isPending}
          className="rounded-xl bg-white/10 px-3 py-1.5 text-[12.5px] text-mist-100 transition hover:bg-white/16 disabled:opacity-50"
        >
          Entendido
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {data.items.map((i) => (
          <Link key={i.id} to={`/titulo/${i.id}`} className="w-[92px] shrink-0" title={i.title}>
            <img src={img.poster(i.id, 200)} alt="" loading="lazy" className="aspect-[2/3] w-full rounded-lg bg-white/5 object-cover" />
            <div className="mt-1 truncate text-[11.5px] text-mist-300">{i.title}</div>
          </Link>
        ))}
        {resto > 0 && <div className="flex w-[92px] shrink-0 items-center justify-center text-[12px] text-mist-500">y {resto} más</div>}
      </div>
    </section>
  );
}
