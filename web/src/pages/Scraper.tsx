import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, TextInput } from '../components/Controls.tsx';
import SelectorDeArte from '../components/SelectorDeArte.tsx';
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
      actual: titulo.poster ? <img src={img.poster(titulo.id, 400, titulo.arte_actualizado)} alt="" className="h-48 rounded-lg" /> : <span className="text-mist-600">—</span>,
      nuevo: p.posterUrl ? <img src={pequena(p.posterUrl, 'w500')!} alt="" className="h-48 rounded-lg" /> : <span className="text-mist-600">TMDb no tiene</span>,
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
      <div className="rounded-xl bg-black/20 p-3 text-[12.5px]">
        <div className="font-semibold">{p.title} <span className="font-normal text-mist-500">({p.year ?? 's/f'})</span></div>
        {p.originalTitle && p.originalTitle !== p.title && <div className="text-[11.5px] text-mist-500">Título original: {p.originalTitle}</div>}
      </div>
      <div className="flex gap-2 text-[11.5px]">
        <button className="font-medium text-accent hover:underline underline-offset-2" onClick={() => setCampos(filas.filter((f) => f.hay && f.c !== 'ficha').map((f) => f.c))}>Marcar todo</button>
        <button className="text-mist-500 hover:underline underline-offset-2" onClick={() => setCampos(filas.filter((f) => f.hay && f.c !== 'genres' && f.c !== 'ficha' && !tiene(titulo, f.c)).map((f) => f.c))}>Solo huecos</button>
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

      {elegida && (
        <label className="flex items-start gap-2 text-[12.5px] text-mist-300">
          <input type="checkbox" checked={identidad} onChange={(e) => setIdentidad(e.target.checked)} className="mt-0.5 accent-[var(--color-accent,#7c8cff)]" />
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

function Ficha({ id }: { id: number }) {
  const [pestana, setPestana] = useState<'emparejar' | 'imagenes'>('emparejar');
  const { data: t } = useQuery({ queryKey: ['scraper-titulo', id], queryFn: () => api.scraperTitulo(id) });
  useEffect(() => setPestana('emparejar'), [id]);
  if (!t) return <p className="p-6 text-[13px] text-mist-500">Cargando…</p>;
  const enlaceTmdb = t.tmdb_id ? `https://www.themoviedb.org/${t.kind === 'show' ? 'tv' : 'movie'}/${t.tmdb_id}` : null;
  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <div className="w-44 shrink-0 overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/10">
          <div className="aspect-2/3">{t.poster ? <img src={img.poster(t.id, 500, t.arte_actualizado)} alt="" className="h-full w-full object-cover" /> : null}</div>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold leading-tight">{t.title} <span className="text-[14px] font-normal text-mist-500">{t.year ?? ''}</span></h2>
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

      <Deshacer id={t.id} />
      <ArteACarpeta id={t.id} />
      <Organizar id={t.id} kind={t.kind} />
      <NfoACarpeta id={t.id} />
      <Enviar id={t.id} kind={t.kind} />

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
  const [modo, setModo] = useState<'asistente' | 'biblioteca' | 'fuentes' | 'ajustes'>('asistente');
  const detalle = useRef<HTMLDivElement>(null);
  const { data: nuevos } = useQuery({ queryKey: ['scraper-nuevos'], queryFn: api.scraperNuevos, enabled: yo?.is_admin === 1 });

  if (yo && yo.is_admin !== 1) return <p className="mx-auto max-w-3xl px-4 page-pt text-[13px] text-mist-500">Solo un administrador puede usar el Scraper.</p>;

  return (
    <div className="mx-auto max-w-[88rem] px-4 page-pt page-pb sm:px-8">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Scraper</h1>
        <p className="hidden text-[12.5px] text-mist-500 sm:block">Elige qué escrapear, empareja con TMDb, renombra y envía a la biblioteca.</p>
      </div>
      <div className="mb-5 flex gap-1 border-b border-white/8">
        {([['asistente', `Asistente${nuevos?.pendientes ? ` (${nuevos.pendientes})` : ''}`], ['biblioteca', 'Biblioteca'], ['fuentes', 'Fuentes'], ['ajustes', 'Ajustes']] as const).map(([k, e]) => (
          <button key={k} onClick={() => setModo(k)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors ${modo === k ? 'border-accent text-mist-100' : 'border-transparent text-mist-500 hover:text-mist-200'}`}>{e}</button>
        ))}
      </div>
      {modo === 'asistente' && <AsistenteNuevos />}
      {modo === 'fuentes' && <FuentesScraper />}
      {modo === 'ajustes' && <AjustesScraper />}
      <div className={modo === 'biblioteca' ? 'grid gap-6 lg:grid-cols-[20rem_1fr]' : 'hidden'}>
        <Lista seleccion={id} onSelect={(f) => { setId(f.id); setTimeout(() => detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />
        <div ref={detalle} className="glass min-h-64 rounded-[var(--radius-panel)] p-5">
          {id ? <Ficha id={id} /> : <p className="py-16 text-center text-[13px] text-mist-500">Elige un título de la lista para ver qué le falta y qué propone TMDb.</p>}
        </div>
      </div>
    </div>
  );
}
