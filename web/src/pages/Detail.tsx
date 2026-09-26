import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { AnimatePresence } from 'motion/react';
import { CandidateRow } from '../components/MetadataReview.tsx';
import AnimeFixer from '../components/AnimeFixer.tsx';
import NumeracionFixer from '../components/NumeracionFixer.tsx';
import SelectorDeArte from '../components/SelectorDeArte.tsx';
import Row from '../components/Row.tsx';
import { api, img, type Episode, type ItemDetail } from '../lib/api.ts';
import { audioLabel, certification, clock, codecLabel, fileSize, languageName, resolutionLabel, runtime } from '../lib/format.ts';
import { usePreferences } from '../lib/preferences.tsx';
import { tintFrom } from '../lib/tint.ts';

function MetadataFixer({ itemId, item, onClose }: { itemId: number; item: ItemDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['enrich-item', itemId], queryFn: () => api.enrichItem(itemId), retry: false });

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
        onClick={(e) => e.stopPropagation()}
        className="glass-strong max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-panel)] p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Corregir metadatos</h2>
            <p className="mt-1 text-[12.5px] text-mist-500">
              Comprueba que la película propuesta es la correcta antes de guardar. Solo se sustituye lo que marques.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-[12px] hover:bg-white/14">
            Cerrar
          </button>
        </div>

        {isLoading && <p className="text-[13px] text-mist-500">Buscando en TMDb…</p>}
        {error && <p className="text-[13px] text-red-400">{(error as Error).message}</p>}
        {data && (
          <CandidateRow
            candidate={data}
            overwriteMode
            onDone={() => {
              queryClient.invalidateQueries({ queryKey: ['item', itemId] });
              queryClient.invalidateQueries({ queryKey: ['home'] });
              onClose();
            }}
          />
        )}

        <SelectorDeArte
          itemId={itemId}
          kind={item.kind === 'show' ? 'show' : 'movie'}
          titulo={item.title}
          anio={item.year ?? null}
          // La propuesta recién buscada manda; si aún no ha llegado (o no
          // encontró nada), se usa el id que ya tenía guardado el título —
          // así las imágenes aparecen sin depender de que la corrección de
          // metadatos encuentre nada nuevo.
          tmdbId={data?.proposal?.tmdbId ?? (item.tmdb_id ? Number(item.tmdb_id) : null)}
        />
      </motion.div>
    </motion.div>
  );
}

function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'accent' }) {
  return (
    <span
      className={`rounded-md px-2 py-1 text-[11px] font-medium tracking-wide ${
        tone === 'accent' ? 'bg-accent/18 text-accent-soft ring-1 ring-accent/30' : 'bg-white/8 text-mist-300 ring-1 ring-white/10'
      }`}
    >
      {children}
    </span>
  );
}

function PlayIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function EpisodeList({ item, seasons }: { item: ItemDetail; seasons: Map<number, Episode[]> }) {
  const navigate = useNavigate();
  const numbers = [...seasons.keys()].sort((a, b) => a - b);
  const [season, setSeason] = useState(() => item.nextUp?.season ?? numbers[0] ?? 1);
  const episodes = seasons.get(season) ?? [];
  const progressFor = (id: number) => item.progress.find((p) => p.episode_id === id);

  return (
    <div className="mt-12">
      <div className="no-scrollbar mb-5 flex gap-1.5 overflow-x-auto">
        {numbers.map((n) => (
          <button
            key={n}
            onClick={() => setSeason(n)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] transition-all duration-200 ${
              n === season ? 'bg-mist-100 font-medium text-ink-950' : 'bg-white/6 text-mist-300 hover:bg-white/12'
            }`}
          >
            {n === 0 ? 'Especiales' : `Temporada ${n}`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {episodes.map((ep, i) => {
          const progress = progressFor(ep.id);
          const pct = progress?.duration ? (progress.position / progress.duration) * 100 : 0;
          return (
            <motion.button
              key={ep.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.3) }}
              disabled={!ep.file_id}
              onClick={() => navigate(`/ver/${ep.file_id}?item=${item.id}&ep=${ep.id}&t=${progress?.watched ? 0 : Math.floor(progress?.position ?? 0)}`)}
              className="group flex w-full gap-4 rounded-2xl p-2.5 text-left transition-colors duration-200 hover:bg-white/6 disabled:opacity-40"
            >
              <div className="relative aspect-16/9 w-40 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/8">
                {ep.has_thumb ? (
                  <img src={img.episode(ep.id, 320)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-mist-600">{ep.episode}</div>
                )}
                <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <PlayIcon size={20} />
                </div>
                {progress && progress.watched === 0 && pct > 1 && (
                  <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/60">
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 py-0.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-mist-500">{ep.episode}.</span>
                  <span className="truncate text-sm font-medium">{ep.title}</span>
                  {progress?.watched === 1 && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0 text-accent">
                      <path d="M4 12.5 9.5 18 20 6.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                {ep.plot && <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-mist-500">{ep.plot}</p>}
                <div className="mt-1.5 flex gap-2 text-[11px] text-mist-600">
                  {ep.runtime ? <span>{runtime(ep.runtime)}</span> : ep.duration ? <span>{clock(ep.duration)}</span> : null}
                  {ep.aired && <span>{new Date(ep.aired).getFullYear()}</span>}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const itemId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { prefs } = usePreferences();
  const [tint, setTint] = useState('40 40 60');
  const [fixing, setFixing] = useState(false);
  const [plotAbierta, setPlotAbierta] = useState(false);
  const [numerando, setNumerando] = useState(false);
  const [anime, setAnime] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [avisoDescarga, setAvisoDescarga] = useState<string | null>(null);

  const { data: item, isLoading } = useQuery({ queryKey: ['item', itemId], queryFn: () => api.item(itemId) });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [itemId]);

  useEffect(() => {
    if (item?.has_poster) tintFrom(img.poster(itemId, 200, item.arte_actualizado)).then(setTint);
  }, [item?.has_poster, item?.arte_actualizado, itemId]);

  /*
   * Las dos escriben en el servidor y luego refrescan **todo** lo que enseña ese
   * estado: la propia ficha, la lista de favoritos y la portada. Antes solo se
   * refrescaba una cosa, así que el botón guardaba de verdad pero en pantalla no
   * cambiaba nada y parecía roto.
   *
   * `onMutate` pinta el cambio antes de que conteste el servidor: en una acción
   * de un clic, esperar medio segundo a que se rellene el corazón ya se siente
   * como que no ha funcionado.
   */
  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ['item', itemId] });
    queryClient.invalidateQueries({ queryKey: ['favorites'] });
    queryClient.invalidateQueries({ queryKey: ['home'] });
  };

  const favorite = useMutation({
    mutationFn: (next: boolean) => api.favorite(itemId, next),
    onMutate: (next) => {
      queryClient.setQueryData(['item', itemId], (previo: ItemDetail | undefined) =>
        previo ? { ...previo, favorite: next ? 1 : 0 } : previo,
      );
    },
    onSettled: refrescar,
  });

  const watched = useMutation({
    mutationFn: (next: boolean) => api.setWatched(itemId, next),
    onMutate: (next) => {
      queryClient.setQueryData(['item', itemId], (previo: ItemDetail | undefined) => {
        if (!previo) return previo;
        const resto = previo.progress.filter((p) => p.episode_id !== null);
        return { ...previo, progress: [...resto, { episode_id: null, position: 0, duration: null, watched: next ? 1 : 0 }] };
      });
    },
    onSettled: refrescar,
  });

  const seasons = useMemo(() => {
    const map = new Map<number, Episode[]>();
    for (const ep of item?.episodes ?? []) {
      if (!map.has(ep.season)) map.set(ep.season, []);
      map.get(ep.season)!.push(ep);
    }
    return map;
  }, [item?.episodes]);

  if (isLoading || !item) {
    return (
      <div className="pt-24">
        <div className="skeleton mx-auto h-[52vh] max-w-[1800px] rounded-3xl" />
      </div>
    );
  }

  const movieFile = item.files.find((f) => !f.episode_id);
  const movieProgress = item.progress.find((p) => p.episode_id === null);
  const esFavorita = item.favorite === 1;
  const estaVista = movieProgress?.watched === 1;
  const resumeAt = prefs.playback.resume && movieProgress && !movieProgress.watched ? movieProgress.position : 0;
  const nextEp = item.nextUp;
  const nextEpFile = nextEp ? item.episodes?.find((e) => e.id === nextEp.id)?.file_id : null;

  const play = () => {
    if (item.kind === 'movie' && movieFile) {
      navigate(`/ver/${movieFile.id}?item=${item.id}&t=${Math.floor(resumeAt)}`);
    } else if (nextEpFile) {
      const p = item.progress.find((x) => x.episode_id === nextEp!.id);
      navigate(`/ver/${nextEpFile}?item=${item.id}&ep=${nextEp!.id}&t=${p?.watched ? 0 : Math.floor(p?.position ?? 0)}`);
    }
  };

  const badges = [
    resolutionLabel(movieFile?.width, movieFile?.height),
    codecLabel(movieFile?.video_codec),
    movieFile?.hdr,
    ...(movieFile?.audio.slice(0, 2).map((a) => audioLabel(a.codec, a.channels)) ?? []),
  ].filter(Boolean) as string[];

  // Descargar prepara una copia en el servidor; el fichero se recoge después
  // desde la página de descargas, para no dejar la pestaña colgada esperando.
  const pedirDescarga = async (perfil: 'movil' | 'tablet' | 'original') => {
    if (!movieFile) return;
    setDescargando(false);
    try {
      const d = await api.descargaPedir(movieFile.id, perfil);
      setAvisoDescarga(d.estado === 'lista' ? 'Lista para descargar' : 'Preparando la copia…');
    } catch (err) {
      setAvisoDescarga((err as Error).message);
    }
  };

  const directores = item.cast
    .filter((c) => c.role === 'director')
    .map((c) => c.name)
    .slice(0, 2)
    .join(', ');

  const audioLanguages = [...new Set(movieFile?.audio.map((a) => a.language).filter(Boolean) ?? [])] as string[];
  const subLanguages = [...new Set(movieFile?.subtitles.map((s) => s.language).filter(Boolean) ?? [])] as string[];

  return (
    <div className="tinted min-h-screen pb-24" style={{ ['--tint' as string]: tint }}>
      <AnimatePresence>{fixing && <MetadataFixer itemId={itemId} item={item} onClose={() => setFixing(false)} />}</AnimatePresence>
      <AnimatePresence>{numerando && <NumeracionFixer showId={itemId} onClose={() => setNumerando(false)} />}</AnimatePresence>
      <AnimatePresence>{anime && <AnimeFixer itemId={itemId} onClose={() => setAnime(false)} />}</AnimatePresence>
      <div className="relative h-[58vh] min-h-[380px] w-full overflow-hidden">
        {item.has_fanart && (
          <motion.img
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            src={img.fanart(itemId, 1920, item.arte_actualizado)}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
        <div className="scrim-b absolute inset-0" />
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(to right, rgb(var(--tint) / 0.32), rgb(var(--tint) / 0.06) 45%, transparent 70%)` }}
        />
        {/*
          * En una pantalla estrecha estas etiquetas caían justo encima de las
          * notas: el texto sube 208 px sobre el fotograma y ahí es donde están
          * ellas. Desde `sm` hay sitio de sobra y se quedan donde estaban, en
          * la esquina de la imagen; por debajo se enseñan más abajo, en su
          * propia línea, con el resto de la ficha.
          */}
        {badges.length > 0 && (
          <div className="absolute right-5 bottom-4 z-20 hidden max-w-[42%] flex-wrap justify-end gap-1.5 sm:right-8 sm:flex">
            {badges.map((b, i) => (
              <Badge key={`${b}-${i}`} tone={b === '4K' || b?.startsWith('HDR') || b === 'DV' ? 'accent' : 'plain'}>
                {b}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="relative z-10 mx-auto -mt-52 max-w-[1500px] px-4 sm:px-8">
        <div className="flex flex-col">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="min-w-0 max-w-[900px] pb-1"
          >
            {item.has_logo ? (
              <img src={img.logo(itemId, 560, item.arte_actualizado)} alt={item.title} className="mb-3 max-h-24 w-auto max-w-[min(420px,80vw)] object-contain object-left drop-shadow-[0_6px_20px_rgba(0,0,0,0.8)]" />
            ) : (
              <h1 className="mb-3 text-4xl font-bold tracking-tight text-shadow-hero">{item.title}</h1>
            )}

            {item.tagline && <p className="mb-3 text-sm text-mist-300 italic">{item.tagline}</p>}

            <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] font-semibold text-mist-100">
              {item.year && <span>{item.year}</span>}
              {item.kind === 'movie' && item.runtime ? <span>{runtime(item.runtime)}</span> : null}
              {item.kind === 'show' && <span>{seasons.size} temporada{seasons.size === 1 ? '' : 's'}</span>}
              {certification(item.mpaa) && <span className="rounded border border-white/25 px-1.5 py-px text-[12px]">{certification(item.mpaa)}</span>}
              {/*
                * Cada sitio con su escala: IMDb y TMDb sobre 10, Rotten Tomatoes
                * y Metacritic sobre 100. Convertirlas a una escala común daría
                * números que no coinciden con los que se ven en ningún lado.
                */}
              {item.ratings && item.ratings.length > 0
                ? item.ratings.map((r) => (
                    <span key={r.fuente} className="flex items-baseline gap-1">
                      <b className="text-[15px]">{r.maximo === 100 ? `${Math.round(r.valor)}%` : r.valor.toFixed(1)}</b>
                      <span className="text-[12px] font-normal text-mist-500">{r.etiqueta}</span>
                    </span>
                  ))
                : item.rating != null && item.rating > 0 && (
                    <span className="flex items-center gap-1">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-accent">
                        <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
                      </svg>
                      {item.rating.toFixed(1)}
                      {item.votes ? <span className="font-normal text-mist-600">({(item.votes / 1000).toFixed(0)}k)</span> : null}
                    </span>
                  )}
              {movieProgress?.watched === 1 && (
                <span className="rounded-full bg-accent/18 px-2.5 py-0.5 text-[12px] text-accent">Vista</span>
              )}
            </div>

            {badges.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5 sm:hidden">
                {badges.map((b, i) => (
                  <Badge key={'m-' + b + '-' + i} tone={b === '4K' || b?.startsWith('HDR') || b === 'DV' ? 'accent' : 'plain'}>
                    {b}
                  </Badge>
                ))}
              </div>
            )}

            {item.genres.length > 0 && <div className="mb-4 text-[14px] text-mist-500">{item.genres.slice(0, 4).join(', ')}</div>}

            {item.plot && (
              <p className={`mb-1 max-w-[820px] text-[15px] leading-relaxed text-mist-300 ${plotAbierta ? '' : 'line-clamp-3'}`}>
                {item.plot}
              </p>
            )}
            {item.plot && item.plot.length > 260 && (
              <button onClick={() => setPlotAbierta((v) => !v)} className="mb-3 text-[13px] text-mist-500 hover:text-mist-100">
                {plotAbierta ? 'Menos' : 'Más'}
              </button>
            )}
            {directores && <div className="mb-5 text-[13.5px] text-mist-500">Dirigida por {directores}</div>}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={play}
                disabled={item.kind === 'movie' ? !movieFile : !nextEpFile}
                className="flex items-center gap-2 rounded-full bg-mist-100 px-6 py-2.5 text-sm font-semibold text-ink-950 transition-transform duration-200 hover:scale-105 active:scale-95 disabled:opacity-40"
              >
                <PlayIcon />
                {item.kind === 'show'
                  ? nextEp ? `T${nextEp.season}:E${nextEp.episode}` : 'Reproducir'
                  : resumeAt > 0 ? `Reanudar ${clock(resumeAt)}` : 'Reproducir'}
              </button>

              {resumeAt > 0 && movieFile && (
                <button
                  onClick={() => navigate(`/ver/${movieFile.id}?item=${item.id}&t=0`)}
                  className="glass rounded-full px-4 py-2.5 text-sm transition-transform duration-200 hover:scale-105 active:scale-95"
                >
                  Desde el principio
                </button>
              )}

              <button
                onClick={() => favorite.mutate(!esFavorita)}
                title={esFavorita ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                className={`glass grid h-10 w-10 place-items-center rounded-full transition-transform duration-200 hover:scale-110 active:scale-95 ${
                  esFavorita ? 'text-accent' : ''
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill={esFavorita ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M12 21s-7.5-4.7-9.3-9A5.3 5.3 0 0 1 12 6.5 5.3 5.3 0 0 1 21.3 12c-1.8 4.3-9.3 9-9.3 9Z" strokeLinejoin="round" />
                </svg>
              </button>

              {me?.is_admin === 1 && (
                <button
                  onClick={() => setFixing(true)}
                  title="Corregir metadatos desde TMDb"
                  className="glass grid h-10 w-10 place-items-center rounded-full transition-transform duration-200 hover:scale-110 active:scale-95"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              )}

              {item.kind === 'movie' && movieFile && (
                <div className="relative">
                  <button
                    onClick={() => setDescargando((v) => !v)}
                    title="Descargar para ver sin conexión"
                    className="glass grid h-10 w-10 place-items-center rounded-full transition-transform duration-200 hover:scale-110 active:scale-95"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                    </svg>
                  </button>
                  {descargando && (
                    <div className="glass-strong absolute bottom-12 left-0 z-50 w-56 rounded-xl p-1.5 shadow-[var(--shadow-3)]">
                      {(
                        [
                          ['movil', 'Móvil', '480p, ocupa poco'],
                          ['tablet', 'Tablet', '720p'],
                          ['original', 'Original', 'el fichero tal cual'],
                        ] as const
                      ).map(([valor, titulo, pie]) => (
                        <button
                          key={valor}
                          onClick={() => pedirDescarga(valor)}
                          className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-white/10"
                        >
                          {titulo}
                          <span className="block text-[11.5px] text-mist-600">{pie}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {avisoDescarga && (
                <Link to="/descargas" className="text-[12.5px] text-accent underline-offset-2 hover:underline">
                  {avisoDescarga} · ver descargas
                </Link>
              )}

              {me?.is_admin === 1 && (
                <button
                  onClick={() => setAnime(true)}
                  title="Identificar como anime (Kitsu, MyAnimeList, AniList)"
                  className="glass grid h-10 w-10 place-items-center rounded-full transition-transform duration-200 hover:scale-110 active:scale-95"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3a9 9 0 1 0 9 9" />
                    <path d="M8.5 10h.01M15.5 10h.01M9 15c.9.8 2 1.2 3 1.2s2.1-.4 3-1.2" />
                  </svg>
                </button>
              )}

              {me?.is_admin === 1 && item.kind === 'show' && (
                <button
                  onClick={() => setNumerando(true)}
                  title="Corregir la numeración de los episodios"
                  className="glass grid h-10 w-10 place-items-center rounded-full transition-transform duration-200 hover:scale-110 active:scale-95"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6h16M4 12h16M4 18h9" />
                    <path d="M18 15v6M15 18h6" />
                  </svg>
                </button>
              )}

              {item.kind === 'movie' && (
                <button
                  onClick={() => watched.mutate(!estaVista)}
                  title={estaVista ? 'Marcar como no vista' : 'Marcar como vista'}
                  className={`grid h-10 w-10 place-items-center rounded-full transition-transform duration-200 hover:scale-110 active:scale-95 ${
                    estaVista ? 'bg-accent text-ink-950' : 'glass'
                  }`}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12.5 9.5 18 20 6.5" />
                  </svg>
                </button>
              )}
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mt-10 grid gap-x-10 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            {item.studio && (
              <div>
                <div className="mb-1 text-mist-600">Estudio</div>
                <div className="text-mist-300">{item.studio.split(', ').slice(0, 2).join(', ')}</div>
              </div>
            )}
            {audioLanguages.length > 0 && (
              <div>
                <div className="mb-1 text-mist-600">Audio</div>
                <div className="text-mist-300">{audioLanguages.map(languageName).join(', ')}</div>
              </div>
            )}
            {subLanguages.length > 0 && (
              <div>
                <div className="mb-1 text-mist-600">Subtítulos</div>
                <div className="text-mist-300">{subLanguages.map(languageName).join(', ')}</div>
              </div>
            )}
          </div>

          {item.cast.filter((c) => c.role === 'actor').length > 0 && (
            <div className="mt-12">
              <h2 className="mb-4 text-[17px] font-semibold tracking-tight">Reparto</h2>
              <div className="no-scrollbar flex gap-5 overflow-x-auto pb-2">
                {item.cast
                  .filter((c) => c.role === 'actor')
                  .slice(0, 24)
                  .map((person) => (
                    <Link key={person.id} to={`/persona/${person.id}`} className="group w-[92px] shrink-0 text-center">
                      <div className="mb-2 aspect-square overflow-hidden rounded-full bg-ink-800 ring-1 ring-white/8 transition-all duration-300 group-hover:scale-105 group-hover:ring-white/25">
                        {person.has_thumb ? (
                          <img src={img.person(person.id, 160)} alt={person.name} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full place-items-center text-lg text-mist-600">{person.name.charAt(0)}</div>
                        )}
                      </div>
                      <div className="truncate text-[12px] font-medium text-mist-100">{person.name}</div>
                      {person.character && <div className="truncate text-[11px] text-mist-600">{person.character}</div>}
                    </Link>
                  ))}
              </div>
            </div>
          )}

          {item.kind === 'show' && seasons.size > 0 && <EpisodeList item={item} seasons={seasons} />}

          {movieFile && (
            <div className="glass mt-12 rounded-[var(--radius-panel)] p-5">
              <h3 className="mb-3 text-[13px] font-semibold tracking-wide text-mist-300 uppercase">Fichero</h3>
              <div className="grid gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <div className="text-mist-600">Nombre</div>
                  <div className="truncate text-mist-300" title={movieFile.name}>{movieFile.name}</div>
                </div>
                <div>
                  <div className="text-mist-600">Tamaño</div>
                  <div className="text-mist-300">{fileSize(movieFile.size)}</div>
                </div>
                <div>
                  <div className="text-mist-600">Vídeo</div>
                  <div className="text-mist-300">
                    {codecLabel(movieFile.video_codec)} {movieFile.width}×{movieFile.height}
                  </div>
                </div>
                <div>
                  <div className="text-mist-600">Pistas</div>
                  <div className="text-mist-300">
                    {movieFile.audio.length} audio · {movieFile.subtitles.length} subtítulos
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {item.collectionItems && item.collectionItems.length > 1 && (
        <div className="mt-16">
          <Row title={item.collection ?? 'Saga'} items={item.collectionItems} to={`/saga/${encodeURIComponent(item.collection ?? '')}`} />
        </div>
      )}

      {item.similar && item.similar.length > 0 && (
        <div className="mt-16">
          <Row title="Títulos similares" items={item.similar} />
        </div>
      )}
    </div>
  );
}
