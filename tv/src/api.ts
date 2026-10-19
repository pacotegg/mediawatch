/** Cliente del servidor TvWatch para la televisión. */
import { ajustes } from './ajustes';

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

/**
 * `tope`: cuánto se espera la respuesta. 12 s valen para casi todo; las búsquedas y bajadas de subtítulos de internet
 * pueden tardar más en el servidor (su propio tope es de 90 s y 2 min) y la tele las daba por fallidas a los 12 s.
 */
async function pedir<T>(ruta: string, opciones?: RequestInit, tope = 12000): Promise<T> {
  const cabeceras: Record<string, string> = {};
  if (opciones && opciones.body) cabeceras['Content-Type'] = 'application/json';

  const t = token();
  if (t) cabeceras['Authorization'] = 'Bearer ' + t;

  const esLectura = !opciones || !opciones.method || opciones.method === 'GET';
  const maxIntentos = esLectura ? 3 : 1;
  let ultimoError: Error | null = null;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const reloj = ctrl ? window.setTimeout(() => ctrl.abort(), tope) : 0;
    try {
      const opts = Object.assign({ headers: cabeceras }, opciones, ctrl ? { signal: ctrl.signal } : {});
      const res = await fetch(servidor() + ruta, opts);
      if (reloj) window.clearTimeout(reloj);

      if (!res.ok) {
        let mensaje = 'Error ' + res.status;
        try {
          const cuerpo = await res.json();
          if (cuerpo && cuerpo.error) mensaje = cuerpo.error;
        } catch (e) {
          /* respuesta sin JSON */
        }
        if (res.status >= 502 && res.status <= 504 && intento < maxIntentos) {
          await new Promise((r) => window.setTimeout(r, 1200));
          continue;
        }
        throw Object.assign(new Error(mensaje), { status: res.status });
      }
      return (await res.json()) as T;
    } catch (e) {
      if (reloj) window.clearTimeout(reloj);
      ultimoError = e as Error;
      if (intento < maxIntentos) await new Promise((r) => window.setTimeout(r, 1200));
    }
  }
  throw ultimoError || new Error('No se pudo conectar con el servidor');
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
  /** Si tiene sintonía o tema musical oficial local. */
  has_theme?: number;
  library_name: string;
  position?: number;
  progressDuration?: number;
  watched?: number;
  studio?: string | null;
  tagline?: string | null;
  mpaa?: string | null;
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
    width: number | null;
    height: number | null;
    video_codec: string | null;
    hdr: string | null;
    episode_id: number | null;
    name: string;
    audio: { codec: string | null; language: string | null; channels: number | null }[];
    subtitles: { language: string | null; forced: number; is_external: number }[];
  }[];
  episodes?: { id: number; season: number; episode: number; title: string | null; plot?: string | null; file_id: number | null; duration: number | null; has_thumb: number }[];
  progress: { episode_id: number | null; position: number; duration: number | null; watched: number }[];
  /** 1 si el perfil actual lo tiene en favoritos. */
  favorite: number;
  extras_count?: number;
  /** Valoración de cada sitio, cada una con su escala (10 o 100). */
  ratings?: { fuente: string; etiqueta: string; valor: number; maximo: number; votos: number }[];
  nextUp?: { id: number; season: number; episode: number };
  /** Del mismo genero, las que mas generos comparten primero. */
  similar?: Titulo[];
  /** Etiquetas tecnicas del mejor fichero: 4K, DV/HDR10/HDR10+/HDR, Atmos, TrueHD, DTS-HD, 5.1, 7.1. */
  tags?: string[];
  /** Nombre de la saga y sus titulos (vacio si no pertenece a ninguna). */
  collection?: string | null;
  collectionItems?: Titulo[];
};

/** Lo que el servidor sabe del fichero que se va a reproducir. */
type Capitulo = { start: number; end: number; title: string };

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

export type DialogoHit = {
  itemId: number;
  title: string;
  year: number | null;
  kind: string;
  fileId: number;
  episodeId: number | null;
  season: number | null;
  episode: number | null;
  startMs: number;
  snippet: string;
};

export type InfoReproduccion = {
  duration: number;
  container: string;
  size: number;
  bitrate: number;
  chapters: Capitulo[];
  /** Cabecera y créditos del episodio, si se han detectado. */
  skip: RangoSalto[];
  video: { codec: string; width: number; height: number; hdr?: string; profile?: string; fps: number; dar?: string; sar?: string } | null;
  plan: { mode: 'direct' | 'remux' | 'transcode'; reasons?: string[] };
  savedAudio?: string | null;
  savedSubtitle?: string | null;
  audio: { id: number; codec: string; language: string | null; channels: number | null; title?: string | null; default?: boolean; compatible?: boolean; atmos?: boolean }[];
  subtitles: { id: string; language: string | null; title?: string | null; forced: boolean; source?: string; codec?: string; offsetMs?: number }[];
};

export type CandidatoSubtitulo = {
  id: string;
  provider: string;
  providerId: string | number;
  language: string;
  languageLabel: string;
  release: string;
  downloads: number;
  rating: number;
  forced: boolean;
  hearingImpaired: boolean;
  comment?: string;
};

type Saga = {
  name: string;
  count: number;
  poster_id: number | null;
  fanart_id: number | null;
  /** 1 si la saga tiene una imagen propia, que manda sobre la de las peliculas. */
  imagen_propia?: number;
};

export type FiltrosRejilla = {
  sort?: string;
  genre?: string;
  decade?: string;
  quality?: string;
  runtime?: string;
  studio?: string;
  person?: number;
  unwatched?: boolean;
};

export const api = {
  yo: () => pedir<{ id: number; name: string; is_admin: number; kid_ratings?: string[] | null }>('/api/me'),
  bibliotecas: () => pedir<{ id: number; name: string; kind: string; count: number }[]>('/api/libraries'),
  portada: () => pedir<{ hero: Titulo[]; rows: { key: string; title: string; kind: string; items: Titulo[] }[] }>('/api/home'),
  /** Donde empieza cada letra en la lista ordenada por titulo de una biblioteca. */
  letras: (biblioteca: number) =>
    pedir<{ total: number; letras: { letra: string; offset: number }[] }>('/api/items/letras?library=' + biblioteca),
  generos: (biblioteca?: number) =>
    pedir<{ id: number; name: string; count: number }[]>(biblioteca ? '/api/genres?library=' + biblioteca : '/api/genres'),
  /** Los estudios del título con logo, sin repetir y en su orden (el primero, el principal). */
  logosEstudio: (id: number) => pedir<{ estudios: string[] }>('/api/items/' + id + '/studio-logos'),
  estudios: (biblioteca?: number) =>
    pedir<{ name: string; count: number }[]>(biblioteca ? '/api/studios?library=' + biblioteca : '/api/studios'),
  actores: (biblioteca?: number) =>
    pedir<{ id: number; name: string; count: number; thumb?: string | null }[]>(
      biblioteca ? '/api/actors?library=' + biblioteca : '/api/actors',
    ),
  titulos: (biblioteca: number, offset: number, limite: number, filtros?: FiltrosRejilla) => {
    let ruta = `/api/items?library=${biblioteca}&limit=${limite}&offset=${offset}`;
    const sort = (filtros && filtros.sort) || 'title';
    ruta += '&sort=' + encodeURIComponent(sort);
    if (filtros) {
      if (filtros.genre) ruta += '&genre=' + encodeURIComponent(filtros.genre);
      if (filtros.decade) ruta += '&decade=' + encodeURIComponent(filtros.decade);
      if (filtros.quality) ruta += '&quality=' + encodeURIComponent(filtros.quality);
      if (filtros.runtime) ruta += '&runtime=' + encodeURIComponent(filtros.runtime);
      if (filtros.studio) ruta += '&studio=' + encodeURIComponent(filtros.studio);
      if (filtros.person) ruta += '&person=' + encodeURIComponent(String(filtros.person));
      if (filtros.unwatched) ruta += '&unwatched=1';
    }
    return pedir<{ total: number; items: Titulo[] }>(ruta);
  },
  ficha: (id: number) => pedir<Ficha>('/api/items/' + id),
  buscar: (q: string) => pedir<{ items: Titulo[] }>('/api/search?q=' + encodeURIComponent(q)),
  buscarDialogo: (q: string) =>
    pedir<{ hits: DialogoHit[] }>('/api/search/dialogue?q=' + encodeURIComponent(q)),
  colecciones: () => pedir<Saga[]>('/api/collections'),
  coleccion: (nombre: string) =>
    pedir<{ name: string; items: Titulo[]; arteItemId: number | null; arteImagen: boolean }>(
      '/api/collections/' + encodeURIComponent(nombre),
    ),
  /** Qué película presta la imagen de la saga; `null` vuelve a la automática. */
  fijarArteSaga: (nombre: string, itemId: number | null) =>
    pedir<{ name: string; arteItemId: number | null }>('/api/collections/' + encodeURIComponent(nombre) + '/arte', {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    }),
  /** Una imagen del buzón (data/arte-entrada) como imagen de la saga. */
  arteSagaDelBuzon: (nombre: string, buzon: string) =>
    pedir<{ name: string; arteImagen: boolean }>('/api/collections/' + encodeURIComponent(nombre) + '/arte', {
      method: 'POST',
      body: JSON.stringify({ buzon }),
    }),
  /** Lo que hay en el buzón, para poder elegirlo con el mando. */
  buzonArte: () => pedir<{ carpeta: string; imagenes: { nombre: string; bytes: number }[] }>('/api/enrich/arte/buzon'),
  /** Búsqueda de alternativas en TMDb para escrapeo. */
  enrichSearch: (query: string, kind: 'movie' | 'show', year?: number | null) =>
    pedir<{ results: { tmdbId: number; title: string; year?: number | null; overview?: string; posterUrl?: string }[] }>(
      '/api/enrich/search',
      { method: 'POST', body: JSON.stringify({ query, kind, year }) },
    ),
  /** Sobrescribir metadatos de un título desde una propuesta de TMDb. */
  enrichApply: (body: { itemId: number; tmdbId: number; kind: 'movie' | 'show'; fields: string[]; overwrite?: boolean }) =>
    pedir<{ applied: string[]; title: string }>('/api/enrich/apply', { method: 'POST', body: JSON.stringify(body) }),
  /** Todas las imágenes de TMDb para un título por papeles (poster, fanart, clearlogo, landscape, discart). */
  enrichImagenes: (kind: 'movie' | 'show', tmdbId: number) =>
    pedir<Record<string, { url: string; vista: string; idioma: string }[]>>('/api/enrich/imagenes/' + kind + '/' + tmdbId),
  /** Fijar una imagen oficial de TMDb o soltarla (null). */
  enrichArte: (body: { itemId: number; papel: string; url?: string | null }) =>
    pedir<{ papel: string }>('/api/enrich/arte', { method: 'POST', body: JSON.stringify(body) }),
  /** Fijar una imagen del buzón local. */
  enrichArteBuzon: (body: { itemId: number; papel: string; nombre: string }) =>
    pedir<{ papel: string }>('/api/enrich/arte/buzon', { method: 'POST', body: JSON.stringify(body) }),

  /** Featurettes, «como se hizo» y demas videos que acompanyan a un titulo. */
  extras: (itemId: number) => pedir<{ extras: Extra[] }>('/api/items/' + itemId + '/extras'),
  trailer: (itemId: number, temporada?: number) =>
    pedir<{ trailer: { youtube: string; idioma: string; calidad: number } | null }>(
      '/api/items/' + itemId + '/trailer' + (temporada !== undefined ? '?temporada=' + temporada : ''),
    ),
  resenas: (itemId: number) => pedir<{ items: { fuente: string; autor: string; contenido: string; valor: number | null; url: string | null; pie?: string | null }[] }>('/api/items/' + itemId + '/reviews'),

  /*
   * Plataformas del usuario (Movistar+, Prime, Apple TV+). Aqui NO se reproduce
   * nada: van cifradas y solo las sirve su propia app. Esto dice donde esta cada
   * titulo y ensenya su catalogo; reproducir es abrir su app con la del sistema.
   */
  dondeVer: (itemId: number) => pedir<DondeVer>('/api/items/' + itemId + '/plataformas'),
  plataformas: () => pedir<{ plataformas: Plataforma[]; configurado?: boolean; porPlataforma?: { clave: string; titulos: number }[] }>('/api/plataformas'),
  /** «Conectar» una plataforma es marcarla como propia: el perfil verá «también en…» de las que marque. */
  guardarMisPlataformas: (claves: string[]) =>
    pedir<{ claves: string[] }>('/api/mis-plataformas', { method: 'POST', body: JSON.stringify({ claves }) }),
  catalogoPlataforma: (clave: string, kind: 'movie' | 'show', orden: string, pagina: number) =>
    pedir<{ total: number; paginas: number; items: FichaPlataforma[] }>(
      '/api/plataformas/' + clave + '/catalogo?kind=' + kind + '&orden=' + orden + '&pagina=' + pagina,
    ),
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
  progreso: (cuerpo: { itemId: number; episodeId?: number | null; position: number; duration?: number; watched?: boolean; audio?: number | string | null; subtitle?: string | null }) =>
    pedir<{ ok: true }>('/api/progress', { method: 'POST', body: JSON.stringify(cuerpo) }),

  /** ¿Ha escrito algo alguien desde el móvil? Se entrega una sola vez. */
  mando: () =>
    pedir<{
      buscar: string | null;
      reproducir: { fileId: number; itemId: number; episodeId: number | null; position: number } | null;
      mensaje: string | null;
      parar: boolean;
      /** Tecla del mando enviada desde el movil (se entrega una sola vez). */
      tecla: 'arriba' | 'abajo' | 'izquierda' | 'derecha' | 'ok' | 'atras' | 'play_pause' | null;
    }>('/api/mando?tele=1'),
  /** Solo los avisos del administrador, sin llevarse las órdenes del móvil (para dentro del reproductor). */
  avisos: () => pedir<{ mensaje: string | null; parar: boolean }>('/api/mando'),

  // El secreto lo inventa esta tele y solo ella lo conoce: sin él, quien adivinara el código en la red de casa podía
  // recoger el token antes que la tele. Va en el cuerpo al empezar y en una cabecera al sondear (no en la URL).
  iniciarEmparejado: (secreto: string) =>
    pedir<{ code: string; expiresInSeconds: number; url: string }>('/api/auth/device/start', { method: 'POST', body: JSON.stringify({ secreto }) }),

  persona: (id: number) =>
    pedir<{
      id: number;
      name: string;
      has_thumb: number;
      detalle: { biography: string | null; birthday: string | null; deathday: string | null; birthplace: string | null; profile: string | null } | null;
      credits: Titulo[];
    }>('/api/people/' + id, undefined, 20_000),
  marcarVista: (itemId: number, vista: boolean, episodeId?: number | null) =>
    pedir<{ ok: true }>('/api/items/' + itemId + '/watched', { method: 'POST', body: JSON.stringify({ watched: vista, episodeId: episodeId || null }) }),
  favorito: (itemId: number, favorito: boolean) =>
    pedir<{ ok: true }>('/api/items/' + itemId + '/favorite', { method: 'POST', body: JSON.stringify({ favorite: favorito }) }),
  /** Con `perfil`, el servidor marca que pistas puede decodificar esta tele. */
  pistas: (fileId: number) =>
    pedir<InfoReproduccion>('/api/play/' + fileId + '/info?perfil=' + perfilReproduccion() + '&resumen=1'),
  subtituloVtt: async (fileId: number, trackId: string, desde = 0, retardo = 0) => {
    const t = token();
    const url = servidor() + '/api/play/' + fileId + '/subtitle/' + trackId + '.vtt?desde=' + desde + '&retardo=' + retardo + (t ? '&token=' + t : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo descargar el subtítulo');
    return await res.text();
  },
  guardarOffsetSubtitulo: (fileId: number, trackId: string, offsetMs: number) =>
    pedir<{ ok: true; offsetMs: number }>('/api/play/' + fileId + '/offsets/' + trackId, {
      method: 'POST',
      body: JSON.stringify({ offsetMs }),
    }),
  buscarSubtitulos: (fileId: number) =>
    pedir<{ ok: boolean; exitCode: number | null; outcome?: string; title?: string }>('/api/subtitles/fetch', {
      method: 'POST',
      body: JSON.stringify({ fileId, languages: 'es,en', wait: true }),
    }, 21 * 60_000),
  buscarCandidatosSubtitulos: (fileId: number, languages = 'es,en') =>
    pedir<{ ok: boolean; candidates: CandidatoSubtitulo[] }>('/api/subtitles/search', {
      method: 'POST',
      body: JSON.stringify({ fileId, languages }),
    }, 100_000),
  descargarCandidatoSubtitulo: (fileId: number, c: CandidatoSubtitulo) =>
    pedir<{ ok: boolean; trackId?: string; fileName?: string }>('/api/subtitles/download', {
      method: 'POST',
      body: JSON.stringify({ fileId, provider: c.provider, subId: c.providerId, language: c.language, release: c.release, forced: c.forced }),
    }, 130_000),
  // Devuelve 202 con `{generating}` mientras el servidor la fabrica.
  // `solo=1`: mirar si ya está hecha, sin pedir que la fabrique. Generarla
  // mientras se ve la película deja al vídeo sin disco.
  tira: (fileId: number) => pedir<Tira | { generating: boolean }>('/api/play/' + fileId + '/trickplay?solo=1'),
  comprobarEmparejado: (codigo: string, secreto: string) =>
    pedir<{ paired: boolean; token?: string; user?: { name: string } }>('/api/auth/device/poll?code=' + codigo, { headers: { 'X-Emparejado': secreto } }),
  perfiles: () =>
    pedir<{ users: { id: number; name: string; color: string; has_pin: number; pin_len?: number | null }[] }>('/api/users'),
  emparejarConPin: (codigo: string, userId: number, pin: string) =>
    pedir<{ ok: boolean; user: string }>('/api/auth/device/pin', {
      method: 'POST',
      body: JSON.stringify({ code: codigo, userId, pin }),
    }),
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

export type Extra = {
  id: number;
  titulo: string;
  tipo: string;
  duration: number | null;
  size: number | null;
  /** «Temporada 3» cuando el disco los trae repartidos por temporada. */
  grupo: string | null;
};

export type Plataforma = { clave: string; id: number; nombre: string; mia?: boolean };

/** Donde ver un titulo fuera de casa. `enlace` es la pagina de TMDb. */
export type DondeVer = {
  suscripcion: { clave: string; nombre: string }[];
  alquiler: { clave: string; nombre: string }[];
  enlace: string;
};

export type FichaPlataforma = {
  tmdbId: number;
  kind: 'movie' | 'show';
  title: string;
  year: number | null;
  rating: number | null;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  /** Id en la biblioteca si ya se tiene: entonces se abre aqui, no en su app. */
  enBiblioteca: number | null;
};

export const imagen = {
  poster: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/poster?w=' + w),
  /** La miniatura de un episodio; `has_thumb` dice si la tiene (un 12 % no). */
  episodio: (id: number, w: number) => conToken(servidor() + '/api/episodes/' + id + '/thumb?w=' + w),
  fondo: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/fanart?w=' + w),
  logo: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/logo?w=' + w),
  /*
   * Caratula de una plataforma. Va por el servidor propio, NO por
   * image.tmdb.org: el `img-src` del config.xml no lleva `https:` y la tele la
   * bloquearia en silencio (la misma trampa que dejo el salvapantallas invisible).
   */
  plataforma: (ruta: string, w: number) => conToken(servidor() + '/api/plataformas/caratula/w' + w + ruta),
  disco: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/discart?w=' + w),
  estudio: (id: number, w: number) => conToken(servidor() + '/api/items/' + id + '/studio-logo?w=' + w),
  /** El logo de un estudio en su versión para fondo oscuro (el servidor aclara los que son negros). */
  estudioNombre: (nombre: string, w: number) =>
    conToken(servidor() + '/api/studios/' + encodeURIComponent(nombre) + '/logo?claro=1&w=' + w),
  tema: (id: number) => conToken(servidor() + '/api/items/' + id + '/theme'),
  persona: (id: number, w: number) => conToken(servidor() + '/api/people/' + id + '/thumb?w=' + w),
  tira: (fileId: number, hoja: number) => conToken(servidor() + '/api/play/' + fileId + '/trickplay/' + hoja),
  /** La imagen propia de una saga, la que se eligió del buzón. */
  saga: (nombre: string, w: number) =>
    conToken(servidor() + '/api/collections/' + encodeURIComponent(nombre) + '/imagen?w=' + w),
  // El QR se pinta en la pantalla de emparejamiento, antes de tener token: esa
  // ruta queda abierta a propósito en el servidor.
  /** Un fotograma del extra, que el servidor saca con ffmpeg y guarda. */
  extra: (id: number) => conToken(servidor() + '/api/extras/' + id + '/thumb'),
  qr: (contenido: string) => servidor() + '/api/qr.svg?d=' + encodeURIComponent(contenido),
};

/** AVPlay abre una URL pelada: el token tiene que ir dentro. */
export const urlExtra = (id: number) => conToken(servidor() + '/api/extras/' + id + '/stream');

/*
 * Las pistas traen dos estándares de códigos a la vez (`chi`/`zho`, `fre`/`fra`, `cze`/`ces`…). Chrome 76
 * no tiene `Intl.DisplayNames`, así que la lista va a mano: están todos los que aparecen en la biblioteca
 * (contados el 15/10/2026); antes salían en mayúsculas («ZHO», «NLD»).
 */
const IDIOMAS: Record<string, string> = {
  spa: 'Español', eng: 'Inglés', cat: 'Catalán', glg: 'Gallego', eus: 'Euskera', baq: 'Euskera',
  fre: 'Francés', fra: 'Francés', ger: 'Alemán', deu: 'Alemán', ita: 'Italiano', por: 'Portugués',
  jpn: 'Japonés', kor: 'Coreano', chi: 'Chino', zho: 'Chino', rus: 'Ruso', ara: 'Árabe', hin: 'Hindi',
  dut: 'Neerlandés', nld: 'Neerlandés', cze: 'Checo', ces: 'Checo', rum: 'Rumano', ron: 'Rumano',
  gre: 'Griego', ell: 'Griego', per: 'Persa', fas: 'Persa', swe: 'Sueco', dan: 'Danés', nor: 'Noruego',
  nob: 'Noruego', fin: 'Finés', pol: 'Polaco', tur: 'Turco', ukr: 'Ucraniano', heb: 'Hebreo',
  tha: 'Tailandés', vie: 'Vietnamita', ind: 'Indonesio', hun: 'Húngaro', srp: 'Serbio', asm: 'Asamés',
};

export const idioma = (codigo: string | null | undefined) => {
  if (!codigo) return 'Desconocido';
  const c = codigo.toLowerCase().trim();
  if (c === 'und' || c === 'unavailable' || c === 'unknown') return 'Desconocido';
  return IDIOMAS[c] || codigo.toUpperCase();
};

/**
 * `raw=1` entrega el fichero original. AVPlay descodifica MKV, HEVC y AC3 por
 * hardware, así que remultiplexar para la tele solo gastaría CPU del servidor y
 * estropearía el audio multicanal.
 */
/**
 * Detecta la plataforma de Smart TV donde corre la aplicación:
 * - 'tizen': Samsung Smart TV (AVPlay nativo).
 * - 'webos': LG Smart TV (HTML5 <video> nativo).
 * - 'web': navegador de desarrollo o equipo genérico.
 */
export function plataformaTV(): 'tizen' | 'webos' | 'web' {
  const w = window as unknown as { tizen?: unknown; webapis?: unknown; webOS?: unknown; webOSTV?: unknown };
  if (w.tizen || w.webapis) return 'tizen';
  if (w.webOS || w.webOSTV || /web0s|webos/i.test(navigator.userAgent)) return 'webos';
  return 'web';
}

/** Obtiene el perfil de reproducción según la plataforma y la opción de passthrough avanzado. */
export function perfilReproduccion(): string {
  const base = plataformaTV() === 'webos' ? 'lgwebos' : 'samsung2021';
  if (ajustes().passthroughAvanzado) {
    return 'lista:aac,ac3,eac3,eac3_ddp_atmos,eac3/atmos,mp3,opus,pcm_s16le,pcm_s24le,flac,dts,dtshd_ma,dts_express,truehd,truehd_atmos';
  }
  return base;
}

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
  compat = false,
): string {
  const t = token();
  return (
    servidor() + '/api/play/' + fileId + '/stream?raw=1&perfil=' + perfilReproduccion() +
    (audioId !== undefined ? '&audio=' + audioId : '') +
    // Solo se manda cuando no es «normal»: en normal la pista va intacta y la
    // barra recibe el Atmos tal cual.
    (modoAudio !== 'normal' ? '&audiomode=' + modoAudio : '') +
    (compat ? '&compat=1' : '') +
    // Solo tiene sentido con audio convertido: ahi el flujo va por tuberia y no
    // admite saltos, asi que para moverse hay que volver a pedirlo ya cortado.
    (desdeSegundos > 0 ? '&t=' + Math.floor(desdeSegundos) : '') +
    (t ? '&token=' + encodeURIComponent(t) : '')
  );
}
