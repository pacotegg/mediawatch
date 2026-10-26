import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './Controls.tsx';
import { api, type CambiosMetadatos, type ItemDetail } from '../lib/api.ts';

const entrada =
  'w-full rounded-xl border border-white/8 bg-white/6 px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-mist-600 focus:border-accent/40';

function Campo({ etiqueta, ayuda, children, ancho }: { etiqueta: string; ayuda?: string; children: React.ReactNode; ancho?: boolean }) {
  return (
    <label className={`block ${ancho ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-mist-500">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-[11.5px] text-mist-600">{ayuda}</span>}
    </label>
  );
}

const EDADES = ['TP', '7', '12', '16', '18', 'PG', 'PG-13', 'R'];

/**
 * Editar a mano los datos de un título (como el diálogo de editar de Plex), para administradores. Solo se envía lo que ha
 * cambiado; lo editado el escáner no lo pisa desde el .nfo y se puede deshacer. No escribe en la carpeta de la biblioteca.
 */
export default function EditorDatos({ item, onGuardado }: { item: ItemDetail & { sort_title?: string | null }; onGuardado?: () => void }) {
  const qc = useQueryClient();
  const inicial = useMemo(
    () => ({
      title: item.title ?? '',
      original_title: item.original_title ?? '',
      sort_title: item.sort_title ?? '',
      year: item.year != null ? String(item.year) : '',
      mpaa: item.mpaa ?? '',
      studio: item.studio ?? '',
      tagline: item.tagline ?? '',
      plot: item.plot ?? '',
      collection: item.collection ?? '',
      genres: [...(item.genres ?? [])],
    }),
    [item.id, item.title, item.original_title, item.sort_title, item.year, item.mpaa, item.studio, item.tagline, item.plot, item.collection, item.genres],
  );
  const [f, setF] = useState(inicial);
  const [genero, setGenero] = useState('');
  const [hecho, setHecho] = useState('');
  // Al refrescarse los datos tras guardar el formulario se reinicia, pero el aviso de «Guardado» se conserva.
  useEffect(() => { setF(inicial); }, [inicial]);
  useEffect(() => { setHecho(''); }, [item.id]);

  const sagas = useQuery({ queryKey: ['collections'], queryFn: () => api.collections(), staleTime: 60_000 });
  const generos = useQuery({ queryKey: ['genres', 'todos'], queryFn: () => api.genres(), staleTime: 60_000 });

  const cambios = useMemo(() => {
    const c: CambiosMetadatos = {};
    const t = (v: string) => v.trim();
    if (t(f.title) !== t(inicial.title)) c.title = t(f.title);
    if (t(f.original_title) !== t(inicial.original_title)) c.original_title = t(f.original_title) || null;
    if (t(f.sort_title) !== t(inicial.sort_title)) c.sort_title = t(f.sort_title) || null;
    if (t(f.year) !== t(inicial.year)) c.year = t(f.year) ? Number(t(f.year)) : null;
    if (t(f.mpaa) !== t(inicial.mpaa)) c.mpaa = t(f.mpaa) || null;
    if (t(f.studio) !== t(inicial.studio)) c.studio = t(f.studio) || null;
    if (t(f.tagline) !== t(inicial.tagline)) c.tagline = t(f.tagline) || null;
    if (t(f.plot) !== t(inicial.plot)) c.plot = t(f.plot) || null;
    if (t(f.collection) !== t(inicial.collection)) c.collection = t(f.collection) || null;
    if (f.genres.join('\u0001') !== inicial.genres.join('\u0001')) c.genres = f.genres;
    return c;
  }, [f, inicial]);
  const hayCambios = Object.keys(cambios).length > 0;
  const anioMal = f.year.trim() !== '' && !/^\d{4}$/.test(f.year.trim());
  const tituloVacio = !f.title.trim();

  const guardar = useMutation({
    mutationFn: () => api.editarMetadatos(item.id, cambios),
    onSuccess: (r) => {
      setHecho(`Guardado (${r.campos.length} ${r.campos.length === 1 ? 'dato' : 'datos'}).`);
      qc.invalidateQueries();
      onGuardado?.();
    },
  });
  const deshacer = useMutation({
    mutationFn: () => api.scraperDeshacer(item.id),
    onSuccess: (r) => { setHecho(`Deshecho: ${r.etiqueta}.`); qc.invalidateQueries(); onGuardado?.(); },
  });

  const anadirGenero = () => {
    const g = genero.trim();
    if (!g || f.genres.some((x) => x.toLowerCase() === g.toLowerCase())) { setGenero(''); return; }
    setF((p) => ({ ...p, genres: [...p.genres, g] }));
    setGenero('');
  };
  const error = (guardar.error as Error | null)?.message || (deshacer.error as Error | null)?.message;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Título" ancho>
          <input className={entrada} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Campo>
        <Campo etiqueta="Título original">
          <input className={entrada} value={f.original_title} onChange={(e) => setF({ ...f, original_title: e.target.value })} />
        </Campo>
        <Campo etiqueta="Título de orden" ayuda="Cómo se ordena en las listas; vacío = el título.">
          <input className={entrada} value={f.sort_title} onChange={(e) => setF({ ...f, sort_title: e.target.value })} />
        </Campo>
        <Campo etiqueta="Año" ayuda={anioMal ? 'Cuatro cifras, por ejemplo 2013.' : undefined}>
          <input className={`${entrada} ${anioMal ? 'border-red-400/50' : ''}`} inputMode="numeric" maxLength={4} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
        </Campo>
        <Campo etiqueta="Edad recomendada">
          <input className={entrada} list="edades-editor" value={f.mpaa} onChange={(e) => setF({ ...f, mpaa: e.target.value })} placeholder="TP, 7, 12, 16, 18…" />
          <datalist id="edades-editor">{EDADES.map((e) => <option key={e} value={e} />)}</datalist>
        </Campo>
        <Campo etiqueta="Estudio" ancho>
          <input className={entrada} value={f.studio} onChange={(e) => setF({ ...f, studio: e.target.value })} placeholder="Varios, separados por coma" />
        </Campo>
        <Campo etiqueta="Lema" ancho>
          <input className={entrada} value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
        </Campo>
        <Campo etiqueta="Sinopsis" ancho>
          <textarea className={`${entrada} min-h-28 resize-y leading-relaxed`} value={f.plot} onChange={(e) => setF({ ...f, plot: e.target.value })} />
        </Campo>
        <Campo etiqueta="Saga / colección" ancho ayuda="Elige una existente o escribe un nombre nuevo; vacío = sin saga.">
          <input className={entrada} list="sagas-editor" value={f.collection} onChange={(e) => setF({ ...f, collection: e.target.value })} placeholder="Sin saga" />
          <datalist id="sagas-editor">{(sagas.data ?? []).map((s) => <option key={s.name} value={s.name} />)}</datalist>
        </Campo>
        <Campo etiqueta="Géneros" ancho>
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/8 bg-white/6 p-2">
            {f.genres.map((g) => (
              <span key={g} className="flex items-center gap-1 rounded-full bg-white/10 py-1 pl-2.5 pr-1.5 text-[12.5px]">
                {g}
                <button type="button" aria-label={`Quitar ${g}`} onClick={() => setF({ ...f, genres: f.genres.filter((x) => x !== g) })} className="grid h-4 w-4 place-items-center rounded-full text-mist-400 hover:bg-white/15 hover:text-white">×</button>
              </span>
            ))}
            <input
              list="generos-editor"
              value={genero}
              onChange={(e) => setGenero(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); anadirGenero(); } }}
              onBlur={anadirGenero}
              placeholder={f.genres.length ? 'Añadir…' : 'Añade un género y pulsa Intro'}
              className="min-w-32 flex-1 bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:text-mist-600"
            />
            <datalist id="generos-editor">{(generos.data ?? []).map((g) => <option key={g.id} value={g.name} />)}</datalist>
          </div>
        </Campo>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => guardar.mutate()} disabled={!hayCambios || anioMal || tituloVacio || guardar.isPending}>
          {guardar.isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
        <Button variant="ghost" onClick={() => { setF(inicial); setHecho(''); }} disabled={!hayCambios}>Descartar</Button>
        <Button variant="ghost" onClick={() => deshacer.mutate()} disabled={deshacer.isPending}>Deshacer el último cambio</Button>
        {hecho && <span className="text-[12.5px] text-emerald-300">{hecho}</span>}
        {error && <span className="text-[12.5px] text-red-400">{error}</span>}
      </div>
      <p className="text-[11.5px] leading-relaxed text-mist-600">
        Solo cambia la base de datos: no escribe en la carpeta de la película ni en su NFO, y el escáner respeta lo que edites aquí.
      </p>
    </div>
  );
}
