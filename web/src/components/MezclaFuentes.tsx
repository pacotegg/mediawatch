import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './Controls.tsx';
import { api, img, type FichaFuente, type FuenteDatos, type Proposal, type ScraperTitulo } from '../lib/api.ts';

/*
 * Todas las fuentes de un título lado a lado. Cada dato (cartel, sinopsis, nota…) se ofrece con el nombre de la fuente de la que viene y
 * su idioma, y eliges de cuál tomarlo; lo que no eliges se queda como está. Se aplica de una vez y se deshace de una vez.
 */

type Campo = 'poster' | 'fanart' | 'logo' | 'plot' | 'rating' | 'genres' | 'mpaa';

const FUENTES: Record<FuenteDatos, { nombre: string; punto: string }> = {
  tmdb: { nombre: 'TMDb', punto: 'bg-sky-400' },
  tvdb: { nombre: 'TVDB', punto: 'bg-emerald-400' },
  omdb: { nombre: 'OMDb', punto: 'bg-amber-400' },
  tvmaze: { nombre: 'TVmaze', punto: 'bg-violet-400' },
};
/** Si dos fuentes tienen el dato, de cuál se parte: las de español primero. */
const PRIORIDAD: FuenteDatos[] = ['tmdb', 'tvdb', 'omdb', 'tvmaze'];

const FILAS: { c: Campo; etiqueta: string; de: (f: FichaFuente) => string | number | string[] | null }[] = [
  { c: 'poster', etiqueta: 'Póster', de: (f) => f.posterUrl },
  { c: 'fanart', etiqueta: 'Fondo', de: (f) => f.backdropUrl },
  { c: 'logo', etiqueta: 'Logo', de: (f) => f.logoUrl },
  { c: 'plot', etiqueta: 'Sinopsis', de: (f) => f.overview },
  { c: 'rating', etiqueta: 'Valoración', de: (f) => f.rating },
  { c: 'genres', etiqueta: 'Géneros', de: (f) => (f.genres.length ? f.genres : null) },
  { c: 'mpaa', etiqueta: 'Edad recomendada', de: (f) => f.certificacion },
];

const Insignia = ({ f }: { f: FichaFuente }) => (
  <span className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide text-mist-200 uppercase">
    <span className={`h-1.5 w-1.5 rounded-full ${FUENTES[f.fuente].punto}`} />{FUENTES[f.fuente].nombre}
    <span className="rounded bg-white/10 px-1 py-px text-[9.5px] font-medium text-mist-400">{f.idioma}</span>
  </span>
);

function Valor({ c, f }: { c: Campo; f: FichaFuente }) {
  if (c === 'poster' && f.posterUrl) return <img src={f.posterUrl.replace('/original/', '/w342/')} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-28 rounded-md shadow-[0_8px_16px_-6px_rgb(0_0_0/0.85)] ring-1 ring-white/12" />;
  if (c === 'fanart' && f.backdropUrl) return <img src={f.backdropUrl.replace('/original/', '/w300/')} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-20 rounded-md ring-1 ring-white/12" />;
  if (c === 'logo' && f.logoUrl) return <img src={f.logoUrl.replace('/original/', '/w300/')} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-12 max-w-40 object-contain" />;
  if (c === 'plot') return <p className="line-clamp-4 text-[12px] leading-relaxed text-mist-300">{f.overview}</p>;
  if (c === 'rating') return <span className="text-[15px] font-semibold tabular-nums">{f.rating?.toFixed(1)}{f.votos ? <span className="ml-1.5 text-[11px] font-normal text-mist-500">{f.votos.toLocaleString('es-ES')} votos</span> : null}</span>;
  if (c === 'genres') return <span className="text-[12px] text-mist-300">{f.genres.join(', ')}</span>;
  return <span className="text-[13px] font-medium">{f.certificacion}</span>;
}

function Actual({ c, t }: { c: Campo; t: ScraperTitulo }) {
  if (c === 'poster') return t.poster ? <img src={img.poster(t.id, 300, t.arte_actualizado)} alt="" className="h-28 rounded-md ring-1 ring-white/12" /> : null;
  if (c === 'fanart') return t.fanart ? <img src={img.fanart(t.id, 500, t.arte_actualizado)} alt="" className="h-20 rounded-md ring-1 ring-white/12" /> : null;
  if (c === 'logo') return t.logo ? <img src={img.logo(t.id, 300, t.arte_actualizado)} alt="" className="h-12 max-w-40 object-contain" /> : null;
  if (c === 'plot') return t.plot ? <p className="line-clamp-4 text-[12px] leading-relaxed text-mist-400">{t.plot}</p> : null;
  if (c === 'rating') return t.rating != null ? <span className="text-[15px] font-semibold tabular-nums">{t.rating.toFixed(1)}</span> : null;
  if (c === 'mpaa') return t.mpaa ? <span className="text-[13px] font-medium">{t.mpaa}</span> : null;
  return null; // los géneros actuales no vienen en la ficha del scraper
}

export default function MezclaFuentes({ titulo, p }: { titulo: ScraperTitulo; p: Proposal }) {
  const qc = useQueryClient();
  const ids = p.tmdbId ? { tmdbId: p.tmdbId } : { imdbId: p.imdbId ?? undefined };
  const { data, isLoading, error } = useQuery({
    queryKey: ['fuentes-ficha', titulo.kind, ids.tmdbId ?? ids.imdbId],
    queryFn: () => api.fuentesFicha(titulo.kind, ids),
    staleTime: 60_000,
    retry: false,
  });
  const [sel, setSel] = useState<Partial<Record<Campo, FuenteDatos>>>({});
  const [hecho, setHecho] = useState('');
  const [fallo, setFallo] = useState('');

  // Al llegar las fuentes: donde el título no tiene el dato se parte de la primera fuente que lo tenga (español antes que inglés); lo que ya tiene se conserva.
  useEffect(() => {
    if (!data) return;
    const inicial: Partial<Record<Campo, FuenteDatos>> = {};
    for (const { c, de } of FILAS) {
      if (c === 'genres') continue;
      const tiene = c === 'poster' ? !!titulo.poster : c === 'fanart' ? !!titulo.fanart : c === 'logo' ? !!titulo.logo : c === 'plot' ? !!titulo.plot : c === 'rating' ? titulo.rating != null : !!titulo.mpaa;
      if (tiene) continue;
      const fuente = PRIORIDAD.find((fu) => { const f = data.fichas.find((x) => x.fuente === fu); return f && de(f) != null; });
      if (fuente) inicial[c] = fuente;
    }
    setSel(inicial); setHecho(''); setFallo('');
  }, [data, titulo.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicar = useMutation({
    mutationFn: () => api.aplicarMezcla({ itemId: titulo.id, kind: titulo.kind, tmdbId: data!.ids.tmdbId ?? undefined, imdbId: data!.ids.imdbId ?? undefined, elecciones: sel as Record<string, FuenteDatos> }),
    onSuccess: (r) => {
      setHecho(`Aplicado: ${r.aplicado.map((a) => `${FILAS.find((f) => f.c === a.campo)!.etiqueta.toLowerCase()} de ${FUENTES[a.fuente].nombre}`).join(', ')}.`);
      setFallo('');
      for (const k of ['scraper-titulo', 'scraper-historial', 'scraper-lista', 'item', 'home']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => setFallo(e.message),
  });

  if (isLoading) return <p className="rounded-2xl bg-black/20 p-5 text-[12.5px] text-mist-500 ring-1 ring-white/6">Consultando TMDb, TVDB, OMDb y TVmaze…</p>;
  if (error || !data) return <p className="text-[12.5px] text-red-400">{(error as Error | null)?.message ?? 'No se han podido consultar las fuentes'}</p>;
  const elegidas = Object.keys(sel).length;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-gradient-to-r from-accent/12 to-transparent p-4 ring-1 ring-accent/20">
        <div className="text-[10.5px] font-medium tracking-[0.16em] text-accent/80 uppercase">Todas las fuentes · {data.fichas.length} respondieron</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{data.fichas.map((f) => (
          <span key={f.fuente} className="flex items-center gap-2 text-[12.5px]">
            <Insignia f={f} />
            <span className="text-mist-400">{f.title}{f.year ? ` (${f.year})` : ''}</span>
            {f.enlace && <a href={f.enlace} target="_blank" rel="noreferrer" className="text-mist-600 hover:text-accent">↗</a>}
          </span>
        ))}</div>
        {data.avisos.length > 0 && <p className="mt-2 text-[11.5px] text-amber-200/90">{data.avisos.join(' · ')}</p>}
        <p className="mt-2 text-[11.5px] text-mist-500">Elige de qué fuente tomar cada dato. «es» y «en» es el idioma en que viene. Lo que no marques se queda como está.</p>
      </div>

      {FILAS.map(({ c, etiqueta, de }) => {
        const opciones = data.fichas.filter((f) => de(f) != null);
        const actual = <Actual c={c} t={titulo} />;
        return (
          <div key={c} className="rounded-2xl bg-black/20 p-3 ring-1 ring-white/6">
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold">{etiqueta}
              {c === 'genres' && <span className="font-normal text-mist-600">· se sustituyen por los de la fuente elegida</span>}
            </div>
            {opciones.length === 0
              ? <p className="text-[12px] text-mist-600">Ninguna fuente tiene este dato.</p>
              : (
                <div className="flex flex-wrap gap-2">
                  {c !== 'genres' && (
                    <button onClick={() => setSel((s) => { const n = { ...s }; delete n[c]; return n; })}
                      className={`flex min-w-32 max-w-60 flex-col items-start gap-1.5 rounded-xl p-2.5 text-left transition-all ${!sel[c] ? 'bg-white/10 ring-1 ring-white/25' : 'bg-white/4 opacity-70 ring-1 ring-white/8 hover:opacity-100'}`}>
                      <span className="text-[10.5px] font-semibold tracking-wide text-mist-300 uppercase">Lo de ahora</span>
                      {actual ?? <span className="text-[12px] text-mist-600">vacío</span>}
                    </button>
                  )}
                  {c === 'genres' && (
                    <button onClick={() => setSel((s) => { const n = { ...s }; delete n[c]; return n; })}
                      className={`flex min-w-32 flex-col items-start gap-1.5 rounded-xl p-2.5 text-left transition-all ${!sel[c] ? 'bg-white/10 ring-1 ring-white/25' : 'bg-white/4 opacity-70 ring-1 ring-white/8 hover:opacity-100'}`}>
                      <span className="text-[10.5px] font-semibold tracking-wide text-mist-300 uppercase">Dejarlos como están</span>
                    </button>
                  )}
                  {opciones.map((f) => (
                    <button key={f.fuente} onClick={() => setSel((s) => ({ ...s, [c]: f.fuente }))}
                      className={`flex min-w-32 max-w-60 flex-col items-start gap-1.5 rounded-xl p-2.5 text-left transition-all ${sel[c] === f.fuente ? 'bg-gradient-to-b from-accent/16 to-accent/4 shadow-[0_0_22px_-8px_rgb(240_165_74/0.55)] ring-1 ring-accent/50' : 'bg-white/4 ring-1 ring-white/8 hover:bg-white/8'}`}>
                      <Insignia f={f} />
                      <Valor c={c} f={f} />
                    </button>
                  ))}
                </div>
              )}
          </div>
        );
      })}

      {fallo && <p className="text-[12.5px] text-red-400">{fallo}</p>}
      {hecho && <p className="text-[12.5px] text-emerald-400">{hecho}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => aplicar.mutate()} disabled={aplicar.isPending || elegidas === 0}>{aplicar.isPending ? 'Guardando…' : `Aplicar ${elegidas ? `(${elegidas})` : ''}`}</Button>
        <span className="text-[11.5px] text-mist-600">Se guarda en la base de datos y en data/artwork; no se escribe nada en la biblioteca. Un solo «Deshacer» lo revierte todo.</span>
      </div>
    </div>
  );
}
