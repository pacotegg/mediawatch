/**
 * Corregir la numeración de episodios de una serie.
 *
 * Nada se escribe sin verse antes: se pide un plan, se muestra el antes y el
 * después de cada episodio, y el botón de aplicar solo aparece cuando hay algo
 * que mover. Se puede deshacer mientras la serie conserve el número que traía
 * del disco.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PlanNumeracion } from '../lib/api.ts';

type Modo = 'tmdb' | 'manual' | 'desplazar' | 'deshacer';

export default function NumeracionFixer({ showId, onClose }: { showId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<Modo>('tmdb');
  const [reparto, setReparto] = useState('');
  const [temporada, setTemporada] = useState(1);
  const [desde, setDesde] = useState(1);
  const [delta, setDelta] = useState(-1);
  const [plan, setPlan] = useState<PlanNumeracion | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const estado = useQuery({ queryKey: ['numeracion', showId], queryFn: () => api.numeracion(showId), retry: false });

  const pedirPlan = useMutation({
    mutationFn: () =>
      api.numeracionPlan(showId, {
        modo,
        reparto: reparto
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
        temporada,
        desde,
        delta,
      }),
    onSuccess: (p) => {
      setPlan(p);
      setHecho(null);
    },
  });

  const aplicar = useMutation({
    mutationFn: () => api.numeracionAplicar(showId, plan as PlanNumeracion),
    onSuccess: (r) => {
      setHecho(`${r.movidos} episodios renumerados`);
      setPlan(null);
      estado.refetch();
      queryClient.invalidateQueries({ queryKey: ['item', showId] });
    },
  });

  const error = (pedirPlan.error ?? aplicar.error ?? estado.error) as Error | null;
  const e = estado.data;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-90 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onClick={(ev) => ev.stopPropagation()}
        className="glass-strong max-h-[86vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-panel)] p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Numeración de episodios</h2>
            <p className="mt-1 text-[12.5px] text-mist-500">
              Reparte una serie que viene numerada de corrido, o corrige un desfase. Se ve el resultado antes de guardarlo.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-[12px] hover:bg-white/14">
            Cerrar
          </button>
        </div>

        {e && (
          <div className="mb-4 rounded-xl bg-white/5 p-3 text-[12.5px]">
            <div className="font-medium">
              {e.titulo} · {e.total} episodios
            </div>
            <div className="mt-1 text-mist-500">
              {e.temporadas.map((t) => `T${t.temporada}: ${t.episodios}`).join(' · ')}
            </div>
            {e.motivo && (
              <div className={`mt-2 ${e.tipo === 'absoluta' ? 'text-accent' : 'text-mist-400'}`}>
                {e.tipo === 'hueco' ? 'Falta un fichero, no es un fallo de numeración: ' : ''}
                {e.motivo}
              </div>
            )}
          </div>
        )}

        <div className="mb-3 flex flex-wrap gap-1.5">
          {(
            [
              ['tmdb', 'Repartir según TMDb'],
              ['manual', 'Reparto a mano'],
              ['desplazar', 'Desplazar números'],
              ['deshacer', 'Volver al original'],
            ] as [Modo, string][]
          ).map(([valor, texto]) => (
            <button
              key={valor}
              onClick={() => {
                setModo(valor);
                setPlan(null);
              }}
              disabled={valor === 'deshacer' && !e?.renumerado}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-30 ${
                modo === valor ? 'bg-mist-100 font-semibold text-ink-950' : 'bg-white/8 hover:bg-white/14'
              }`}
            >
              {texto}
            </button>
          ))}
        </div>

        {modo === 'manual' && (
          <label className="mb-3 block text-[12.5px] text-mist-400">
            Episodios por temporada, separados por espacios o comas
            <input
              value={reparto}
              onChange={(ev) => setReparto(ev.target.value)}
              placeholder="12 13 13 26"
              className="mt-1 w-full rounded-lg bg-white/8 px-3 py-2 text-[13px] outline-none focus:bg-white/12"
            />
          </label>
        )}

        {modo === 'desplazar' && (
          <div className="mb-3 grid grid-cols-3 gap-2 text-[12.5px] text-mist-400">
            <label>
              Temporada
              <input
                type="number"
                value={temporada}
                onChange={(ev) => setTemporada(Number(ev.target.value))}
                className="mt-1 w-full rounded-lg bg-white/8 px-3 py-2 text-[13px] outline-none focus:bg-white/12"
              />
            </label>
            <label>
              Desde el episodio
              <input
                type="number"
                value={desde}
                onChange={(ev) => setDesde(Number(ev.target.value))}
                className="mt-1 w-full rounded-lg bg-white/8 px-3 py-2 text-[13px] outline-none focus:bg-white/12"
              />
            </label>
            <label>
              Sumar
              <input
                type="number"
                value={delta}
                onChange={(ev) => setDelta(Number(ev.target.value))}
                className="mt-1 w-full rounded-lg bg-white/8 px-3 py-2 text-[13px] outline-none focus:bg-white/12"
              />
            </label>
          </div>
        )}

        <button
          onClick={() => pedirPlan.mutate()}
          disabled={pedirPlan.isPending}
          className="rounded-full bg-white/12 px-4 py-2 text-[13px] font-medium hover:bg-white/20 disabled:opacity-40"
        >
          {pedirPlan.isPending ? 'Calculando…' : 'Ver qué cambiaría'}
        </button>

        {error && <p className="mt-3 text-[13px] text-red-400">{error.message}</p>}
        {hecho && <p className="mt-3 text-[13px] text-accent">{hecho}</p>}

        {plan && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
              <span className="font-medium">{plan.mueve} episodios se moverían</span>
              <span className="text-mist-500">· {plan.origen}</span>
              {plan.reparto.length > 0 && (
                <span className="text-mist-500">· reparto {plan.reparto.map((r) => r.episodios).join(' + ')}</span>
              )}
            </div>
            {plan.aviso && <p className="mb-2 text-[12.5px] text-amber-400">{plan.aviso}</p>}

            {plan.mueve === 0 ? (
              <p className="text-[13px] text-mist-500">La numeración ya coincide, no hay nada que cambiar.</p>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto rounded-xl bg-black/25">
                  <table className="w-full text-left text-[12.5px]">
                    <tbody>
                      {plan.cambios
                        .filter((c) => c.cambia)
                        .map((c) => (
                          <tr key={c.episodeId} className="border-b border-white/5 last:border-0">
                            <td className="w-20 py-1.5 pl-3 font-mono text-mist-500">{c.antes}</td>
                            <td className="w-6 text-mist-600">→</td>
                            <td className="w-20 font-mono text-accent">{c.despues}</td>
                            <td className="truncate py-1.5 pr-3 text-mist-400">{c.titulo}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                <button
                  onClick={() => aplicar.mutate()}
                  disabled={aplicar.isPending}
                  className="mt-3 rounded-full bg-mist-100 px-5 py-2 text-[13px] font-semibold text-ink-950 hover:scale-105 disabled:opacity-40"
                >
                  {aplicar.isPending ? 'Guardando…' : `Aplicar a ${plan.mueve} episodios`}
                </button>
              </>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
