import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Casilla, TextInput } from '../components/Controls.tsx';
import SelectorDeArte from '../components/SelectorDeArte.tsx';
import EditorDatos from '../components/EditorDatos.tsx';
import AsistenteNuevos from '../components/AsistenteNuevos.tsx';
import EnviarTitulos from '../components/EnviarTitulos.tsx';
import MezclaFuentes from '../components/MezclaFuentes.tsx';
import FuentesScraper from '../components/FuentesScraper.tsx';
import AjustesScraper from '../components/AjustesScraper.tsx';
import { api, img, type Proposal, type ScraperFila, type ScraperTitulo } from '../lib/api.ts';

/*
 * Scraper: consola de emparejado y catalogación al estilo tinyMediaManager Pro.
 * Columna izquierda con listado y filtros avanzados; columna derecha con ficha inmersiva,
 * emparejado inteligente con TMDb/OMDb, selector de arte y operaciones de biblioteca.
 */

const FILTROS = [
  { clave: 'todos', etiqueta: 'Todos' },
  { clave: 'huecos', etiqueta: 'Con huecos' },
  { clave: 'sinid', etiqueta: 'Sin emparejar' },
  { clave: 'sinsinopsis', etiqueta: 'Sin sinopsis' },
  { clave: 'sinedad', etiqueta: 'Sin edad' },
  { clave: 'sinlogo', etiqueta: 'Sin logo' },
  { clave: 'sinorganizar', etiqueta: 'Sin organizar' },
] as const;

const CAMPOS = [
  { clave: 'poster', etiqueta: 'Póster' },
  { clave: 'fanart', etiqueta: 'Fondo' },
  { clave: 'logo', etiqueta: 'Logotipo' },
  { clave: 'plot', etiqueta: 'Sinopsis' },
  { clave: 'rating', etiqueta: 'Valoración' },
  { clave: 'genres', etiqueta: 'Géneros' },
  { clave: 'ficha', etiqueta: 'Reparto, estudios y país' },
] as const;
type Campo = (typeof CAMPOS)[number]['clave'];

/** Las URLs de TMDb vienen en tamaño original; para previsualizar basta una intermedia. */
const pequena = (url: string | null, w: string) => (url ? url.replace('/original/', `/${w}/`) : null);

/** Indicador micro de estado para 4 elementos esenciales: Póster, Fondo, Logo y Sinopsis. */
function Avance({ f }: { f: ScraperFila }) {
  const partes: [string, boolean][] = [
    ['Póster', !!f.poster],
    ['Fondo', !!f.fanart],
    ['Logo', !!f.logo],
    ['Sinopsis', !!f.sinopsis],
  ];
  return (
    <div className="flex items-center gap-1" title={partes.map(([n, ok]) => `${n}: ${ok ? 'sí' : 'falta'}`).join(' · ')}>
      {partes.map(([n, ok]) => (
        <span
          key={n}
          className={`h-1.5 w-3.5 rounded-full transition-colors ${
            ok ? 'bg-accent/80 shadow-[0_0_6px_rgba(240,165,74,0.4)]' : 'bg-white/10'
          }`}
        />
      ))}
    </div>
  );
}

function IconoBuscar() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.2 13.2 3.6 3.6" />
    </svg>
  );
}

function Fila({ f, activa, onClick, marcada }: { f: ScraperFila; activa: boolean; onClick: () => void; marcada?: boolean }) {
  const seleccionando = marcada !== undefined;
  const resaltada = seleccionando ? marcada : activa;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all duration-200 ${
        resaltada
          ? 'bg-gradient-to-r from-accent/18 via-accent/6 to-transparent ring-1 ring-accent/35 shadow-[0_4px_16px_rgba(0,0,0,0.6)]'
          : 'hover:bg-white/6'
      }`}
    >
      {seleccionando && <Casilla marcada={marcada} onChange={() => {}} />}
      {!seleccionando && activa && (
        <span className="absolute top-2.5 bottom-2.5 left-0 w-1 rounded-r-full bg-accent shadow-[0_0_12px_rgba(240,165,74,0.8)]" />
      )}
      <div className="h-[68px] w-12 shrink-0 overflow-hidden rounded-xl bg-ink-800 shadow-[0_8px_18px_-4px_rgba(0,0,0,0.8)] ring-1 ring-white/10 transition-transform duration-200 group-hover:scale-105">
        {f.poster ? (
          <img src={img.poster(f.id, 120, f.arte_actualizado)} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-[10px] text-mist-600">Sin foto</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold leading-tight text-mist-100 group-hover:text-white">
          {f.title}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-mist-500">
          <span className="font-mono tabular-nums">{f.year ?? 's/f'}</span>
          <span className="text-mist-600">·</span>
          <span>{f.kind === 'show' ? 'Serie' : 'Película'}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Avance f={f} />
          {!f.tmdb_id && (
            <span className="flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[9.5px] font-bold tracking-wider text-amber-300 ring-1 ring-amber-400/30">
              <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse" />
              SIN EMPAREJAR
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

const CAMPOS_LOTE = [
  ['studio', 'Estudio', 'Paramount Pictures'],
  ['mpaa', 'Edad recomendada', '12'],
  ['collection', 'Saga', 'Nombre de la saga'],
] as const;

/** Mismo dato para los títulos marcados en bloque. */
function BarraLote({ ids, alTerminar }: { ids: number[]; alTerminar: () => void }) {
  const qc = useQueryClient();
  const [campo, setCampo] = useState<(typeof CAMPOS_LOTE)[number][0]>('mpaa');
  const [valor, setValor] = useState('');
  const [quitar, setQuitar] = useState(false);
  const [aviso, setAviso] = useState('');
  const etiqueta = CAMPOS_LOTE.find((c) => c[0] === campo)![1];
  const aplicar = useMutation({
    mutationFn: () => api.editarLote(ids, { [campo]: quitar ? null : valor.trim() }),
    onSuccess: (r) => {
      setAviso(r.fallos.length ? `Hecho en ${r.hechos}; fallaron ${r.fallos.length}: ${r.fallos[0].error}` : `Hecho en ${r.hechos} títulos.`);
      for (const k of ['scraper-lista', 'scraper-titulo', 'item', 'home']) qc.invalidateQueries({ queryKey: [k] });
      if (!r.fallos.length) alTerminar();
    },
    onError: (e: Error) => setAviso(e.message),
  });
  const listo = ids.length > 0 && (quitar || valor.trim() !== '');
  return (
    <div className="space-y-3 rounded-2xl bg-black/40 p-4 ring-1 ring-accent/30 shadow-[0_12px_32px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-accent-soft">{ids.length} títulos seleccionados</span>
        <span className="text-[11px] text-mist-500">Edición en lote</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {CAMPOS_LOTE.map(([k, e]) => (
          <button
            key={k}
            type="button"
            onClick={() => setCampo(k)}
            className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors ${
              campo === k ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40' : 'bg-white/6 text-mist-400 hover:bg-white/10'
            }`}
          >
            {e}
          </button>
        ))}
      </div>
      <TextInput value={valor} onChange={setValor} placeholder={CAMPOS_LOTE.find((c) => c[0] === campo)![2]} className="w-full rounded-full" />
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-mist-400">
        <Casilla marcada={quitar} onChange={setQuitar} />
        Quitar este dato en todos
      </label>
      <Button onClick={() => aplicar.mutate()} disabled={!listo || aplicar.isPending}>
        {aplicar.isPending ? 'Aplicando…' : quitar ? `Quitar ${etiqueta.toLowerCase()} en ${ids.length}` : `Poner ${etiqueta.toLowerCase()} «${valor.trim() || '…'}» en ${ids.length}`}
      </Button>
      {aviso && <p className="text-[11.5px] text-mist-400">{aviso}</p>}
      <p className="text-[11px] text-mist-600">Solo modifica la base de datos, no la biblioteca física. Se puede deshacer título a título.</p>
    </div>
  );
}

function Lista({ seleccion, onSelect }: { seleccion: number | null; onSelect: (f: ScraperFila) => void }) {
  const [filtro, setFiltro] = useState<string>('huecos');
  const [kind, setKind] = useState<'' | 'movie' | 'show'>('');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [acumuladas, setAcumuladas] = useState<ScraperFila[]>([]);
  const [lote, setLote] = useState(false);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());

  const alternar = (id: number) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const terminarLote = () => {
    setLote(false);
    setMarcados(new Set());
  };

  useEffect(() => {
    const t = setTimeout(() => setQ(texto), 250);
    return () => clearTimeout(t);
  }, [texto]);

  useEffect(() => {
    setOffset(0);
    setAcumuladas([]);
  }, [filtro, kind, q]);

  const { data, isFetching } = useQuery({
    queryKey: ['scraper-lista', filtro, kind, q, offset],
    queryFn: () => api.scraperTitulos({ filtro, q, kind, offset }),
    placeholderData: (previa) => previa,
  });

  useEffect(() => {
    if (!data || data.offset !== offset) return;
    setAcumuladas((prev) => (offset === 0 ? data.items : [...prev, ...data.items.filter((n) => !prev.some((p) => p.id === n.id))]));
  }, [data, offset]);

  const { data: elegida } = useQuery({
    queryKey: ['scraper-titulo', seleccion],
    queryFn: () => api.scraperTitulo(seleccion!),
    enabled: seleccion != null,
  });

  const aldia = (f: ScraperFila): ScraperFila =>
    elegida && elegida.id === f.id
      ? { ...f, title: elegida.title, year: elegida.year, poster: elegida.poster, fanart: elegida.fanart, logo: elegida.logo, arte_actualizado: elegida.arte_actualizado }
      : f;

  const total = data?.total ?? 0;

  return (
    <div className="glass flex min-h-0 flex-col gap-3.5 rounded-[var(--radius-panel)] p-4 shadow-[var(--shadow-3)]">
      {/* Buscador de alta fidelidad */}
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-mist-500">
          <IconoBuscar />
        </span>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar en el catálogo…"
          className="w-full rounded-full border border-white/8 bg-black/30 py-2.5 pr-9 pl-10 text-[13px] text-mist-100 outline-none transition-all placeholder:text-mist-600 focus:border-accent/40 focus:bg-black/45 focus:ring-2 focus:ring-accent/15"
        />
        {texto && (
          <button
            type="button"
            onClick={() => setTexto('')}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-[12px] font-bold text-mist-500 hover:text-mist-200"
          >
            ✕
          </button>
        )}
      </div>

      {/* Píldoras de filtrado */}
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => {
          const activo = filtro === f.clave;
          const cuenta = data?.cuenta[f.clave];
          return (
            <button
              key={f.clave}
              type="button"
              onClick={() => setFiltro(f.clave)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium transition-all duration-200 ${
                activo
                  ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40 shadow-sm'
                  : 'bg-white/5 text-mist-400 hover:bg-white/10 hover:text-mist-200'
              }`}
            >
              <span>{f.etiqueta}</span>
              {cuenta != null && (
                <span className={`text-[10px] font-mono tabular-nums ${activo ? 'text-accent/90' : 'text-mist-600'}`}>
                  {cuenta}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selector de tipo y modo lote */}
      <div className="flex items-center justify-between border-t border-white/6 pt-2.5 text-[11.5px]">
        <div className="flex items-center gap-1 rounded-full bg-black/20 p-0.5 ring-1 ring-white/6">
          {([['', 'Todo'], ['movie', 'Películas'], ['show', 'Series']] as const).map(([k, e]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full px-2.5 py-1 transition-all ${
                kind === k ? 'bg-white/14 font-medium text-mist-100 shadow-sm' : 'text-mist-500 hover:text-mist-300'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono tabular-nums text-mist-500">{total} títulos</span>
          <button
            type="button"
            onClick={() => (lote ? terminarLote() : setLote(true))}
            className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
              lote ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40' : 'text-mist-400 hover:text-mist-100'
            }`}
          >
            {lote ? 'Salir' : 'Seleccionar'}
          </button>
        </div>
      </div>

      {lote && (
        <div className="flex items-center justify-between rounded-xl bg-accent/8 px-3 py-2 text-[11.5px] ring-1 ring-accent/20">
          <button
            type="button"
            className="font-semibold text-accent hover:underline underline-offset-2"
            onClick={() => setMarcados((m) => new Set([...m, ...acumuladas.map((x) => x.id)]))}
          >
            Marcar los {acumuladas.length} cargados
          </button>
          <button
            type="button"
            className="text-mist-400 hover:underline underline-offset-2"
            onClick={() => setMarcados(new Set())}
          >
            Desmarcar todos
          </button>
        </div>
      )}

      {/* Lista scrolleable estilizada */}
      <div className="max-h-[calc(100vh-22rem)] min-h-64 space-y-1 overflow-y-auto pr-1">
        {acumuladas.map((f) => (
          <Fila
            key={f.id}
            f={aldia(f)}
            activa={f.id === seleccion}
            marcada={lote ? marcados.has(f.id) : undefined}
            onClick={() => (lote ? alternar(f.id) : onSelect(f))}
          />
        ))}

        {!isFetching && acumuladas.length === 0 && (
          <div className="py-12 text-center text-[12.5px] text-mist-500">
            No hay títulos con el filtro seleccionado.
          </div>
        )}

        {acumuladas.length < total && (
          <div className="py-3 text-center">
            <Button variant="ghost" onClick={() => setOffset(acumuladas.length)} disabled={isFetching}>
              {isFetching ? 'Cargando más…' : `Cargar más (${total - acumuladas.length} restantes)`}
            </Button>
          </div>
        )}
      </div>

      {lote && marcados.size > 0 && <BarraLote ids={[...marcados]} alTerminar={terminarLote} />}
    </div>
  );
}

function Tarjeta({ p, elegida, onClick }: { p: Proposal; elegida: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-36 shrink-0 flex-col gap-2 rounded-2xl p-2.5 text-left transition-all duration-200 ${
        elegida
          ? 'bg-gradient-to-b from-accent/20 via-accent/8 to-transparent ring-1 ring-accent/50 shadow-[0_0_24px_-4px_rgba(240,165,74,0.4)]'
          : 'bg-white/4 opacity-75 ring-1 ring-white/6 hover:opacity-100 hover:bg-white/8'
      }`}
    >
      <div className="aspect-2/3 w-full overflow-hidden rounded-xl bg-ink-800 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.85)] ring-1 ring-white/12 transition-transform duration-200 group-hover:scale-105">
        {p.posterUrl ? (
          <img src={pequena(p.posterUrl, 'w342')!} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-[11px] text-mist-600">Sin póster</div>
        )}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-[12px] font-semibold leading-tight text-mist-100 group-hover:text-white">
          {p.title}
        </div>
        <div className="mt-0.5 text-[11px] text-mist-500 font-mono">
          {p.year ?? 's/f'} · <span className="text-accent-soft">{p.fuente === 'omdb' ? p.imdbId : `TMDb ${p.tmdbId}`}</span>
        </div>
      </div>
    </button>
  );
}

function Comparar({ titulo, p, campos, setCampos }: { titulo: ScraperTitulo; p: Proposal; campos: Campo[]; setCampos: (c: Campo[]) => void }) {
  const alternar = (c: Campo) => setCampos(campos.includes(c) ? campos.filter((k) => k !== c) : [...campos, c]);
  const filas: { c: Campo; actual: React.ReactNode; nuevo: React.ReactNode; hay: boolean }[] = [
    {
      c: 'poster',
      hay: !!p.posterUrl,
      actual: titulo.poster ? (
        <img src={img.poster(titulo.id, 400, titulo.arte_actualizado)} alt="" className="h-44 rounded-xl shadow-md ring-1 ring-white/10" />
      ) : (
        <span className="text-mist-600">—</span>
      ),
      nuevo: p.posterUrl ? (
        <img src={pequena(p.posterUrl, 'w500')!} alt="" className="h-44 rounded-xl shadow-md ring-1 ring-accent/35" />
      ) : (
        <span className="text-mist-600">{p.fuente === 'omdb' ? 'OMDb' : 'TMDb'} no tiene</span>
      ),
    },
    {
      c: 'fanart',
      hay: !!p.backdropUrl,
      actual: titulo.fanart ? (
        <img src={img.fanart(titulo.id, 800, titulo.arte_actualizado)} alt="" className="h-32 rounded-xl object-cover" />
      ) : (
        <span className="text-mist-600">—</span>
      ),
      nuevo: p.backdropUrl ? (
        <img src={pequena(p.backdropUrl, 'w780')!} alt="" className="h-32 rounded-xl object-cover ring-1 ring-accent/35" />
      ) : (
        <span className="text-mist-600">{p.fuente === 'omdb' ? 'OMDb' : 'TMDb'} no tiene</span>
      ),
    },
    {
      c: 'logo',
      hay: !!p.logoUrl,
      actual: titulo.logo ? (
        <img src={img.logo(titulo.id, 500, titulo.arte_actualizado)} alt="" className="h-16 object-contain" />
      ) : (
        <span className="text-mist-600">—</span>
      ),
      nuevo: p.logoUrl ? (
        <img src={pequena(p.logoUrl, 'w500')!} alt="" className="h-16 object-contain drop-shadow-md" />
      ) : (
        <span className="text-mist-600">{p.fuente === 'omdb' ? 'OMDb' : 'TMDb'} no tiene</span>
      ),
    },
    {
      c: 'plot',
      hay: !!p.overview,
      actual: <p className="line-clamp-4 text-[12px] leading-relaxed text-mist-400">{titulo.plot || <span className="text-mist-600">—</span>}</p>,
      nuevo: <p className="line-clamp-4 text-[12px] leading-relaxed text-mist-200">{p.overview || <span className="text-mist-600">{p.fuente === 'omdb' ? 'OMDb' : 'TMDb'} no tiene</span>}</p>,
    },
    {
      c: 'rating',
      hay: p.rating != null,
      actual: <span className="font-mono text-mist-400">{titulo.rating != null ? titulo.rating.toFixed(1) : '—'}</span>,
      nuevo: <span className="font-mono font-bold text-accent-soft">{p.rating != null ? p.rating.toFixed(1) : '—'}</span>,
    },
    {
      c: 'ficha',
      hay: !!(p.reparto?.length || p.estudios?.length),
      actual: (
        <span className="text-mist-400">
          {titulo.reparto} personas{titulo.studio ? ' · ' + titulo.studio : ''}{titulo.country ? ' · ' + titulo.country : ''}
        </span>
      ),
      nuevo: (
        <div className="space-y-0.5 text-mist-200">
          <div>{p.reparto?.length ?? 0} actores{p.directores?.length ? ' · dir. ' + p.directores.slice(0, 2).join(', ') : ''}</div>
          <div className="text-mist-500 text-[11.5px]">{[p.estudios?.slice(0, 2).join(', '), p.paises?.join(', ')].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    {
      c: 'genres',
      hay: p.genres.length > 0,
      actual: <span className="text-mist-600">se conservan; marcar añade los de TMDb</span>,
      nuevo: <span className="text-mist-200">{p.genres.join(', ') || '—'}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Banner de propuesta */}
      <div className="rounded-2xl bg-gradient-to-r from-accent/14 via-accent/5 to-transparent p-4 ring-1 ring-accent/25">
        <div className="flex items-center gap-2 text-[10.5px] font-bold tracking-[0.16em] text-accent uppercase">
          <span>Propuesta de {p.fuente === 'omdb' ? 'OMDb' : 'TMDb'}</span>
          <span className="font-mono text-accent-soft">· ID {p.fuente === 'omdb' ? p.imdbId : p.tmdbId}</span>
        </div>
        {p.fuente === 'omdb' && (
          <div className="mt-1 text-[11.5px] text-amber-200/90">
            OMDb provee datos en inglés y no contiene logo/fondo. Ideal para nota, edad y géneros.
          </div>
        )}
        <div className="mt-1.5 text-[18px] font-bold tracking-tight text-white">
          {p.title} <span className="font-normal font-mono text-mist-400">({p.year ?? 's/f'})</span>
        </div>
        {p.originalTitle && p.originalTitle !== p.title && (
          <div className="mt-0.5 text-[12px] text-mist-500 italic">Título original: {p.originalTitle}</div>
        )}
      </div>

      {/* Selector rápido de campos */}
      <div className="flex items-center justify-between border-b border-white/6 pb-2 text-[12px]">
        <span className="text-mist-400 font-medium">Campos a actualizar:</span>
        <div className="flex gap-2.5">
          <button
            type="button"
            className="font-semibold text-accent hover:underline underline-offset-2"
            onClick={() => setCampos(filas.filter((f) => f.hay && f.c !== 'ficha').map((f) => f.c))}
          >
            Marcar todo
          </button>
          <button
            type="button"
            className="text-mist-400 hover:text-mist-200 hover:underline underline-offset-2"
            onClick={() => setCampos(filas.filter((f) => f.hay && f.c !== 'genres' && f.c !== 'ficha' && !tiene(titulo, f.c)).map((f) => f.c))}
          >
            Solo huecos
          </button>
          <button
            type="button"
            className="text-mist-500 hover:text-mist-300 hover:underline underline-offset-2"
            onClick={() => setCampos([])}
          >
            Ninguno
          </button>
        </div>
      </div>

      {/* Tabla comparativa estilizada */}
      <div className="divide-y divide-white/6 overflow-hidden rounded-2xl bg-black/25 ring-1 ring-white/8">
        <div className="grid grid-cols-[2rem_6rem_1fr_1fr] items-center gap-3 bg-white/4 px-4 py-2.5 text-[11px] font-bold tracking-[0.12em] text-mist-500 uppercase">
          <span />
          <span>Campo</span>
          <span>Actual en biblioteca</span>
          <span>Propuesta de {p.fuente === 'omdb' ? 'OMDb' : 'TMDb'}</span>
        </div>
        {filas.map((f) => (
          <label
            key={f.c}
            className={`grid grid-cols-[2rem_6rem_1fr_1fr] items-center gap-3 px-4 py-3 transition-colors ${
              f.hay ? 'cursor-pointer hover:bg-white/4' : 'opacity-40'
            } ${campos.includes(f.c) ? 'bg-accent/6' : ''}`}
          >
            <Casilla disabled={!f.hay} marcada={campos.includes(f.c)} onChange={() => alternar(f.c)} />
            <span className="text-[12.5px] font-semibold text-mist-200">{CAMPOS.find((x) => x.clave === f.c)!.etiqueta}</span>
            <div className="min-w-0 text-[12.5px]">{f.actual}</div>
            <div className="min-w-0 text-[12.5px]">{f.nuevo}</div>
          </label>
        ))}
      </div>
    </div>
  );
}

function tiene(t: ScraperTitulo, c: Campo): boolean {
  switch (c) {
    case 'poster':
      return !!t.poster;
    case 'fanart':
      return !!t.fanart;
    case 'logo':
      return !!t.logo;
    case 'plot':
      return !!t.plot;
    case 'rating':
      return t.rating != null;
    case 'ficha':
      return t.reparto > 0 && !!t.studio;
    default:
      return false;
  }
}

function Emparejar({ titulo }: { titulo: ScraperTitulo }) {
  const qc = useQueryClient();
  const inicial = titulo.tmdb_id ? titulo.tmdb_id : titulo.title;
  const [entrada, setEntrada] = useState(inicial);
  const [propuestas, setPropuestas] = useState<Proposal[]>([]);
  const [elegida, setElegida] = useState<Proposal | null>(null);
  const [campos, setCampos] = useState<Campo[]>([]);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState('');
  const [identidad, setIdentidad] = useState(false);
  const lanzada = useRef<number | null>(null);
  const [fuente, setFuente] = useState<'tmdb' | 'omdb' | 'todas'>('tmdb');
  const inicialDe = (fu: 'tmdb' | 'omdb' | 'todas') => (fu === 'omdb' ? titulo.imdb_id || titulo.title : inicial);

  const buscar = useMutation({
    mutationFn: async ({ texto, fu }: { texto: string; fu: 'tmdb' | 'omdb' | 'todas' }) => {
      if (fu === 'omdb') return api.scraperResolverOmdb(texto, titulo.kind, titulo.year);
      let r: { propuestas: Proposal[]; aviso?: string };
      try {
        r = await api.scraperResolver(texto, titulo.kind, titulo.tmdb_id ? null : titulo.year);
      } catch (e) {
        if (fu !== 'todas') throw e;
        r = { propuestas: [], aviso: (e as Error).message };
      }
      if (fu === 'todas' && r.propuestas.length === 0 && !/^\d+$/.test(texto.trim())) {
        const o = await api.scraperResolverOmdb(texto, titulo.kind, titulo.year).catch(() => null);
        if (o && o.propuestas.length) return o;
      }
      return r;
    },
    onSuccess: (r) => {
      setPropuestas(r.propuestas);
      setAviso(r.aviso ?? (r.propuestas.length === 0 ? 'Sin resultados. Prueba con otro título, un ID de TMDb o su URL.' : ''));
      setError('');
      const primera = r.propuestas[0] ?? null;
      setElegida(primera);
    },
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    setFuente('tmdb');
    setEntrada(inicial);
    setPropuestas([]);
    setElegida(null);
    setCampos([]);
    setAviso('');
    setError('');
    setHecho('');
    setIdentidad(!titulo.tmdb_id);
    if (lanzada.current !== titulo.id) {
      lanzada.current = titulo.id;
      buscar.mutate({ texto: inicial, fu: 'tmdb' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulo.id]);

  useEffect(() => {
    if (!elegida) return setCampos([]);
    const hay: Record<Campo, boolean> = {
      poster: !!elegida.posterUrl,
      fanart: !!elegida.backdropUrl,
      logo: !!elegida.logoUrl,
      plot: !!elegida.overview,
      rating: elegida.rating != null,
      genres: elegida.genres.length > 0,
      ficha: false,
    };
    setCampos(CAMPOS.map((c) => c.clave).filter((c) => c !== 'genres' && hay[c] && !tiene(titulo, c)));
  }, [elegida, titulo]);

  const aplicar = useMutation({
    mutationFn: () =>
      elegida!.fuente === 'omdb'
        ? api.scraperAplicarOmdb({
            itemId: titulo.id,
            imdbId: elegida!.imdbId!,
            kind: titulo.kind,
            fields: campos.filter((c): c is 'poster' | 'plot' | 'rating' | 'genres' => ['poster', 'plot', 'rating', 'genres'].includes(c)),
            overwrite: true,
          })
        : api.enrichApply({
            itemId: titulo.id,
            tmdbId: elegida!.tmdbId,
            kind: titulo.kind,
            fields: campos.flatMap((c) => (c === 'ficha' ? ['cast', 'studio', 'ratings'] : [c])),
            overwrite: true,
            identidad,
          }),
    onSuccess: (r) => {
      setHecho(`Guardado con éxito en «${r.title}»: ${r.applied.join(', ')}.`);
      setError('');
      qc.invalidateQueries({ queryKey: ['scraper-titulo', titulo.id] });
      qc.invalidateQueries({ queryKey: ['scraper-historial', titulo.id] });
      qc.invalidateQueries({ queryKey: ['scraper-lista'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-5">
      {/* Selector de fuente y descripción */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/6 pb-3">
        <div className="flex gap-1 rounded-full bg-black/30 p-1 ring-1 ring-white/8">
          {([['tmdb', 'TMDb'], ['omdb', 'OMDb'], ['todas', 'Todas las fuentes']] as const).map(([k, e]) => (
            <button
              key={k}
              type="button"
              disabled={buscar.isPending}
              onClick={() => {
                if (k === fuente) return;
                setFuente(k);
                setPropuestas([]);
                setElegida(null);
                setCampos([]);
                setAviso('');
                setError('');
                setHecho('');
                const texto = inicialDe(k);
                setEntrada(texto);
                buscar.mutate({ texto, fu: k });
              }}
              className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition-all ${
                fuente === k
                  ? 'bg-white/14 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                  : 'text-mist-400 hover:text-mist-200'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-mist-500">
          {fuente === 'omdb'
            ? 'Sin fondo ni logo; título y sinopsis en inglés.'
            : fuente === 'todas'
              ? 'TMDb, TVDB, OMDb y TVmaze juntas: eliges qué dato adoptar.'
              : 'La fuente principal: datos y arte oficial en español.'}
        </span>
      </div>

      {/* Formulario de búsqueda directa */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (entrada.trim()) buscar.mutate({ texto: entrada, fu: fuente });
        }}
      >
        <TextInput
          value={entrada}
          onChange={setEntrada}
          placeholder="Título, ID de TMDb, ID de IMDb (tt…) o URL directa…"
          className="flex-1 rounded-full"
        />
        <Button onClick={() => entrada.trim() && buscar.mutate({ texto: entrada, fu: fuente })} disabled={buscar.isPending}>
          {buscar.isPending ? 'Buscando…' : 'Buscar'}
        </Button>
      </form>

      {aviso && <p className="rounded-xl bg-white/4 px-4 py-2.5 text-[12.5px] text-mist-400">{aviso}</p>}

      {/* Carrusel de propuestas encontradas */}
      {propuestas.length > 1 && (
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-mist-400">Coincidencias encontradas ({propuestas.length}):</div>
          <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-2">
            {propuestas.map((p) => {
              const clave = p.imdbId ?? p.tmdbId;
              return (
                <Tarjeta
                  key={clave}
                  p={p}
                  elegida={(elegida?.imdbId ?? elegida?.tmdbId) === clave}
                  onClick={() => setElegida(p)}
                />
              );
            })}
          </div>
        </div>
      )}

      {elegida && fuente === 'todas' && <MezclaFuentes titulo={titulo} p={elegida} />}
      {elegida && fuente !== 'todas' && <Comparar titulo={titulo} p={elegida} campos={campos} setCampos={setCampos} />}

      {elegida && fuente !== 'todas' && elegida.fuente !== 'omdb' && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/3 p-3 text-[12.5px] text-mist-300 ring-1 ring-white/6">
          <Casilla marcada={identidad} onChange={setIdentidad} />
          <span>
            Actualizar también el título canónico, año y clasificación oficial de TMDb{' '}
            <span className="text-mist-500 font-mono">({elegida.title}{elegida.year ? ` · ${elegida.year}` : ''})</span>. Esto lo
            utilizará la opción «Organizar» para renombrar carpetas y archivos.
          </span>
        </label>
      )}

      {campos.includes('ficha') && (
        <div className="rounded-xl bg-amber-500/10 p-3.5 text-[12px] leading-relaxed text-amber-200 ring-1 ring-amber-500/20">
          Al incorporar reparto, estudios y país de TMDb, el título se gestionará íntegramente desde la base de datos del servidor y sus
          datos dejarán de depender de archivos .nfo locales.
        </div>
      )}

      {error && <p className="rounded-xl bg-red-500/10 p-3 text-[12.5px] text-red-400 ring-1 ring-red-500/20">{error}</p>}
      {hecho && <p className="rounded-xl bg-emerald-500/10 p-3 text-[12.5px] text-emerald-300 ring-1 ring-emerald-500/20">{hecho}</p>}

      {elegida && fuente !== 'todas' && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button onClick={() => aplicar.mutate()} disabled={aplicar.isPending || campos.length === 0}>
            {aplicar.isPending ? 'Guardando en biblioteca…' : `Aplicar cambios seleccionados (${campos.length})`}
          </Button>
          <span className="text-[11.5px] text-mist-500">
            Se almacena en la base de datos y en data/artwork; la biblioteca de medios no se modifica.
          </span>
        </div>
      )}
    </div>
  );
}

function ArteACarpeta({ id }: { id: number }) {
  const [abierto, setAbierto] = useState(false);
  const [hecho, setHecho] = useState('');
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ['scraper-arte-carpeta', id],
    queryFn: () => api.scraperArteCarpeta(id),
    enabled: abierto,
    retry: false,
    staleTime: 0,
  });
  const aplicar = useMutation({
    mutationFn: () => api.scraperArteCarpetaAplicar(id),
    onSuccess: (r) => {
      setHecho(`Escritos ${r.escritos.length} ficheros${r.retirados ? ` y apartados ${r.retirados} en _retirados` : ''}.`);
      qc.invalidateQueries({ queryKey: ['scraper-arte-carpeta', id] });
    },
  });
  useEffect(() => {
    setAbierto(false);
    setHecho('');
  }, [id]);

  return (
    <div className="rounded-2xl bg-white/4 p-4 text-[12.5px] ring-1 ring-white/6">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-left font-semibold text-mist-200">
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="2" y="2" width="12" height="12" rx="2" /><circle cx="5.5" cy="5.5" r="1.5" /><path d="m14 10-3.5-3.5-5.5 5.5" />
          </svg>
          Exportar imágenes a la carpeta local (Plex, Kodi y Jellyfin)
        </span>
        <span className="font-mono text-mist-500">{abierto ? '−' : '+'}</span>
      </button>
      {abierto && (
        <div className="mt-3.5 space-y-3 pt-1 border-t border-white/6">
          {plan.isLoading && <p className="text-mist-500">Calculando plan de exportación…</p>}
          {plan.error && <p className="text-red-400">{(plan.error as Error).message}</p>}
          {plan.data && plan.data.pasos.length === 0 && (
            <p className="text-mist-500">Todo el arte de la carpeta ya coincide exactamente con el seleccionado en MediaWatch.</p>
          )}
          {plan.data && plan.data.pasos.length > 0 && (
            <>
              <p className="text-mist-400">
                Se guardará en el disco en: <span className="break-all font-mono text-mist-200">{plan.data.carpeta}</span>
              </p>
              <ul className="space-y-1">
                {plan.data.pasos.map((p) => (
                  <li key={p.papel} className="rounded-xl bg-black/25 px-3 py-2 text-[12px]">
                    <span className="font-semibold text-emerald-300">crear</span> <span className="break-all font-mono">{p.hacia}</span>
                    {p.retira && <div className="text-amber-300/90 text-[11px] mt-0.5">apartar a _retirados: <span className="break-all font-mono">{p.retira}</span></div>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button variant="danger" onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>
                  {aplicar.isPending ? 'Escribiendo…' : 'Sí, exportar arte a la biblioteca'}
                </Button>
                <span className="text-[11.5px] text-mist-500">Nada se borra: los archivos reemplazados van a la carpeta _retirados.</span>
              </div>
            </>
          )}
          {aplicar.error && <p className="text-red-400">{(aplicar.error as Error).message}</p>}
          {hecho && <p className="text-emerald-400">{hecho}</p>}
        </div>
      )}
    </div>
  );
}

function Organizar({ id, kind }: { id: number; kind: 'movie' | 'show' }) {
  const [abierto, setAbierto] = useState(false);
  const [edicion, setEdicion] = useState('');
  const [hecho, setHecho] = useState('');
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ['scraper-organizar', id, edicion],
    queryFn: () => api.scraperOrganizar(id, edicion),
    enabled: abierto,
    retry: false,
    staleTime: 0,
  });
  const aplicar = useMutation({
    mutationFn: () => api.scraperOrganizarAplicar(id, edicion),
    onSuccess: (r) => {
      setHecho(`Completado: ${r.movidos} cambios de nombre realizados.`);
      for (const k of ['scraper-organizar', 'scraper-titulo', 'scraper-lista']) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  useEffect(() => {
    setAbierto(false);
    setHecho('');
    setEdicion('');
  }, [id]);

  return (
    <div className="rounded-2xl bg-white/4 p-4 text-[12.5px] ring-1 ring-white/6">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-left font-semibold text-mist-200">
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M2 4h4l2 2h6v7H2z" strokeLinecap="round" />
          </svg>
          Organizar: renombrar carpetas y ficheros según estándar tMM
        </span>
        <span className="font-mono text-mist-500">{abierto ? '−' : '+'}</span>
      </button>
      {abierto && (
        <div className="mt-3.5 space-y-3 pt-1 border-t border-white/6">
          {kind === 'movie' && (
            <label className="flex flex-wrap items-center gap-2 text-mist-300">
              Edición opcional:
              <TextInput value={edicion} onChange={setEdicion} placeholder="Extended Edition, IMAX, Final Cut…" className="w-64" />
            </label>
          )}
          {plan.isLoading && <p className="text-mist-500">Calculando cambios de ruta…</p>}
          {plan.error && <p className="text-red-400">{(plan.error as Error).message}</p>}
          {plan.data && plan.data.pasos.length === 0 && (
            <p className="text-mist-500">Ya está completamente organizado: la estructura y los nombres son impecables.</p>
          )}
          {plan.data && plan.data.pasos.length > 0 && (
            <>
              <p className="text-mist-400">Se van a renombrar los siguientes elementos en la biblioteca (sin borrados):</p>
              <ul className="max-h-64 space-y-1.5 overflow-y-auto font-mono text-[11.5px]">
                {plan.data.pasos.map((p, i) => (
                  <li key={i} className="rounded-xl bg-black/25 px-3 py-2">
                    <div className="break-all text-mist-500">{p.tipo === 'carpeta' ? '[CARPETA] ' : '[ARCHIVO] '}{p.desde}</div>
                    <div className="break-all text-emerald-300 mt-0.5">→ {p.final}</div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button variant="danger" onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>
                  {aplicar.isPending ? 'Renombrando…' : 'Sí, renombrar en la biblioteca'}
                </Button>
                <span className="text-[11.5px] text-mist-500">Plex indexará estos elementos como nuevos tras reescanear.</span>
              </div>
            </>
          )}
          {aplicar.error && <p className="text-red-400">{(aplicar.error as Error).message}</p>}
          {hecho && <p className="text-emerald-400">{hecho}</p>}
        </div>
      )}
    </div>
  );
}

function NfoACarpeta({ id }: { id: number }) {
  const [abierto, setAbierto] = useState(false);
  const [hecho, setHecho] = useState('');
  const qc = useQueryClient();
  const plan = useQuery({
    queryKey: ['scraper-nfo', id],
    queryFn: () => api.scraperNfo(id),
    enabled: abierto,
    retry: false,
    staleTime: 0,
  });
  const aplicar = useMutation({
    mutationFn: () => api.scraperNfoAplicar(id),
    onSuccess: (r) => {
      setHecho(`Escritos ${r.escritos.length} NFO${r.retirados ? ` y apartados ${r.retirados} en _retirados` : ''}.`);
      qc.invalidateQueries({ queryKey: ['scraper-nfo', id] });
    },
  });
  useEffect(() => {
    setAbierto(false);
    setHecho('');
  }, [id]);

  return (
    <div className="rounded-2xl bg-white/4 p-4 text-[12.5px] ring-1 ring-white/6">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-left font-semibold text-mist-200">
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 2h8l3 3v9H4z" strokeLinecap="round" /><path d="M7 6h3M7 9h4M7 12h2" strokeLinecap="round" />
          </svg>
          Escribir NFO local en la carpeta (para preservar metadatos fuera del servidor)
        </span>
        <span className="font-mono text-mist-500">{abierto ? '−' : '+'}</span>
      </button>
      {abierto && (
        <div className="mt-3.5 space-y-3 pt-1 border-t border-white/6">
          {plan.isLoading && <p className="text-mist-500">Calculando NFO…</p>}
          {plan.error && <p className="text-red-400">{(plan.error as Error).message}</p>}
          {plan.data && plan.data.pasos.length === 0 && (
            <p className="text-mist-500">Los archivos .NFO de la carpeta están completamente actualizados.</p>
          )}
          {plan.data && plan.data.pasos.length > 0 && (
            <>
              <p className="text-mist-400">Se escribirán los siguientes archivos NFO:</p>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto font-mono text-[11.5px]">
                {plan.data.pasos.map((p, i) => (
                  <li key={i} className="rounded-xl bg-black/25 px-3 py-2">
                    <span className="font-semibold text-emerald-300">escribir</span> <span className="break-all">{p.hacia}</span>
                    {p.retira && <div className="text-amber-300/90 text-[11px] mt-0.5">apartar: <span className="break-all">{p.retira}</span></div>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Button variant="danger" onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>
                  {aplicar.isPending ? 'Escribiendo…' : 'Sí, escribir los NFO'}
                </Button>
                <span className="text-[11.5px] text-mist-500">Los archivos anteriores se apartan a _retirados sin borrarse.</span>
              </div>
            </>
          )}
          {aplicar.error && <p className="text-red-400">{(aplicar.error as Error).message}</p>}
          {hecho && <p className="text-emerald-400">{hecho}</p>}
        </div>
      )}
    </div>
  );
}

function Enviar({ id, kind }: { id: number; kind: 'movie' | 'show' }) {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => setAbierto(false), [id]);
  return (
    <div className="rounded-2xl bg-white/4 p-4 text-[12.5px] ring-1 ring-white/6">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-left font-semibold text-mist-200">
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Mover o enviar título a otra biblioteca física
        </span>
        <span className="font-mono text-mist-500">{abierto ? '−' : '+'}</span>
      </button>
      {abierto && (
        <div className="mt-3.5 pt-2 border-t border-white/6">
          <EnviarTitulos ids={[id]} kind={kind} />
        </div>
      )}
    </div>
  );
}

function Deshacer({ id }: { id: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['scraper-historial', id], queryFn: () => api.scraperHistorial(id) });
  const [error, setError] = useState('');
  const deshacer = useMutation({
    mutationFn: () => api.scraperDeshacer(id),
    onSuccess: () => {
      setError('');
      for (const k of ['scraper-historial', 'scraper-titulo', 'scraper-lista', 'home']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => setError(e.message),
  });
  if (!data?.ultima) return null;
  const cuando = new Date(data.ultima.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/4 px-4 py-2.5 text-[12.5px] ring-1 ring-white/6">
      <div className="flex items-center gap-2 text-mist-300">
        <svg viewBox="0 0 16 16" className="h-4 w-4 text-mist-400" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2 6.5M2 2.5v4h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Último cambio: <strong className="font-semibold text-mist-100">{data.ultima.etiqueta}</strong> ({cuando})</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => deshacer.mutate()} disabled={deshacer.isPending}>
          {deshacer.isPending ? 'Deshaciendo…' : 'Deshacer'}
        </Button>
        {error && <span className="text-red-400 text-[12px]">{error}</span>}
      </div>
    </div>
  );
}

function Datos({ id }: { id: number }) {
  const { data: item } = useQuery({ queryKey: ['item', id], queryFn: () => api.itemScraper(id) });
  if (!item) return <div className="p-8 text-center text-[13px] text-mist-500">Cargando datos del título…</div>;
  return <EditorDatos item={item} />;
}

type Pestana = 'datos' | 'emparejar' | 'imagenes' | 'archivos';
const PESTANAS: ReadonlyArray<readonly [Pestana, string]> = [
  ['datos', 'Datos'],
  ['emparejar', 'Emparejar con TMDb'],
  ['imagenes', 'Imágenes'],
  ['archivos', 'Archivos'],
];

function Anillo({ hechos, total }: { hechos: number; total: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const pct = Math.round((hechos / total) * 100);
  return (
    <div className="relative h-14 w-14 shrink-0" title={`${hechos} de ${total} datos completos`}>
      <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="4" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(c * hechos) / total} ${c}`}
          style={{ filter: 'drop-shadow(0 0 6px rgba(240, 165, 74, 0.6))' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap text-[13px] font-bold tabular-nums text-white">
        {pct}
        <span className="ml-px text-[9px] font-normal text-mist-400">%</span>
      </span>
    </div>
  );
}

function Ficha({ id }: { id: number }) {
  const [pestana, setPestana] = useState<Pestana>('datos');
  const { data: t } = useQuery({ queryKey: ['scraper-titulo', id], queryFn: () => api.scraperTitulo(id) });
  const cargada = t != null;
  const tmdb = t?.tmdb_id ?? null;

  useEffect(() => {
    if (cargada) setPestana(tmdb ? 'datos' : 'emparejar');
  }, [id, cargada, tmdb]);

  if (!t) return <div className="p-12 text-center text-[13px] text-mist-500">Cargando ficha del título…</div>;

  const enlaceTmdb = t.tmdb_id ? `https://www.themoviedb.org/${t.kind === 'show' ? 'tv' : 'movie'}/${t.tmdb_id}` : null;
  const estado: [string, boolean][] = [
    ['Póster', !!t.poster],
    ['Fondo', !!t.fanart],
    ['Logo', !!t.logo],
    ['Sinopsis', !!t.plot],
    ['Edad', !!t.mpaa],
    ['TMDb', !!t.tmdb_id],
  ];
  const hechos = estado.filter(([, ok]) => ok).length;

  return (
    <div>
      {/* Hero cinemático con backdrop y degradado suave */}
      <div className="relative isolate overflow-hidden">
        {t.fanart ? (
          <img src={img.fanart(t.id, 1280, t.arte_actualizado)} alt="" className="absolute inset-0 -z-20 h-full w-full scale-105 object-cover opacity-45" />
        ) : t.poster ? (
          <img src={img.poster(t.id, 300, t.arte_actualizado)} alt="" className="absolute inset-0 -z-20 h-full w-full scale-150 object-cover opacity-25 blur-3xl" />
        ) : null}

        {/* Gradientes multicapa para fundido impecable */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-950 via-ink-900/80 to-ink-900/30" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-950/95 via-ink-900/60 to-transparent" />

        <div className="flex flex-col gap-6 px-6 pt-8 pb-6 sm:flex-row sm:gap-7">
          {/* Póster con relieve 3D */}
          <div className="w-32 shrink-0 self-start overflow-hidden rounded-2xl bg-ink-800 shadow-[0_24px_50px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/15 sm:w-44">
            <div className="aspect-2/3">
              {t.poster ? (
                <img src={img.poster(t.id, 500, t.arte_actualizado)} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-[12px] text-mist-600">Sin cartel</div>
              )}
            </div>
          </div>

          {/* Información principal */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-accent uppercase">
              <span>{t.kind === 'show' ? 'Serie de TV' : 'Película'}</span>
              <span className="text-mist-600">·</span>
              <span className="text-mist-400">{t.biblioteca}</span>
              {t.mpaa && (
                <span className="rounded-md border border-white/20 bg-white/4 px-1.5 py-0.5 text-[10px] tracking-normal text-mist-200 font-mono">
                  {t.mpaa}
                </span>
              )}
            </div>

            {t.logo ? (
              <img
                src={img.logo(t.id, 520, t.arte_actualizado)}
                alt={t.title}
                className="mt-3.5 max-h-20 w-auto max-w-[min(420px,85%)] self-start object-contain object-left drop-shadow-[0_8px_28px_rgba(0,0,0,0.9)]"
              />
            ) : (
              <h2 className="mt-2 text-[32px] sm:text-[38px] leading-[1.05] font-extrabold tracking-tight text-white">
                {t.title}
              </h2>
            )}

            <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13.5px] text-mist-400">
              {t.logo ? <span className="font-semibold text-mist-100">{t.title}</span> : null}
              {t.year && <span className="font-mono tabular-nums text-mist-300">{t.year}</span>}
              {t.original_title && t.original_title !== t.title && (
                <span className="text-mist-500 italic">«{t.original_title}»</span>
              )}
              {t.collection && (
                <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent-soft ring-1 ring-accent/30">
                  {t.collection}
                </span>
              )}
            </div>

            {t.tagline && <p className="mt-2 text-[13px] text-mist-300 italic">«{t.tagline}»</p>}
            {t.plot && <p className="mt-2 line-clamp-2 max-w-2xl text-[12.5px] leading-relaxed text-mist-400">{t.plot}</p>}

            {/* Fila de salud y completitud */}
            <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-4">
              <Anillo hechos={hechos} total={estado.length} />
              <div className="flex flex-wrap gap-1.5">
                {estado.map(([n, ok]) => (
                  <span
                    key={n}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      ok
                        ? 'bg-emerald-400/12 text-emerald-300 ring-1 ring-emerald-400/25'
                        : 'bg-red-400/10 text-red-300 ring-1 ring-red-400/20'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    {n}
                  </span>
                ))}
              </div>
              <div className="ml-auto flex gap-2 text-[11.5px]">
                {enlaceTmdb && (
                  <a
                    href={enlaceTmdb}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-full bg-white/8 px-3.5 py-1 text-mist-200 transition-colors hover:bg-white/16 hover:text-white"
                  >
                    <span>TMDb {t.tmdb_id}</span>
                    <span className="text-[10px]">↗</span>
                  </a>
                )}
                {t.imdb_id && (
                  <a
                    href={`https://www.imdb.com/title/${t.imdb_id}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-full bg-white/8 px-3.5 py-1 text-mist-200 transition-colors hover:bg-white/16 hover:text-white"
                  >
                    <span>IMDb</span>
                    <span className="text-[10px]">↗</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contenido interactivo y pestañas de la ficha */}
      <div className="space-y-5 p-6 pt-4">
        <Deshacer id={t.id} />

        {/* Barra de pestañas segmentada */}
        <div className="flex gap-1 overflow-x-auto rounded-full bg-black/35 p-1 ring-1 ring-white/8 sm:w-fit shadow-inner">
          {PESTANAS.map(([k, e]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPestana(k)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-all duration-200 ${
                pestana === k
                  ? 'bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_10px_rgba(0,0,0,0.6)]'
                  : 'text-mist-400 hover:text-mist-200'
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        {pestana === 'datos' && <Datos id={t.id} />}
        {pestana === 'emparejar' && <Emparejar titulo={t} />}
        {pestana === 'imagenes' && (
          <SelectorDeArte itemId={t.id} kind={t.kind} titulo={t.title} anio={t.year} tmdbId={t.tmdb_id ? Number(t.tmdb_id) : null} />
        )}
        {pestana === 'archivos' && (
          <div className="space-y-3.5">
            <p className="text-[12.5px] leading-relaxed text-mist-400">
              Operaciones directas sobre la biblioteca física en el disco. Cada acción calcula y muestra un plan detallado antes de confirmar.
            </p>
            <ArteACarpeta id={t.id} />
            <Organizar id={t.id} kind={t.kind} />
            <NfoACarpeta id={t.id} />
            <Enviar id={t.id} kind={t.kind} />
          </div>
        )}
      </div>
    </div>
  );
}

const MODOS = [
  ['asistente', 'Asistente', 'M13 10V3L4 14h7v7l9-11h-7z'],
  ['biblioteca', 'Biblioteca', 'M2 4h12v9H2z'],
  ['fuentes', 'Fuentes', 'M2 4h4l2 2h6v7H2z'],
  ['ajustes', 'Ajustes', 'M3 4h10M3 8h10M3 12h10'],
] as const;

export default function Scraper() {
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  const [id, setId] = useState<number | null>(null);
  const [modo, setModo] = useState<(typeof MODOS)[number][0]>('asistente');
  const detalle = useRef<HTMLDivElement>(null);
  const { data: nuevos } = useQuery({ queryKey: ['scraper-nuevos'], queryFn: api.scraperNuevos, enabled: yo?.is_admin === 1 });

  if (yo && yo.is_admin !== 1) {
    return (
      <div className="mx-auto max-w-3xl px-4 page-pt text-center">
        <p className="text-[14px] text-mist-400">Solo un administrador de MediaWatch tiene acceso a las herramientas del Scraper.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[98rem] px-4 page-pt page-pb sm:px-8">
      {/* Cabecera general de administración */}
      <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-white/6 pb-6">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] text-accent uppercase">
            ADMINISTRACIÓN · CATÁLOGO & METADATOS
          </div>
          <h1 className="mt-1 text-[34px] sm:text-[38px] leading-none font-black tracking-tight text-white">
            Scraper
          </h1>
          <p className="mt-2 hidden max-w-lg text-[13px] text-mist-400 sm:block">
            Empareja con TMDb, completa información y arte en alta fidelidad, y organiza tu biblioteca.
          </p>
        </div>

        {/* Navegación por modos */}
        <nav className="glass no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full p-1.5 shadow-[var(--shadow-2)]">
          {MODOS.map(([k, e, iconD]) => {
            const activo = modo === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setModo(k)}
                className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-200 ${
                  activo
                    ? 'bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] ring-1 ring-white/10'
                    : 'text-mist-400 hover:bg-white/6 hover:text-mist-100'
                }`}
              >
                <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 ${activo ? 'text-accent' : 'text-mist-500'}`} fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d={iconD} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{e}</span>
                {k === 'asistente' && nuevos?.pendientes ? (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10.5px] font-bold text-ink-950 tabular-nums">
                    {nuevos.pendientes}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      {modo === 'asistente' && <AsistenteNuevos />}
      {modo === 'fuentes' && <FuentesScraper />}
      {modo === 'ajustes' && <AjustesScraper />}

      {/* Vista de biblioteca a dos columnas */}
      <div className={modo === 'biblioteca' ? 'grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]' : 'hidden'}>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Lista
            seleccion={id}
            onSelect={(f) => {
              setId(f.id);
              if (!window.matchMedia('(min-width: 1024px)').matches) {
                setTimeout(() => detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
              }
            }}
          />
        </div>

        <div ref={detalle} className="glass min-h-64 overflow-hidden rounded-[var(--radius-panel)] shadow-[var(--shadow-3)]">
          {id ? (
            <Ficha id={id} />
          ) : (
            <div className="grid min-h-[30rem] place-items-center px-8 text-center">
              <div>
                <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-white/6 text-accent ring-1 ring-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.6)]">
                  <IconoBuscar />
                </div>
                <h3 className="text-[17px] font-bold text-mist-100">Selecciona un título</h3>
                <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-mist-400">
                  Explora las propuestas de TMDb y OMDb, personaliza el arte gráfico y edita sus metadatos con control total.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
