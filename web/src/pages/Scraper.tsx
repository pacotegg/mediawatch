import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, TextInput } from '../components/Controls.tsx';
import SelectorDeArte from '../components/SelectorDeArte.tsx';
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
] as const;

const CAMPOS = [
  { clave: 'poster', etiqueta: 'Póster' },
  { clave: 'fanart', etiqueta: 'Fondo' },
  { clave: 'logo', etiqueta: 'Logo' },
  { clave: 'plot', etiqueta: 'Sinopsis' },
  { clave: 'rating', etiqueta: 'Valoración' },
  { clave: 'genres', etiqueta: 'Géneros' },
] as const;
type Campo = (typeof CAMPOS)[number]['clave'];

/** Las URLs de TMDb vienen en tamaño original; para previsualizar basta una pequeña. */
const pequena = (url: string | null, w: string) => (url ? url.replace('/original/', `/${w}/`) : null);

function Punto({ ok, titulo }: { ok: boolean; titulo: string }) {
  return <span title={`${titulo}: ${ok ? 'sí' : 'falta'}`} className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400/70' : 'bg-red-400/80'}`} />;
}

function Fila({ f, activa, onClick }: { f: ScraperFila; activa: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors ${activa ? 'bg-white/12' : 'hover:bg-white/6'}`}
    >
      <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-ink-800">
        {f.poster ? <img src={img.poster(f.id, 80)} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{f.title}</div>
        <div className="flex items-center gap-2 text-[11px] text-mist-600">
          <span>{f.year ?? 's/f'}</span>
          <span>{f.kind === 'show' ? 'Serie' : 'Película'}</span>
          {!f.tmdb_id && <span className="text-amber-400/90">sin emparejar</span>}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Punto ok={!!f.poster} titulo="Póster" />
        <Punto ok={!!f.fanart} titulo="Fondo" />
        <Punto ok={!!f.logo} titulo="Logo" />
        <Punto ok={!!f.sinopsis} titulo="Sinopsis" />
      </div>
    </button>
  );
}

function Lista({ seleccion, onSelect }: { seleccion: number | null; onSelect: (f: ScraperFila) => void }) {
  const [filtro, setFiltro] = useState<string>('huecos');
  const [kind, setKind] = useState<'' | 'movie' | 'show'>('');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [acumuladas, setAcumuladas] = useState<ScraperFila[]>([]);

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

  const total = data?.total ?? 0;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <TextInput value={texto} onChange={setTexto} placeholder="Buscar en la biblioteca…" className="w-full" />
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            onClick={() => setFiltro(f.clave)}
            className={`rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${filtro === f.clave ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40' : 'bg-white/6 text-mist-400 hover:bg-white/12'}`}
          >
            {f.etiqueta}
            {data?.cuenta[f.clave] != null && <span className="ml-1 tabular-nums text-mist-600">{data.cuenta[f.clave]}</span>}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 text-[11.5px]">
        {([['', 'Todo'], ['movie', 'Películas'], ['show', 'Series']] as const).map(([k, e]) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-full px-2.5 py-1 ${kind === k ? 'bg-white/14 text-mist-100' : 'text-mist-500 hover:text-mist-200'}`}>{e}</button>
        ))}
        <span className="ml-auto self-center tabular-nums text-mist-600">{total} títulos</span>
      </div>
      <div className="max-h-[calc(100vh-18rem)] min-h-64 space-y-0.5 overflow-y-auto pr-1">
        {acumuladas.map((f) => <Fila key={f.id} f={f} activa={f.id === seleccion} onClick={() => onSelect(f)} />)}
        {!isFetching && acumuladas.length === 0 && <p className="px-2 py-6 text-center text-[12.5px] text-mist-500">Nada con ese filtro.</p>}
        {acumuladas.length < total && (
          <div className="py-2 text-center">
            <Button variant="ghost" onClick={() => setOffset(acumuladas.length)} disabled={isFetching}>{isFetching ? 'Cargando…' : `Cargar más (${total - acumuladas.length})`}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Tarjeta({ p, elegida, onClick }: { p: Proposal; elegida: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-32 shrink-0 flex-col gap-1.5 rounded-xl p-1.5 text-left transition-colors hover:bg-white/8 ${elegida ? 'bg-white/10 ring-1 ring-accent/50' : ''}`}>
      <div className="aspect-2/3 w-full overflow-hidden rounded-lg bg-ink-800">
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
      actual: titulo.poster ? <img src={img.poster(titulo.id, 160, titulo.arte_actualizado)} alt="" className="h-24 rounded" /> : <span className="text-mist-600">—</span>,
      nuevo: p.posterUrl ? <img src={pequena(p.posterUrl, 'w185')!} alt="" className="h-24 rounded" /> : <span className="text-mist-600">TMDb no tiene</span>,
    },
    {
      c: 'fanart', hay: !!p.backdropUrl,
      actual: titulo.fanart ? <img src={img.fanart(titulo.id, 400, titulo.arte_actualizado)} alt="" className="h-16 rounded" /> : <span className="text-mist-600">—</span>,
      nuevo: p.backdropUrl ? <img src={pequena(p.backdropUrl, 'w300')!} alt="" className="h-16 rounded" /> : <span className="text-mist-600">TMDb no tiene</span>,
    },
    {
      c: 'logo', hay: !!p.logoUrl,
      actual: titulo.logo ? <img src={img.logo(titulo.id, 300, titulo.arte_actualizado)} alt="" className="h-10 object-contain" /> : <span className="text-mist-600">—</span>,
      nuevo: p.logoUrl ? <img src={pequena(p.logoUrl, 'w300')!} alt="" className="h-10 object-contain" /> : <span className="text-mist-600">TMDb no tiene</span>,
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
      c: 'genres', hay: p.genres.length > 0,
      actual: <span className="text-mist-600">se conservan; marcar añade los de TMDb</span>,
      nuevo: <span>{p.genres.join(', ') || '—'}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-black/20 p-3 text-[12.5px]">
        <div className="font-semibold">{p.title} <span className="font-normal text-mist-500">({p.year ?? 's/f'})</span></div>
        {p.originalTitle && p.originalTitle !== p.title && <div className="text-[11.5px] text-mist-500">Título original: {p.originalTitle}</div>}
      </div>
      <div className="flex gap-2 text-[11.5px]">
        <button className="font-medium text-accent hover:underline underline-offset-2" onClick={() => setCampos(filas.filter((f) => f.hay).map((f) => f.c))}>Marcar todo</button>
        <button className="text-mist-500 hover:underline underline-offset-2" onClick={() => setCampos(filas.filter((f) => f.hay && f.c !== 'genres' && !tiene(titulo, f.c)).map((f) => f.c))}>Solo huecos</button>
        <button className="text-mist-500 hover:underline underline-offset-2" onClick={() => setCampos([])}>Ninguno</button>
      </div>
      <div className="divide-y divide-white/6 rounded-xl bg-white/4">
        <div className="grid grid-cols-[1.5rem_5rem_1fr_1fr] items-center gap-3 px-3 py-1.5 text-[10.5px] uppercase tracking-wide text-mist-600">
          <span /><span>Campo</span><span>Actual</span><span>Propuesta de TMDb</span>
        </div>
        {filas.map((f) => (
          <label key={f.c} className={`grid grid-cols-[1.5rem_5rem_1fr_1fr] items-center gap-3 px-3 py-2 ${f.hay ? 'cursor-pointer hover:bg-white/4' : 'opacity-50'}`}>
            <input type="checkbox" disabled={!f.hay} checked={campos.includes(f.c)} onChange={() => alternar(f.c)} className="accent-[var(--color-accent,#7c8cff)]" />
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
    setPropuestas([]); setElegida(null); setCampos([]); setAviso(''); setError(''); setHecho('');
    if (lanzada.current !== titulo.id) { lanzada.current = titulo.id; buscar.mutate(inicial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titulo.id]);

  // Propuesta nueva -> por defecto se marcan los huecos (lo que no pisa nada).
  useEffect(() => {
    if (!elegida) return setCampos([]);
    const hay: Record<Campo, boolean> = { poster: !!elegida.posterUrl, fanart: !!elegida.backdropUrl, logo: !!elegida.logoUrl, plot: !!elegida.overview, rating: elegida.rating != null, genres: elegida.genres.length > 0 };
    // Géneros nunca por defecto: la biblioteca usa los de IMDb (decisión del 26/09) y TMDb reparte de más.
    setCampos(CAMPOS.map((c) => c.clave).filter((c) => c !== 'genres' && hay[c] && !tiene(titulo, c)));
  }, [elegida, titulo]);

  const aplicar = useMutation({
    mutationFn: () => api.enrichApply({ itemId: titulo.id, tmdbId: elegida!.tmdbId, kind: titulo.kind, fields: campos, overwrite: true }),
    onSuccess: (r) => {
      setHecho(`Guardado en «${r.title}»: ${r.applied.join(', ')}.`);
      setError('');
      qc.invalidateQueries({ queryKey: ['scraper-titulo', titulo.id] });
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
        <TextInput value={entrada} onChange={setEntrada} placeholder="Título, id de TMDb, id de IMDb (tt…) o dirección de su página" className="flex-1" />
        <Button onClick={() => entrada.trim() && buscar.mutate(entrada)} disabled={buscar.isPending}>{buscar.isPending ? 'Buscando…' : 'Buscar'}</Button>
      </form>
      {aviso && <p className="text-[12.5px] text-mist-500">{aviso}</p>}

      {propuestas.length > 1 && (
        <div className="no-scrollbar flex gap-1 overflow-x-auto pb-1">
          {propuestas.map((p) => <Tarjeta key={p.tmdbId} p={p} elegida={elegida?.tmdbId === p.tmdbId} onClick={() => setElegida(p)} />)}
        </div>
      )}

      {elegida && <Comparar titulo={titulo} p={elegida} campos={campos} setCampos={setCampos} />}

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

function Ficha({ id }: { id: number }) {
  const [pestana, setPestana] = useState<'emparejar' | 'imagenes'>('emparejar');
  const { data: t } = useQuery({ queryKey: ['scraper-titulo', id], queryFn: () => api.scraperTitulo(id) });
  useEffect(() => setPestana('emparejar'), [id]);
  if (!t) return <p className="p-6 text-[13px] text-mist-500">Cargando…</p>;
  const enlaceTmdb = t.tmdb_id ? `https://www.themoviedb.org/${t.kind === 'show' ? 'tv' : 'movie'}/${t.tmdb_id}` : null;
  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <div className="w-24 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8">
          <div className="aspect-2/3">{t.poster ? <img src={img.poster(t.id, 240, t.arte_actualizado)} alt="" className="h-full w-full object-cover" /> : null}</div>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-tight">{t.title} <span className="text-[14px] font-normal text-mist-500">{t.year ?? ''}</span></h2>
          {t.original_title && t.original_title !== t.title && <div className="text-[12px] text-mist-500">{t.original_title}</div>}
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-mist-400">
            <span className="rounded bg-white/8 px-1.5 py-0.5">{t.biblioteca}</span>
            {t.mpaa && <span className="rounded bg-white/8 px-1.5 py-0.5">{t.mpaa}</span>}
            {enlaceTmdb
              ? <a href={enlaceTmdb} target="_blank" rel="noreferrer" className="rounded bg-white/8 px-1.5 py-0.5 hover:bg-white/14">TMDb {t.tmdb_id}</a>
              : <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">Sin emparejar</span>}
            {t.imdb_id && <a href={`https://www.imdb.com/title/${t.imdb_id}/`} target="_blank" rel="noreferrer" className="rounded bg-white/8 px-1.5 py-0.5 hover:bg-white/14">{t.imdb_id}</a>}
            {t.origen === 'tmdb' && <span className="rounded bg-white/8 px-1.5 py-0.5">datos de TMDb</span>}
          </div>
          {t.plot && <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-mist-500">{t.plot}</p>}
        </div>
      </div>

      <div className="flex gap-1 border-b border-white/8">
        {([['emparejar', 'Emparejar y completar'], ['imagenes', 'Imágenes']] as const).map(([k, e]) => (
          <button key={k} onClick={() => setPestana(k)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors ${pestana === k ? 'border-accent text-mist-100' : 'border-transparent text-mist-500 hover:text-mist-200'}`}>{e}</button>
        ))}
      </div>

      {pestana === 'emparejar' && <Emparejar titulo={t} />}
      {pestana === 'imagenes' && (
        <SelectorDeArte itemId={t.id} kind={t.kind} titulo={t.title} anio={t.year} tmdbId={t.tmdb_id ? Number(t.tmdb_id) : null} />
      )}
    </div>
  );
}

export default function Scraper() {
  const { data: yo } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  const [id, setId] = useState<number | null>(null);
  const detalle = useRef<HTMLDivElement>(null);

  if (yo && yo.is_admin !== 1) return <p className="mx-auto max-w-3xl px-4 page-pt text-[13px] text-mist-500">Solo un administrador puede usar el Scraper.</p>;

  return (
    <div className="mx-auto max-w-6xl px-4 page-pt page-pb sm:px-8">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Scraper</h1>
        <p className="hidden text-[12.5px] text-mist-500 sm:block">Empareja con TMDb, compara con lo que hay y aplica. La biblioteca no se toca.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Lista seleccion={id} onSelect={(f) => { setId(f.id); setTimeout(() => detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />
        <div ref={detalle} className="glass min-h-64 rounded-[var(--radius-panel)] p-5">
          {id ? <Ficha id={id} /> : <p className="py-16 text-center text-[13px] text-mist-500">Elige un título de la lista para ver qué le falta y qué propone TMDb.</p>}
        </div>
      </div>
    </div>
  );
}
