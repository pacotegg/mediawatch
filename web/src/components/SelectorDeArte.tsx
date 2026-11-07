import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, img as imgs, type ImagenDisponible, type PapelArte } from '../lib/api.ts';

/*
 * SelectorDeArte: selector y visor de imágenes de alta fidelidad (TMDb / fanart.tv / subidas propias).
 * Diseño de flujo natural sin elementos sticky intrusivos: el dock de confirmación flota en la base
 * únicamente cuando se selecciona una imagen candidata, permitiendo scroll fluido y vista completa de la galería.
 */

const PAPELES: { clave: PapelArte; etiqueta: string; proporcion: string }[] = [
  { clave: 'poster', etiqueta: 'Carátula', proporcion: 'aspect-2/3' },
  { clave: 'fanart', etiqueta: 'Fondo', proporcion: 'aspect-video' },
  { clave: 'clearlogo', etiqueta: 'Logotipo', proporcion: 'aspect-video' },
  { clave: 'landscape', etiqueta: 'Apaisada', proporcion: 'aspect-video' },
  { clave: 'discart', etiqueta: 'Disco', proporcion: 'aspect-square' },
];

const DE_GOLPE = 12;

/** TMDb ofrece w1280 para alta resolución; fanart.tv entrega la imagen grande directamente. */
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
  const [previa, setPrevia] = useState<ImagenDisponible | null>(null);
  const [visibles, setVisibles] = useState(DE_GOLPE);
  const [version, setVersion] = useState(() => String(Date.now()));

  useEffect(() => {
    if (tmdbId != null) setElegido(tmdbId);
  }, [tmdbId]);

  useEffect(() => {
    setPrevia(null);
    setVisibles(DE_GOLPE);
    setAviso('');
  }, [papel, elegido]);

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
    queryClient.invalidateQueries({ queryKey: ['scraper-titulo', itemId] });
    queryClient.invalidateQueries({ queryKey: ['scraper-historial', itemId] });
  };

  const etiquetaPapel = PAPELES.find((p) => p.clave === papel)!.etiqueta;

  const poner = useMutation({
    mutationFn: (url: string | null) => api.ponerArte(itemId, papel, url),
    onSuccess: (_r, url) => {
      setPrevia(null);
      setAviso(url ? `${etiquetaPapel}: imagen actualizada con éxito.` : `${etiquetaPapel}: restaurada la imagen original del disco.`);
      refrescarFicha();
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const subir = useMutation({
    mutationFn: (fichero: File) => api.subirArte(itemId, papel, fichero),
    onSuccess: () => {
      setPrevia(null);
      setAviso(`${etiquetaPapel}: imagen personalizada aplicada.`);
      refrescarFicha();
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const { data: buzon } = useQuery({ queryKey: ['buzon-arte'], queryFn: () => api.buzonArte(), retry: false });
  const delBuzon = useMutation({
    mutationFn: (nombre: string) => api.ponerArteDelBuzon(itemId, papel, nombre),
    onSuccess: () => {
      setAviso(`${etiquetaPapel}: imagen aplicada desde el buzón.`);
      refrescarFicha();
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const lista: ImagenDisponible[] = imagenes?.[papel] ?? [];
  const forma = PAPELES.find((p) => p.clave === papel)!.proporcion;
  const contiene = papel === 'discart' || papel === 'clearlogo';
  const ocupado = poner.isPending || subir.isPending || delBuzon.isPending;
  const rejilla = papel === 'poster' || papel === 'discart'
    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="space-y-5">
      {/* Selector de Papel de Arte (Carátula, Fondo, Logotipo, Apaisada, Disco) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/6 pb-4">
        <div className="flex flex-wrap gap-1.5 rounded-full bg-black/25 p-1 ring-1 ring-white/8">
          {PAPELES.map((p) => {
            const activo = papel === p.clave;
            const cuenta = imagenes?.[p.clave]?.length ?? 0;
            return (
              <button
                key={p.clave}
                type="button"
                onClick={() => setPapel(p.clave)}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[12.5px] font-medium transition-all duration-200 ${
                  activo
                    ? 'bg-accent/20 text-accent-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ring-1 ring-accent/40'
                    : 'text-mist-400 hover:bg-white/6 hover:text-mist-100'
                }`}
              >
                <span>{p.etiqueta}</span>
                {cuenta > 0 && (
                  <span className={`rounded-full px-1.5 py-0.2 text-[10.5px] tabular-nums ${activo ? 'bg-accent/25 text-accent-soft' : 'bg-white/8 text-mist-500'}`}>
                    {cuenta}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Acciones auxiliares compactas */}
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <label
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/6 px-3.5 py-1.5 font-medium text-mist-200 ring-1 ring-white/10 transition-colors hover:bg-white/12 ${
              ocupado ? 'pointer-events-none opacity-40' : ''
            }`}
            title="Sube un archivo JPEG, PNG o WebP de hasta 20 MB"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M8 11V3m0 0L4.5 6.5M8 3l3.5 3.5M2 13h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{subir.isPending ? 'Subiendo…' : 'Subir imagen'}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) subir.mutate(f);
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => poner.mutate(null)}
            disabled={ocupado}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/4 px-3 py-1.5 text-mist-400 ring-1 ring-white/6 transition-colors hover:bg-white/10 hover:text-mist-200 disabled:opacity-40"
            title="Restaura la imagen original que tinymediamanager o el disco guardó"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-mist-500" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2 6.5M2 2.5v4h4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Restaurar disco</span>
          </button>
        </div>
      </div>

      {aviso && (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-[12.5px] text-emerald-300 ring-1 ring-emerald-500/20">
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5l3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{aviso}</span>
        </div>
      )}

      {/* Mini-tarjeta: Imagen actualmente activa en la biblioteca */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-ink-900/60 p-3.5 ring-1 ring-white/8">
        <div className="flex items-center gap-3.5">
          <div className={`h-20 shrink-0 overflow-hidden rounded-xl bg-ink-800 shadow-[0_8px_20px_-4px_rgba(0,0,0,0.8)] ring-1 ring-white/12 ${forma}`}>
            <img
              src={imgs[papel === 'clearlogo' ? 'logo' : papel](itemId, 700, version)}
              alt=""
              className={`h-full w-full ${contiene ? 'object-contain p-1.5' : 'object-cover'}`}
              onError={(e) => (e.currentTarget.style.opacity = '0')}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-mist-100">{etiquetaPapel} en uso</span>
              <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-400/25">
                Activa en biblioteca
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-mist-500">
              {previa
                ? 'Has seleccionado una imagen candidata abajo. Pulsa «Usar esta imagen» para reemplazarla.'
                : 'Pulsa cualquiera de las imágenes del catálogo para previsualizarla y aplicarla.'}
            </p>
          </div>
        </div>

        {previa && (
          <div className="flex items-center gap-2.5">
            <span className="text-[12px] text-mist-400">
              Candidata: <strong className="font-medium text-accent-soft">{previa.ancho ? `${previa.ancho}×${previa.alto}` : 'WebP'}</strong>
              {previa.idioma ? ` (${previa.idioma.toUpperCase()})` : ''}
            </span>
            <button
              type="button"
              onClick={() => poner.mutate(previa.url)}
              disabled={ocupado}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-ink-950 shadow-[0_4px_14px_rgba(240,165,74,0.4)] transition hover:brightness-110 disabled:opacity-40"
            >
              <span>{poner.isPending ? 'Guardando…' : 'Usar esta imagen'}</span>
            </button>
            <button
              type="button"
              onClick={() => setPrevia(null)}
              className="rounded-full px-3 py-1.5 text-[12px] text-mist-400 hover:text-mist-200"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* Galería de imágenes disponibles */}
      <div>
        {elegido == null && (
          <p className="py-8 text-center text-[13px] text-mist-500">
            Busca primero la película (abajo en «Buscar en TMDb con otro título») para cargar sus galerías oficiales.
          </p>
        )}
        {isLoading && (
          <div className="flex items-center justify-center gap-2.5 py-12 text-[13px] text-mist-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span>Consultando galerías de TMDb y fanart.tv…</span>
          </div>
        )}

        {lista.length > 0 && (
          <div className="space-y-5">
            <div className={`grid gap-3 ${rejilla}`}>
              {lista.slice(0, visibles).map((i) => {
                const esCandidata = previa?.url === i.url;
                return (
                  <button
                    key={i.url}
                    type="button"
                    onClick={() => setPrevia(i)}
                    disabled={ocupado}
                    className={`group relative overflow-hidden rounded-xl bg-ink-800 text-left ring-1 transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 ${forma} ${
                      esCandidata
                        ? 'ring-2 ring-accent shadow-[0_0_24px_-4px_rgba(240,165,74,0.65)]'
                        : 'ring-white/10 shadow-[0_6px_18px_-4px_rgba(0,0,0,0.7)] hover:ring-white/30'
                    }`}
                  >
                    <img
                      src={i.vista}
                      alt=""
                      loading="lazy"
                      className={`h-full w-full transition-transform duration-300 group-hover:scale-105 ${contiene ? 'object-contain p-2' : 'object-cover'}`}
                    />

                    {/* Badge superior de estado o selección */}
                    <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                      {esCandidata && (
                        <span className="flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink-950 uppercase shadow-md">
                          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Seleccionada
                        </span>
                      )}
                      {i.idioma && (
                        <span className="rounded-full bg-black/60 px-1.5 py-0.5 text-[9.5px] font-medium tracking-wider text-mist-200 uppercase backdrop-blur-md">
                          {i.idioma}
                        </span>
                      )}
                    </div>

                    {/* Metadata en hover inferior */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 text-[11px] text-mist-200 opacity-90 transition-opacity group-hover:opacity-100">
                      <div className="flex items-center justify-between font-mono text-[10px] text-mist-300 tabular-nums">
                        <span>{i.ancho > 0 ? `${i.ancho}×${i.alto}` : 'HQ'}</span>
                        <span className="text-[10px] font-sans font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
                          Elegir →
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {lista.length > visibles && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setVisibles((v) => v + DE_GOLPE)}
                  className="rounded-full bg-white/8 px-6 py-2.5 text-[13px] font-medium text-mist-200 ring-1 ring-white/10 transition-colors hover:bg-white/14"
                >
                  Cargar más imágenes ({lista.length - visibles} restantes)
                </button>
              </div>
            )}
          </div>
        )}

        {elegido != null && !isLoading && lista.length === 0 && (
          <div className="rounded-2xl bg-white/3 p-8 text-center text-mist-500 ring-1 ring-white/6">
            <p className="text-[13.5px]">No hay {etiquetaPapel.toLowerCase()}s disponibles en TMDb para este título.</p>
            <p className="mt-1 text-[12px] text-mist-600">Puedes subir tu propio archivo con el botón «Subir imagen» superior.</p>
          </div>
        )}
      </div>

      {/* Barra de acción flotante (dock inferior) cuando hay candidata elegida */}
      {previa && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 w-full max-w-xl -translate-x-1/2 px-4">
          <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-full bg-ink-900/95 p-2 pl-3 shadow-[0_20px_45px_-8px_rgba(0,0,0,0.9),0_0_24px_rgba(240,165,74,0.25)] ring-1 ring-white/15 backdrop-blur-2xl">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-accent">
                <img src={grande(previa)} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-mist-100">
                  Aplicar como {etiquetaPapel.toLowerCase()}
                </div>
                <div className="text-[11px] text-mist-500">
                  {previa.ancho > 0 ? `${previa.ancho}×${previa.alto} px` : 'Resolución nativa'}
                  {previa.idioma ? ` · ${previa.idioma.toUpperCase()}` : ' · Sin texto'}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPrevia(null)}
                className="rounded-full px-3 py-1.5 text-[12px] font-medium text-mist-400 hover:text-mist-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => poner.mutate(previa.url)}
                disabled={ocupado}
                className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-accent to-accent-soft px-4 py-2 text-[12.5px] font-bold text-ink-950 shadow-[0_4px_16px_rgba(240,165,74,0.5)] transition hover:brightness-110 disabled:opacity-40"
              >
                {poner.isPending ? 'Guardando…' : 'Confirmar cambio'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Secciones secundarias plegadas con estilo limpio */}
      <div className="space-y-3 pt-4">
        <details className="group rounded-2xl bg-white/3 p-4 ring-1 ring-white/6 transition-colors open:bg-white/4">
          <summary className="flex cursor-pointer items-center justify-between text-[12.5px] font-medium text-mist-400 hover:text-mist-200">
            <span className="flex items-center gap-2">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-mist-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" strokeLinecap="round" />
              </svg>
              ¿No coincide la película en TMDb? Buscar con otro término o ID
            </span>
            <span className="text-mist-600 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="mt-3.5 space-y-3 pt-2">
            <div className="flex gap-2">
              <input
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && busqueda.mutate()}
                placeholder="Título o ID de TMDb…"
                className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/30 px-3.5 py-2 text-[13px] text-mist-100 outline-none transition-colors focus:border-accent/40"
              />
              <button
                type="button"
                onClick={() => busqueda.mutate()}
                disabled={busqueda.isPending}
                className="shrink-0 rounded-full bg-white/10 px-4 py-2 text-[12.5px] font-medium text-mist-200 hover:bg-white/16 disabled:opacity-40"
              >
                {busqueda.isPending ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
            {busqueda.data && busqueda.data.results.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {busqueda.data.results.slice(0, 8).map((r) => (
                  <button
                    key={r.tmdbId}
                    type="button"
                    onClick={() => setElegido(r.tmdbId)}
                    className={`rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors ${
                      elegido === r.tmdbId
                        ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40'
                        : 'bg-white/6 text-mist-300 hover:bg-white/12'
                    }`}
                  >
                    {r.title} {r.year ? `(${r.year})` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        </details>

        {buzon && buzon.imagenes.length > 0 && (
          <details className="group rounded-2xl bg-white/3 p-4 ring-1 ring-white/6 transition-colors open:bg-white/4">
            <summary className="flex cursor-pointer items-center justify-between text-[12.5px] font-medium text-mist-400 hover:text-mist-200">
              <span className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-mist-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M2 4h12v9H2z" strokeLinecap="round" /><path d="M2 7l6 4 6-4" strokeLinecap="round" />
                </svg>
                Imágenes locales en el buzón ({buzon.imagenes.length} archivos en <code className="text-mist-500 font-mono text-[11px]">{buzon.carpeta}</code>)
              </span>
              <span className="text-mist-600 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="mt-3.5 grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4 lg:grid-cols-6">
              {buzon.imagenes.map((i) => (
                <button
                  key={i.nombre}
                  type="button"
                  onClick={() => delBuzon.mutate(i.nombre)}
                  disabled={ocupado}
                  title={`${i.nombre} (${Math.round(i.bytes / 1024)} kB) — Asignar como ${etiquetaPapel.toLowerCase()}`}
                  className={`group relative overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/10 transition-all hover:scale-105 hover:ring-accent ${forma}`}
                >
                  <img src={`/api/enrich/arte/buzon/${encodeURIComponent(i.nombre)}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/80 px-2 py-1 text-[10px] text-mist-200">
                    {i.nombre}
                  </span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
