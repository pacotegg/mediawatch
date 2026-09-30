import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type FichaPlataforma } from '../lib/api.ts';

/**
 * Catálogo de las plataformas del usuario (Movistar+, Prime, Apple TV+).
 *
 * Aquí NO se reproduce nada: esos servicios van cifrados con DRM y solo
 * entregan vídeo a sus propias apps. Esto enseña qué hay y, si el título
 * resulta estar en la biblioteca, lleva a la copia de casa, que sí se ve.
 *
 * Las carátulas se piden al servidor propio y no a image.tmdb.org: la app de la
 * tele tiene `img-src` sin `https:` y las bloquearía en silencio. Aquí la web no
 * lo necesita, pero se usa la misma ruta para no mantener dos caminos y para
 * aprovechar la caché en disco.
 */

const ORDENES = [
  { clave: 'popular', etiqueta: 'Populares' },
  { clave: 'nuevo', etiqueta: 'Novedades' },
  { clave: 'nota', etiqueta: 'Mejor valoradas' },
];

function Tarjeta({ ficha }: { ficha: FichaPlataforma }) {
  const cuerpo = (
    <>
      <div className="relative aspect-2/3 overflow-hidden rounded-[var(--radius-card)] bg-ink-800 ring-1 ring-white/8 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-[1.03]">
        {ficha.poster ? (
          <img
            src={`/api/plataformas/caratula/w342${ficha.poster}`}
            alt={ficha.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-[12px] text-mist-500">{ficha.title}</div>
        )}
        {ficha.enBiblioteca !== null && (
          <span className="absolute top-2 left-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-ink-950">
            En tu biblioteca
          </span>
        )}
      </div>
      <div className="mt-1.5 truncate text-[13px] text-mist-200">{ficha.title}</div>
      <div className="text-[12px] text-mist-600">{ficha.year ?? ''}</div>
    </>
  );

  // Lo que ya está en casa se abre en casa; lo demás no lleva a ningún sitio
  // porque no hay nada que reproducir aquí.
  return ficha.enBiblioteca !== null ? (
    <Link to={`/titulo/${ficha.enBiblioteca}`} className="group block w-full">{cuerpo}</Link>
  ) : (
    <div className="group block w-full">{cuerpo}</div>
  );
}

export default function Plataformas() {
  const { clave } = useParams<{ clave: string }>();
  const [kind, setKind] = useState<'movie' | 'show'>('movie');
  const [orden, setOrden] = useState('popular');
  const [pagina, setPagina] = useState(1);

  const { data: info } = useQuery({ queryKey: ['plataformas'], queryFn: api.plataformas, staleTime: 3600_000 });
  const activa = clave ?? info?.plataformas[0]?.clave;

  const { data, isLoading, error } = useQuery({
    queryKey: ['catalogo', activa, kind, orden, pagina],
    queryFn: () => api.catalogoPlataforma(activa!, kind, orden, pagina),
    enabled: Boolean(activa),
    staleTime: 600_000,
  });

  const cambiar = (fn: () => void) => { fn(); setPagina(1); };

  return (
    <div className="px-6 py-6 sm:px-10">
      <h1 className="mb-1 text-2xl font-semibold">Plataformas</h1>
      <p className="mb-5 max-w-[720px] text-[13px] text-mist-500">
        Lo que hay en tus suscripciones. No se reproduce aquí: estos servicios van cifrados y solo
        se ven en su propia aplicación. Lo que ya tienes en casa aparece marcado y se abre en tu biblioteca.
        {/* TMDb exige citar a JustWatch como origen de estos datos; si no, revoca la clave. */}
        <span className="mt-1 block text-[12px] text-mist-600">
          Disponibilidad: JustWatch, vía TMDb. Enlaces directos:{' '}
          <a href="https://www.watchmode.com" target="_blank" rel="noreferrer" className="underline">Watchmode</a>.
        </span>
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {(info?.plataformas ?? []).map((p) => (
          <Link
            key={p.clave}
            to={`/plataformas/${p.clave}`}
            onClick={() => setPagina(1)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium ${p.clave === activa ? 'bg-mist-100 text-ink-950' : 'bg-white/8 text-mist-200 hover:bg-white/14'}`}
          >
            {p.nombre}
          </Link>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {(['movie', 'show'] as const).map((k) => (
          <button
            key={k}
            onClick={() => cambiar(() => setKind(k))}
            className={`rounded-full px-3 py-1 text-[12px] ${k === kind ? 'bg-white/18 text-mist-100' : 'bg-white/6 text-mist-400 hover:bg-white/12'}`}
          >
            {k === 'movie' ? 'Películas' : 'Series'}
          </button>
        ))}
        <span className="mx-1 w-px bg-white/10" />
        {ORDENES.map((o) => (
          <button
            key={o.clave}
            onClick={() => cambiar(() => setOrden(o.clave))}
            className={`rounded-full px-3 py-1 text-[12px] ${o.clave === orden ? 'bg-white/18 text-mist-100' : 'bg-white/6 text-mist-400 hover:bg-white/12'}`}
          >
            {o.etiqueta}
          </button>
        ))}
      </div>

      {error && <p className="text-[13px] text-red-400">No se pudo pedir el catálogo: {(error as Error).message}</p>}
      {isLoading && <p className="text-[13px] text-mist-500">Cargando…</p>}

      {data && (
        <>
          <p className="mb-3 text-[12px] text-mist-600">
            {data.total.toLocaleString('es-ES')} títulos · página {pagina} de {data.paginas}
          </p>
          <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {data.items.map((f) => <Tarjeta key={f.tmdbId} ficha={f} />)}
          </div>
          <div className="mt-7 flex items-center justify-center gap-3">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1}
              className="rounded-full bg-white/8 px-4 py-1.5 text-[13px] disabled:opacity-35"
            >
              Anterior
            </button>
            <button
              onClick={() => setPagina((p) => Math.min(data.paginas, p + 1))}
              disabled={pagina >= data.paginas}
              className="rounded-full bg-white/8 px-4 py-1.5 text-[13px] disabled:opacity-35"
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </div>
  );
}
