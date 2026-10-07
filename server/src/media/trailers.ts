/**
 * Tráileres de películas, series y temporadas, desde TMDb (vídeos de YouTube).
 *
 * Nunca se descarga nada: los clientes los ven incrustados con el reproductor
 * de YouTube, que es lo que permite YouTube. Aquí solo se guarda el
 * identificador del vídeo, por id de TMDb (los ids de `items` se renumeran en
 * cada escaneo).
 *
 * Qué tráiler: solo de tipo «Trailer» en YouTube. Castellano si hay uno de
 * 720p o más; si no, el inglés de más resolución. Oficial antes que no
 * oficial a igualdad de lo demás. Medido el 07/10 con «Origen»: el único en
 * castellano es a 360p y no oficial; en inglés los hay oficiales en 1080p.
 */
import { config } from '../config.ts';
import { db } from '../db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS trailers (
  clave     TEXT PRIMARY KEY,   -- movie:<tmdb> | tv:<tmdb> | tv:<tmdb>:s<n>
  youtube   TEXT,               -- NULL: TMDb no tiene ninguno que valga
  idioma    TEXT,
  calidad   INTEGER,
  comprobado TEXT NOT NULL
);
`);

const CACHE_DIAS = 30;

type Video = { key: string; site: string; type: string; size: number; official: boolean; iso_639_1: string };
export type Trailer = { youtube: string; idioma: string; calidad: number; de?: 'temporada' | 'titulo' };

async function videos(ruta: string, idioma: string): Promise<Video[]> {
  const r = await fetch(`https://api.themoviedb.org/3${ruta}/videos?language=${idioma}&api_key=${config.tmdbApiKey}`, {
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`TMDb ${r.status}`);
  const j = (await r.json()) as { results?: Video[] };
  return (j.results || []).filter((v) => v.site === 'YouTube' && v.type === 'Trailer' && /^[\w-]{11}$/.test(v.key));
}

// Oficial primero y después la resolución: en «Origen» ganaba un «35mm
// Theatrical Trailer» no oficial en 2160p al oficial en 1080p.
const mejor = (lista: Video[]) =>
  lista.slice().sort((a, b) => Number(b.official) - Number(a.official) || b.size - a.size)[0];

function elegir(es: Video[], en: Video[]): Trailer | null {
  const castellano = mejor(es.filter((v) => v.size >= 720));
  if (castellano) return { youtube: castellano.key, idioma: 'es', calidad: castellano.size };
  const ingles = mejor(en);
  if (ingles) return { youtube: ingles.key, idioma: 'en', calidad: ingles.size };
  // Ni castellano bueno ni inglés: el castellano que haya, aunque sea flojo.
  const resto = mejor(es);
  return resto ? { youtube: resto.key, idioma: 'es', calidad: resto.size } : null;
}

async function buscar(clave: string, ruta: string): Promise<Trailer | null> {
  const guardado = db.prepare('SELECT youtube, idioma, calidad, comprobado FROM trailers WHERE clave = ?').get(clave) as
    | { youtube: string | null; idioma: string; calidad: number; comprobado: string }
    | undefined;
  if (guardado && (Date.now() - new Date(guardado.comprobado).getTime()) / 86_400_000 < CACHE_DIAS) {
    return guardado.youtube ? { youtube: guardado.youtube, idioma: guardado.idioma, calidad: guardado.calidad } : null;
  }
  if (!config.tmdbApiKey) return null;
  try {
    const t = elegir(await videos(ruta, 'es-ES'), await videos(ruta, 'en-US'));
    db.prepare(`INSERT INTO trailers (clave, youtube, idioma, calidad, comprobado) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(clave) DO UPDATE SET youtube = excluded.youtube, idioma = excluded.idioma,
                  calidad = excluded.calidad, comprobado = excluded.comprobado`)
      .run(clave, t?.youtube ?? null, t?.idioma ?? null, t?.calidad ?? null, new Date().toISOString());
    return t;
  } catch {
    // Sin red o TMDb caído: lo guardado, aunque esté viejo.
    return guardado?.youtube ? { youtube: guardado.youtube, idioma: guardado.idioma, calidad: guardado.calidad } : null;
  }
}

/** El de la temporada si se pide y existe; si no, el de la película o serie. */
export async function trailerDe(itemId: number, temporada?: number): Promise<Trailer | null> {
  const item = db.prepare('SELECT tmdb_id, kind FROM items WHERE id = ?').get(itemId) as
    | { tmdb_id: string | null; kind: string }
    | undefined;
  if (!item?.tmdb_id || !/^\d+$/.test(item.tmdb_id)) return null;
  if (item.kind === 'show') {
    if (temporada !== undefined && Number.isInteger(temporada) && temporada >= 0) {
      const t = await buscar(`tv:${item.tmdb_id}:s${temporada}`, `/tv/${item.tmdb_id}/season/${temporada}`);
      if (t) return { ...t, de: 'temporada' };
    }
    const t = await buscar(`tv:${item.tmdb_id}`, `/tv/${item.tmdb_id}`);
    return t ? { ...t, de: 'titulo' } : null;
  }
  const t = await buscar(`movie:${item.tmdb_id}`, `/movie/${item.tmdb_id}`);
  return t ? { ...t, de: 'titulo' } : null;
}

/**
 * La página que incrusta el reproductor. Va servida por http desde el HTPC
 * porque YouTube rechaza incrustarse en la app de la tele, que se carga como
 * fichero local (error 153, comprobado el 07/10 en la QN93A); desde aquí se
 * reproduce en 1080p. Reenvía al padre lo que cuenta el reproductor (estado,
 * error) y baja al reproductor las órdenes del padre (pausa, play).
 */
export function paginaTrailer(youtube: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;background:#000;overflow:hidden}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head>
<body>
<script>
  var f = document.createElement('iframe');
  f.allow = 'autoplay; encrypted-media';
  f.src = 'https://www.youtube-nocookie.com/embed/${youtube}?autoplay=1&enablejsapi=1&controls=0&rel=0&iv_load_policy=3&origin=' + encodeURIComponent(location.origin);
  document.body.appendChild(f);
  window.addEventListener('message', function (e) {
    if (e.source === f.contentWindow) { if (parent !== window) parent.postMessage(e.data, '*'); }
    else if (e.source === parent) { f.contentWindow.postMessage(e.data, '*'); }
  });
  f.onload = function () {
    var n = 0;
    var h = setInterval(function () {
      f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
      if (++n > 20) clearInterval(h);
    }, 500);
  };
</script>
</body></html>`;
}
