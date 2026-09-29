import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ImagenDisponible, type PapelArte } from '../lib/api.ts';

/*
 * Elegir la carátula, el fondo y el logotipo a mano.
 *
 * Antes solo se ofrecía la imagen que TMDb marca por defecto, una por papel y
 * sin alternativa. Una película tiene treinta carteles y el que gusta depende
 * de quién mire: esto es lo que hace Plex y lo que aquí faltaba.
 *
 * Lo que se elige **no se escribe en la carpeta de la película**. Las carpetas
 * de la biblioteca son del usuario y están cuidadas; la imagen se guarda aparte,
 * en los datos de TvWatch, y queda marcada para que el escáner no la pise en la
 * siguiente pasada. Sin esa marca, cambiar una carátula duraba hasta el próximo
 * escaneo —cada 24 h y además al arrancar— que es justo lo que pasaba con
 * «Magnolia».
 */

const PAPELES: { clave: PapelArte; etiqueta: string; proporcion: string }[] = [
  { clave: 'poster', etiqueta: 'Carátula', proporcion: 'aspect-2/3' },
  { clave: 'fanart', etiqueta: 'Fondo', proporcion: 'aspect-video' },
  { clave: 'clearlogo', etiqueta: 'Logotipo', proporcion: 'aspect-video' },
  { clave: 'landscape', etiqueta: 'Apaisada', proporcion: 'aspect-video' },
];

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

  /*
   * `useState(tmdbId)` solo lee el valor inicial una vez. Este componente se
   * monta desde «Corregir metadatos» antes de que termine la búsqueda en
   * TMDb, así que `tmdbId` llega en `null` en el primer render y el selector
   * se quedaba sin imágenes para siempre aunque la búsqueda encontrara la
   * película: había que teclear el título otra vez a mano en este mismo
   * cuadro para que apareciera algo. Al llegar el id de verdad, se adopta.
   */
  useEffect(() => {
    if (tmdbId != null) setElegido(tmdbId);
  }, [tmdbId]);

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

  const poner = useMutation({
    mutationFn: (url: string | null) => api.ponerArte(itemId, papel, url),
    onSuccess: () => {
      setAviso(
        papel === 'poster' ? 'Carátula cambiada.' : papel === 'fanart' ? 'Fondo cambiado.' : 'Logotipo cambiado.',
      );
      /*
       * El fichero en disco se llama siempre igual (`poster.jpg`…), así que la
       * URL con la que se pide la imagen no cambia sola: sin la marca
       * `arte_actualizado` que ahora trae la ficha, el navegador seguía
       * enseñando la vieja de su propia caché. Antes esto se «arreglaba» con
       * una recarga completa de la página (`location.reload()`), que además de
       * innecesaria cerraba este mismo cuadro de golpe. Con la marca en la
       * URL, invalidar basta: React vuelve a pedir la ficha y la imagen
       * cambia sola en cuanto llega el nuevo `arte_actualizado`.
       */
      queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      queryClient.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  /*
   * Dos caminos para una imagen que no está en TMDb, porque no se usan igual:
   * subirla desde este ordenador, y coger una de las que haya en el buzón
   * (`data/arte-entrada`), que es el único camino que también sirve desde la
   * tele, donde no se puede navegar el disco con un mando.
   */
  const refrescarFicha = () => {
    queryClient.invalidateQueries({ queryKey: ['item', itemId] });
    queryClient.invalidateQueries({ queryKey: ['home'] });
  };

  const subir = useMutation({
    mutationFn: (fichero: File) => api.subirArte(itemId, papel, fichero),
    onSuccess: () => {
      setAviso('Imagen subida y puesta.');
      refrescarFicha();
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const { data: buzon } = useQuery({ queryKey: ['buzon-arte'], queryFn: () => api.buzonArte(), retry: false });

  const delBuzon = useMutation({
    mutationFn: (nombre: string) => api.ponerArteDelBuzon(itemId, papel, nombre),
    onSuccess: () => {
      setAviso('Imagen del buzón puesta.');
      refrescarFicha();
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const lista: ImagenDisponible[] = imagenes?.[papel] ?? [];
  const forma = PAPELES.find((p) => p.clave === papel)!.proporcion;

  return (
    <div className="mt-6 border-t border-white/10 pt-5">
      <h3 className="mb-1 text-[14px] font-semibold text-mist-200">Imágenes</h3>
      <p className="mb-4 text-[12px] text-mist-500">
        Elige la que quieras. Se guarda aparte y el escáner ya no la pisa; para volver a la de la carpeta, usa
        «Quitar la elegida».
      </p>

      {/* Por si el título que TMDb ha adivinado no es el que toca. */}
      <div className="mb-4 flex gap-2">
        <input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && busqueda.mutate()}
          placeholder="¿No es esta película? Búscala por su título"
          className="min-w-0 flex-1 rounded-xl bg-white/6 px-3 py-2 text-[13px] outline-none ring-1 ring-white/10 focus:ring-white/25"
        />
        <button
          onClick={() => busqueda.mutate()}
          disabled={busqueda.isPending}
          className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-[12.5px] hover:bg-white/18 disabled:opacity-40"
        >
          Buscar
        </button>
      </div>

      {busqueda.data && busqueda.data.results.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {busqueda.data.results.slice(0, 6).map((r) => (
            <button
              key={r.tmdbId}
              onClick={() => setElegido(r.tmdbId)}
              className={`rounded-full px-3 py-1.5 text-[12px] ${
                elegido === r.tmdbId ? 'bg-accent/25 text-accent-soft ring-1 ring-accent/40' : 'bg-white/8 hover:bg-white/14'
              }`}
            >
              {r.title} {r.year ? `(${r.year})` : ''}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex gap-1.5">
        {PAPELES.map((p) => (
          <button
            key={p.clave}
            onClick={() => setPapel(p.clave)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] ${
              papel === p.clave ? 'bg-mist-100 font-medium text-ink-950' : 'bg-white/6 text-mist-300 hover:bg-white/12'
            }`}
          >
            {p.etiqueta}
            {imagenes?.[p.clave] ? <span className="ml-1.5 opacity-60">{imagenes[p.clave].length}</span> : null}
          </button>
        ))}
      </div>

      {elegido == null && <p className="text-[13px] text-mist-500">Busca primero la película para ver sus imágenes.</p>}
      {isLoading && <p className="text-[13px] text-mist-500">Pidiendo las imágenes a TMDb…</p>}

      {lista.length > 0 && (
        <div
          className={`grid gap-2.5 ${papel === 'poster' ? 'grid-cols-[repeat(auto-fill,minmax(96px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(170px,1fr))]'}`}
        >
          {lista.slice(0, 40).map((img) => (
            <button
              key={img.url}
              onClick={() => poner.mutate(img.url)}
              disabled={poner.isPending}
              title={`${img.ancho}×${img.alto}${img.idioma ? ` · ${img.idioma}` : ' · sin texto'}`}
              className={`group relative overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10 transition-all hover:ring-white/40 disabled:opacity-50 ${forma}`}
            >
              <img src={img.vista} alt="" loading="lazy" className="h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-[9.5px] text-mist-300 opacity-0 transition-opacity group-hover:opacity-100">
                {img.ancho}×{img.alto} {img.idioma || 'sin texto'}
              </span>
            </button>
          ))}
        </div>
      )}

      {elegido != null && !isLoading && lista.length === 0 && (
        <p className="text-[13px] text-mist-500">TMDb no tiene ninguna imagen de este tipo para este título.</p>
      )}

      <div className="mt-5 border-t border-white/10 pt-4">
        <h4 className="mb-2 text-[13px] font-semibold text-mist-200">Una imagen mía</h4>
        <p className="mb-3 text-[12px] text-mist-500">
          Se guarda igual que las de TMDb: aparte de la carpeta de la película y sin que el escáner la pise. Vale
          JPEG, PNG y WebP, hasta 20 MB; el tipo se comprueba por el contenido del fichero.
        </p>

        <label className="inline-flex cursor-pointer items-center rounded-full bg-white/10 px-3.5 py-1.5 text-[12.5px] hover:bg-white/18">
          {subir.isPending ? 'Subiendo…' : `Subir imagen para «${PAPELES.find((p) => p.clave === papel)!.etiqueta}»`}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={subir.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Se limpia el input: si no, elegir el MISMO fichero otra vez (por
              // ejemplo tras recortarlo) no dispara `change` y parece que no va.
              e.target.value = '';
              if (f) subir.mutate(f);
            }}
          />
        </label>

        {buzon && buzon.imagenes.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[12px] text-mist-500">
              O una de las {buzon.imagenes.length} que hay en el buzón
              (<code className="text-mist-400">{buzon.carpeta}</code>), donde puedes dejarlas desde el propio HTPC:
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2.5">
              {buzon.imagenes.map((img) => (
                <button
                  key={img.nombre}
                  onClick={() => delBuzon.mutate(img.nombre)}
                  disabled={delBuzon.isPending}
                  title={`${img.nombre} · ${Math.round(img.bytes / 1024)} kB`}
                  className={`group relative overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10 hover:ring-white/40 disabled:opacity-50 ${forma}`}
                >
                  <img
                    src={`/api/enrich/arte/buzon/${encodeURIComponent(img.nombre)}`}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[9.5px] text-mist-300">
                    {img.nombre}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => poner.mutate(null)}
          disabled={poner.isPending}
          className="rounded-full bg-white/8 px-3 py-1.5 text-[12px] text-mist-300 hover:bg-white/14 disabled:opacity-40"
        >
          Quitar la elegida
        </button>
        {aviso && <span className="text-[12px] text-mist-400">{aviso}</span>}
      </div>
    </div>
  );
}
