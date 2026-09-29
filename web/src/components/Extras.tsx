import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { api, extraThumb, extraUrl, type Extra } from '../lib/api.ts';

/*
 * Los extras de un título: featurettes, «cómo se hizo», escenas eliminadas.
 * Estaban en el disco desde siempre —1.111 ficheros repartidos por 126
 * títulos— pero el escáner saltaba esas carpetas y no había forma de verlos.
 *
 * Van detrás de un botón y no en la ficha: son muchos en algunos títulos y
 * ninguno en la mayoría, así que ocuparían sitio para nada casi siempre.
 *
 * Y detrás del botón hay dos niveles, porque Breaking Bad tiene 143 y Fringe
 * 75: primero las secciones —el tipo, y la temporada cuando el disco los trae
 * repartidos— y dentro las miniaturas. Con menos de un puñado se entra directo
 * a las miniaturas, que para seis vídeos un menú sobra.
 */

const DIRECTO = 10;

const duracion = (s: number | null) => {
  if (!s) return '';
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

/** «Featurette · Temporada 3», o solo el tipo cuando no van por temporada. */
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
          <h3 className="truncate text-[14px] font-medium">{extra.titulo}</h3>
          <button onClick={onClose} className="shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-[12px] hover:bg-white/14">
            Cerrar
          </button>
        </div>
        <video src={extraUrl(extra.id)} controls autoPlay className="max-h-[80vh] w-full rounded-xl bg-black" />
      </div>
    </motion.div>
  );
}

function Rejilla({ extras, onVer }: { extras: Extra[]; onVer: (e: Extra) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {extras.map((e) => (
        <button key={e.id} onClick={() => onVer(e)} className="group text-left">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-white/5">
            <img
              src={extraThumb(e.id)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition group-hover:scale-105"
              onError={(ev) => { (ev.target as HTMLImageElement).style.visibility = 'hidden'; }}
            />
            {e.duration ? (
              <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px]">
                {duracion(e.duration)}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug">{e.titulo}</p>
        </button>
      ))}
    </div>
  );
}

export default function Extras({ itemId }: { itemId: number }) {
  const [abierto, setAbierto] = useState(false);
  const [seccion, setSeccion] = useState<string | null>(null);
  const [viendo, setViendo] = useState<Extra | null>(null);
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

  // Sin extras no hay boton: no se anuncia una ventana que saldria vacia.
  if (extras.length === 0) return null;

  const porSecciones = extras.length > DIRECTO && secciones.length > 1;
  const cerrar = () => { setAbierto(false); setSeccion(null); };
  const visibles = seccion ? (secciones.find(([n]) => n === seccion)?.[1] ?? []) : extras;

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="rounded-full bg-white/8 px-4 py-2 text-[13px] font-medium hover:bg-white/14"
      >
        Extras ({extras.length})
      </button>

      {abierto && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-90 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={cerrar}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-panel)] p-5"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">{seccion ?? 'Extras'}</h2>
                <p className="mt-1 text-[12.5px] text-mist-500">
                  {visibles.length} {visibles.length === 1 ? 'vídeo' : 'vídeos'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {seccion && (
                  <button
                    onClick={() => setSeccion(null)}
                    className="rounded-full bg-white/8 px-3 py-1.5 text-[12px] hover:bg-white/14"
                  >
                    Volver
                  </button>
                )}
                <button onClick={cerrar} className="rounded-full bg-white/8 px-3 py-1.5 text-[12px] hover:bg-white/14">
                  Cerrar
                </button>
              </div>
            </div>

            {porSecciones && !seccion ? (
              <div className="flex flex-col gap-1.5">
                {secciones.map(([nombre, lista]) => (
                  <button
                    key={nombre}
                    onClick={() => setSeccion(nombre)}
                    className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 text-left text-[13.5px] hover:bg-white/10"
                  >
                    <span>{nombre}</span>
                    <span className="text-[12px] text-mist-500">{lista.length}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Rejilla extras={visibles} onVer={setViendo} />
            )}
          </motion.div>
        </motion.div>
      )}

      {viendo && <Reproductor extra={viendo} onClose={() => setViendo(null)} />}
    </>
  );
}
