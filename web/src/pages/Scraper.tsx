import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Casilla, TextInput } from '../components/Controls.tsx';
import SelectorDeArte from '../components/SelectorDeArte.tsx';
import EditorDatos from '../components/EditorDatos.tsx';
import AsistenteNuevos from '../components/AsistenteNuevos.tsx';
import EnviarTitulos from '../components/EnviarTitulos.tsx';
import FuentesScraper from '../components/FuentesScraper.tsx';
import AjustesScraper from '../components/AjustesScraper.tsx';
import { api, img, type Proposal, type ScraperFila, type ScraperTitulo } from '../lib/api.ts';

/*
 * Scraper: la pantalla de emparejado al estilo de tinyMediaManager (lista a la izquierda, ficha a la derecha),
 * pensada para que lo habitual sean tres gestos: elegir un título, ver qué propone TMDb frente a lo que hay y aplicar.
 * Solo administrador. Lo que se aplica va a la base de datos y a data/artwork; la biblioteca no se toca.
 */

const FILTROS = [
  { clave: 'todos', etiqueta: 'Todos' },
  { clave: 'huecos', etiqueta: 'Con huecos' },
  { clave: 'sinid', etiqueta: 'Sin emparejar' },
  { clave: 'sinsinopsis', etiqueta: 'Sin sinopsis' },
  { clave: 'sinedad', etiqueta: 'Sin edad' },
  { clave: 'sinlogo', etiqueta: 'Sin logo' },
  { clave: 'sinorganizar', etiqueta: 'Nombre sin organizar' },
] as const;

const CAMPOS = [
  { clave: 'poster', etiqueta: 'Póster' },
  { clave: 'fanart', etiqueta: 'Fondo' },
  { clave: 'logo', etiqueta: 'Logo' },
  { clave: 'plot', etiqueta: 'Sinopsis' },
  { clave: 'rating', etiqueta: 'Valoración' },
  { clave: 'genres', etiqueta: 'Géneros' },
  { clave: 'ficha', etiqueta: 'Reparto, estudios y país' },
] as const;
type Campo = (typeof CAMPOS)[number]['clave'];

/** Las URLs de TMDb vienen en tamaño original; para previsualizar basta una pequeña. */
const pequena = (url: string | null, w: string) => (url ? url.replace('/original/', `/${w}/`) : null);

/** Cuatro rayitas por título: póster, fondo, logo y sinopsis. Encendida = lo tiene; apagada = falta. */
function Avance({ f }: { f: ScraperFila }) {
  const partes: [string, boolean][] = [['Póster', !!f.poster], ['Fondo', !!f.fanart], ['Logo', !!f.logo], ['Sinopsis', !!f.sinopsis]];
  return (
    <div className="flex gap-[3px]" title={partes.map(([n, ok]) => `${n}: ${ok ? 'sí' : 'falta'}`).join(' · ')}>
      {partes.map(([n, ok]) => <span key={n} className={`h-[3px] w-4 rounded-full ${ok ? 'bg-accent/85' : 'bg-white/12'}`} />)}
    </div>
  );
}

function IconoBuscar() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.6 3.6" />
    </svg>
  );
}

function Fila({ f, activa, onClick, marcada }: { f: ScraperFila; activa: boolean; onClick: () => void; marcada?: boolean }) {
  const seleccionando = marcada !== undefined;
  const resaltada = seleccionando ? marcada : activa;
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 ${resaltada ? 'bg-gradient-to-r from-accent/16 via-accent/5 to-transparent ring-1 ring-accent/25' : 'hover:bg-white/6'}`}
    >
      {seleccionando && <Casilla marcada={marcada} onChange={() => {}} />}
      {!seleccionando && activa && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-accent shadow-[0_0_12px_rgb(240_165_74/0.7)]" />}
      <div className="h-[66px] w-11 shrink-0 overflow-hidden rounded-md bg-ink-800 shadow-[0_6px_14px_-4px_rgb(0_0_0/0.8)] ring-1 ring-white/10 transition-transform duration-200 group-hover:scale-[1.04]">
        {f.poster ? <img src={img.poster(f.id, 120, f.arte_actualizado)} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium leading-tight text-mist-100">{f.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-mist-500">
          <span className="tabular-nums">{f.year ?? 's/f'}</span>
          <span className="text-mist-600">·</span>
          <span>{f.kind === 'show' ? 'Serie' : 'Película'}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Avance f={f} />
          {!f.tmdb_id && <span className="rounded-full bg-amber-400/12 px-1.5 py-px text-[10px] font-medium tracking-wide text-amber-300">SIN EMPAREJAR</span>}
        </div>
      </div>
    </button>
  );
}

const CAMPOS_LOTE = [['studio', 'Estudio', 'Paramount Pictures'], ['mpaa', 'Edad recomendada', '12'], ['collection', 'Saga', 'Nombre de la saga']] as const;

/** Mismo dato (estudio, edad o saga) para todos los títulos marcados. Solo la base de datos; cada uno se deshace desde su ficha. */
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
    <div className="space-y-2.5 rounded-2xl bg-black/25 p-3 ring-1 ring-accent/25">
      <div className="text-[12px] font-medium text-accent-soft">{ids.length} marcados · el mismo dato para todos</div>
      <div className="flex flex-wrap gap-1.5">
        {CAMPOS_LOTE.map(([k, e]) => (
          <button key={k} onClick={() => setCampo(k)} className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors ${campo === k ? 'bg-accent/18 text-accent-soft ring-1 ring-accent/40' : 'bg-white/5 text-mist-400 hover:bg-white/10'}`}>{e}</button>
        ))}
      </div>
      <TextInput value={valor} onChange={setValor} placeholder={CAMPOS_LOTE.find((c) => c[0] === campo)![2]} className="w-full rounded-full" />
      <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-mist-400"><Casilla marcada={quitar} onChange={setQuitar} />Quitar este dato en todos</label>
      <Button onClick={() => aplicar.mutate()} disabled={!listo || aplicar.isPending}>
        {aplicar.isPending ? 'Aplicando…' : quitar ? `Quitar ${etiqueta.toLowerCase()} en ${ids.length}` : `Poner ${etiqueta.toLowerCase()} «${valor.trim() || '…'}» en ${ids.length}`}
      </Button>
      {aviso && <p className="text-[11.5px] text-mist-400">{aviso}</p>}
      <p className="text-[11px] text-mist-600">Solo cambia la base de datos, no la biblioteca. Se deshace título a título desde su ficha.</p>
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
  const alternar = (id: number) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const terminarLote = () => { setLote(false); setMarcados(new Set()); };

  // Esperar a que se deje de teclear antes de preguntar al servidor.
  useEffect(() => {
    const t = setTimeout(() => setQ(texto), 250);
    return () => clearTimeout(t);
  }, [texto]);
  useEffect(() => { setOffset(0); setAcumuladas([]); }, [filtro, kind, q]);

  const { data, isFetching } = useQuery({
    queryKey: ['scraper-lista', filtro, kind, q, offset],
    queryFn: () => api.scraperTitulos({ filtro, q, kind, offset }),
    placeholderData: (previa) => previa,
  });

  // Mientras llega una página nueva, `data` es la anterior: solo se añade la que corresponde al offset pedido.
  useEffect(() => {
    if (!data || data.offset !== offset) return;
    setAcumuladas((prev) => (offset === 0 ? data.items : [...prev, ...data.items.filter((n) => !prev.some((p) => p.id === n.id))]));
  }, [data, offset]);

  // La fila elegida se pinta con la ficha (misma consulta, sin pedir nada): al cambiarle el arte o los datos se ve al momento.
  const { data: elegida } = useQuery({ queryKey: ['scraper-titulo', seleccion], queryFn: () => api.scraperTitulo(seleccion!), enabled: seleccion != null });
  const aldia = (f: ScraperFila): ScraperFila =>
    elegida && elegida.id === f.id ? { ...f, title: elegida.title, year: elegida.year, poster: elegida.poster, fanart: elegida.fanart, logo: elegida.logo, arte_actualizado: elegida.arte_actualizado } : f;

  const total = data?.total ?? 0;
  return (
    <div className="glass flex min-h-0 flex-col gap-3 rounded-[var(--radius-panel)] p-3">
      <label className="relative block">
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-mist-500"><IconoBuscar /></span>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar en la biblioteca…"
          className="w-full rounded-full border border-white/8 bg-black/25 py-2.5 pr-4 pl-10 text-[13px] outline-none transition-colors placeholder:text-mist-600 focus:border-accent/40 focus:bg-black/35"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            onClick={() => setFiltro(f.clave)}
            className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition-colors duration-200 ${filtro === f.clave ? 'bg-accent/18 text-accent-soft ring-1 ring-accent/40' : 'bg-white/5 text-mist-400 hover:bg-white/10 hover:text-mist-200'}`}
          >
            {f.etiqueta}
            {data?.cuenta[f.clave] != null && <span className={`ml-1.5 tabular-nums ${filtro === f.clave ? 'text-accent/70' : 'text-mist-600'}`}>{data.cuenta[f.clave]}</span>}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-white/6 pt-2.5 text-[11.5px]">
        {([['', 'Todo'], ['movie', 'Películas'], ['show', 'Series']] as const).map(([k, e]) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-full px-2.5 py-1 transition-colors ${kind === k ? 'bg-white/12 text-mist-100' : 'text-mist-500 hover:text-mist-200'}`}>{e}</button>
        ))}
        <span className="ml-auto tabular-nums text-mist-600">{total} títulos</span>
        <button onClick={() => (lote ? terminarLote() : setLote(true))} className={`rounded-full px-2.5 py-1 font-medium transition-colors ${lote ? 'bg-accent/18 text-accent-soft ring-1 ring-accent/40' : 'text-mist-400 hover:text-mist-100'}`}>{lote ? 'Salir' : 'Seleccionar'}</button>
      </div>
      {lote && (
        <div className="flex items-center gap-3 text-[11.5px]">
          <button className="font-medium text-accent hover:underline underline-offset-2" onClick={() => setMarcados((m) => new Set([...m, ...acumuladas.map((x) => x.id)]))}>Marcar los {acumuladas.length} de la lista</button>
          <button className="text-mist-500 hover:underline underline-offset-2" onClick={() => setMarcados(new Set())}>Quitar marcas</button>
        </div>
      )}
      <div className="max-h-[calc(100vh-22rem)] min-h-64 space-y-0.5 overflow-y-auto pr-1">
        {acumuladas.map((f) => <Fila key={f.id} f={aldia(f)} activa={f.id === seleccion} marcada={lote ? marcados.has(f.id) : undefined} onClick={() => (lote ? alternar(f.id) : onSelect(f))} />)}
        {!isFetching && acumuladas.length === 0 && <p className="px-2 py-10 text-center text-[12.5px] text-mist-500">Nada con ese filtro.</p>}
        {acumuladas.length < total && (
          <div className="py-2 text-center">
            <Button variant="ghost" onClick={() => setOffset(acumuladas.length)} disabled={isFetching}>{isFetching ? 'Cargando…' : `Cargar más (${total - acumuladas.length})`}</Button>
          </div>
        )}
      </div>
      {lote && marcados.size > 0 && <BarraLote ids={[...marcados]} alTerminar={terminarLote} />}
    </div>
  );
}

function Tarjeta({ p, elegida, onClick }: { p: Proposal; elegida: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-32 shrink-0 flex-col gap-2 rounded-2xl p-2 text-left transition-all duration-200 hover:bg-white/8 ${elegida ? 'bg-gradient-to-b from-accent/16 to-accent/4 ring-1 ring-accent/45 shadow-[0_0_24px_-6px_rgb(240_165_74/0.45)]' : 'opacity-80 hover:opacity-100'}`}>
      <div className="aspect-2/3 w-full overflow-hidden rounded-lg bg-ink-800 shadow-[0_12px_24px_-8px_rgb(0_0_0/0.85)] ring-1 ring-white/12">
        {p.posterUrl ? <img src={pequena(p.posterUrl, 'w342')!} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[10.5px] text-mist-600">Sin póster</div>}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 text-[11.5px] font-medium leading-tight">{p.title}</div>
        <div className="text-[10.5px] text-mist-600">{p.year ?? 's/f'} · TMDb {p.tmdbId}</div>
      </div>
    </button>
  );
}

function Comparar({ titulo, p, campos, setCampos }: { titulo: ScraperTitulo; p: Proposal; campos: Campo[]; setCampos: (c: Campo[]) => void }) {
  const alternar = (c: Campo) => setCampos(campos.includes(c) ? campos.filter((k) => k !== c) : [...campos, c]);
  const filas: { c: Campo; actual: React.ReactNode; nuevo: React.ReactNode; hay: boolean }[] = [
    {
      c: 'poster', hay: !!p.posterUrl,
      actual: titulo.poster ? <img src={img.poster(titulo.id, 400, titulo.arte_actualizado)} alt="" className="h-48 rounded-lg shadow-[0_10px_22px_-8px_rgb(0_0_0/0.85)] ring-1 ring-white/12" /> : <span className="text-mist-600">—</span>,
      nuevo: p.posterUrl ? <img src={pequena(p.posterUrl, 'w500')!} alt="" className="h-48 rounded-lg shadow-[0_10px_22px_-8px_rgb(0_0_0/0.85)] ring-1 ring-accent/30" /> : <span className="text-mist-600">TMDb no tiene</span>,
    },
    {
      c: 'fanart', hay: !!p.backdropUrl,
      actual: titulo.fanart ? <img src={img.fanart(titulo.id, 800, titulo.arte_actualizado)} alt="" className="h-36 rounded-lg" /> : <span className="text-mist-600">—</span>,
      nuevo: p.backdropUrl ? <img src={pequena(p.backdropUrl, 'w780')!} alt="" className="h-36 rounded-lg" /> : <span className="text-mist-600">TMDb no tiene</span>,
    },
    {
      c: 'logo', hay: !!p.logoUrl,
      actual: titulo.logo ? <img src={img.logo(titulo.id, 500, titulo.arte_actualizado)} alt="" className="h-20 object-contain" /> : <span className="text-mist-600">—</span>,
      nuevo: p.logoUrl ? <img src={pequena(p.logoUrl, 'w500')!} alt="" className="h-20 object-contain" /> : <span className="text-mist-600">TMDb no tiene</span>,
    },
    {
      c: 'plot', hay: !!p.overview,
      actual: <p className="line-clamp-4 text-[12px] leading-relaxed text-mist-400">{titulo.plot || <span className="text-mist-600">—</span>}</p>,
      nuevo: <p className="line-clamp-4 text-[12px] leading-relaxed text-mist-300">{p.overview || <span className="text-mist-600">TMDb no tiene</span>}</p>,
    },
    {
      c: 'rating', hay: p.rating != null,
      actual: <span>{titulo.rating != null ? titulo.rating.toFixed(1) : '—'}</span>,
      nuevo: <span>{p.rating != null ? p.rating.toFixed(1) : '—'}</span>,
    },
    {
      c: 'ficha', hay: !!(p.reparto?.length || p.estudios?.length),
      actual: <span>{titulo.reparto} personas{titulo.studio ? ' · ' + titulo.studio : ''}{titulo.country ? ' · ' + titulo.country : ''}</span>,
      nuevo: <div className="space-y-0.5">
            <div>{p.reparto?.length ?? 0} actores{p.directores?.length ? ' · dir. ' + p.directores.slice(0, 2).join(', ') : ''}</div>
            <div className="text-mist-500">{[p.estudios?.slice(0, 2).join(', '), p.paises?.join(', ')].filter(Boolean).join(' · ')}</div>
          </div>,
    },
    {
      c: 'genres', hay: p.genres.length > 0,
      actual: <span className="text-mist-600">se conservan; marcar añade los de TMDb</span>,
      nuevo: <span>{p.genres.join(', ') || '—'}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-gradient-to-r from-accent/12 to-transparent p-4 ring-1 ring-accent/20">
        <div className="text-[10.5px] font-medium tracking-[0.16em] text-accent/80 uppercase">Propuesta de TMDb</div>
        <div className="mt-1 text-[17px] font-semibold tracking-tight">{p.title} <span className="font-normal text-mist-400">({p.year ?? 's/f'})</span></div>
        {p.originalTitle && p.originalTitle !== p.title && <div className="text-[11.5px] text-mist-500">Título original: {p.originalTitle}</div>}
      </div>
      <div className="flex gap-2 text-[11.5px]">
        <button className="font-medium text-accent hover:underline underline-offset-2" onClick={() => setCampos(filas.filter((f) => f.hay && f.c !== 'ficha').map((f) => f.c))}>Marcar todo</button>
        <button className="text-mist-500 hover:underline underline-offset-2" onClick={() => setCampos(filas.filter((f) => f.hay && f.c !== 'genres' && f.c !== 'ficha' && !tiene(titulo, f.c)).map((f) => f.c))}>Solo huecos</button>
        <button className="text-mist-500 hover:underline underline-offset-2" onClick={() => setCampos([])}>Ninguno</button>
      </div>
      <div className="divide-y divide-white/6 overflow-hidden rounded-2xl bg-black/20 ring-1 ring-white/6">
        <div className="grid grid-cols-[1.5rem_5rem_1fr_1fr] items-center gap-3 bg-white/4 px-3 py-2 text-[10.5px] font-medium tracking-[0.12em] text-mist-500 uppercase">
          <span /><span>Campo</span><span>Actual</span><span>Propuesta de TMDb</span>
        </div>
        {filas.map((f) => (
          <label key={f.c} className={`grid grid-cols-[1.5rem_5rem_1fr_1fr] items-center gap-3 px-3 py-2.5 transition-colors ${f.hay ? 'cursor-pointer hover:bg-white/5' : 'opacity-50'} ${campos.includes(f.c) ? 'bg-accent/6' : ''}`}>
            <Casilla disabled={!f.hay} marcada={campos.includes(f.c)} onChange={() => alternar(f.c)} />
            <span className="text-[12.5px] font-medium">{CAMPOS.find((x) => x.clave === f.c)!.etiqueta}</span>
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
    case 'poster': return !!t.poster;
    case 'fanart': return !!t.fanart;
    case 'logo': return !!t.logo;
    case 'plot': return !!t.plot;
    case 'rating': return t.rating != null;
    case 'ficha': return t.reparto > 0 && !!t.studio;
    default: return false;
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
  // Titulo, ano y datos de identidad: por defecto solo si el titulo aun no esta emparejado (es lo que despues usa «Organizar» para el nombre).
  const [identidad, setIdentidad] = useState(false);
  const lanzada = useRef<number | null>(null);

  const buscar = useMutation({
    mutationFn: (texto: string) => api.scraperResolver(texto, titulo.kind, titulo.tmdb_id ? null : titulo.year),
    onSuccess: (r) => {
      setPropuestas(r.propuestas);
      setAviso(r.aviso ?? (r.propuestas.length === 0 ? 'Sin resultados. Prueba con otro título, un id de TMDb o la dirección de su página.' : ''));
      setError('');
      const primera = r.propuestas[0] ?? null;
      setElegida(primera);
    },
    onError: (e: Error) => setError(e.message),
  });

  // Al elegir otro título de la lista se parte de cero y se lanza la primera búsqueda sola.
  useEffect(() => {
    setEntrada(inicial);
    setPropuestas([]); setElegida(null); setCampos([]); setAviso(''); setError(''); setHecho(''); setIdentidad(!titulo.tmdb_id);
    if (lanzada.current !== titulo.id) { lanzada.current = titulo.id; buscar.mutate(inicial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulo.id]);

  // Propuesta nueva -> por defecto se marcan los huecos (lo que no pisa nada).
  useEffect(() => {
    if (!elegida) return setCampos([]);
    const hay: Record<Campo, boolean> = { poster: !!elegida.posterUrl, fanart: !!elegida.backdropUrl, logo: !!elegida.logoUrl, plot: !!elegida.overview, rating: elegida.rating != null, genres: elegida.genres.length > 0, ficha: false };
    // Géneros nunca por defecto: la biblioteca usa los de IMDb (decisión del 26/09) y TMDb reparte de más.
    setCampos(CAMPOS.map((c) => c.clave).filter((c) => c !== 'genres' && hay[c] && !tiene(titulo, c)));
  }, [elegida, titulo]);

  const aplicar = useMutation({
    mutationFn: () => api.enrichApply({ itemId: titulo.id, tmdbId: elegida!.tmdbId, kind: titulo.kind, fields: campos.flatMap((c) => (c === 'ficha' ? ['cast', 'studio', 'ratings'] : [c])), overwrite: true, identidad }),
    onSuccess: (r) => {
      setHecho(`Guardado en «${r.title}»: ${r.applied.join(', ')}.`);
      setError('');
      qc.invalidateQueries({ queryKey: ['scraper-titulo', titulo.id] });
      qc.invalidateQueries({ queryKey: ['scraper-historial', titulo.id] });
      qc.invalidateQueries({ queryKey: ['scraper-lista'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (entrada.trim()) buscar.mutate(entrada); }}
      >
        <TextInput value={entrada} onChange={setEntrada} placeholder="Título, id de TMDb, id de IMDb (tt…) o dirección de su página" className="flex-1 rounded-full" />
        <Button onClick={() => entrada.trim() && buscar.mutate(entrada)} disabled={buscar.isPending}>{buscar.isPending ? 'Buscando…' : 'Buscar'}</Button>
      </form>
      {aviso && <p className="text-[12.5px] text-mist-500">{aviso}</p>}

      {propuestas.length > 1 && (
        <div className="no-scrollbar flex gap-1 overflow-x-auto pb-1">
          {propuestas.map((p) => <Tarjeta key={p.tmdbId} p={p} elegida={elegida?.tmdbId === p.tmdbId} onClick={() => setElegida(p)} />)}
        </div>
      )}

      {elegida && <Comparar titulo={titulo} p={elegida} campos={campos} setCampos={setCampos} />}

      {elegida && (
        <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-mist-300">
          <Casilla marcada={identidad} onChange={setIdentidad} />
          <span>Poner también el título, el año y la clasificación de TMDb <span className="text-mist-500">({elegida.title}{elegida.year ? ` · ${elegida.year}` : ''}). Es lo que usa «Organizar» para el nombre de la carpeta y del fichero.</span></span>
        </label>
      )}
      {campos.includes('ficha') && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-200">
          Al aplicar el reparto, los estudios y el país, este título pasa a gestionarse desde el servidor: sus datos (y los de sus episodios, si es una serie) dejan de leerse de los .nfo. Se puede deshacer.
        </p>
      )}
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}
      {hecho && <p className="text-[12.5px] text-emerald-400">{hecho}</p>}
      {elegida && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => aplicar.mutate()} disabled={aplicar.isPending || campos.length === 0}>
            {aplicar.isPending ? 'Guardando…' : `Aplicar ${campos.length ? `(${campos.length})` : ''}`}
          </Button>
          <span className="text-[11.5px] text-mist-600">Se guarda en la base de datos y en data/artwork; no se escribe nada en la biblioteca.</span>
        </div>
      )}
    </div>
  );
}

/**
 * Copiar el arte elegido a la carpeta del título, con los nombres de tinyMediaManager, para quien lea la biblioteca con otro
 * programa (Plex con «usar activos locales», Jellyfin, Kodi). Es lo único de esta pantalla que escribe en la biblioteca:
 * primero se enseña el plan, y no se hace nada hasta confirmarlo. Lo que se sustituye se aparta, no se borra.
 */
function ArteACarpeta({ id }: { id: number }) {
  const [abierto, setAbierto] = useState(false);
  const [hecho, setHecho] = useState('');
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ['scraper-arte-carpeta', id], queryFn: () => api.scraperArteCarpeta(id), enabled: abierto, retry: false, staleTime: 0 });
  const aplicar = useMutation({
    mutationFn: () => api.scraperArteCarpetaAplicar(id),
    onSuccess: (r) => { setHecho(`Escritos ${r.escritos.length} ficheros${r.retirados ? ` y apartados ${r.retirados} en _retirados` : ''}.`); qc.invalidateQueries({ queryKey: ['scraper-arte-carpeta', id] }); },
  });
  useEffect(() => { setAbierto(false); setHecho(''); }, [id]);

  return (
    <div className="rounded-xl bg-white/4 p-3 text-[12.5px]">
      <button onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-left font-medium text-mist-300">
        <span>Copiar el arte a la carpeta del título (Plex y otros programas)</span>
        <span className="text-mist-500">{abierto ? '−' : '+'}</span>
      </button>
      {abierto && (
        <div className="mt-3 space-y-2">
          {plan.isLoading && <p className="text-mist-500">Calculando…</p>}
          {plan.error && <p className="text-red-400">{(plan.error as Error).message}</p>}
          {plan.data && plan.data.pasos.length === 0 && <p className="text-mist-500">Nada que copiar: la carpeta ya tiene el arte elegido, o este título aún no tiene arte propio del servidor.</p>}
          {plan.data && plan.data.pasos.length > 0 && (
            <>
              <p className="text-mist-400">Se va a escribir en la biblioteca, en <span className="break-all text-mist-200">{plan.data.carpeta}</span>:</p>
              <ul className="space-y-1">
                {plan.data.pasos.map((p) => (
                  <li key={p.papel} className="rounded-lg bg-black/20 px-2.5 py-1.5">
                    <span className="text-emerald-300">crear</span> <span className="break-all">{p.hacia}</span>
                    {p.retira && <div className="text-amber-300/90">apartar a _retirados: <span className="break-all">{p.retira}</span></div>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>{aplicar.isPending ? 'Escribiendo…' : 'Sí, escribir en la biblioteca'}</Button>
                <span className="text-[11.5px] text-mist-600">Nada se borra: lo que se sustituye va a la carpeta _retirados de la biblioteca.</span>
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

/**
 * Organizar: dejar carpeta y ficheros con los nombres que ponía tinyMediaManager (Título (Año)/Título (Año) 1080p AC3.mkv,
 * Serie (Año)/Season N/Serie - S01E01 - Título.mkv). Renombra, no borra, y la base de datos se actualiza en el mismo paso (el
 * fichero conserva su id). Primero se enseña el plan y no se hace nada hasta confirmarlo.
 */
function Organizar({ id, kind }: { id: number; kind: 'movie' | 'show' }) {
  const [abierto, setAbierto] = useState(false);
  const [edicion, setEdicion] = useState('');
  const [hecho, setHecho] = useState('');
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ['scraper-organizar', id, edicion], queryFn: () => api.scraperOrganizar(id, edicion), enabled: abierto, retry: false, staleTime: 0 });
  const aplicar = useMutation({
    mutationFn: () => api.scraperOrganizarAplicar(id, edicion),
    onSuccess: (r) => {
      setHecho(`Hecho: ${r.movidos} cambios de nombre.`);
      for (const k of ['scraper-organizar', 'scraper-titulo', 'scraper-lista']) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  useEffect(() => { setAbierto(false); setHecho(''); setEdicion(''); }, [id]);

  return (
    <div className="rounded-xl bg-white/4 p-3 text-[12.5px]">
      <button onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-left font-medium text-mist-300">
        <span>Organizar: poner los nombres como los dejaba tMM</span>
        <span className="text-mist-500">{abierto ? '−' : '+'}</span>
      </button>
      {abierto && (
        <div className="mt-3 space-y-2">
          {kind === 'movie' && (
            <label className="flex flex-wrap items-center gap-2 text-mist-400">
              Edición (opcional):
              <TextInput value={edicion} onChange={setEdicion} placeholder="Extended Edition, IMAX, Final Cut…" className="w-64" />
            </label>
          )}
          {plan.isLoading && <p className="text-mist-500">Calculando…</p>}
          {plan.error && <p className="text-red-400">{(plan.error as Error).message}</p>}
          {plan.data && plan.data.pasos.length === 0 && <p className="text-mist-500">Ya está organizado: no hay nada que renombrar.</p>}
          {plan.data && plan.data.pasos.length > 0 && (
            <>
              <p className="text-mist-400">Se va a <b>renombrar en la biblioteca</b> (nada se borra):</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {plan.data.pasos.map((p, i) => (
                  <li key={i} className="rounded-lg bg-black/20 px-2.5 py-1.5">
                    <div className="break-all text-mist-500">{p.tipo === 'carpeta' ? 'carpeta ' : ''}{p.desde}</div>
                    <div className="break-all text-emerald-300">→ {p.final}</div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>{aplicar.isPending ? 'Renombrando…' : 'Sí, renombrar en la biblioteca'}</Button>
                <span className="text-[11.5px] text-mist-600">Plex verá estos ficheros como nuevos hasta que vuelva a escanear la biblioteca.</span>
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

/**
 * Escribir el NFO junto al vídeo (como tMM): los datos viajan con la carpeta. Pensado para la carpeta de entrada: se prepara aquí,
 * se mueve a la biblioteca y el escaneo de allí lo recupera todo. Plan visible y confirmación; lo sustituido se aparta, no se borra.
 */
function NfoACarpeta({ id }: { id: number }) {
  const [abierto, setAbierto] = useState(false);
  const [hecho, setHecho] = useState('');
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ['scraper-nfo', id], queryFn: () => api.scraperNfo(id), enabled: abierto, retry: false, staleTime: 0 });
  const aplicar = useMutation({
    mutationFn: () => api.scraperNfoAplicar(id),
    onSuccess: (r) => { setHecho(`Escritos ${r.escritos.length} NFO${r.retirados ? ` y apartados ${r.retirados} en _retirados` : ''}.`); qc.invalidateQueries({ queryKey: ['scraper-nfo', id] }); },
  });
  useEffect(() => { setAbierto(false); setHecho(''); }, [id]);
  return (
    <div className="rounded-xl bg-white/4 p-3 text-[12.5px]">
      <button onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-left font-medium text-mist-300">
        <span>Escribir el NFO en la carpeta (para que los datos viajen con ella)</span>
        <span className="text-mist-500">{abierto ? '−' : '+'}</span>
      </button>
      {abierto && (
        <div className="mt-3 space-y-2">
          {plan.isLoading && <p className="text-mist-500">Calculando…</p>}
          {plan.error && <p className="text-red-400">{(plan.error as Error).message}</p>}
          {plan.data && plan.data.pasos.length === 0 && <p className="text-mist-500">Nada que escribir: los NFO de la carpeta ya están al día.</p>}
          {plan.data && plan.data.pasos.length > 0 && (
            <>
              <p className="text-mist-400">Se van a escribir en la carpeta del título:</p>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {plan.data.pasos.map((p, i) => (
                  <li key={i} className="rounded-lg bg-black/20 px-2.5 py-1.5">
                    <span className="text-emerald-300">escribir</span> <span className="break-all">{p.hacia}</span>
                    {p.retira && <div className="text-amber-300/90">apartar a _retirados: <span className="break-all">{p.retira}</span></div>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={() => aplicar.mutate()} disabled={aplicar.isPending}>{aplicar.isPending ? 'Escribiendo…' : 'Sí, escribir los NFO'}</Button>
                <span className="text-[11.5px] text-mist-600">Nada se borra: lo que se sustituye va a _retirados.</span>
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

/** Enviar este título a otra biblioteca (copia comprobada; el original se aparta). */
function Enviar({ id, kind }: { id: number; kind: 'movie' | 'show' }) {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => setAbierto(false), [id]);
  return (
    <div className="rounded-xl bg-white/4 p-3 text-[12.5px]">
      <button onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between text-left font-medium text-mist-300">
        <span>Enviar a la biblioteca (copiar a la carpeta que elijas)</span>
        <span className="text-mist-500">{abierto ? '−' : '+'}</span>
      </button>
      {abierto && <div className="mt-3"><EnviarTitulos ids={[id]} kind={kind} /></div>}
    </div>
  );
}

/** Deshacer el último cambio hecho desde el Scraper en este título (ficha, reparto, arte...). */
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
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/4 px-3 py-2 text-[12.5px]">
      <span className="text-mist-400">Último cambio: {data.ultima.etiqueta} ({cuando})</span>
      <Button variant="ghost" onClick={() => deshacer.mutate()} disabled={deshacer.isPending}>{deshacer.isPending ? 'Deshaciendo…' : 'Deshacer'}</Button>
      {error && <span className="text-red-400">{error}</span>}
    </div>
  );
}

/** Los datos del título se editan a mano con el mismo editor de la ficha de la web (incluye saga y deshacer). */
function Datos({ id }: { id: number }) {
  const { data: item } = useQuery({ queryKey: ['item', id], queryFn: () => api.item(id) });
  if (!item) return <p className="p-4 text-[13px] text-mist-500">Cargando…</p>;
  return <EditorDatos item={item} />;
}

type Pestana = 'datos' | 'emparejar' | 'imagenes' | 'archivos';
const PESTANAS: ReadonlyArray<readonly [Pestana, string]> = [
  ['datos', 'Datos'],
  ['emparejar', 'Emparejar con TMDb'],
  ['imagenes', 'Imágenes'],
  ['archivos', 'Archivos'],
];

/** Anillo con el porcentaje de lo que ya tiene el título (póster, fondo, logo, sinopsis, edad y emparejado). */
function Anillo({ hechos, total }: { hechos: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r, pct = Math.round((hechos / total) * 100);
  return (
    <div className="relative h-14 w-14 shrink-0" title={`${hechos} de ${total} datos completos`}>
      <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="4" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(c * hechos) / total} ${c}`} style={{ filter: 'drop-shadow(0 0 6px rgb(240 165 74 / 0.55))' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap text-[13px] leading-none font-semibold tabular-nums">{pct}<span className="ml-px text-[8px] font-normal text-mist-500">%</span></span>
    </div>
  );
}

function Ficha({ id }: { id: number }) {
  const [pestana, setPestana] = useState<Pestana>('datos');
  const { data: t } = useQuery({ queryKey: ['scraper-titulo', id], queryFn: () => api.scraperTitulo(id) });
  // Al cambiar de título: sin emparejar lo primero es emparejarlo; emparejado, revisar los datos.
  const cargada = t != null;
  const tmdb = t?.tmdb_id ?? null;
  useEffect(() => { if (cargada) setPestana(tmdb ? 'datos' : 'emparejar'); }, [id, cargada, tmdb]);
  if (!t) return <p className="p-8 text-[13px] text-mist-500">Cargando…</p>;
  const enlaceTmdb = t.tmdb_id ? `https://www.themoviedb.org/${t.kind === 'show' ? 'tv' : 'movie'}/${t.tmdb_id}` : null;
  const estado: [string, boolean][] = [
    ['Póster', !!t.poster], ['Fondo', !!t.fanart], ['Logo', !!t.logo], ['Sinopsis', !!t.plot], ['Edad', !!t.mpaa], ['TMDb', !!t.tmdb_id],
  ];
  const hechos = estado.filter(([, ok]) => ok).length;
  return (
    <div>
      <div className="relative isolate overflow-hidden">
        {t.fanart
          ? <img src={img.fanart(t.id, 1280, t.arte_actualizado)} alt="" className="absolute inset-0 -z-20 h-full w-full scale-105 object-cover opacity-55" />
          : t.poster ? <img src={img.poster(t.id, 300, t.arte_actualizado)} alt="" className="absolute inset-0 -z-20 h-full w-full scale-150 object-cover opacity-30 blur-3xl" /> : null}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-900 via-ink-900/75 to-ink-900/20" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-900/90 via-ink-900/40 to-transparent" />
        <div className="flex flex-col gap-5 px-6 pt-7 pb-6 sm:flex-row sm:gap-7">
          <div className="w-32 shrink-0 self-start overflow-hidden rounded-xl bg-ink-800 shadow-[0_24px_50px_-12px_rgb(0_0_0/0.9)] ring-1 ring-white/15 sm:w-44">
            <div className="aspect-2/3">{t.poster ? <img src={img.poster(t.id, 500, t.arte_actualizado)} alt="" className="h-full w-full object-cover" /> : null}</div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.16em] text-accent/85 uppercase">
              <span>{t.kind === 'show' ? 'Serie' : 'Película'}</span><span className="text-mist-600">·</span><span className="text-mist-400">{t.biblioteca}</span>
              {t.mpaa && <span className="rounded border border-white/20 px-1.5 py-px text-[10px] tracking-normal text-mist-300">{t.mpaa}</span>}
            </div>
            {t.logo
              ? <img src={img.logo(t.id, 520, t.arte_actualizado)} alt={t.title} className="mt-3 max-h-20 w-auto max-w-[min(420px,80%)] self-start object-contain object-left drop-shadow-[0_6px_24px_rgba(0,0,0,0.85)]" />
              : <h2 className="mt-2 text-[34px] leading-[1.05] font-semibold tracking-tight">{t.title}</h2>}
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-mist-400">
              {t.logo ? <span className="font-medium text-mist-200">{t.title}</span> : null}
              {t.year && <span className="tabular-nums">{t.year}</span>}
              {t.original_title && t.original_title !== t.title && <span className="text-mist-500 italic">{t.original_title}</span>}
              {t.collection && <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-mist-300">{t.collection}</span>}
            </div>
            {t.tagline && <p className="mt-2 text-[13px] text-mist-300 italic">«{t.tagline}»</p>}
            {t.plot && <p className="mt-2 line-clamp-2 max-w-2xl text-[12.5px] leading-relaxed text-mist-500">{t.plot}</p>}
            <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-4">
              <Anillo hechos={hechos} total={estado.length} />
              <div className="flex flex-wrap gap-1.5">
                {estado.map(([n, ok]) => (
                  <span key={n} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${ok ? 'bg-emerald-400/12 text-emerald-300' : 'bg-red-400/12 text-red-300'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />{n}
                  </span>
                ))}
              </div>
              <div className="ml-auto flex gap-1.5 text-[11px]">
                {enlaceTmdb && <a href={enlaceTmdb} target="_blank" rel="noreferrer" className="rounded-full bg-white/8 px-3 py-1 text-mist-300 transition-colors hover:bg-white/15">TMDb {t.tmdb_id} ↗</a>}
                {t.imdb_id && <a href={`https://www.imdb.com/title/${t.imdb_id}/`} target="_blank" rel="noreferrer" className="rounded-full bg-white/8 px-3 py-1 text-mist-300 transition-colors hover:bg-white/15">IMDb ↗</a>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6 pt-4">
        <Deshacer id={t.id} />

        <div className="flex gap-1 overflow-x-auto rounded-full bg-black/25 p-1 ring-1 ring-white/6 sm:w-fit">
          {PESTANAS.map(([k, e]) => (
            <button key={k} onClick={() => setPestana(k)} className={`shrink-0 rounded-full px-4 py-1.5 text-[12.5px] font-medium transition-all duration-200 ${pestana === k ? 'bg-white/14 text-mist-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_2px_8px_-2px_rgb(0_0_0/0.6)]' : 'text-mist-500 hover:text-mist-200'}`}>{e}</button>
          ))}
        </div>

        {pestana === 'datos' && <Datos id={t.id} />}
        {pestana === 'emparejar' && <Emparejar titulo={t} />}
        {pestana === 'imagenes' && (
          <SelectorDeArte itemId={t.id} kind={t.kind} titulo={t.title} anio={t.year} tmdbId={t.tmdb_id ? Number(t.tmdb_id) : null} />
        )}
        {pestana === 'archivos' && (
          <div className="space-y-3">
            <p className="text-[12.5px] leading-relaxed text-mist-500">
              Lo de aquí toca la carpeta del título en la biblioteca. Cada acción enseña antes qué va a crear, renombrar o apartar, y no hace nada hasta que lo confirmes; nada se borra.
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

const MODOS = [['asistente', 'Asistente'], ['biblioteca', 'Biblioteca'], ['fuentes', 'Fuentes'], ['ajustes', 'Ajustes']] as const;

export default function Scraper() {
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  const [id, setId] = useState<number | null>(null);
  const [modo, setModo] = useState<(typeof MODOS)[number][0]>('asistente');
  const detalle = useRef<HTMLDivElement>(null);
  const { data: nuevos } = useQuery({ queryKey: ['scraper-nuevos'], queryFn: api.scraperNuevos, enabled: yo?.is_admin === 1 });

  if (yo && yo.is_admin !== 1) return <p className="mx-auto max-w-3xl px-4 page-pt text-[13px] text-mist-500">Solo un administrador puede usar el Scraper.</p>;

  return (
    <div className="mx-auto max-w-[96rem] px-4 page-pt page-pb sm:px-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <div className="text-[11px] font-medium tracking-[0.2em] text-accent/80 uppercase">Administración</div>
          <h1 className="mt-1.5 text-[34px] leading-none font-semibold tracking-tight">Scraper</h1>
          <p className="mt-2 hidden max-w-md text-[13px] text-mist-500 sm:block">Empareja con TMDb, completa los datos y el arte, y envía a la biblioteca.</p>
        </div>
        <nav className="glass no-scrollbar flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1">
          {MODOS.map(([k, e]) => (
            <button key={k} onClick={() => setModo(k)} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all duration-200 sm:gap-2 sm:px-4 ${modo === k ? 'bg-white/14 text-mist-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]' : 'text-mist-500 hover:text-mist-200'}`}>
              {e}
              {k === 'asistente' && nuevos?.pendientes ? <span className="rounded-full bg-accent px-1.5 py-px text-[10.5px] font-semibold text-ink-950 tabular-nums">{nuevos.pendientes}</span> : null}
            </button>
          ))}
        </nav>
      </header>
      {modo === 'asistente' && <AsistenteNuevos />}
      {modo === 'fuentes' && <FuentesScraper />}
      {modo === 'ajustes' && <AjustesScraper />}
      <div className={modo === 'biblioteca' ? 'grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]' : 'hidden'}>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Lista seleccion={id} onSelect={(f) => {
            setId(f.id);
            // En pantalla ancha la ficha ya está al lado: bajar la página sacaba la lista de la vista.
            if (!window.matchMedia('(min-width: 1024px)').matches) setTimeout(() => detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
          }} />
        </div>
        <div ref={detalle} className="glass min-h-64 overflow-hidden rounded-[var(--radius-panel)]">
          {id
            ? <Ficha id={id} />
            : (
              <div className="grid min-h-[28rem] place-items-center px-8 text-center">
                <div>
                  <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/6 text-mist-500 ring-1 ring-white/8"><IconoBuscar /></div>
                  <p className="text-[15px] font-medium text-mist-200">Elige un título</p>
                  <p className="mx-auto mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-mist-500">Verás qué le falta, lo que propone TMDb y podrás editar sus datos a mano.</p>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
