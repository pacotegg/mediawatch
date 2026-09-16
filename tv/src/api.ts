/** Cliente del servidor TvWatch para la televisión. */

const SERVIDOR_KEY = 'cineteca.tv.servidor';
const TOKEN_KEY = 'cineteca.tv.token';

// Valor de partida: la IP del HTPC en la red de casa. Se puede cambiar desde la
// pantalla de conexión con los números del mando.
const SERVIDOR_POR_DEFECTO = 'http://192.168.31.16:8730';

export function servidor(): string {
  try {
    const guardado = localStorage.getItem(SERVIDOR_KEY);
    if (guardado) return guardado;
  } catch (e) {
    /* sin almacenamiento */
  }

  // Si la app se ha cargado por HTTP (probándola desde el navegador de la tele),
  // el servidor es justamente de donde vino: no hay que configurar nada.
  // Empaquetada como app de Tizen el origen no es http, y ahí sí hace falta la IP.
  if (typeof location !== 'undefined' && location.protocol.indexOf('http') === 0) {
    return location.protocol + '//' + location.host;
  }
  return SERVIDOR_POR_DEFECTO;
}

export function guardarServidor(url: string) {
  try {
    localStorage.setItem(SERVIDOR_KEY, url);
  } catch (e) {
    /* sin almacenamiento: se usará solo durante esta sesión */
  }
}

export function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
}

export function guardarToken(valor: string) {
  try {
    localStorage.setItem(TOKEN_KEY, valor);
  } catch (e) {
    /* idem */
  }
}

export function olvidarToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* idem */
  }
}

async function pedir<T>(ruta: string, opciones?: RequestInit): Promise<T> {
  const cabeceras: Record<string, string> = {};
  // Solo se declara el tipo si hay cuerpo: anunciar JSON sin enviarlo hace que
  // el servidor rechace la petición por vacía.
  if (opciones && opciones.body) cabeceras['Content-Type'] = 'application/json';

  const t = token();
  if (t) cabeceras['Authorization'] = 'Bearer ' + t;

  const res = await fetch(servidor() + ruta, Object.assign({ headers: cabeceras }, opciones));
  if (!res.ok) {
    let mensaje = 'Error ' + res.status;
    try {
      const cuerpo = await res.json();
      if (cuerpo && cuerpo.error) mensaje = cuerpo.error;
    } catch (e) {
      /* respuesta sin JSON */
    }
    throw Object.assign(new Error(mensaje), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export type Titulo = {
  id: number;
  kind: 'movie' | 'show';
  title: string;
  year: number | null;
  rating: number | null;
  runtime: number | null;
  has_poster: number;
  has_fanart: number;
  has_logo: number;
  /** Solo en la ficha: el disco redondo, que gira en la pausa. */
  has_discart?: number;
  library_name: string;
  position?: number;
  progressDuration?: number;
  watched?: number;
  /** Solo lo trae el héroe de la portada, que muestra una sinopsis breve. */
  plot?: string | null;
};

export type Ficha = Titulo & {
  plot: string | null;
  genres: string[];
  cast: { id: number; name: string; character: string | null; role: string; has_thumb: number }[];
  files: {
    id: number;
    duration: number | null;
    height: number | null;
    video_codec: string | null;
    hdr: string | null;
    episode_id: number | null;
    name: string;
    audio: { codec: string | null; language: string | null; channels: number | null }[];
    subtitles: { language: string | null; forced: number; is_external: number }[];
  }[];
  episodes?: { id: number; season: number; episode: number; title: string | null; file_id: number | null; duration: number | null }[];
  progress: { episode_id: number | null; position: number; duration: number | null; watched: number }[];
  /** 1 si el perfil actual lo tiene en favoritos. */
  favorite: number;
  /** Valoración de cada sitio, cada una con su escala (10 o 100). */
  ratings?: { fuente: string; etiqueta: string; valor: number; maximo: number; votos: number }[];
  nextUp?: { id: number; season: number; episode: number };
  /** Del mismo genero, las que mas generos comparten primero. */
  similar?: Titulo[];
};

/** Lo que el servidor sabe del fichero que se va a reproducir. */
export type Capitulo = { start: number; end: number; title: string };

/**
 * Tira de miniaturas para la barra. `times[i]` es el segundo exacto de la
 * miniatura `i`, y **no viene ordenado**: con fotogramas B las claves salen del
 * descodificador desordenadas y la tira se arma en ese mismo orden, así que
 * cada miniatura lleva su hora puesta y hay que buscar la más cercana.
 */
export type Tira = {
  fileId: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  sheets: number;
  times: number[];
};
export type RangoSalto = { kind: string; start_s: number; end_s: number; confidence: number };

export type InfoReproduccion = {
  duration: number;
  container: string;
  size: number;
  bitrate: number;
  chapters: Capitulo[];
  /** Cabecera y créditos del episodio, si se han detectado. */
  skip: RangoSalto[];
  video: { codec: string; width: number; height: number; hdr?: string; profile?: string; fps: number } | null;
  plan: { mode: 'direct' | 'remux' | 'transcode'; reasons?: string[] };
  audio: { id: number; codec: string; language: string | null; channels: number | null; title?: string | null; default?: boolean; compatible?: boolean; atmos?: boolean }[];
  subtitles: { id: string; language: string | null; title?: string | null; forced: boolean; source?: string }[];
};

export type Saga = { name: string; count: number; poster_id: number | null; fanart_id: number | null };

export const api = {
  yo: () => pedir<{ id: number; name: string }>('/api/me'),
  bibliotecas: () => pedir<{ id: number; name: string; kind: string; count: number }[]>('/api/libraries'),
  portada: () => pedir<{ hero: Titulo[]; rows: { key: string; title: string; kind: string; items: Titulo[] }[] }>('/api/home'),
  titulos: (biblioteca: number, offset: number, limite: number) =>
    pedir<{ total: number; items: Titulo[] }>(`/api/items?library=${biblioteca}&limit=${limite}&offset=${offset}&sort=title`),
  ficha: (id: number) => pedir<Ficha>('/api/items/' + id),
  buscar: (q: string) => pedir<{ items: Titulo[] }>('/api/search?q=' + encodeURIComponent(q)),
  colecciones: () => pedir<Saga[]>('/api/collections'),
  coleccion: (nombre: string) => pedir<{ name: string; items: Titulo[] }>('/api/collections/' + encodeURIComponent(nombre)),
  favoritos: () => pedir<Titulo[]>('/api/favorites'),
  continuarEn: (biblioteca: number) => pedir<Titulo[]>('/api/libraries/' + biblioteca + '/continuar'),
  borrar: (itemId: number, confirmar: string) =>
    pedir<{ borrado: true; titulo: string; ficheros: number }>('/api/items/' + itemId, { method: 'DELETE', body: JSON.stringify({ confirmar }) }),
  escanear: () => pedir<{ started: boolean; reason?: string }>('/api/scan', { method: 'POST' }),
  detectarCabeceras: () => pedir<{ started: boolean; total: number }>('/api/skip/detect-todo', { method: 'POST', body: '{}' }),
  pararCabeceras: () => pedir<{ parando: boolean }>('/api/skip/parar', { method: 'POST', body: '{}' }),
  miniaturas: (todo = false) => pedir<{ started: boolean; total: number }>('/api/trickplay/lote', { method: 'POST', body: JSON.stringify({ todo }) }),
  pararMiniaturas: () => pedir<{ parando: boolean }>('/api/trickplay/parar', { method: 'POST', body: '{}' }),
  estadoMiniaturas: () =>
    pedir<{ lote: { running: boolean; total: number; hechas: number; fallos: number; actual: string } }>('/api/trickplay/estado'),
  notasOmdb: () => pedir<{ started: boolean; total: number }>('/api/omdb/rellenar', { method: 'POST', body: '{}' }),
  pararOmdb: () => pedir<{ parando: boolean }>('/api/omdb/parar', { method: 'POST', body: '{}' }),
  estadoOmdb: () =>
    pedir<{ lote: { running: boolean; total: number; hechos: number; anadidas: number; sinDatos: number; actual: string; error: string | null }; configurada: boolean }>(
      '/api/omdb/estado',
    ),
  estadoCabeceras: () =>
    pedir<{ job: { running: boolean; showTitle: string; season: number | null; kind: string; found: number; total: number; hechas: number } }>(
      '/api/skip/status',
    ),
  progreso: (cuerpo: { itemId: number; episodeId?: number | null; position: number; duration?: number; watched?: boolean }) =>
    pedir<{ ok: true }>('/api/progress', { method: 'POST', body: JSON.stringify(cuerpo) }),

  /** ¿Ha escrito algo alguien desde el móvil? Se entrega una sola vez. */
  mando: () =>
    pedir<{
      buscar: string | null;
      reproducir: { fileId: number; itemId: number; episodeId: number | null; position: number } | null;
    }>('/api/mando'),

  iniciarEmparejado: () => pedir<{ code: string; expiresInSeconds: number; url: string }>('/api/auth/device/start', { method: 'POST' }),

  persona: (id: number) =>
    pedir<{
      id: number;
      name: string;
      has_thumb: number;
      detalle: { biography: string | null; birthday: string | null; deathday: string | null; birthplace: string | null; profile: string | null } | null;
      credits: Titulo[];
    }>('/api/people/' + id),
  marcarVista: (itemId: number, vista: boolean, episodeId?: number | null) =>
    pedir<{ ok: true }>('/api/items/' + itemId + '/watched', { method: 'POST', body: JSON.stringify({ watched: vista, episodeId: episodeId || null }) }),
  favorito: (itemId: number, favorito: boolean) =>
    pedir<{ ok: true }>('/api/items/' + itemId + '/favorite', { method: 'POST', body: JSON.stringify({ favorite: favorito }) }),
  /** Con `perfil`, el servidor marca que pistas puede decodificar esta tele. */
  pistas: (fileId: number) =>
    pedir<InfoReproduccion>('/api/play/' + fileId + '/info?perfil=' + PERFIL),
  // Devuelve 202 con `{generating}` mientras el servidor la fabrica.
  // `solo=1`: mirar si ya está hecha, sin pedir que la fabrique. Generarla
  // mientras se ve la película deja al vídeo sin disco.
  tira: (fileId: number) => pedir<Tira | { generating: boolean }>('/api/play/' + fileId + '/trickplay?solo=1'),
  comprobarEmparejado: (codigo: string) =>
    pedir<{ paired: boolean; token?: string; user?: { name: string } }>('/api/auth/device/poll?code=' + codigo),
};

/**
 * Las imágenes son etiquetas `<img>`, y una `<img>` no puede mandar la cabecera
 * `Authorization`. Aquí no hay cookie que valga —la app corre desde su propio
 * origen, no desde el del servidor—, así que el token va en la URL o el
 * servidor responde 401 y la pantalla se queda sin una sola carátula.
 */
function conToken(url: string): string {
  const t = token();
  if (!t) return url;
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

export const imagen = {
  poster: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/poster?w=' + w),
  fondo: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/fanart?w=' + w),
  logo: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/logo?w=' + w),
  disco: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/discart?w=' + w),
  persona: (id: number, w: number) => conToken(servidor() + '/api/people/' + id + '/thumb?w=' + w),
  tira: (fileId: number, hoja: number) => conToken(servidor() + '/api/play/' + fileId + '/trickplay/' + hoja),
  // El QR se pinta en la pantalla de emparejamiento, antes de tener token: esa
  // ruta queda abierta a propósito en el servidor.
  qr: (contenido: string) => servidor() + '/api/qr.svg?d=' + encodeURIComponent(contenido),
};

const IDIOMAS: Record<string, string> = {
  spa: 'Español', eng: 'Inglés', cat: 'Catalán', glg: 'Gallego', eus: 'Euskera',
  fre: 'Francés', ger: 'Alemán', ita: 'Italiano', por: 'Portugués', jpn: 'Japonés',
  kor: 'Coreano', chi: 'Chino', rus: 'Ruso',
};

export const idioma = (codigo: string | null | undefined) =>
  !codigo ? 'Desconocido' : IDIOMAS[codigo.toLowerCase()] || codigo.toUpperCase();

/**
 * `raw=1` entrega el fichero original. AVPlay descodifica MKV, HEVC y AC3 por
 * hardware, así que remultiplexar para la tele solo gastaría CPU del servidor y
 * estropearía el audio multicanal.
 */
/** Lo que esta tele decodifica; lo sabe el servidor, no hay que listar codecs aqui. */
export const PERFIL = 'samsung2021';

/**
 * `raw=1` entrega el fichero original: AVPlay decodifica MKV, HEVC, AC3 y DD+
 * por hardware, y una pista DD+ JOC llega intacta a la barra como Atmos.
 * Con `audio=` y el perfil, si esa pista es de las que la tele no lee (DTS,
 * TrueHD, FLAC) el servidor convierte solo el audio a DD+ 5.1 y copia el video.
 */
export function urlReproduccion(
  fileId: number,
  audioId?: number,
  desdeSegundos = 0,
  modoAudio: 'normal' | 'night' | 'dialogue' = 'normal',
): string {
  const t = token();
  return (
    servidor() + '/api/play/' + fileId + '/stream?raw=1&perfil=' + PERFIL +
    (audioId !== undefined ? '&audio=' + audioId : '') +
    // Solo se manda cuando no es «normal»: en normal la pista va intacta y la
    // barra recibe el Atmos tal cual.
    (modoAudio !== 'normal' ? '&audiomode=' + modoAudio : '') +
    // Solo tiene sentido con audio convertido: ahi el flujo va por tuberia y no
    // admite saltos, asi que para moverse hay que volver a pedirlo ya cortado.
    (desdeSegundos > 0 ? '&t=' + Math.floor(desdeSegundos) : '') +
    (t ? '&token=' + encodeURIComponent(t) : '')
  );
}
