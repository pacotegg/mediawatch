import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extraThumb, extraUrl, type Extra, type ExtraTmdb } from '../lib/api.ts';

const duracion = (s: number | null) => {
  if (!s) return '';
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

const nombreSeccion = (e: Extra) => (e.grupo ? `${e.tipo} · ${e.grupo}` : e.tipo);

function Reproductor({ extra, onClose }: { extra: Extra; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-100 grid place-items-center bg-black/90 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-medium">{extra.titulo}</h3>
            <p className="text-[12px] text-mist-500">{extra.tipo}{extra.grupo ? ` · ${extra.grupo}` : ''}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-white/10 px-4 py-1.5 text-[12px] font-medium hover:bg-white/20 transition">
            Cerrar
          </button>
        </div>
        <video src={extraUrl(extra.id)} controls autoPlay className="max-h-[80vh] w-full rounded-2xl bg-black shadow-2xl" />
      </div>
    </motion.div>
  );
}

function ModalTmdb({
  itemId,
  onClose,
  onDescargado,
}: {
  itemId: number;
  onClose: () => void;
  onDescargado: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['extrasTmdb', itemId],
    queryFn: () => api.extrasTmdb(itemId),
  });

  const [descargando, setDescargando] = useState<string | null>(null);
  const [descargados, setDescargados] = useState<Set<string>>(new Set());
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);

  const videos = data?.videos ?? [];

  const handleDescargar = async (v: ExtraTmdb) => {
    setDescargando(v.key);
    setErrorDescarga(null);
    try {
      const res = await api.descargarExtra(itemId, {
        youtubeKey: v.key,
        titulo: v.name,
        tipo: v.type,
      });
      if (res.ok) {
        setDescargados((prev) => new Set(prev).add(v.key));
        onDescargado();
      } else {
        setErrorDescarga(res.error || 'Error al descargar el extra');
      }
    } catch (err) {
      setErrorDescarga((err as Error).message || 'Fallo de conexión');
    } finally {
      setDescargando(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-100 grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-panel)] p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-[17px] font-semibold tracking-tight">Buscar extras en TMDb</h3>
            <p className="mt-0.5 text-[12.5px] text-mist-400">
              Vídeos oficiales de producción, entrevistas y featurettes para descargar a su carpeta local
            </p>
          </div>
          <button onClick={onClose} className="rounded-full bg-white/8 px-3.5 py-1.5 text-[12px] hover:bg-white/14">
            Cerrar
          </button>
        </div>

        {errorDescarga && (
          <div className="mb-4 rounded-xl bg-red-500/15 border border-red-500/30 p-3 text-[12.5px] text-red-200">
            {errorDescarga}
          </div>
        )}

        {isLoading ? (
          <div className="py-12 text-center text-[13px] text-mist-500">Consultando TMDb...</div>
        ) : videos.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-mist-500">
            No se encontraron extras adicionales en TMDb para este título.
          </div>
        ) : (
          <div className="space-y-2.5">
            {videos.map((v) => {
              const estaDescargando = descargando === v.key;
              const yaDescargado = descargados.has(v.key);
              return (
                <div
                  key={v.key}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-3 hover:bg-white/8 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-mist-300">
                        {v.type}
                      </span>
                      {v.official && (
                        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">Oficial</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-[13px] font-medium text-mist-100">{v.name}</p>
                  </div>

                  <button
                    disabled={estaDescargando || yaDescargado}
                    onClick={() => handleDescargar(v)}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-medium transition ${
                      yaDescargado
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : estaDescargando
                          ? 'bg-accent/30 text-accent animate-pulse cursor-wait'
                          : 'bg-mist-100 text-ink-950 hover:bg-white active:scale-95'
                    }`}
                  >
                    {yaDescargado ? '✓ Descargado' : estaDescargando ? 'Descargando...' : 'Descargar'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

export default function Extras({ itemId, isAdmin }: { itemId: number; isAdmin?: boolean }) {
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<string | null>(null);
  const [viendo, setViendo] = useState<Extra | null>(null);
  const [buscandoTmdb, setBuscandoTmdb] = useState(false);

  const { data } = useQuery({
    queryKey: ['extras', itemId],
    queryFn: () => api.extras(itemId),
    staleTime: 5 * 60_000,
  });

  const extras = useMemo(() => data?.extras ?? [], [data]);

  const secciones = useMemo(() => {
    const mapa = new Map<string, Extra[]>();
    for (const e of extras) {
      const clave = nombreSeccion(e);
      const lista = mapa.get(clave);
      if (lista) lista.push(e);
      else mapa.set(clave, [e]);
    }
    return [...mapa.entries()];
  }, [extras]);

  const visibles = useMemo(() => {
    if (!filtro) return extras;
    return secciones.find(([n]) => n === filtro)?.[1] ?? extras;
  }, [extras, filtro, secciones]);

  if (extras.length === 0 && !isAdmin) return null;

  return (
    <div className="mt-12" id="extras">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[17px] font-semibold tracking-tight">Material adicional y Extras</h2>
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] font-medium text-mist-400">
            {extras.length}
          </span>
        </div>

        {isAdmin && (
          <button
            onClick={() => setBuscandoTmdb(true)}
            className="flex items-center gap-1.5 rounded-full bg-white/8 px-3.5 py-1.5 text-[12px] font-medium text-mist-200 hover:bg-white/14 hover:text-white transition active:scale-95"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Añadir extras desde TMDb
          </button>
        )}
      </div>

      {extras.length === 0 ? (
        <div className="glass rounded-[var(--radius-panel)] p-6 text-center text-[13px] text-mist-400">
          No hay vídeos adicionales en el disco. Pulsa en «Añadir extras desde TMDb» para descargar entrevistas, featurettes o cómo se hizo directamente a la carpeta de la biblioteca.
        </div>
      ) : (
        <>
          {secciones.length > 1 && (
            <div className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setFiltro(null)}
                className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] transition ${
                  filtro === null ? 'bg-mist-100 font-medium text-ink-950' : 'bg-white/6 text-mist-300 hover:bg-white/12'
                }`}
              >
                Todos ({extras.length})
              </button>
              {secciones.map(([nombre, lista]) => (
                <button
                  key={nombre}
                  onClick={() => setFiltro(nombre)}
                  className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] transition ${
                    filtro === nombre ? 'bg-mist-100 font-medium text-ink-950' : 'bg-white/6 text-mist-300 hover:bg-white/12'
                  }`}
                >
                  {nombre} ({lista.length})
                </button>
              ))}
            </div>
          )}

          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-4 pt-1">
            {visibles.map((e) => (
              <button
                key={e.id}
                onClick={() => setViendo(e)}
                className="group relative w-60 shrink-0 text-left transition-transform duration-200 hover:scale-[1.02]"
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/10 group-hover:ring-white/30">
                  <img
                    src={extraThumb(e.id)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    onError={(ev) => { (ev.target as HTMLImageElement).style.visibility = 'hidden'; }}
                  />
                  <div className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-ink-950 shadow-lg transition-transform group-hover:scale-110">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                      </svg>
                    </div>
                  </div>
                  <span className="absolute left-2 top-2 rounded-md bg-ink-950/75 backdrop-blur-md px-1.5 py-0.5 text-[10px] font-medium text-mist-200 border border-white/10">
                    {e.tipo}
                  </span>
                  {e.duration ? (
                    <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 text-[10.5px] font-mono text-mist-300">
                      {duracion(e.duration)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-snug text-mist-100 group-hover:text-accent">
                  {e.titulo}
                </p>
                {e.grupo && <p className="text-[11px] text-mist-500 mt-0.5">{e.grupo}</p>}
              </button>
            ))}
          </div>
        </>
      )}

      <AnimatePresence>
        {viendo && <Reproductor extra={viendo} onClose={() => setViendo(null)} />}
        {buscandoTmdb && (
          <ModalTmdb
            itemId={itemId}
            onClose={() => setBuscandoTmdb(false)}
            onDescargado={() => queryClient.invalidateQueries({ queryKey: ['extras', itemId] })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
