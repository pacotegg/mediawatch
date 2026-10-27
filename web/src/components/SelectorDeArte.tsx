import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, img as imgs, type ImagenDisponible, type PapelArte } from '../lib/api.ts';

/*
 * Elegir cartel, fondo, logotipo, apaisada y disco.
 *
 * Pensado para no subir y bajar: la barra de arriba (tipo de imagen, la actual frente a la que vas a poner, y los botones) se queda fija
 * mientras miras; debajo solo hay 6 imágenes y «Cargar más». Todo lo que se usa de vez en cuando (subir una propia, quitar la elegida)
 * está en esa misma barra; buscar otra película y el buzón van plegados porque casi nunca hacen falta.
 *
 * Lo que se elige **no se escribe en la carpeta de la película**: se guarda aparte y queda marcado para que el escáner no lo pise
 * (antes cambiar una carátula duraba hasta el siguiente escaneo, que es justo lo que pasaba con «Magnolia»).
 */

const PAPELES: { clave: PapelArte; etiqueta: string; proporcion: string }[] = [
  { clave: 'poster', etiqueta: 'Carátula', proporcion: 'aspect-2/3' },
  { clave: 'fanart', etiqueta: 'Fondo', proporcion: 'aspect-video' },
  { clave: 'clearlogo', etiqueta: 'Logotipo', proporcion: 'aspect-video' },
  { clave: 'landscape', etiqueta: 'Apaisada', proporcion: 'aspect-video' },
  { clave: 'discart', etiqueta: 'Disco', proporcion: 'aspect-square' },
];

const DE_GOLPE = 6;

/** Una version de buen tamano para mirarla de cerca: TMDb ofrece w1280 de lo que en la rejilla va a w500; fanart.tv ya trae la grande. */
function grande(i: ImagenDisponible): string {
  return i.url.includes('image.tmdb.org') ? i.url.replace('/original/', '/w1280/') : i.url;
}

export default function SelectorDeArte({
  itemId,
  kind,
  titulo,
  anio,
  tmdbId,
}: {
  itemId: number;
  kind: 'movie' | 'show';
  titulo: string;
  anio: number | null;
  tmdbId: number | null;
}) {
  const queryClient = useQueryClient();
  const [elegido, setElegido] = useState<number | null>(tmdbId);
  const [papel, setPapel] = useState<PapelArte>('poster');
  const [consulta, setConsulta] = useState(titulo);
  const [aviso, setAviso] = useState('');
  // La imagen que se esta mirando, cuantas se enseñan, y una marca para repintar la actual cuando cambie.
  const [previa, setPrevia] = useState<ImagenDisponible | null>(null);
  const [visibles, setVisibles] = useState(DE_GOLPE);
  const [version, setVersion] = useState(() => String(Date.now()));

  /*
   * `useState(tmdbId)` solo lee el valor inicial una vez. Este componente se monta antes de que termine la búsqueda en TMDb, así que
   * `tmdbId` puede llegar en `null` en el primer render y el selector se quedaba sin imágenes para siempre. Al llegar el id, se adopta.
   */
  useEffect(() => {
    if (tmdbId != null) setElegido(tmdbId);
  }, [tmdbId]);
  useEffect(() => { setPrevia(null); setVisibles(DE_GOLPE); }, [papel, elegido]);

  const busqueda = useMutation({
    mutationFn: () => api.enrichSearch(consulta.trim(), kind, anio),
    onError: (e: Error) => setAviso(e.message),
  });

  const { data: imagenes, isLoading } = useQuery({
    queryKey: ['arte', kind, elegido],
    queryFn: () => api.enrichImagenes(kind, elegido!),
    enabled: elegido != null,
    retry: false,
  });

  const refrescarFicha = () => {
    setVersion(String(Date.now()));
    queryClient.invalidateQueries({ queryKey: ['item', itemId] });
    queryClient.invalidateQueries({ queryKey: ['home'] });
    // El Scraper pinta su propia cabecera de la ficha: sin esto el cartel nuevo no se veia hasta recargar.
    queryClient.invalidateQueries({ queryKey: ['scraper-titulo', itemId] });
    queryClient.invalidateQueries({ queryKey: ['scraper-historial', itemId] });
  };

  const etiquetaPapel = PAPELES.find((p) => p.clave === papel)!.etiqueta;

  const poner = useMutation({
    mutationFn: (url: string | null) => api.ponerArte(itemId, papel, url),
    onSuccess: (_r, url) => {
      setPrevia(null);
      setAviso(url ? `${etiquetaPapel}: cambiada.` : `${etiquetaPapel}: vuelve la de la carpeta.`);
      refrescarFicha();
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const subir = useMutation({
    mutationFn: (fichero: File) => api.subirArte(itemId, papel, fichero),
    onSuccess: () => { setPrevia(null); setAviso(`${etiquetaPapel}: tu imagen está puesta.`); refrescarFicha(); },
    onError: (e: Error) => setAviso(e.message),
  });

  const { data: buzon } = useQuery({ queryKey: ['buzon-arte'], queryFn: () => api.buzonArte(), retry: false });
  const delBuzon = useMutation({
    mutationFn: (nombre: string) => api.ponerArteDelBuzon(itemId, papel, nombre),
    onSuccess: () => { setAviso(`${etiquetaPapel}: imagen del buzón puesta.`); refrescarFicha(); },
    onError: (e: Error) => setAviso(e.message),
  });

  const lista: ImagenDisponible[] = imagenes?.[papel] ?? [];
  const forma = PAPELES.find((p) => p.clave === papel)!.proporcion;
  const contiene = papel === 'discart' || papel === 'clearlogo';
  const ocupado = poner.isPending || subir.isPending || delBuzon.isPending;
  // 6 carteles caben en una fila; 6 fondos, en dos de tres.
  const rejilla = papel === 'poster' || papel === 'discart' ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-2 lg:grid-cols-3';

  return (
    <div className="mt-2">
      {/* ----- BARRA FIJA: todo lo que se usa, siempre a la vista ----- */}
      <div className="sticky top-2 z-20 space-y-3 rounded-2xl bg-ink-900/90 p-3.5 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.9)] ring-1 ring-white/12 backdrop-blur-xl">
        <div className="flex flex-wrap gap-1.5">
          {PAPELES.map((p) => (
            <button
              key={p.clave}
              onClick={() => setPapel(p.clave)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] ${papel === p.clave ? 'bg-accent/18 font-medium text-accent-soft ring-1 ring-accent/40' : 'bg-white/6 text-mist-300 hover:bg-white/12'}`}
            >
              {p.etiqueta}
              {imagenes?.[p.clave] ? <span className="ml-1.5 opacity-60">{imagenes[p.clave].length}</span> : null}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-1 text-[11.5px] font-medium text-mist-500">Actual</div>
            <div className={`h-44 shrink-0 overflow-hidden rounded-xl bg-ink-800 shadow-[0_14px_28px_-8px_rgb(0_0_0/0.85)] ring-1 ring-white/12 ${forma}`}>
              <img src={imgs[papel === 'clearlogo' ? 'logo' : papel](itemId, 700, version)} alt="" className={`h-full w-full ${contiene ? 'object-contain p-2' : 'object-cover'}`} onError={(e) => (e.currentTarget.style.opacity = '0')} />
            </div>
          </div>
          <div>
            <div className={`mb-1 text-[11.5px] font-medium ${previa ? 'text-accent' : 'text-mist-600'}`}>La que vas a poner</div>
            <div className={`grid h-44 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink-800 ${forma} ${previa ? 'shadow-[0_0_28px_-6px_rgb(240_165_74/0.5)] ring-2 ring-accent/70' : 'ring-1 ring-dashed ring-white/10'}`}>
              {previa
                ? <img src={grande(previa)} alt="" className={`h-full w-full ${contiene ? 'object-contain p-2' : 'object-cover'}`} />
                : <span className="px-3 text-center text-[11.5px] text-mist-600">Pulsa una de abajo</span>}
            </div>
          </div>

          <div className="flex min-w-48 flex-1 flex-col gap-2">
            {previa && <div className="text-[12px] text-mist-500">{previa.ancho > 0 ? `${previa.ancho}×${previa.alto} · ` : ''}{previa.idioma ? `idioma: ${previa.idioma}` : 'sin texto'}</div>}
            <button
              onClick={() => previa && poner.mutate(previa.url)}
              disabled={!previa || ocupado}
              className="rounded-full bg-gradient-to-b from-accent-soft to-accent px-5 py-2.5 text-[14px] font-semibold text-ink-950 shadow-[0_8px_22px_-8px_rgb(240_165_74/0.6)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
            >
              {poner.isPending ? 'Guardando…' : 'Usar esta imagen'}
            </button>
            <div className="flex flex-wrap gap-2">
              <label className={`inline-flex cursor-pointer items-center rounded-full bg-white/10 px-3.5 py-1.5 text-[12.5px] hover:bg-white/18 ${ocupado ? 'pointer-events-none opacity-40' : ''}`} title="JPEG, PNG o WebP, hasta 20 MB. Se guarda aparte, sin tocar la carpeta.">
                {subir.isPending ? 'Subiendo…' : 'Subir una mía'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={ocupado}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    // Se limpia el input: si no, elegir el MISMO fichero otra vez no dispara `change` y parece que no va.
                    e.target.value = '';
                    if (f) subir.mutate(f);
                  }}
                />
              </label>
              <button onClick={() => poner.mutate(null)} disabled={ocupado} className="rounded-full bg-white/8 px-3.5 py-1.5 text-[12.5px] text-mist-300 hover:bg-white/14 disabled:opacity-40" title="Vuelve a la imagen que haya en la carpeta del título">
                Quitar la elegida
              </button>
              {previa && <button onClick={() => setPrevia(null)} className="rounded-full px-3 py-1.5 text-[12.5px] text-mist-500 hover:text-mist-200">Cancelar</button>}
            </div>
            {aviso && <div className="text-[12.5px] text-emerald-300">{aviso}</div>}
          </div>
        </div>
      </div>

      {/* ----- LAS IMAGENES: 6 de golpe ----- */}
      <div className="mt-4">
        {elegido == null && <p className="text-[13px] text-mist-500">Busca primero la película (abajo, «¿No es esta película?») para ver sus imágenes.</p>}
        {isLoading && <p className="text-[13px] text-mist-500">Pidiendo las imágenes…</p>}

        {lista.length > 0 && (
          <>
            <div className={`grid gap-3 ${rejilla}`}>
              {lista.slice(0, visibles).map((i) => (
                <button
                  key={i.url}
                  onClick={() => setPrevia(i)}
                  disabled={ocupado}
                  title={`${i.ancho > 0 ? `${i.ancho}×${i.alto} · ` : ''}${i.idioma || 'sin texto'}`}
                  className={`group relative overflow-hidden rounded-xl bg-ink-800 ring-1 transition-all hover:ring-white/50 disabled:opacity-50 ${previa?.url === i.url ? 'ring-2 ring-accent shadow-[0_0_22px_-6px_rgb(240_165_74/0.55)]' : 'ring-white/10 shadow-[0_8px_18px_-8px_rgb(0_0_0/0.8)]'} ${forma}`}
                >
                  <img src={i.vista} alt="" loading="lazy" className={`h-full w-full ${contiene ? 'object-contain p-2' : 'object-cover'}`} />
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-1 text-[10.5px] text-mist-200 opacity-0 transition-opacity group-hover:opacity-100">
                    {i.ancho > 0 ? `${i.ancho}×${i.alto} · ` : ''}{i.idioma || 'sin texto'}
                  </span>
                </button>
              ))}
            </div>
            {lista.length > visibles && (
              <div className="mt-3 text-center">
                <button onClick={() => setVisibles((v) => v + DE_GOLPE)} className="rounded-full bg-white/10 px-5 py-2 text-[13px] hover:bg-white/18">
                  Cargar más ({lista.length - visibles} más)
                </button>
              </div>
            )}
          </>
        )}

        {elegido != null && !isLoading && lista.length === 0 && (
          <p className="text-[13px] text-mist-500">No hay imágenes de este tipo para este título. Puedes subir una tuya con el botón de arriba.</p>
        )}
      </div>

      {/* ----- Lo que casi nunca hace falta, plegado ----- */}
      <details className="mt-5 rounded-xl bg-white/4 px-3 py-2 text-[12.5px]">
        <summary className="cursor-pointer text-mist-400">¿No es esta película? Buscar otra</summary>
        <div className="mt-3 flex gap-2">
          <input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && busqueda.mutate()}
            placeholder="Búscala por su título"
            className="min-w-0 flex-1 rounded-xl bg-white/6 px-3 py-2 text-[13px] outline-none ring-1 ring-white/10 focus:ring-white/25"
          />
          <button onClick={() => busqueda.mutate()} disabled={busqueda.isPending} className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-[12.5px] hover:bg-white/18 disabled:opacity-40">Buscar</button>
        </div>
        {busqueda.data && busqueda.data.results.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {busqueda.data.results.slice(0, 6).map((r) => (
              <button key={r.tmdbId} onClick={() => setElegido(r.tmdbId)} className={`rounded-full px-3 py-1.5 text-[12px] ${elegido === r.tmdbId ? 'bg-accent/25 text-accent-soft ring-1 ring-accent/40' : 'bg-white/8 hover:bg-white/14'}`}>
                {r.title} {r.year ? `(${r.year})` : ''}
              </button>
            ))}
          </div>
        )}
      </details>

      {buzon && buzon.imagenes.length > 0 && (
        <details className="mt-3 rounded-xl bg-white/4 px-3 py-2 text-[12.5px]">
          <summary className="cursor-pointer text-mist-400">Del buzón ({buzon.imagenes.length} imágenes que dejaste en <code className="text-mist-500">{buzon.carpeta}</code>)</summary>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {buzon.imagenes.map((i) => (
              <button
                key={i.nombre}
                onClick={() => delBuzon.mutate(i.nombre)}
                disabled={ocupado}
                title={`${i.nombre} · ${Math.round(i.bytes / 1024)} kB — pulsa para ponerla como ${etiquetaPapel.toLowerCase()}`}
                className={`group relative overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/10 hover:ring-white/50 disabled:opacity-50 ${forma}`}
              >
                <img src={`/api/enrich/arte/buzon/${encodeURIComponent(i.nombre)}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1.5 py-1 text-[10.5px] text-mist-200">{i.nombre}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
