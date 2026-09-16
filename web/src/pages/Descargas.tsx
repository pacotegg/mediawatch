/**
 * Descargas para ver sin conexión.
 *
 * El servidor prepara una copia ligera y aquí solo se ve el estado y el enlace.
 * La descarga en sí la hace el navegador con su propio gestor: en el móvil eso
 * es lo que permite dejarla en segundo plano y reanudarla si se va la wifi.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { api } from '../lib/api.ts';

function tamano(bytes: number | null) {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export default function Descargas() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['descargas'],
    queryFn: () => api.descargas(),
    // Mientras algo se está preparando conviene refrescar; parado, no.
    refetchInterval: (q) => (q.state.data?.descargas.some((d) => d.estado === 'preparando') ? 2000 : false),
  });

  const borrar = useMutation({
    mutationFn: (id: number) => api.descargaBorrar(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['descargas'] }),
  });

  useEffect(() => {
    document.title = 'Descargas · Media Watch';
  }, []);

  if (isLoading) return <div className="p-8 text-[13px] text-mist-500">Cargando…</div>;
  if (error) return <div className="p-8 text-[13px] text-red-400">{(error as Error).message}</div>;

  const descargas = data?.descargas ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-[900px] px-4 py-8 sm:px-8"
    >
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Descargas</h1>
      <p className="mb-6 text-[13px] text-mist-500">
        Copias preparadas para llevártelas. Una vez bajadas son ficheros tuyos: se ven sin servidor y sin caducidad.
      </p>

      {descargas.length === 0 ? (
        <div className="glass rounded-[var(--radius-panel)] p-6 text-[13px] text-mist-500">
          Todavía no has pedido ninguna. Se piden desde la ficha de cada película, con el botón de descargar.
        </div>
      ) : (
        <div className="space-y-2">
          {descargas.map((d) => (
            <div key={d.id} className="glass flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{d.titulo}</div>
                <div className="mt-0.5 text-[12px] text-mist-500">
                  {d.perfil === 'original' ? 'Fichero original' : d.perfil === 'movil' ? 'Móvil · 480p' : 'Tablet · 720p'}
                  {d.bytes ? ` · ${tamano(d.bytes)}` : ''}
                  {d.estado === 'preparando' ? ` · preparando ${d.progreso}%` : ''}
                </div>
                {d.estado === 'preparando' && (
                  <div className="mt-1.5 h-1.5 w-full max-w-xs rounded-full bg-white/8">
                    <div className="h-1.5 rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(2, d.progreso)}%` }} />
                  </div>
                )}
                {d.estado === 'error' && <div className="mt-1 text-[12px] text-red-400">{d.error}</div>}
              </div>

              {d.estado === 'lista' && (
                <a
                  href={api.descargaUrl(d.id)}
                  download
                  className="rounded-full bg-mist-100 px-4 py-2 text-[12.5px] font-semibold text-ink-950 transition-transform hover:scale-105"
                >
                  Descargar
                </a>
              )}
              <button
                onClick={() => borrar.mutate(d.id)}
                className="rounded-full bg-white/8 px-3 py-2 text-[12.5px] hover:bg-white/16"
                title={d.perfil === 'original' ? 'Quita el enlace; el fichero de la biblioteca no se toca' : 'Borra la copia del servidor'}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-[12px] text-mist-600">
        ¿Buscas algo que descargar? Entra en cualquier <Link to="/" className="underline hover:text-mist-300">película o serie</Link> y usa el botón de descargar de su ficha.
      </p>
    </motion.div>
  );
}
