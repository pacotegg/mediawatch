import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PosterCard from '../components/PosterCard.tsx';
import { api, img, type DialogueHit } from '../lib/api.ts';
import { clock } from '../lib/format.ts';

function DialogueResults({ hits, count }: { hits: DialogueHit[]; count: number }) {
  const navigate = useNavigate();
  if (hits.length === 0) return null;

  return (
    <div className="mb-10">
      <h2 className="mb-1 text-[15px] font-semibold text-mist-300">Diálogos</h2>
      <p className="mb-4 text-[11.5px] text-mist-600">
        Entre {count.toLocaleString('es-ES')} frases indexadas. Al pulsar, la película empieza en ese momento.
      </p>
      <div className="space-y-1.5">
        {hits.map((hit, i) => (
          <button
            key={`${hit.fileId}-${hit.startMs}-${i}`}
            onClick={() => {
              const params = new URLSearchParams({ item: String(hit.itemId), t: String(Math.max(0, Math.floor(hit.startMs / 1000) - 3)) });
              if (hit.episodeId) params.set('ep', String(hit.episodeId));
              navigate(`/ver/${hit.fileId}?${params}`);
            }}
            className="flex w-full items-baseline gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/6"
          >
            <span className="shrink-0 font-mono text-[11px] text-mist-600 tabular-nums">{clock(hit.startMs / 1000)}</span>
            <span
              className="min-w-0 flex-1 truncate text-[13px] text-mist-200 [&_b]:text-accent"
              dangerouslySetInnerHTML={{
                __html: hit.snippet.replace(/«/g, '<b>').replace(/»/g, '</b>'),
              }}
            />
            <span className="shrink-0 text-[11.5px] text-mist-500">
              {hit.title}
              {hit.season ? ` · T${hit.season}E${hit.episode}` : hit.year ? ` · ${hit.year}` : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Mandar lo escrito aquí al buscador de la televisión.
 *
 * Teclear un título con las flechas del mando son cuarenta y tantas
 * pulsaciones; el teléfono ya tiene teclado y ya tiene la sesión abierta. La
 * tele lo recoge sola si está en su pantalla de buscar, y eso es justo lo que
 * hay que decirle a quien pulsa: si no está ahí, no pasa nada.
 */
function EnviarALaTele({ term }: { term: string }) {
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'enviado' | 'fallo'>('listo');

  if (term.trim().length < 2) return null;

  const enviar = () => {
    setEstado('enviando');
    api
      .buscarEnLaTele(term)
      .then(() => {
        setEstado('enviado');
        window.setTimeout(() => setEstado('listo'), 4000);
      })
      .catch(() => setEstado('fallo'));
  };

  return (
    <div className="mb-8 flex flex-wrap items-center gap-3">
      <button
        onClick={enviar}
        disabled={estado === 'enviando'}
        className="rounded-full bg-white/10 px-4 py-2 text-[13px] font-medium transition-colors hover:bg-white/18 disabled:opacity-50"
      >
        Enviar a la tele
      </button>
      <span className="text-[12px] text-mist-600">
        {estado === 'enviado'
          ? 'Enviado. Si la tele está en Buscar, ya lo tiene.'
          : estado === 'fallo'
            ? 'No se pudo enviar.'
            : 'La tele lo recoge en su pantalla de Buscar.'}
      </span>
    </div>
  );
}

export default function Search() {
  const [params] = useSearchParams();
  const term = params.get('q') ?? '';
  const { data, isFetching } = useQuery({
    queryKey: ['search', term],
    queryFn: () => api.search(term),
    enabled: term.trim().length >= 2,
  });

  const { data: dialogue } = useQuery({
    queryKey: ['search-dialogue', term],
    queryFn: () => api.searchDialogue(term),
    enabled: term.trim().length >= 3,
  });

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-24 pb-24 sm:px-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        {term ? <>Resultados para «{term}»</> : 'Buscar'}
      </h1>
      {data && <p className="mb-4 text-sm text-mist-500">{data.items.length} títulos · {data.people.length} personas</p>}

      <EnviarALaTele term={term} />

      {dialogue && <DialogueResults hits={dialogue.hits} count={dialogue.stats.frases} />}

      {data?.people && data.people.length > 0 && (
        <div className="mb-10">
          <h2 className="mb-4 text-[15px] font-semibold text-mist-300">Personas</h2>
          <div className="no-scrollbar flex gap-5 overflow-x-auto pb-2">
            {data.people.map((person) => (
              <Link key={person.id} to={`/persona/${person.id}`} className="group w-[92px] shrink-0 text-center">
                <div className="mb-2 aspect-square overflow-hidden rounded-full bg-ink-800 ring-1 ring-white/8 transition-all group-hover:scale-105 group-hover:ring-white/25">
                  {person.has_thumb ? (
                    <img src={img.person(person.id, 160)} alt={person.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-lg text-mist-600">{person.name.charAt(0)}</div>
                  )}
                </div>
                <div className="truncate text-[12px]">{person.name}</div>
                <div className="text-[11px] text-mist-600">{person.count} títulos</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
        {data?.items.map((item, i) => (
          <div key={item.id} className="cull">
            <PosterCard item={item} index={i} />
          </div>
        ))}
        {isFetching && Array.from({ length: 12 }).map((_, i) => <div key={i} className="skeleton aspect-2/3 rounded-[var(--radius-card)]" />)}
      </div>

      {term.length >= 2 && !isFetching && data?.items.length === 0 && data.people.length === 0 && (
        <p className="mt-16 text-center text-mist-500">Nada por aquí. Prueba con otro título.</p>
      )}
    </div>
  );
}
