import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Casilla, TextInput } from './Controls.tsx';
import { api, img, type FilaNueva, type Proposal } from '../lib/api.ts';
import SelectorDeArte from './SelectorDeArte.tsx';
import EnviarTitulos from './EnviarTitulos.tsx';

/*
 * Asistente: el flujo de tinyMediaManager sobre los ficheros de tus fuentes.
 *
 *   1. Elegir      aparece la LISTA de ficheros de la fuente y marcas los que quieres escrapear. No se busca nada por su cuenta.
 *   2. Emparejar   TMDb propone una coincidencia para cada marcado; puedes cambiarla o buscar otra a mano (título, id o dirección).
 *   3. Aplicar     ficha completa y arte por defecto de los que aceptas (base de datos y data/artwork; la biblioteca no se toca).
 *   4. Arte        (opcional) elegir cartel, fondo, logo, horizontal y disco entre los de TMDb y fanart.tv, o subir uno propio.
 *   5. Renombrar   carpeta (Título (Año)) y fichero (Título (Año) 1080p AC3) como los dejaba tMM, con la lista completa y una confirmación.
 *   6. Enviar      (opcional) a la biblioteca que elijas, en vez de moverlo a mano.
 */

const CONFIANZA = {
  segura: ['Segura', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25'],
  probable: ['Probable', 'bg-amber-500/15 text-amber-300 ring-amber-500/25'],
  dudosa: ['Dudosa · revísala', 'bg-red-500/15 text-red-300 ring-red-500/25'],
  ninguna: ['Sin resultados', 'bg-white/8 text-mist-500 ring-white/10'],
} as const;

const pequena = (url: string | null) => (url ? url.replace('/original/', '/w342/') : null);
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');

function Barra({ hechos, total }: { hechos: number; total: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/30 ring-1 ring-white/6">
      <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft shadow-[0_0_10px_rgb(240_165_74/0.6)] transition-all duration-500" style={{ width: `${total ? Math.round((100 * hechos) / total) : 0}%` }} />
    </div>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="glass space-y-4 rounded-[var(--radius-panel)] p-5 sm:p-6">
      <h3 className="flex items-center gap-3 text-[16px] font-semibold tracking-tight">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-soft to-accent text-[12px] font-bold text-ink-950 shadow-[0_0_14px_rgb(240_165_74/0.45)]">{n}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

type Eleccion = { tmdbId: number | null; incluir: boolean };

/** Búsqueda manual para una fila: título, id de TMDb, id de IMDb o dirección de su página (como «buscar» de tMM). */
function BuscarOtra({ fila, alEncontrar }: { fila: FilaNueva; alEncontrar: (p: Proposal[]) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(fila.titulo);
  const [aviso, setAviso] = useState('');
  const buscar = useMutation({
    mutationFn: () => api.scraperResolver(texto, fila.kind, null),
    onSuccess: (r) => { alEncontrar(r.propuestas); setAviso(r.aviso ?? (r.propuestas.length ? '' : 'Sin resultados')); },
    onError: (e: Error) => setAviso(e.message),
  });
  if (!abierto) return <button onClick={() => setAbierto(true)} className="mt-1 text-[11.5px] text-accent hover:underline underline-offset-2">Buscar otra…</button>;
  return (
    <form className="mt-1 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (texto.trim()) buscar.mutate(); }}>
      <TextInput value={texto} onChange={setTexto} placeholder="Título, id de TMDb, tt… o dirección" className="w-64 max-w-full" />
      <Button variant="ghost" onClick={() => texto.trim() && buscar.mutate()} disabled={buscar.isPending}>{buscar.isPending ? 'Buscando…' : 'Buscar'}</Button>
      {aviso && <span className="text-[11.5px] text-mist-500">{aviso}</span>}
    </form>
  );
}

/** Un título ya aplicado: se ve su arte actual y se puede abrir el selector (el mismo de la ficha) para cambiarlo. */
function FilaArte({ id, titulo, kind }: { id: number; titulo: string; kind: 'movie' | 'show' }) {
  const { data: t } = useQuery({ queryKey: ['scraper-titulo', id], queryFn: () => api.scraperTitulo(id) });
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="rounded-2xl bg-white/4 p-4 ring-1 ring-white/6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-wrap gap-3">
          <div className="h-60 w-40 overflow-hidden rounded-xl bg-ink-800 shadow-[0_14px_28px_-8px_rgb(0_0_0/0.85)] ring-1 ring-white/12">{t?.poster ? <img src={img.poster(id, 400, t.arte_actualizado)} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[12px] text-mist-600">Sin cartel</div>}</div>
          <div className="h-60 w-[26rem] max-w-full overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/10">{t?.fanart ? <img src={img.fanart(id, 800, t.arte_actualizado)} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[12px] text-mist-600">Sin fondo</div>}</div>
          <div className="grid h-60 w-56 place-items-center overflow-hidden rounded-xl bg-ink-800 p-3 ring-1 ring-white/10">{t?.logo ? <img src={img.logo(id, 500, t.arte_actualizado)} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[12px] text-mist-600">Sin logo</span>}</div>
        </div>
        <div className="min-w-0 flex-1 text-[14px]">
          <div className="font-semibold">{t?.title ?? titulo}{t?.year ? <span className="font-normal text-mist-500"> ({t.year})</span> : null}</div>
          <div className="text-[12px] text-mist-600">{[t?.poster ? 'cartel' : null, t?.fanart ? 'fondo' : null, t?.logo ? 'logo' : null].filter(Boolean).join(' · ') || 'sin arte'}</div>
        </div>
        <Button variant="ghost" onClick={() => setAbierto((v) => !v)}>{abierto ? 'Cerrar' : 'Elegir imágenes…'}</Button>
      </div>
      {abierto && (
        <div className="mt-3">
          <SelectorDeArte itemId={id} kind={kind} titulo={t?.title ?? titulo} anio={t?.year ?? null} tmdbId={t?.tmdb_id ? Number(t.tmdb_id) : null} />
        </div>
      )}
    </div>
  );
}

export default function AsistenteNuevos() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['scraper-nuevos'],
    queryFn: api.scraperNuevos,
    refetchInterval: (q) => (q.state.data && (q.state.data.busqueda.corriendo || q.state.data.aplicacion.corriendo || q.state.data.renombrado.corriendo) ? 1200 : false),
    refetchIntervalInBackground: true,
  });

  // 1. La lista de ficheros y lo marcado.
  const [fuente, setFuente] = useState('');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [todos, setTodos] = useState(false);
  // Claves: `i:<id>` para lo ya registrado, `r:<ruta>` para lo que hay en el disco y el servidor aun no ha analizado.
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  useEffect(() => { const t = setTimeout(() => setQ(texto), 250); return () => clearTimeout(t); }, [texto]);
  const lista = useQuery({ queryKey: ['scraper-nuevos-lista', fuente, q, todos], queryFn: () => api.scraperNuevosLista({ biblioteca: fuente, q, todos }), placeholderData: (p) => p });
  const items = lista.data?.items ?? [];
  const nuevos = lista.data?.sinRegistrar ?? [];
  const fuentes = lista.data?.fuentes ?? [];
  const alternar = (clave: string) => setMarcados((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n; });
  const clavesVisibles = [...nuevos.map((n) => `r:${n.ruta}`), ...items.map((i) => `i:${i.id}`)];
  const visiblesMarcados = clavesVisibles.filter((c) => marcados.has(c)).length;

  // 2. El emparejado.
  const [eleccion, setEleccion] = useState<Record<number, Eleccion>>({});
  const [extras, setExtras] = useState<Record<number, Proposal[]>>({});
  const [error, setError] = useState('');
  const [copiarArte, setCopiarArte] = useState(true);
  const [escribirNfo, setEscribirNfo] = useState(true);
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

  const buscar = useMutation({
    mutationFn: () => api.scraperNuevosBuscar([...marcados].filter((c) => c.startsWith('i:')).map((c) => Number(c.slice(2))), [...marcados].filter((c) => c.startsWith('r:')).map((c) => c.slice(2))),
    onSuccess: () => { setEleccion({}); setExtras({}); setError(''); refrescar(); },
    onError: (e: Error) => setError(e.message),
  });
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

  return (
    <div className="space-y-5">
      <Paso n={1} titulo="Elige qué ficheros escrapear">
        <div className="flex flex-wrap items-center gap-2">
          <select value={fuente} onChange={(e) => setFuente(e.target.value)} className="rounded-full border border-white/8 bg-black/25 px-4 py-2 text-[13px] outline-none transition-colors focus:border-accent/40">
            <option value="" className="bg-ink-900">Todas las fuentes</option>
            {fuentes.map((f) => <option key={f.ruta} value={f.ruta} className="bg-ink-900">{f.name} ({f.pendientes} sin escrapear)</option>)}
          </select>
          <TextInput value={texto} onChange={setTexto} placeholder="Buscar en la lista…" className="w-56" />
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-mist-400">
            <Casilla marcada={todos} onChange={setTodos} />
            Mostrar también los ya escrapeados
          </label>
          <Button variant="ghost" onClick={() => lista.refetch()} disabled={lista.isFetching}>{lista.isFetching ? 'Mirando…' : 'Actualizar lista'}</Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <span className="tabular-nums text-mist-500">{items.length + nuevos.length} ficheros · {marcados.size} marcados</span>
          <button className="font-medium text-accent hover:underline underline-offset-2" onClick={() => setMarcados((s) => new Set([...s, ...clavesVisibles]))}>Marcar todos los de la lista</button>
          <button className="text-mist-500 hover:underline underline-offset-2" onClick={() => setMarcados(new Set())}>Quitar marcas</button>
        </div>

        <div className="max-h-96 space-y-1 overflow-y-auto rounded-2xl bg-black/20 p-1.5 ring-1 ring-white/6">
          {nuevos.map((n) => (
            <label key={n.ruta} className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors ${marcados.has(`r:${n.ruta}`) ? 'bg-gradient-to-r from-accent/16 via-accent/6 to-transparent ring-1 ring-accent/25' : 'hover:bg-white/6'}`}>
              <Casilla marcada={marcados.has(`r:${n.ruta}`)} onChange={() => alternar(`r:${n.ruta}`)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{n.carpeta}</div>
                <div className="text-[11px] text-mist-600">{n.biblioteca} · {n.tipo === 'video' ? 'Vídeo suelto' : 'Carpeta con vídeo'} · en el disco, aún sin analizar</div>
              </div>
              <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10.5px] font-medium text-sky-300">nuevo</span>
            </label>
          ))}
          {items.map((i) => (
            <label key={i.id} className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors ${marcados.has(`i:${i.id}`) ? 'bg-gradient-to-r from-accent/16 via-accent/6 to-transparent ring-1 ring-accent/25' : 'hover:bg-white/6'}`}>
              <Casilla marcada={marcados.has(`i:${i.id}`)} onChange={() => alternar(`i:${i.id}`)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{i.carpeta}</div>
                <div className="text-[11px] text-mist-600">{i.biblioteca} · {i.kind === 'show' ? 'Serie' : 'Película'}{i.alta ? ` · ${fecha(i.alta)}` : ''}</div>
              </div>
              {i.escrapeado && <span className="rounded-full bg-emerald-400/12 px-2 py-0.5 text-[10.5px] font-medium text-emerald-300">escrapeado</span>}
            </label>
          ))}
          {!lista.isFetching && items.length + nuevos.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-mist-500">No hay ficheros sin escrapear{fuente ? ' en esta fuente' : ''}.{!fuente ? ' Si acabas de dejar algo, pulsa «Actualizar lista» (Escanear solo esta en Ajustes → Biblioteca también sirve).' : ''}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => buscar.mutate()} disabled={marcados.size === 0 || b?.corriendo || buscar.isPending}>
            {b?.corriendo ? (b.fase === 'analizando' ? 'Analizando la carpeta…' : `Buscando ${b.hechos}/${b.total}…`) : `Escrapear los ${marcados.size} marcados`}
          </Button>
          <span className="text-[11.5px] text-mist-600">Solo se busca en TMDb para los marcados (lo «nuevo» se analiza antes, solo esa fuente); aún no se aplica nada.{visiblesMarcados !== marcados.size ? ' (Hay marcados fuera de este filtro.)' : ''}</span>
        </div>
        {b?.corriendo && <Barra hechos={b.hechos} total={b.total} />}
        {b?.error && <p className="text-[12.5px] text-red-400">{b.error}</p>}
      </Paso>

      {filas.length > 0 && (
        <Paso n={2} titulo="Revisa el emparejado">
          <p className="text-[12.5px] text-mist-500">Lo seguro y lo probable viene marcado; lo dudoso, no. Cambia la coincidencia con el desplegable o con «Buscar otra…».</p>
          <div className="space-y-2">
            {filas.map((f) => {
              const e = eleccion[f.itemId];
              const opciones = [...(f.propuesta ? [f.propuesta] : []), ...f.alternativas, ...(extras[f.itemId] ?? [])].filter((o, i, arr) => arr.findIndex((x) => x.tmdbId === o.tmdbId) === i);
              const actual = opciones.find((o) => o.tmdbId === e?.tmdbId) ?? f.propuesta;
              const [etiqueta, tono] = CONFIANZA[f.confianza];
              return (
                <div key={f.itemId} className={`flex gap-4 rounded-2xl p-3 transition-all ${e?.incluir ? 'bg-white/6 ring-1 ring-accent/25' : 'bg-white/3 opacity-60 ring-1 ring-white/6'}`}>
                  <div className="pt-1">
                    <Casilla disabled={!actual} marcada={Boolean(e?.incluir && actual)}
                      onChange={(v) => setEleccion((p) => ({ ...p, [f.itemId]: { tmdbId: p[f.itemId]?.tmdbId ?? actual?.tmdbId ?? null, incluir: v } }))} />
                  </div>
                  <div className="h-40 w-[6.7rem] shrink-0 overflow-hidden rounded-lg bg-ink-800 shadow-[0_14px_28px_-8px_rgb(0_0_0/0.85)] ring-1 ring-white/12">{actual?.posterUrl && <img src={pequena(actual.posterUrl)!} alt="" className="h-full w-full object-cover" />}</div>
                  <div className="min-w-0 flex-1 text-[14px]">
                    <div className="truncate text-mist-500">{f.titulo}{f.anio ? ` (${f.anio})` : ''} · {f.biblioteca}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">{actual ? `${actual.title} (${actual.year ?? 's/f'})` : 'Sin propuesta'}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${tono}`}>{etiqueta}</span>
                    </div>
                    {opciones.length > 1 && (
                      <select value={actual?.tmdbId ?? ''} onChange={(ev) => setEleccion((p) => ({ ...p, [f.itemId]: { tmdbId: Number(ev.target.value), incluir: true } }))} className="mt-1.5 max-w-full rounded-full border border-white/8 bg-black/25 px-3 py-1 text-[11.5px] outline-none focus:border-accent/40">
                        {opciones.map((o) => <option key={o.tmdbId} value={o.tmdbId} className="bg-ink-900">{o.title} ({o.year ?? 's/f'}) · TMDb {o.tmdbId}</option>)}
                      </select>
                    )}
                    <div><BuscarOtra fila={f} alEncontrar={(ps) => { if (ps.length) { setExtras((p) => ({ ...p, [f.itemId]: [...ps, ...(p[f.itemId] ?? [])] })); setEleccion((p) => ({ ...p, [f.itemId]: { tmdbId: ps[0].tmdbId, incluir: true } })); } }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </Paso>
      )}

      {filas.length > 0 && !b?.corriendo && (
        <Paso n={3} titulo="Aplicar los datos">
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
        <Paso n={4} titulo="Elige el arte (opcional)">
          <p className="text-[12.5px] text-mist-500">Se ha puesto el que TMDb marca por defecto. Si quieres otro cartel, fondo, logo, horizontal o disco, ábrelo y elígelo (también puedes subir uno propio): lo que elijas es lo que se copiará a la carpeta.</p>
          <div className="space-y-2">
            {aplicados.map((id) => (
              <FilaArte key={id} id={id} titulo={a?.resultados.find((x) => x.itemId === id)?.titulo ?? String(id)} kind={filas.find((f) => f.itemId === id)?.kind ?? 'movie'} />
            ))}
          </div>
        </Paso>
      )}

      {aplicados.length > 0 && !a?.corriendo && (
        <Paso n={5} titulo="Renombrar carpetas y ficheros como tMM">
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
              <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-mist-300">
                <Casilla marcada={copiarArte} onChange={setCopiarArte} />
                Copiar también el arte a la carpeta de cada título (para Plex y otros programas)
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-mist-300">
                <Casilla marcada={escribirNfo} onChange={setEscribirNfo} />
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
        <Paso n={6} titulo="Enviar a la biblioteca (opcional)">
          <p className="text-[12.5px] text-mist-500">Si los preparaste en la carpeta de entrada, puedes mandarlos ya a la biblioteca que elijas, en vez de moverlos a mano.</p>
          <EnviarTitulos ids={r.resultados.filter((x) => x.ok).map((x) => x.itemId)} kind={filas.find((f) => f.itemId === r.resultados[0].itemId)?.kind ?? 'movie'} />
        </Paso>
      )}
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}
    </div>
  );
}
