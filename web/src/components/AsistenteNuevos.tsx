import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Casilla, TextInput } from './Controls.tsx';
import {
  api,
  img,
  type Candidato,
  type FilaNueva,
  type Proposal,
  type EstadoEnvio,
} from '../lib/api.ts';
import SelectorDeArte from './SelectorDeArte.tsx';

/*
 * Asistente de Bandeja de Entrada & Scraper (AAA Workspace)
 * Vista unificada sin pasos lineales ("siguiente, siguiente"):
 * - Detección automática de Películas vs Series en carpetas de entrada.
 * - Conmutador rápido [🎬 Película | 📺 Serie] con re-búsqueda automática en TMDb.
 * - Selección de coincidencia TMDb y búsqueda manual directa.
 * - Selector de arte integrado bajo demanda.
 * - Enrutamiento inteligente a destino (Películas -> E:\Peliculas, Series -> E:\Series).
 * - Procesado y envío en un solo clic desde el panel flotante inferior.
 */

const CONFIANZA = {
  segura: ['Segura', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'],
  probable: ['Probable', 'bg-amber-500/15 text-amber-300 ring-amber-500/30'],
  dudosa: ['Dudosa · revisa', 'bg-rose-500/15 text-rose-300 ring-rose-500/30'],
  ninguna: ['Sin propuesta', 'bg-white/8 text-mist-400 ring-white/10'],
} as const;

const pequena = (url: string | null) => (url ? url.replace('/original/', '/w342/') : null);

type Eleccion = { tmdbId: number | null; incluir: boolean };

/** Formulario compacto para buscar manualmente una coincidencia por título, ID o URL */
function BuscarManual({
  fila,
  alEncontrar,
}: {
  fila: FilaNueva;
  alEncontrar: (p: Proposal[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(fila.titulo);
  const [fuente, setFuente] = useState<'tmdb' | 'tvdb' | 'omdb' | 'todas'>('tmdb');
  const [aviso, setAviso] = useState('');

  const buscar = useMutation({
    mutationFn: async () => {
      if (fuente === 'tvdb') return api.scraperResolverTvdb(texto, fila.kind, null, true);
      if (fuente === 'omdb') return api.scraperResolverOmdb(texto, fila.kind, null, true);
      let r: { propuestas: Proposal[]; aviso?: string };
      try {
        r = await api.scraperResolver(texto, fila.kind, null);
      } catch (e) {
        if (fuente !== 'todas') throw e;
        r = { propuestas: [], aviso: (e as Error).message };
      }
      if (fuente === 'todas' && r.propuestas.length === 0) {
        const tv = await api.scraperResolverTvdb(texto, fila.kind, null, true).catch(() => null);
        if (tv && tv.propuestas.length) return tv;
        const om = await api.scraperResolverOmdb(texto, fila.kind, null, true).catch(() => null);
        if (om && om.propuestas.length) return om;
      }
      return r;
    },
    onSuccess: (r) => {
      alEncontrar(r.propuestas);
      setAviso(r.aviso ?? (r.propuestas.length ? '' : 'Sin resultados'));
    },
    onError: (e: Error) => setAviso(e.message),
  });

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-[12px] font-medium text-accent hover:underline underline-offset-2 flex items-center gap-1"
      >
        <span>🔍 Buscar en otras BBDD…</span>
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-black/40 p-3 ring-1 ring-white/10 space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (texto.trim()) buscar.mutate();
        }}
      >
        <select
          value={fuente}
          onChange={(e) => setFuente(e.target.value as any)}
          className="rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 text-[12px] font-medium text-mist-200 outline-none focus:border-accent"
        >
          <option value="tmdb" className="bg-ink-900">TMDb</option>
          <option value="tvdb" className="bg-ink-900">TheTVDB</option>
          <option value="omdb" className="bg-ink-900">OMDb</option>
          <option value="todas" className="bg-ink-900">Todas</option>
        </select>
        <TextInput
          value={texto}
          onChange={setTexto}
          placeholder="Título, ID o enlace web…"
          className="w-64 max-w-full text-[13px]"
        />
        <Button
          variant="primary"
          onClick={() => texto.trim() && buscar.mutate()}
          disabled={buscar.isPending}
        >
          {buscar.isPending ? 'Buscando…' : 'Buscar'}
        </Button>
        <Button variant="ghost" onClick={() => setAbierto(false)}>
          Cerrar
        </Button>
      </form>
      {aviso && <p className="text-[11.5px] text-amber-300">{aviso}</p>}
    </div>
  );
}

export default function AsistenteNuevos() {
  const qc = useQueryClient();

  // Filtros superiores
  const [fuente, setFuente] = useState('');
  const [textoFiltro, setTextoFiltro] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'movie' | 'show' | 'nuevos'>('todos');
  const [mostrarTodos, setMostrarTodos] = useState(false);

  // Opciones de procesado
  const [organizarNombres, setOrganizarNombres] = useState(true);
  const [copiarArte, setCopiarArte] = useState(true);
  const [escribirNfo, setEscribirNfo] = useState(true);
  const [enviarDestino, setEnviarDestino] = useState(true);

  // Selección de ítems y propuestas
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [eleccion, setEleccion] = useState<Record<number, Eleccion>>({});
  const [extras, setExtras] = useState<Record<number, Proposal[]>>({});
  const [arteAbierto, setArteAbierto] = useState<number | null>(null);

  // Estado del pipeline de ejecución
  const [fasePipeline, setFasePipeline] = useState<
    'inactivo' | 'identificando' | 'aplicando' | 'renombrando' | 'enviando' | 'exito' | 'error'
  >('inactivo');
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  // ¿El último proceso llegó a enviar a la biblioteca? «Escrapear aquí» y el proceso sin envío no mueven nada fuera de su carpeta.
  const [enviado, setEnviado] = useState(false);

  // Consultas principales
  const { data: estadoNuevos } = useQuery({
    queryKey: ['scraper-nuevos'],
    queryFn: api.scraperNuevos,
    refetchInterval: (q) =>
      q.state.data &&
      (q.state.data.busqueda.corriendo ||
        q.state.data.aplicacion.corriendo ||
        q.state.data.renombrado.corriendo)
        ? 1200
        : false,
    refetchIntervalInBackground: true,
  });

  const { data: listaData, isFetching: listaCargando, refetch: refetchLista } = useQuery({
    queryKey: ['scraper-nuevos-lista', fuente, textoFiltro, mostrarTodos],
    queryFn: () => api.scraperNuevosLista({ biblioteca: fuente, q: textoFiltro, todos: mostrarTodos }),
    placeholderData: (p) => p,
  });

  const { data: destinosData } = useQuery({
    queryKey: ['scraper-destinos'],
    queryFn: api.scraperDestinos,
  });

  const { data: estadoEnvio } = useQuery({
    queryKey: ['scraper-envio'],
    queryFn: api.scraperEnvio,
    enabled: fasePipeline === 'enviando',
    refetchInterval: 1000,
  });

  const items = listaData?.items ?? [];
  const sinRegistrar = listaData?.sinRegistrar ?? [];
  const fuentes = listaData?.fuentes ?? [];
  const filasBusqueda = estadoNuevos?.busqueda.resultados ?? [];

  // Al llegar resultados de búsqueda, marcar por defecto los que tengan coincidencia razonable
  useEffect(() => {
    setEleccion((prev) => {
      const sig = { ...prev };
      for (const f of filasBusqueda) {
        if (!(f.itemId in sig)) {
          sig[f.itemId] = {
            tmdbId: f.propuesta?.tmdbId ?? null,
            incluir: f.confianza === 'segura' || f.confianza === 'probable',
          };
        }
      }
      return sig;
    });
  }, [filasBusqueda.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inicializar marcados con todos los ítems visibles si está vacío
  useEffect(() => {
    if (items.length > 0 && marcados.size === 0) {
      setMarcados(new Set(items.map((i) => `i:${i.id}`)));
    }
  }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const refrescarTodo = () => {
    qc.invalidateQueries({ queryKey: ['scraper-nuevos'] });
    refetchLista();
  };

  // Mutación para cambiar entre Película y Serie con re-búsqueda automática
  const cambiarTipoMutation = useMutation({
    mutationFn: async ({ itemId, kind }: { itemId: number; kind: 'movie' | 'show' }) => {
      await api.scraperCambiarTipo(itemId, kind);
      await api.scraperNuevosBuscar([itemId], []);
    },
    onSuccess: () => {
      refrescarTodo();
    },
  });

  // Mutación para limpiar lote
  const limpiarMutation = useMutation({
    mutationFn: api.scraperNuevosLimpiar,
    onSuccess: () => {
      setMarcados(new Set());
      setEleccion({});
      setExtras({});
      setFasePipeline('inactivo');
      refrescarTodo();
    },
  });

  // Búsqueda inicial para ítems que aún no tienen propuesta
  const buscarTMDbMutation = useMutation({
    mutationFn: (ids: number[]) => api.scraperNuevosBuscar(ids, []),
    onSuccess: () => {
      refrescarTodo();
    },
  });

  // Filtrado de la cola según pestañas
  const itemsFiltrados = useMemo(() => {
    return items.filter((it) => {
      if (filtroTipo === 'movie' && it.kind !== 'movie') return false;
      if (filtroTipo === 'show' && it.kind !== 'show') return false;
      if (textoFiltro && !it.carpeta.toLowerCase().includes(textoFiltro.toLowerCase()) && !it.titulo.toLowerCase().includes(textoFiltro.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [items, filtroTipo, textoFiltro]);

  const sinRegistrarFiltrados = useMemo(() => {
    if (filtroTipo === 'movie' || filtroTipo === 'show') return [];
    return sinRegistrar.filter((s) => {
      if (textoFiltro && !s.carpeta.toLowerCase().includes(textoFiltro.toLowerCase())) return false;
      return true;
    });
  }, [sinRegistrar, filtroTipo, textoFiltro]);

  // Contadores
  const numPelis = items.filter((i) => i.kind === 'movie').length;
  const numSeries = items.filter((i) => i.kind === 'show').length;

  // Ítems elegidos para procesar
  const elegidosParaProcesar = useMemo(() => {
    return items.filter((it) => {
      const e = eleccion[it.id];
      if (e) return e.incluir;
      return marcados.has(`i:${it.id}`);
    });
  }, [items, eleccion, marcados]);

  // Iniciar procesamiento completo y envío
  const ejecutarPipeline = async () => {
    if (elegidosParaProcesar.length === 0) return;
    setMensajeError(null);
    try {
      // 1. Si hay propuestas seleccionadas, aplicarlas a la base de datos
      setFasePipeline('aplicando');
      const paraAplicar = elegidosParaProcesar
        .map((it) => {
          const tmdbId = eleccion[it.id]?.tmdbId ?? filasBusqueda.find((f) => f.itemId === it.id)?.propuesta?.tmdbId;
          return tmdbId ? { itemId: it.id, tmdbId } : null;
        })
        .filter((x): x is { itemId: number; tmdbId: number } => Boolean(x));

      // Sin id de TMDb y sin estar ya escrapeado no hay con qué nombrarlo: se para antes de tocar nada.
      const sinId = elegidosParaProcesar.filter((it) => !it.escrapeado && !paraAplicar.some((p) => p.itemId === it.id));
      if (sinId.length > 0) {
        throw new Error(`Sin coincidencia de TMDb para: ${sinId.map((it) => it.titulo).join(', ')}. Elige una o desmárcalos.`);
      }

      if (paraAplicar.length > 0) {
        await api.scraperNuevosAplicar(paraAplicar);
        let esperas = 0;
        while (esperas < 60) {
          await new Promise((r) => setTimeout(r, 800));
          const est = await api.scraperNuevos();
          if (!est.aplicacion.corriendo) break;
          esperas++;
        }
      }

      // 2. Si se solicitó organizar, generar NFO o copiar arte
      if (organizarNombres || escribirNfo || copiarArte) {
        setFasePipeline('renombrando');
        const ids = elegidosParaProcesar.map((i) => i.id);
        await api.scraperLoteAplicar(ids, copiarArte, escribirNfo);
        let esperas = 0;
        while (esperas < 60) {
          await new Promise((r) => setTimeout(r, 800));
          const est = await api.scraperNuevos();
          if (!est.renombrado.corriendo) break;
          esperas++;
        }
      }

      // 3. Enviar a biblioteca correspondiente solo si enviarDestino está activo
      if (enviarDestino) {
        setFasePipeline('enviando');
        const ids = elegidosParaProcesar.map((i) => i.id);
        await api.scraperEnviar(ids, '', true, 'rapida');
      } else {
        setEnviado(false); setFasePipeline('exito');
        refrescarTodo();
      }
    } catch (err) {
      setFasePipeline('error');
      setMensajeError((err as Error).message);
    }
  };

  // Procesar un solo ítem dejándolo en su carpeta actual
  const procesarIndividualAqui = async (it: Candidato, tmdbId: number) => {
    setMensajeError(null);
    try {
      setFasePipeline('aplicando');
      await api.scraperNuevosAplicar([{ itemId: it.id, tmdbId }]);
      let esperas = 0;
      while (esperas < 40) {
        await new Promise((r) => setTimeout(r, 600));
        const est = await api.scraperNuevos();
        if (!est.aplicacion.corriendo) break;
        esperas++;
      }
      if (organizarNombres || escribirNfo || copiarArte) {
        setFasePipeline('renombrando');
        await api.scraperLoteAplicar([it.id], copiarArte, escribirNfo);
        esperas = 0;
        while (esperas < 40) {
          await new Promise((r) => setTimeout(r, 600));
          const est = await api.scraperNuevos();
          if (!est.renombrado.corriendo) break;
          esperas++;
        }
      }
      setEnviado(false); setFasePipeline('exito');
      refrescarTodo();
    } catch (err) {
      setFasePipeline('error');
      setMensajeError((err as Error).message);
    }
  };

  // Monitorizar progreso del envío
  useEffect(() => {
    if (fasePipeline === 'enviando' && estadoEnvio) {
      if (!estadoEnvio.corriendo && estadoEnvio.terminado) {
        const fallidos = (estadoEnvio.resultados ?? []).filter((r) => !r.ok);
        if (fallidos.length > 0) {
          setFasePipeline('error');
          setMensajeError(`Error al transferir: ${fallidos.map((f) => `${f.titulo} (${f.error})`).join('; ')}`);
        } else {
          setEnviado(true); setFasePipeline('exito');
        }
        refrescarTodo();
      }
    }
  }, [fasePipeline, estadoEnvio]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6 pb-32">
      {/* 1. Header moderno & Filtros de control */}
      <section className="glass rounded-[var(--radius-panel)] p-5 sm:p-6 shadow-xl border border-white/8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-accent text-ink-950 font-bold shadow-lg shadow-amber-500/20">
                ⚡
              </span>
              <h2 className="text-[18px] font-bold tracking-tight text-white">
                Bandeja de Entrada & Scraper
              </h2>
            </div>
            <p className="mt-1 text-[12.5px] text-mist-400">
              Detecta automáticamente películas y series en tus carpetas de entrada, empareja con TMDb y envíalas con su estructura limpia a la biblioteca.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={refrescarTodo}
              disabled={listaCargando}
            >
              {listaCargando ? 'Mirando…' : '🔄 Actualizar lista'}
            </Button>
            {filasBusqueda.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => limpiarMutation.mutate()}
                disabled={limpiarMutation.isPending}
              >
                Limpiar lote
              </Button>
            )}
          </div>
        </div>

        {/* Barra de herramientas y filtros */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/6">
          <div className="flex flex-wrap items-center gap-2">
            {/* Selector de fuente */}
            <select
              value={fuente}
              onChange={(e) => setFuente(e.target.value)}
              className="rounded-full border border-white/10 bg-black/40 px-3.5 py-1.5 text-[12.5px] font-medium text-mist-200 outline-none transition focus:border-accent"
            >
              <option value="" className="bg-ink-900">Todas las fuentes</option>
              {fuentes.map((f) => (
                <option key={f.ruta} value={f.ruta} className="bg-ink-900">
                  📁 {f.name} ({f.pendientes} pendientes)
                </option>
              ))}
            </select>

            {/* Pestañas de tipo */}
            <div className="flex items-center gap-1 rounded-full bg-black/30 p-1 ring-1 ring-white/8 text-[12px]">
              <button
                type="button"
                onClick={() => setFiltroTipo('todos')}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  filtroTipo === 'todos' ? 'bg-white/15 text-white shadow-sm' : 'text-mist-400 hover:text-white'
                }`}
              >
                Todos ({items.length + sinRegistrar.length})
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipo('movie')}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  filtroTipo === 'movie' ? 'bg-white/15 text-white shadow-sm' : 'text-mist-400 hover:text-white'
                }`}
              >
                🎬 Películas ({numPelis})
              </button>
              <button
                type="button"
                onClick={() => setFiltroTipo('show')}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  filtroTipo === 'show' ? 'bg-white/15 text-white shadow-sm' : 'text-mist-400 hover:text-white'
                }`}
              >
                📺 Series ({numSeries})
              </button>
            </div>

            <TextInput
              value={textoFiltro}
              onChange={setTextoFiltro}
              placeholder="Filtrar por nombre…"
              className="w-48 text-[12.5px]"
            />
          </div>

          <div className="flex items-center gap-3 text-[12px]">
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => {
                const nuevosIds = itemsFiltrados.map((i) => `i:${i.id}`);
                setMarcados((s) => new Set([...s, ...nuevosIds]));
                setEleccion((prev) => {
                  const sig = { ...prev };
                  for (const it of itemsFiltrados) {
                    if (sig[it.id]) sig[it.id].incluir = true;
                  }
                  return sig;
                });
              }}
            >
              Marcar todos
            </button>
            <span className="text-white/20">|</span>
            <button
              type="button"
              className="text-mist-500 hover:underline"
              onClick={() => {
                setMarcados(new Set());
                setEleccion((prev) => {
                  const sig = { ...prev };
                  for (const k in sig) sig[k].incluir = false;
                  return sig;
                });
              }}
            >
              Desmarcar
            </button>
          </div>
        </div>
      </section>

      {/* 2. Banner de éxito o error tras procesar */}
      {fasePipeline === 'exito' && (
        <div className="rounded-2xl bg-emerald-500/15 p-4 ring-1 ring-emerald-500/30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-lg">
              ✓
            </span>
            <div>
              <div className="font-semibold text-emerald-200">
                {enviado ? '¡Títulos procesados y enviados a la biblioteca!' : '¡Títulos procesados en su carpeta!'}
              </div>
              <div className="text-[12px] text-emerald-300/80">
                {enviado
                  ? 'Se han generado sus archivos NFO, copiado el arte y reubicado en su carpeta definitiva.'
                  : 'Se han guardado sus datos y generado NFO y arte junto al vídeo. No se ha enviado a la biblioteca: sigue en su carpeta de entrada.'}
              </div>
            </div>
          </div>
          <Button variant="ghost" onClick={() => setFasePipeline('inactivo')}>
            Cerrar aviso
          </Button>
        </div>
      )}

      {mensajeError && (
        <div className="rounded-2xl bg-rose-500/15 p-4 ring-1 ring-rose-500/30 flex items-center justify-between gap-4">
          <div className="text-[13px] text-rose-200">
            <b>Error en el procesado:</b> {mensajeError}
          </div>
          <Button variant="ghost" onClick={() => setMensajeError(null)}>
            Cerrar
          </Button>
        </div>
      )}

      {/* 3. Cola de títulos (Cards de nueva generación) */}
      <div className="space-y-3">
        {/* Títulos sin registrar en el disco (aún no analizados) */}
        {sinRegistrarFiltrados.map((s) => (
          <div
            key={s.ruta}
            className="rounded-2xl bg-white/4 p-4 ring-1 ring-white/8 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300 font-bold">
                ✨
              </span>
              <div className="min-w-0">
                <div className="truncate font-semibold text-[14px] text-white">
                  {s.carpeta}
                </div>
                <div className="text-[11.5px] text-mist-500">
                  {s.biblioteca} · {s.tipo === 'video' ? 'Vídeo suelto' : 'Carpeta con archivos'} · nuevo en disco
                </div>
              </div>
            </div>
            <Button
              variant="primary"
              onClick={() => api.scraperNuevosBuscar([], [s.ruta]).then(refrescarTodo)}
            >
              Analizar e identificar
            </Button>
          </div>
        ))}

        {/* Títulos en la cola */}
        {itemsFiltrados.map((it) => {
          const fila = filasBusqueda.find((f) => f.itemId === it.id);
          const e = eleccion[it.id];
          const opciones = [
            ...(fila?.propuesta ? [fila.propuesta] : []),
            ...(fila?.alternativas ?? []),
            ...(extras[it.id] ?? []),
          ].filter((o, idx, arr) => arr.findIndex((x) => x.tmdbId === o.tmdbId) === idx);

          const actual = opciones.find((o) => o.tmdbId === e?.tmdbId) ?? fila?.propuesta;
          const [confianzaLabel, confianzaTono] = CONFIANZA[fila?.confianza ?? 'ninguna'];
          const estaMarcado = Boolean(e ? e.incluir : marcados.has(`i:${it.id}`));

          // Destino resuelto
          const destino = destinosData?.find((d) => d.kind === it.kind)?.name ?? (it.kind === 'movie' ? 'Películas' : 'Series');

          return (
            <div
              key={it.id}
              className={`rounded-2xl p-4 transition-all duration-200 border ${
                estaMarcado
                  ? 'bg-gradient-to-r from-white/[0.08] via-white/[0.04] to-transparent border-accent/40 shadow-lg'
                  : 'bg-white/[0.02] border-white/6 opacity-75 hover:opacity-100'
              }`}
            >
              <div className="flex flex-col sm:flex-row items-start gap-4">
                {/* Póster / Thumbnail */}
                <div className="h-40 w-28 shrink-0 overflow-hidden rounded-xl bg-ink-900 ring-1 ring-white/12 shadow-md relative group">
                  {actual?.posterUrl ? (
                    <img
                      src={pequena(actual.posterUrl)!}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-center p-2 text-mist-600 text-[11px]">
                      {it.kind === 'movie' ? '🎬 Sin póster' : '📺 Sin póster'}
                    </div>
                  )}
                </div>

                {/* Contenido Central */}
                <div className="min-w-0 flex-1 space-y-2">
                  {/* Fila de insignias e interruptor de tipo */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Botón conmutador Película vs Serie */}
                    <button
                      type="button"
                      title="Haz clic para cambiar entre Película y Serie"
                      onClick={() =>
                        cambiarTipoMutation.mutate({
                          itemId: it.id,
                          kind: it.kind === 'movie' ? 'show' : 'movie',
                        })
                      }
                      disabled={cambiarTipoMutation.isPending}
                      className="group flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-accent hover:text-ink-950 ring-1 ring-white/15"
                    >
                      <span>{it.kind === 'movie' ? '🎬 Película' : '📺 Serie'}</span>
                      <span className="text-mist-400 group-hover:text-ink-950 text-[10px]">⇄</span>
                    </button>

                    {/* Origen */}
                    <span className="rounded-full bg-white/6 px-2 py-0.5 text-[10.5px] text-mist-400">
                      📁 {it.biblioteca}
                    </span>

                    {/* Confianza TMDb */}
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ${confianzaTono}`}>
                      {confianzaLabel}
                    </span>

                    {it.escrapeado && (
                      <span className="rounded-full bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 px-2 py-0.5 text-[10.5px] font-bold">
                        ✓ Ya escrapeado en carpeta
                      </span>
                    )}

                    {/* Destino biblioteca */}
                    <span className="rounded-full bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20 px-2 py-0.5 text-[10.5px] font-medium">
                      → {destino}
                    </span>
                  </div>

                  {/* Título identificado y nombre en disco */}
                  <div className="space-y-0.5">
                    <div className="text-[16px] font-bold text-white tracking-tight flex items-center gap-2">
                      <span>{actual ? `${actual.title}` : it.titulo}</span>
                      {actual?.year && (
                        <span className="font-normal text-mist-400">({actual.year})</span>
                      )}
                    </div>
                    <div className="text-[11.5px] font-mono text-mist-500 truncate" title={it.carpeta}>
                      Origen: {it.carpeta}
                    </div>
                    <div className="text-[11.5px] font-mono text-emerald-400/90 truncate flex items-center gap-1.5" title={`Carpeta destino prevista: ${destino}\\${actual ? `${actual.title}${actual.year ? ` (${actual.year})` : ''}` : it.carpeta}`}>
                      <span className="text-mist-400">📁 Carpeta destino:</span>
                      <span className="font-semibold text-emerald-300">
                        {destino}\{actual ? `${actual.title}${actual.year ? ` (${actual.year})` : ''}` : it.carpeta}
                      </span>
                    </div>
                  </div>

                  {/* Desplegable de alternativas si existen */}
                  {opciones.length > 1 && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11.5px] text-mist-500">Coincidencia:</span>
                      <select
                        value={actual?.tmdbId ?? ''}
                        onChange={(ev) =>
                          setEleccion((p) => ({
                            ...p,
                            [it.id]: { tmdbId: Number(ev.target.value), incluir: true },
                          }))
                        }
                        className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11.5px] text-mist-200 outline-none focus:border-accent"
                      >
                        {opciones.map((o) => (
                          <option key={o.tmdbId} value={o.tmdbId} className="bg-ink-900">
                            {o.title} ({o.year ?? 's/f'}) · TMDb #{o.tmdbId}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Búsqueda manual de TMDb si la fila existe */}
                  {fila && (
                    <BuscarManual
                      fila={fila}
                      alEncontrar={(ps) => {
                        if (ps.length) {
                          setExtras((p) => ({ ...p, [it.id]: [...ps, ...(p[it.id] ?? [])] }));
                          setEleccion((p) => ({ ...p, [it.id]: { tmdbId: ps[0].tmdbId, incluir: true } }));
                        }
                      }}
                    />
                  )}

                  {/* Botón para buscar en TMDb si aún no se ha buscado */}
                  {!fila && (
                    <button
                      type="button"
                      onClick={() => buscarTMDbMutation.mutate([it.id])}
                      disabled={buscarTMDbMutation.isPending}
                      className="text-[12px] text-accent hover:underline flex items-center gap-1 font-medium"
                    >
                      ⚡ Buscar coincidencia en TMDb
                    </button>
                  )}
                </div>

                {/* Columna Derecha: Casilla de selección y Acciones */}
                <div className="flex flex-col items-end gap-3 shrink-0 self-start">
                  <label className="flex items-center gap-2 cursor-pointer p-1">
                    <span className="text-[12px] text-mist-400 font-medium">Incluir</span>
                    <Casilla
                      marcada={estaMarcado}
                      onChange={(v) => {
                        setEleccion((p) => ({
                          ...p,
                          [it.id]: {
                            tmdbId: p[it.id]?.tmdbId ?? actual?.tmdbId ?? null,
                            incluir: v,
                          },
                        }));
                        setMarcados((s) => {
                          const n = new Set(s);
                          if (v) n.add(`i:${it.id}`);
                          else n.delete(`i:${it.id}`);
                          return n;
                        });
                      }}
                    />
                  </label>

                  {actual?.tmdbId && (
                    <button
                      type="button"
                      title="Aplica la ficha, NFO y arte en su carpeta actual sin moverlo a otro disco"
                      onClick={() => procesarIndividualAqui(it, actual.tmdbId)}
                      className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11.5px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition flex items-center gap-1"
                    >
                      <span>💾 Escrapear aquí</span>
                    </button>
                  )}

                  <button
                    type="button"
                    title="Marca este título como catalogado para sacarlo de la lista de pendientes"
                    onClick={() => api.scraperIgnorar(it.id).then(() => refrescarTodo())}
                    className="rounded-full bg-white/6 px-3 py-1 text-[11.5px] font-medium text-mist-400 hover:text-white hover:bg-white/12 transition flex items-center gap-1"
                  >
                    <span>✓ Ya catalogado</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setArteAbierto(arteAbierto === it.id ? null : it.id)}
                    className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition ${
                      arteAbierto === it.id
                        ? 'bg-accent text-ink-950 font-bold'
                        : 'bg-white/6 text-mist-300 hover:bg-white/12'
                    }`}
                  >
                    🖼️ Arte {arteAbierto === it.id ? '▲' : '▼'}
                  </button>
                </div>
              </div>

              {/* Panel expandible de Arte */}
              {arteAbierto === it.id && (
                <div className="mt-4 pt-4 border-t border-white/8">
                  <SelectorDeArte
                    itemId={it.id}
                    kind={it.kind}
                    titulo={actual?.title ?? it.titulo}
                    anio={actual?.year ?? it.anio}
                    tmdbId={actual?.tmdbId ?? null}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Estado vacío */}
        {!listaCargando && itemsFiltrados.length === 0 && sinRegistrarFiltrados.length === 0 && (
          <div className="glass rounded-2xl p-12 text-center space-y-3">
            <span className="text-3xl">🎉</span>
            <h3 className="text-[16px] font-semibold text-white">Bandeja de entrada al día</h3>
            <p className="text-[12.5px] text-mist-400 max-w-md mx-auto">
              No hay títulos pendientes en tus carpetas de entrada. Cuando descargues o añadas nuevo contenido en {fuente || 'C:\\Users\\HTPC\\Videos'}, aparecerá aquí automáticamente.
            </p>
          </div>
        )}
      </div>

      {/* 4. Barra de Acciones Flotante Inferior (Dock AAA) */}
      {items.length > 0 && (
        <aside
          aria-label="Panel de acciones del scraper"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-5xl z-40 backdrop-blur-2xl bg-ink-950/85 border border-white/12 shadow-[0_20px_50px_rgba(0,0,0,0.85)] rounded-2xl p-4 transition-all"
        >
          {fasePipeline !== 'inactivo' && fasePipeline !== 'exito' && fasePipeline !== 'error' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[13px] font-medium">
                <span className="flex items-center gap-2 text-accent">
                  <span className="inline-block animate-spin">⚡</span>
                  {fasePipeline === 'aplicando' && 'Guardando metadatos y arte en el servidor…'}
                  {fasePipeline === 'renombrando' && 'Escribiendo NFO y organizando carpetas…'}
                  {fasePipeline === 'enviando' &&
                    `Transfiriendo a la biblioteca: ${estadoEnvio?.actual ?? ''} (${estadoEnvio?.hechos ?? 0}/${estadoEnvio?.total ?? elegidosParaProcesar.length})`}
                </span>
                {estadoEnvio && estadoEnvio.bytesTotal > 0 && (
                  <span className="font-mono text-mist-400 text-[12px]">
                    {(estadoEnvio.bytesHechos / 1e6).toFixed(1)} MB / {(estadoEnvio.bytesTotal / 1e6).toFixed(1)} MB
                  </span>
                )}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft shadow-[0_0_12px_rgb(240_165_74/0.7)] transition-all duration-300"
                  style={{
                    width: `${
                      fasePipeline === 'aplicando'
                        ? 25
                        : fasePipeline === 'renombrando'
                        ? 50
                        : estadoEnvio && estadoEnvio.bytesTotal
                        ? Math.round((100 * estadoEnvio.bytesHechos) / estadoEnvio.bytesTotal)
                        : 75
                    }%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Resumen de selección */}
              <div className="min-w-0">
                <div className="text-[14px] font-bold text-white flex items-center gap-2">
                  <span>{elegidosParaProcesar.length} títulos seleccionados</span>
                  <span className="text-[12px] font-normal text-mist-400">
                    ({elegidosParaProcesar.filter((i) => i.kind === 'movie').length} pelis,{' '}
                    {elegidosParaProcesar.filter((i) => i.kind === 'show').length} series)
                  </span>
                </div>
                <div className="text-[11.5px] text-mist-400 flex items-center gap-3 mt-0.5">
                  {enviarDestino ? (
                    <>
                      <span>Destino: Películas → <b>E:\Peliculas</b></span>
                      <span>·</span>
                      <span>Series → <b>E:\Series</b></span>
                    </>
                  ) : (
                    <span className="text-amber-300/90 font-medium">
                      📍 Mantener en ubicación actual (sin mover a otro disco)
                    </span>
                  )}
                </div>
              </div>

              {/* Toggles de opciones rápidas */}
              <div className="hidden md:flex items-center gap-4 text-[12px] text-mist-300">
                <label className="flex items-center gap-2 cursor-pointer hover:text-white">
                  <Casilla marcada={organizarNombres} onChange={setOrganizarNombres} />
                  <span>Renombrar tMM</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:text-white">
                  <Casilla marcada={escribirNfo} onChange={setEscribirNfo} />
                  <span>Generar .NFO</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:text-white">
                  <Casilla marcada={copiarArte} onChange={setCopiarArte} />
                  <span>Arte en carpeta</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer hover:text-white border-l border-white/10 pl-3">
                  <Casilla marcada={enviarDestino} onChange={setEnviarDestino} />
                  <span className={enviarDestino ? 'text-accent font-medium' : 'text-mist-400'}>Mover a destino</span>
                </label>
              </div>

              {/* Botón Principal CTA */}
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  onClick={ejecutarPipeline}
                  disabled={elegidosParaProcesar.length === 0}
                >
                  {enviarDestino
                    ? `⚡ Procesar y Enviar a la biblioteca (${elegidosParaProcesar.length})`
                    : `💾 Solo escrapear y guardar aquí (${elegidosParaProcesar.length})`}
                </Button>
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
