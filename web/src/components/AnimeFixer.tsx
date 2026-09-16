/**
 * Identificar un título como anime.
 *
 * TMDb se equivoca con anime más que con nada: confunde la serie con sus
 * películas y con los remakes. Aquí se consulta a Kitsu, MyAnimeList y AniList,
 * y cada aspirante llega con la razón por la que se propone —«los 243 episodios
 * cuadran»— para poder juzgarlo sin fiarse del orden.
 *
 * Como en el resto del scraper, no se guarda nada hasta confirmar, y solo los
 * campos marcados.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type PropuestaAnime } from '../lib/api.ts';

const CONFIANZA: Record<string, { texto: string; clase: string }> = {
  exact: { texto: 'Coincidencia clara', clase: 'bg-accent/18 text-accent' },
  strong: { texto: 'Probable', clase: 'bg-white/12 text-mist-200' },
  weak: { texto: 'Dudosa', clase: 'bg-amber-400/15 text-amber-400' },
};

const CAMPOS: [string, string][] = [
  ['poster', 'Portada'],
  ['fanart', 'Fondo'],
  ['plot', 'Sinopsis'],
  ['rating', 'Valoración'],
  ['genres', 'Géneros'],
];

const FUENTES: Record<string, string> = { kitsu: 'Kitsu', mal: 'MyAnimeList', anilist: 'AniList' };

function Ficha({ p, elegido, onElegir, porque }: { p: PropuestaAnime; elegido: boolean; onElegir: () => void; porque?: string }) {
  return (
    <button
      onClick={onElegir}
      className={`flex w-full gap-3 rounded-xl p-2 text-left transition-colors ${elegido ? 'bg-white/14' : 'hover:bg-white/8'}`}
    >
      <div className="h-[86px] w-[60px] shrink-0 overflow-hidden rounded-lg bg-ink-800">
        {p.portadaUrl && <img src={p.portadaUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium">{p.titulo}</div>
        {p.tituloOriginal && p.tituloOriginal !== p.titulo && (
          <div className="truncate text-[12px] text-mist-600">{p.tituloOriginal}</div>
        )}
        <div className="mt-0.5 text-[12px] text-mist-500">
          {[p.anio, p.formato, p.episodios ? `${p.episodios} episodios` : null, p.nota ? `★ ${p.nota}` : null].filter(Boolean).join(' · ')}
        </div>
        <div className="mt-0.5 text-[11.5px] text-mist-600">
          {FUENTES[p.fuente]}
          {porque ? ` · ${porque}` : ''}
        </div>
      </div>
    </button>
  );
}

export default function AnimeFixer({ itemId, onClose }: { itemId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [elegido, setElegido] = useState<PropuestaAnime | null>(null);
  const [campos, setCampos] = useState<string[]>(['poster', 'plot', 'rating', 'genres']);
  const [sobrescribir, setSobrescribir] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [hecho, setHecho] = useState<string | null>(null);

  const candidato = useQuery({
    queryKey: ['anime', itemId],
    queryFn: async () => {
      const c = await api.animeItem(itemId);
      setElegido(c.propuesta);
      setBusqueda(c.titulo);
      return c;
    },
    retry: false,
  });

  const buscar = useMutation({ mutationFn: () => api.animeSearch(busqueda, null) });

  const aplicar = useMutation({
    mutationFn: () => api.animeApply({ itemId, animeId: (elegido as PropuestaAnime).id, campos, overwrite: sobrescribir }),
    onSuccess: (r) => {
      setHecho(r.aplicado.length > 0 ? `Guardado desde ${FUENTES[r.fuente] ?? r.fuente}: ${r.aplicado.join(', ')}` : 'No había nada que rellenar');
      queryClient.invalidateQueries({ queryKey: ['item', itemId] });
      queryClient.invalidateQueries({ queryKey: ['home'] });
    },
  });

  const c = candidato.data;
  const error = (candidato.error ?? buscar.error ?? aplicar.error) as Error | null;
  const resultados = buscar.data?.results ?? [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-90 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onClick={(ev) => ev.stopPropagation()}
        className="glass-strong max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-panel)] p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Identificar como anime</h2>
            <p className="mt-1 text-[12.5px] text-mist-500">
              Busca en bases de datos de anime, que distinguen la serie de sus películas y sus remakes. Comprueba la propuesta antes de guardar.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-[12px] hover:bg-white/14">
            Cerrar
          </button>
        </div>

        {candidato.isLoading && <p className="text-[13px] text-mist-500">Consultando bases de datos de anime…</p>}
        {error && <p className="mb-3 text-[13px] text-red-400">{error.message}</p>}

        {c && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className={`rounded-full px-2.5 py-1 ${CONFIANZA[c.confianza].clase}`}>{CONFIANZA[c.confianza].texto}</span>
              <span className="text-mist-500">{c.coincidePor}</span>
              {c.episodiosEnDisco > 0 && <span className="text-mist-600">· {c.episodiosEnDisco} episodios en disco</span>}
            </div>

            {c.propuesta && (
              <Ficha p={c.propuesta} elegido={elegido?.id === c.propuesta.id} onElegir={() => setElegido(c.propuesta)} />
            )}

            {c.alternativas.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[12px] text-mist-600">Otras posibilidades</div>
                <div className="space-y-1">
                  {c.alternativas.map((a) => (
                    <Ficha
                      key={a.propuesta.id}
                      p={a.propuesta}
                      porque={a.porque}
                      elegido={elegido?.id === a.propuesta.id}
                      onElegir={() => setElegido(a.propuesta)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <input
                value={busqueda}
                onChange={(ev) => setBusqueda(ev.target.value)}
                onKeyDown={(ev) => ev.key === 'Enter' && buscar.mutate()}
                placeholder="Buscar con otro nombre"
                className="flex-1 rounded-lg bg-white/8 px-3 py-2 text-[13px] outline-none focus:bg-white/12"
              />
              <button
                onClick={() => buscar.mutate()}
                disabled={buscar.isPending}
                className="rounded-lg bg-white/12 px-4 text-[13px] hover:bg-white/20 disabled:opacity-40"
              >
                {buscar.isPending ? '…' : 'Buscar'}
              </button>
            </div>

            {resultados.length > 0 && (
              <div className="mt-2 space-y-1">
                {resultados.map((p) => (
                  <Ficha key={p.id} p={p} elegido={elegido?.id === p.id} onElegir={() => setElegido(p)} />
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-white/8 pt-3">
              <div className="mb-2 text-[12px] text-mist-600">Qué guardar</div>
              <div className="flex flex-wrap gap-1.5">
                {CAMPOS.map(([clave, texto]) => (
                  <button
                    key={clave}
                    onClick={() => setCampos((v) => (v.includes(clave) ? v.filter((x) => x !== clave) : [...v, clave]))}
                    className={`rounded-full px-3 py-1.5 text-[12.5px] transition-colors ${
                      campos.includes(clave) ? 'bg-mist-100 font-medium text-ink-950' : 'bg-white/8 hover:bg-white/14'
                    }`}
                  >
                    {texto}
                  </button>
                ))}
              </div>

              <label className="mt-3 flex items-center gap-2 text-[12.5px] text-mist-400">
                <input type="checkbox" checked={sobrescribir} onChange={(ev) => setSobrescribir(ev.target.checked)} />
                Sustituir también lo que ya hay (si no, solo se rellenan los huecos)
              </label>

              {hecho && <p className="mt-3 text-[13px] text-accent">{hecho}</p>}

              <button
                onClick={() => aplicar.mutate()}
                disabled={!elegido || campos.length === 0 || aplicar.isPending}
                className="mt-3 rounded-full bg-mist-100 px-5 py-2 text-[13px] font-semibold text-ink-950 transition-transform hover:scale-105 disabled:opacity-40"
              >
                {aplicar.isPending ? 'Guardando…' : elegido ? `Guardar «${elegido.titulo}»` : 'Elige una ficha'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
