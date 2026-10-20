import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './Controls.tsx';
import { api, type FilaNueva } from '../lib/api.ts';
import EnviarTitulos from './EnviarTitulos.tsx';

/*
 * Asistente de títulos nuevos: el flujo de tinyMediaManager (actualizar fuentes → escrapear → renombrar) sobre una selección.
 *
 *   1. Buscar     TMDb propone un emparejado para cada título sin identificar. No se aplica nada.
 *   2. Aplicar    ficha completa y arte de los que aceptas (base de datos y data/artwork; la biblioteca no se toca).
 *   3. Renombrar  carpeta (Título (Año)) y fichero (Título (Año) 1080p AC3) como los dejaba tMM. Se ve la lista COMPLETA de cambios
 *                 y solo se hace si la confirmas; es lo único que escribe en la biblioteca. Un título que falla no frena a los demás.
 */

const CONFIANZA = {
  segura: ['Segura', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25'],
  probable: ['Probable', 'bg-amber-500/15 text-amber-300 ring-amber-500/25'],
  dudosa: ['Dudosa · revísala', 'bg-red-500/15 text-red-300 ring-red-500/25'],
  ninguna: ['Sin resultados', 'bg-white/8 text-mist-500 ring-white/10'],
} as const;

const pequena = (url: string | null) => (url ? url.replace('/original/', '/w92/') : null);

function Barra({ hechos, total }: { hechos: number; total: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
      <div className="h-full bg-accent transition-all" style={{ width: `${total ? Math.round((100 * hechos) / total) : 0}%` }} />
    </div>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="glass space-y-3 rounded-[var(--radius-panel)] p-5">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold"><span className="grid h-5 w-5 place-items-center rounded-full bg-white/12 text-[11px]">{n}</span>{titulo}</h3>
      {children}
    </section>
  );
}

type Eleccion = { tmdbId: number | null; incluir: boolean };

export default function AsistenteNuevos() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['scraper-nuevos'],
    queryFn: api.scraperNuevos,
    refetchInterval: (q) => (q.state.data && (q.state.data.busqueda.corriendo || q.state.data.aplicacion.corriendo || q.state.data.renombrado.corriendo) ? 1200 : false),
    refetchIntervalInBackground: true,
  });
  const [limite, setLimite] = useState(40);
  const [eleccion, setEleccion] = useState<Record<number, Eleccion>>({});
  const [copiarArte, setCopiarArte] = useState(true);
  const [escribirNfo, setEscribirNfo] = useState(true);
  const [error, setError] = useState('');
  const refrescar = () => qc.invalidateQueries({ queryKey: ['scraper-nuevos'] });

  const filas = data?.busqueda.resultados ?? [];
  // Al llegar resultados nuevos se parte de lo razonable: aceptar lo seguro y lo probable, no lo dudoso.
  useEffect(() => {
    setEleccion((prev) => {
      const sig = { ...prev };
      for (const f of filas) if (!(f.itemId in sig)) sig[f.itemId] = { tmdbId: f.propuesta?.tmdbId ?? null, incluir: f.confianza === 'segura' || f.confianza === 'probable' };
      return sig;
    });
  }, [filas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const elegidas = useMemo(() => filas.filter((f) => eleccion[f.itemId]?.incluir && eleccion[f.itemId]?.tmdbId), [filas, eleccion]);

  const buscar = useMutation({ mutationFn: () => api.scraperNuevosBuscar(limite), onSuccess: () => { setEleccion({}); setError(''); refrescar(); }, onError: (e: Error) => setError(e.message) });
  const aplicar = useMutation({
    mutationFn: () => api.scraperNuevosAplicar(elegidas.map((f) => ({ itemId: f.itemId, tmdbId: eleccion[f.itemId].tmdbId! }))),
    onSuccess: () => { setError(''); refrescar(); },
    onError: (e: Error) => setError(e.message),
  });

  const aplicados = (data?.aplicacion.resultados ?? []).filter((r) => r.ok).map((r) => r.itemId);
  const [verPlan, setVerPlan] = useState(false);
  const plan = useQuery({ queryKey: ['scraper-lote-plan', aplicados.join(',')], queryFn: () => api.scraperLotePlan(aplicados), enabled: verPlan && aplicados.length > 0, staleTime: 0 });
  const conCambios = (plan.data?.planes ?? []).filter((p) => !p.error && p.pasos.length > 0);
  const renombrar = useMutation({
    mutationFn: () => api.scraperLoteAplicar(conCambios.map((p) => p.itemId), copiarArte, escribirNfo),
    onSuccess: () => { setError(''); refrescar(); qc.invalidateQueries({ queryKey: ['scraper-lista'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const b = data?.busqueda;
  const a = data?.aplicacion;
  const r = data?.renombrado;
  const cambiar = (f: FilaNueva, tmdbId: number) => setEleccion((p) => ({ ...p, [f.itemId]: { tmdbId, incluir: true } }));

  return (
    <div className="space-y-5">
      <Paso n={1} titulo="Buscar coincidencias de los títulos nuevos">
        <p className="text-[12.5px] text-mist-500">
          Hay <b className="text-mist-200">{data?.pendientes ?? '…'}</b> títulos sin identificar (sin id de TMDb). TMDb propone un emparejado para cada uno; todavía no se aplica nada.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={limite} onChange={(e) => setLimite(Number(e.target.value))} className="rounded-xl border border-white/8 bg-white/6 px-3 py-2 text-[13px]">
            {[10, 20, 40, 80, 150].map((n) => <option key={n} value={n} className="bg-ink-900">{n} títulos</option>)}
          </select>
          <Button onClick={() => buscar.mutate()} disabled={b?.corriendo || buscar.isPending || (data?.pendientes ?? 0) === 0}>{b?.corriendo ? `Buscando ${b.hechos}/${b.total}…` : 'Buscar coincidencias'}</Button>
        </div>
        {b?.corriendo && <Barra hechos={b.hechos} total={b.total} />}
        {b?.error && <p className="text-[12.5px] text-red-400">{b.error}</p>}

        {filas.length > 0 && (
          <div className="space-y-2">
            {filas.map((f) => {
              const e = eleccion[f.itemId];
              const opciones = [...(f.propuesta ? [f.propuesta] : []), ...f.alternativas];
              const actual = opciones.find((o) => o.tmdbId === e?.tmdbId) ?? f.propuesta;
              const [etiqueta, tono] = CONFIANZA[f.confianza];
              return (
                <div key={f.itemId} className={`flex gap-3 rounded-xl p-2.5 ${e?.incluir ? 'bg-white/6' : 'bg-white/3 opacity-70'}`}>
                  <input type="checkbox" className="mt-1 accent-[var(--color-accent,#7c8cff)]" disabled={!actual} checked={Boolean(e?.incluir && actual)}
                    onChange={(ev) => setEleccion((p) => ({ ...p, [f.itemId]: { tmdbId: p[f.itemId]?.tmdbId ?? actual?.tmdbId ?? null, incluir: ev.target.checked } }))} />
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-ink-800">{actual?.posterUrl && <img src={pequena(actual.posterUrl)!} alt="" className="h-full w-full object-cover" />}</div>
                  <div className="min-w-0 flex-1 text-[12.5px]">
                    <div className="truncate text-mist-500">{f.titulo}{f.anio ? ` (${f.anio})` : ''} · {f.biblioteca}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{actual ? `${actual.title} (${actual.year ?? 's/f'})` : 'Sin propuesta'}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10.5px] ring-1 ${tono}`}>{etiqueta}</span>
                    </div>
                    {opciones.length > 1 && (
                      <select value={actual?.tmdbId ?? ''} onChange={(ev) => cambiar(f, Number(ev.target.value))} className="mt-1 max-w-full rounded-lg border border-white/8 bg-white/6 px-2 py-1 text-[11.5px]">
                        {opciones.map((o) => <option key={o.tmdbId} value={o.tmdbId} className="bg-ink-900">{o.title} ({o.year ?? 's/f'}) · TMDb {o.tmdbId}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Paso>

      {filas.length > 0 && !b?.corriendo && (
        <Paso n={2} titulo="Aplicar los datos">
          <p className="text-[12.5px] text-mist-500">
            Se aplicará a <b className="text-mist-200">{elegidas.length}</b> títulos: título, año, sinopsis, valoración, reparto, estudios, país y el arte (cartel, fondo y logo, ya en WebP). Se guarda en la base de datos y en
            <span className="text-mist-300"> data/artwork</span>; <b>la biblioteca no se toca</b>. Cada título puede deshacerse desde su ficha.
          </p>
          <Button onClick={() => aplicar.mutate()} disabled={elegidas.length === 0 || a?.corriendo || aplicar.isPending}>{a?.corriendo ? `Aplicando ${a.hechos}/${a.total}…` : `Aplicar a ${elegidas.length} títulos`}</Button>
          {a?.corriendo && <Barra hechos={a.hechos} total={a.total} />}
          {a && !a.corriendo && a.resultados.length > 0 && (
            <ul className="space-y-1 text-[12.5px]">
              {a.resultados.map((x) => <li key={x.itemId} className={x.ok ? 'text-emerald-300' : 'text-red-400'}>{x.ok ? '✓' : '✗'} {x.titulo}{x.error ? ` — ${x.error}` : ''}</li>)}
            </ul>
          )}
        </Paso>
      )}

      {aplicados.length > 0 && !a?.corriendo && (
        <Paso n={3} titulo="Renombrar carpetas y ficheros como tMM">
          {!verPlan && <Button onClick={() => setVerPlan(true)}>Ver los cambios de nombre ({aplicados.length} títulos)</Button>}
          {verPlan && plan.isLoading && <p className="text-[12.5px] text-mist-500">Calculando…</p>}
          {plan.data && (
            <>
              <p className="text-[12.5px] text-mist-400">Esto es <b>exactamente</b> lo que se va a renombrar <b>en la biblioteca</b> (nada se borra, y cada fichero conserva su id):</p>
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                {plan.data.planes.map((p) => (
                  <details key={p.itemId} className="rounded-xl bg-white/4 px-3 py-2 text-[12px]" open={Boolean(p.error)}>
                    <summary className="cursor-pointer font-medium">
                      {p.titulo} <span className={p.error ? 'text-red-400' : p.pasos.length ? 'text-emerald-300' : 'text-mist-500'}>
                        {p.error ? '· no se puede' : p.pasos.length ? `· ${p.pasos.length} cambios` : '· ya está organizado'}</span>
                    </summary>
                    {p.error && <p className="mt-1 text-red-400">{p.error}</p>}
                    <ul className="mt-1 space-y-1">
                      {p.pasos.map((s, i) => (
                        <li key={i}><div className="break-all text-mist-500">{s.tipo === 'carpeta' ? 'carpeta ' : ''}{s.desde}</div><div className="break-all text-emerald-300">→ {s.final}</div></li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-mist-300">
                <input type="checkbox" checked={copiarArte} onChange={(e) => setCopiarArte(e.target.checked)} className="accent-[var(--color-accent,#7c8cff)]" />
                Copiar también el arte a la carpeta de cada título (para Plex y otros programas)
              </label>
              <label className="flex items-start gap-2 text-[12.5px] text-mist-300">
                <input type="checkbox" checked={escribirNfo} onChange={(e) => setEscribirNfo(e.target.checked)} className="mt-0.5 accent-[var(--color-accent,#7c8cff)]" />
                <span>Escribir también el NFO en cada carpeta <span className="text-mist-500">(como tMM: así los datos viajan con la carpeta cuando la muevas a la biblioteca y el escaneo de allí los recupera)</span></span>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={() => renombrar.mutate()} disabled={conCambios.length === 0 || r?.corriendo || renombrar.isPending}>
                  {r?.corriendo ? `Renombrando ${r.hechos}/${r.total}…` : `Sí, renombrar ${conCambios.length} títulos en la biblioteca`}
                </Button>
                <span className="text-[11.5px] text-mist-600">Plex los verá como nuevos hasta que reescanee la biblioteca.</span>
              </div>
              {r?.corriendo && <Barra hechos={r.hechos} total={r.total} />}
              {r && !r.corriendo && r.resultados.length > 0 && (
                <ul className="space-y-1 text-[12.5px]">
                  {r.resultados.map((x) => <li key={x.itemId} className={x.ok ? 'text-emerald-300' : 'text-red-400'}>{x.ok ? '✓' : '✗'} {x.titulo}{x.ok ? ` — ${x.movidos} cambios${x.detalle ? `, ${x.detalle}` : ''}` : ` — ${x.error}`}</li>)}
                </ul>
              )}
            </>
          )}
        </Paso>
      )}
      {r && !r.corriendo && r.resultados.some((x) => x.ok) && (
        <Paso n={4} titulo="Enviar a la biblioteca (opcional)">
          <p className="text-[12.5px] text-mist-500">Si los preparaste en la carpeta de entrada, puedes mandarlos ya a la biblioteca que elijas, en vez de moverlos a mano.</p>
          <EnviarTitulos ids={r.resultados.filter((x) => x.ok).map((x) => x.itemId)} kind={filas.find((f) => f.itemId === r.resultados[0].itemId)?.kind ?? 'movie'} />
        </Paso>
      )}
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}
    </div>
  );
}
