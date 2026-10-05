import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PosterCard from '../components/PosterCard.tsx';
import { api, img, type CollectionSummary, type ImagenDisponible, type ItemSummary } from '../lib/api.ts';

function CollectionCard({ collection, index }: { collection: CollectionSummary; index: number }) {
  const years = collection.first_year
    ? collection.last_year && collection.last_year !== collection.first_year
      ? `${collection.first_year}–${collection.last_year}`
      : String(collection.first_year)
    : '';

  const v = collection.arte_actualizado ? `&t=${new Date(collection.arte_actualizado).getTime()}` : '';
  const fondoSrc = collection.fondo_propio
    ? `${api.fondoSaga(collection.name, 640)}${v}`
    : collection.fanart_id
      ? img.fanart(collection.fanart_id, 640)
      : null;

  const posterSrc = collection.imagen_propia
    ? `${api.imagenSaga(collection.name, 200)}${v}`
    : collection.poster_id
      ? img.poster(collection.poster_id, 200)
      : null;

  return (
    <Link
      to={`/saga/${encodeURIComponent(collection.name)}`}
      className="group fade-up block"
      style={{ ['--i' as string]: index }}
    >
      <div className="relative aspect-16/9 overflow-hidden rounded-[var(--radius-card)] bg-ink-800 shadow-[var(--shadow-2)] ring-1 ring-white/8 transition-transform duration-[420ms] ease-[cubic-bezier(0.34,1.4,0.64,1)] will-change-transform group-hover:-translate-y-1 group-hover:scale-[1.02] group-hover:ring-white/20">
        {fondoSrc && (
          <img src={fondoSrc} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
        <div className="scrim-b absolute inset-0" />

        {posterSrc && (
          <img
            src={posterSrc}
            alt=""
            loading="lazy"
            className="absolute bottom-3 left-3 h-20 w-auto rounded-md shadow-[var(--shadow-2)] ring-1 ring-white/20"
          />
        )}

        <div className="absolute right-3 bottom-3 left-28 text-right">
          <div className="truncate text-[13px] font-semibold text-shadow-hero">{collection.name}</div>
          <div className="text-[11px] text-mist-300">
            {collection.count} títulos{years && ` · ${years}`}
          </div>
          {collection.seen ? (
            <div className="mt-1 text-[11px] text-accent">
              {collection.seen} de {collection.count} vistas
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export function CollectionsIndex() {
  const { data, isLoading } = useQuery({ queryKey: ['collections'], queryFn: api.collections });

  return (
    <div className="mx-auto max-w-[1800px] px-4 pt-24 pb-24 sm:px-8">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sagas</h1>
      <p className="mb-8 text-sm text-mist-500">
        {data ? `${data.length} colecciones con más de un título` : 'Cargando…'}
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {data?.map((collection, i) => (
          <div key={collection.name} className="cull">
            <CollectionCard collection={collection} index={i} />
          </div>
        ))}
        {isLoading && Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton aspect-16/9 rounded-[var(--radius-card)]" />)}
      </div>
    </div>
  );
}

function SelectorDeArteSaga({
  name,
  items,
  onClose,
}: {
  name: string;
  items?: ItemSummary[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [papel, setPapel] = useState<'poster' | 'fanart'>('poster');
  const [aviso, setAviso] = useState('');
  const [terminoBusqueda, setTerminoBusqueda] = useState('');
  const [consultaActual, setConsultaActual] = useState(name);

  const { data: tmdbData, isLoading: loadingTmdb } = useQuery({
    queryKey: ['saga-imagenes', name, consultaActual],
    queryFn: () => api.collectionImagenes(name, consultaActual !== name ? consultaActual : undefined),
    retry: false,
  });

  const { data: buzon } = useQuery({
    queryKey: ['buzon-arte'],
    queryFn: () => api.buzonArte(),
    retry: false,
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['collection', name] });
    queryClient.invalidateQueries({ queryKey: ['collections'] });
  };

  const poner = useMutation({
    mutationFn: (body: { itemId?: number | null; buzon?: string; url?: string; papel?: 'poster' | 'fanart' }) =>
      api.ponerArteSaga(name, { ...body, papel }),
    onSuccess: () => {
      setAviso(papel === 'poster' ? 'Carátula de saga actualizada.' : 'Fondo de saga actualizado.');
      refrescar();
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const subir = useMutation({
    mutationFn: (fichero: File) => api.subirArteSaga(name, papel, fichero),
    onSuccess: () => {
      setAviso('Imagen subida y aplicada a la saga.');
      refrescar();
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const tmdbLista: ImagenDisponible[] = (papel === 'poster' ? tmdbData?.posters : tmdbData?.fanarts) ?? [];
  const forma = papel === 'poster' ? 'aspect-2/3' : 'aspect-video';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-strong max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-panel)] p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Carátulas y fondos específicos de la saga</h2>
            <p className="mt-1 text-[12.5px] text-mist-400">
              «{name}»: carátulas y fondos oficiales diseñados específicamente para la saga o colección en TMDb.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full bg-white/8 px-3.5 py-1.5 text-[12px] font-medium hover:bg-white/14"
          >
            Cerrar
          </button>
        </div>

        {aviso && (
          <div className="mb-4 rounded-lg bg-accent/20 px-3.5 py-2 text-[12.5px] text-accent">
            {aviso}
          </div>
        )}

        {/* Pestañas: Carátula vs Fondo */}
        <div className="mb-4 flex gap-2 border-b border-white/10 pb-4">
          <button
            onClick={() => setPapel('poster')}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              papel === 'poster'
                ? 'bg-mist-100 text-ink-950 shadow-sm'
                : 'bg-white/6 text-mist-300 hover:bg-white/12'
            }`}
          >
            Carátulas de la saga {tmdbData?.posters?.length ? `(${tmdbData.posters.length})` : ''}
          </button>
          <button
            onClick={() => setPapel('fanart')}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              papel === 'fanart'
                ? 'bg-mist-100 text-ink-950 shadow-sm'
                : 'bg-white/6 text-mist-300 hover:bg-white/12'
            }`}
          >
            Fondos de la saga {tmdbData?.fanarts?.length ? `(${tmdbData.fanarts.length})` : ''}
          </button>
        </div>

        {/* Buscador alternativo por si el nombre de la saga difiere en TMDb */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (terminoBusqueda.trim()) setConsultaActual(terminoBusqueda.trim());
          }}
          className="mb-5 flex gap-2"
        >
          <input
            type="text"
            value={terminoBusqueda}
            onChange={(e) => setTerminoBusqueda(e.target.value)}
            placeholder={`Buscar otra saga en TMDb (actual: ${consultaActual})…`}
            className="flex-1 rounded-full bg-white/6 px-4 py-2 text-[12.5px] text-white placeholder-mist-500 ring-1 border border-white/10 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-full bg-white/10 px-4 py-2 text-[12.5px] font-medium hover:bg-white/18"
          >
            Buscar en TMDb
          </button>
          {consultaActual !== name && (
            <button
              type="button"
              onClick={() => {
                setConsultaActual(name);
                setTerminoBusqueda('');
              }}
              className="rounded-full bg-white/6 px-3 py-2 text-[12.5px] text-mist-400 hover:bg-white/12"
            >
              Restablecer
            </button>
          )}
        </form>

        {/* 1. Imágenes específicas de la colección en TMDb */}
        <div className="mb-6">
          <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">
            {papel === 'poster' ? 'Carátulas de colección en TMDb' : 'Fondos de colección en TMDb'}
          </h3>
          <p className="mb-3 text-[12px] text-mist-500">
            {loadingTmdb
              ? 'Consultando imágenes oficiales de la saga en TMDb…'
              : tmdbLista.length > 0
                ? 'Toca la imagen específica de la saga que prefieras para aplicarla:'
                : `No se encontraron imágenes para «${consultaActual}» en TMDb. Prueba con el buscador de arriba.`}
          </p>

          {tmdbLista.length > 0 && (
            <div
              className={`grid gap-2.5 ${
                papel === 'poster'
                  ? 'grid-cols-[repeat(auto-fill,minmax(115px,1fr))]'
                  : 'grid-cols-[repeat(auto-fill,minmax(180px,1fr))]'
              }`}
            >
              {tmdbLista.slice(0, 40).map((imgObj) => (
                <button
                  key={imgObj.url}
                  onClick={() => poner.mutate({ url: imgObj.url })}
                  disabled={poner.isPending}
                  title={`${imgObj.ancho}×${imgObj.alto}${imgObj.idioma ? ` · ${imgObj.idioma}` : ''}`}
                  className={`group relative overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10 transition-all hover:ring-white/40 disabled:opacity-50 ${forma}`}
                >
                  <img src={imgObj.vista} alt="" loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/75 px-1.5 py-0.5 text-[10px] text-mist-300 opacity-0 transition-opacity group-hover:opacity-100">
                    {imgObj.ancho}×{imgObj.alto} {imgObj.idioma}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2. Elegir de una de las películas que componen la saga */}
        {items && items.length > 0 && (
          <div className="mb-6 border-t border-white/10 pt-4">
            <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">
              {papel === 'poster' ? 'Películas de la saga' : 'Fondos de las películas de la saga'}
            </h3>
            <p className="mb-3 text-[12px] text-mist-500">
              Toca cualquiera de las {items.length} películas para usar su {papel === 'poster' ? 'carátula' : 'fondo'}:
            </p>
            <div
              className={`grid gap-2.5 max-h-60 overflow-y-auto pr-1 ${
                papel === 'poster'
                  ? 'grid-cols-[repeat(auto-fill,minmax(105px,1fr))]'
                  : 'grid-cols-[repeat(auto-fill,minmax(160px,1fr))]'
              }`}
            >
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => poner.mutate({ itemId: it.id })}
                  disabled={poner.isPending}
                  title={`${it.title} (${it.year ?? '?'})`}
                  className={`group relative overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10 transition-all hover:ring-white/40 disabled:opacity-50 ${forma}`}
                >
                  <img
                    src={papel === 'poster' ? img.poster(it.id, 200) : img.fanart(it.id, 400)}
                    alt={it.title}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/75 px-1.5 py-0.5 text-[10px] text-mist-300">
                    {it.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 3. Subir archivo propio o elegir del buzón */}
        <div className="border-t border-white/10 pt-4">
          <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">Subir imagen o usar buzón</h3>
          <p className="mb-3 text-[12px] text-mist-500">
            Admite archivos JPEG, PNG o WebP de hasta 20 MB.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center rounded-full bg-white/10 px-4 py-2 text-[12.5px] font-medium transition-colors hover:bg-white/18">
              {subir.isPending ? 'Subiendo…' : `Subir archivo para «${papel === 'poster' ? 'Carátula' : 'Fondo'}»`}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={subir.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) subir.mutate(f);
                }}
              />
            </label>

            <button
              onClick={() => poner.mutate({ itemId: null })}
              disabled={poner.isPending}
              className="rounded-full bg-white/6 px-4 py-2 text-[12.5px] text-mist-400 transition-colors hover:bg-white/12 disabled:opacity-40"
            >
              Restaurar automática
            </button>

            {aviso && <span className="text-[12.5px] text-accent">{aviso}</span>}
          </div>

          {buzon && buzon.imagenes.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[12px] text-mist-500">
                O desde el buzón (<code className="text-mist-400">{buzon.carpeta}</code>):
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
                {buzon.imagenes.map((bImg) => (
                  <button
                    key={bImg.nombre}
                    onClick={() => poner.mutate({ buzon: bImg.nombre })}
                    disabled={poner.isPending}
                    className={`group relative overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10 hover:ring-white/40 ${forma}`}
                  >
                    <img
                      src={`/api/enrich/arte/buzon/${encodeURIComponent(bImg.nombre)}`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/75 px-1 py-0.5 text-[9.5px] text-mist-300">
                      {bImg.nombre}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CollectionDetail() {
  const { name } = useParams<{ name: string }>();
  const [modalArte, setModalArte] = useState(false);

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });
  const { data } = useQuery({
    queryKey: ['collection', name],
    queryFn: () => api.collection(name!),
    enabled: !!name,
  });

  const tParam = data?.actualizado ? `&t=${new Date(data.actualizado).getTime()}` : '';

  const fanartSrc = data?.arteFondo
    ? `${api.fondoSaga(name!, 1920)}${tParam}`
    : data?.fanart_id
      ? img.fanart(data.fanart_id, 1920)
      : null;

  const posterSrc = data?.arteImagen
    ? `${api.imagenSaga(name!, 300)}${tParam}`
    : data?.poster_id
      ? img.poster(data.poster_id, 300)
      : null;

  return (
    <div>
      {/* Cabecera cinematográfica */}
      <div className="relative mb-8 min-h-[340px] w-full overflow-hidden bg-ink-950 pt-24 pb-12 shadow-md">
        {fanartSrc && (
          <img
            src={fanartSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-35"
          />
        )}
        <div className="scrim-b absolute inset-0" />

        <div className="relative mx-auto flex max-w-[1800px] flex-col gap-6 px-4 sm:flex-row sm:items-end sm:px-8">
          {posterSrc && (
            <img
              src={posterSrc}
              alt=""
              className="h-52 w-auto shrink-0 rounded-[var(--radius-card)] shadow-2xl ring-1 ring-white/20"
            />
          )}

          <div className="flex-1">
            <Link
              to="/sagas"
              className="mb-2 inline-block text-[12.5px] text-mist-400 transition-colors hover:text-mist-100"
            >
              ← Todas las sagas
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-md sm:text-4xl">
              {data?.name ?? name}
            </h1>
            <p className="mt-2 text-sm text-mist-300">
              {data ? `${data.items.length} títulos en orden cronológico` : 'Cargando…'}
            </p>

            {me?.is_admin === 1 && (
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => setModalArte(true)}
                  className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-medium text-white transition-all hover:bg-white/16 active:scale-95"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                  </svg>
                  Cambiar carátula / fondo
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lista de películas */}
      <div className="mx-auto max-w-[1800px] px-4 pb-24 sm:px-8">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
          {data?.items.map((item, i) => (
            <div key={item.id} className="cull">
              <PosterCard item={item} index={i} />
            </div>
          ))}
        </div>
      </div>

      {/* Modal para cambiar carátula / fondo */}
      {modalArte && data && (
        <SelectorDeArteSaga
          name={data.name}
          items={data.items}
          onClose={() => setModalArte(false)}
        />
      )}
    </div>
  );
}
