import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';

/*
 * Botón «Tráiler»: solo aparece si TMDb tiene alguno (el servidor elige:
 * castellano si es de 720p o más, si no el inglés oficial de más resolución).
 * Se ve incrustado con el reproductor de YouTube, sin descargar nada: en la
 * web se puede incrustar directamente (en la tele no, ver media/trailers.ts).
 *
 * Con `temporada`, solo se enseña si esa temporada tiene tráiler propio: el
 * servidor daría el de la serie, que ya tiene su botón arriba.
 */
export default function Trailer({ itemId, temporada, texto = 'Tráiler' }: { itemId: number; temporada?: number; texto?: string }) {
  const { data } = useQuery({
    queryKey: ['trailer', itemId, temporada ?? null],
    queryFn: () => api.trailer(itemId, temporada),
    staleTime: 3600_000,
  });
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [abierto]);

  const t = data?.trailer;
  if (!t || (temporada !== undefined && t.de !== 'temporada')) return null;

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="glass rounded-full px-4 py-2.5 text-sm transition-transform duration-200 hover:scale-105 active:scale-95"
      >
        {texto}
      </button>
      {abierto && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-100 grid place-items-center bg-black/90 p-4"
          onClick={() => setAbierto(false)}
        >
          <div className="w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setAbierto(false)} className="rounded-full bg-white/8 px-3 py-1.5 text-[12px] hover:bg-white/14">
                Cerrar
              </button>
            </div>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${t.youtube}?autoplay=1&rel=0&iv_load_policy=3`}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              title={texto}
              className="aspect-video w-full rounded-xl bg-black"
            />
          </div>
        </motion.div>
      )}
    </>
  );
}
