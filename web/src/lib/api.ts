export type ItemSummary = {
  id: number;
  kind: 'movie' | 'show';
  title: string;
  year: number | null;
  rating: number | null;
  runtime: number | null;
  mpaa: string | null;
  tagline: string | null;
  has_poster: number;
  has_fanart: number;
  has_logo: number;
  has_landscape: number;
  library_id: number;
  library_name: string;
  position?: number;
  progressDuration?: number;
  watched?: number;
  episode_id?: number | null;
  plot?: string;
  character?: string;
  role?: string;
};

export type MediaFile = {
  id: number;
  size: number;
  container: string;
  duration: number | null;
  video_codec: string | null;
  width: number | null;
  height: number | null;
  hdr: string | null;
  episode_id: number | null;
  name: string;
  audio: { codec: string; language: string | null; channels: number | null }[];
  subtitles: { language: string | null; forced: number; is_external: number }[];
};

export type Episode = {
  id: number;
  season: number;
  episode: number;
  title: string | null;
  plot: string | null;
  aired: string | null;
  runtime: number | null;
  rating: number | null;
  has_thumb: number;
  file_id: number | null;
  duration: number | null;
  height: number | null;
  video_codec: string | null;
};

export type ItemDetail = ItemSummary & {
  /** El disco redondo del Blu-ray, si lo hay: gira en la pausa del reproductor. */
  has_discart?: number;
  plot: string | null;
  original_title: string | null;
  premiered: string | null;
  studio: string | null;
  country: string | null;
  collection: string | null;
  imdb_id: string | null;
  votes: number | null;
  genres: string[];
  cast: { id: number; name: string; character: string | null; role: string; has_thumb: number }[];
  files: MediaFile[];
  episodes?: Episode[];
  similar?: ItemSummary[];
  collectionItems?: ItemSummary[];
  progress: { episode_id: number | null; position: number; duration: number | null; watched: number }[];
  /** 1 si el perfil actual lo tiene en favoritos. */
  favorite: number;
  /** Nota de cada sitio con su escala: IMDb y TMDb sobre 10, los tomatómetros sobre 100. */
  ratings?: { fuente: string; etiqueta: string; valor: number; maximo: number; votos: number }[];
  nextUp?: { id: number; season: number; episode: number; title: string | null; position?: number };
};

export type PlayInfo = {
  fileId: number;
  title: string;
  duration: number;
  video: { codec: string; width: number; height: number; hdr?: string; profile?: string } | null;
  plan: { mode: 'direct' | 'remux' | 'transcode'; videoAction: string; audioAction: string; reasons: string[] };
  audio: { id: number; codec: string; language: string | null; channels: number | null; title: string | null; default: boolean }[];
  subtitles: { id: string; language: string | null; title: string | null; forced: boolean; source: 'embedded' | 'external' }[];
};

export type PapelArte = 'poster' | 'fanart' | 'clearlogo' | 'landscape';

export type ImagenDisponible = {
  url: string;
  vista: string;
  ancho: number;
  alto: number;
  idioma: string;
  voto: number;
};

export type User = { id: number; name: string; color: string | null; is_admin: number; has_pin?: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  /*
   * Si hay cuerpo, hay cabecera. Sin `Content-Type` Fastify no parsea el JSON,
   * la ruta ve los campos vacios y contesta 400 sin decir gran cosa: dos
   * llamadas nuevas se escribieron asi y fallaban en silencio.
   */
  const cabeceras = init?.body && !init?.headers ? { 'Content-Type': 'application/json' } : init?.headers;
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: cabeceras });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(body.error ?? 'Error de red'), { status: res.status });
  }
  return res.json() as Promise<T>;
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

export type PropuestaAnime = {
  id: string;
  fuente: 'kitsu' | 'mal' | 'anilist';
  titulo: string;
  tituloOriginal: string | null;
  anio: number | null;
  formato: string | null;
  episodios: number | null;
  sinopsis: string | null;
  nota: number | null;
  portadaUrl: string | null;
  fondoUrl: string | null;
  generos: string[];
  sinonimos: string[];
};

export type AspiranteAnime = { propuesta: PropuestaAnime; confianza: 'exact' | 'strong' | 'weak'; porque: string };

export type CandidatoAnime = {
  itemId: number;
  titulo: string;
  anio: number | null;
  episodiosEnDisco: number;
  confianza: 'exact' | 'strong' | 'weak';
  coincidePor: string;
  propuesta: PropuestaAnime | null;
  alternativas: AspiranteAnime[];
};

export type DescargaItem = {
  id: number;
  file_id: number;
  perfil: 'movil' | 'tablet' | 'original';
  estado: 'preparando' | 'lista' | 'error';
  bytes: number | null;
  progreso: number;
  error: string | null;
  titulo: string;
  creado: string;
};

export type Estadisticas = {
  biblioteca: {
    titulos: number; peliculas: number; series: number; episodios: number;
    ficheros: number; bytes: number; segundos: number;
    porBiblioteca: { nombre: string; titulos: number; bytes: number }[];
    resolucion: { etiqueta: string; n: number; bytes: number }[];
    codec: { etiqueta: string; n: number; bytes: number }[];
    hdr: { etiqueta: string; n: number }[];
    audio: { etiqueta: string; n: number }[];
    idiomasAudio: { etiqueta: string; n: number }[];
    subtitulos: { con: number; sin: number };
  };
  actividad: {
    dias: number; sesiones: number; segundos: number; titulos: number;
    porDia: { dia: string; segundos: number; sesiones: number }[];
    porUsuario: { nombre: string; segundos: number; sesiones: number }[];
    porCliente: { nombre: string; segundos: number; sesiones: number }[];
    porModo: { nombre: string; sesiones: number }[];
    masVistos: { itemId: number; titulo: string; segundos: number; sesiones: number }[];
    reciente: { itemId: number; titulo: string; usuario: string; cuando: string; segundos: number; episodio: string | null }[];
  };
  salud: {
    sinMetadatos: number; sinAnalizar: number; sinSubtitulos: number; episodiosSinFichero: number;
    sinFichero: { id: number; titulo: string; tipo: string }[];
    duplicados: { titulo: string; anio: number | null; n: number }[];
  };
};

export type EstadoNumeracion = {
  showId: number;
  titulo: string;
  tmdbId: string | null;
  total: number;
  temporadas: { temporada: number; episodios: number; primero: number; ultimo: number }[];
  tipo: 'absoluta' | 'hueco' | null;
  sospechoso: boolean;
  motivo: string | null;
  renumerado: boolean;
};

export type PlanNumeracion = {
  showId: number;
  origen: string;
  reparto: { temporada: number; episodios: number }[];
  cambios: { episodeId: number; titulo: string | null; antes: string; despues: string; cambia: boolean }[];
  mueve: number;
  sobran: number;
  aviso: string | null;
};

export const api = {
  me: () => request<User>('/api/me'),
  /** Poner, cambiar o quitar el PIN. Cadena vacia lo quita. */
  cambiarPin: (userId: number, pin: string, actual: string) =>
    post<{ ok: true; tienePin: boolean; sesionesCerradas: number }>(`/api/users/${userId}/pin`, { pin, actual }),
  users: () => request<{ users: User[]; setupNeeded: boolean }>('/api/users'),
  createUser: (name: string, pin?: string) => post<{ id: number }>('/api/users', { name, pin: pin || undefined }),
  login: (userId: number, pin?: string) => post<User>('/api/auth/login', { userId, pin }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),

  home: () => request<{ hero: ItemSummary[]; rows: { key: string; title: string; kind: string; items: ItemSummary[] }[] }>('/api/home'),
  libraries: () => request<{ id: number; name: string; kind: string; count: number }[]>('/api/libraries'),
  genres: (library?: number) => request<{ id: number; name: string; count: number }[]>(`/api/genres${library ? `?library=${library}` : ''}`),
  items: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [string, string][],
    );
    return request<{ total: number; items: ItemSummary[] }>(`/api/items?${qs}`);
  },
  item: (id: number) => request<ItemDetail>(`/api/items/${id}`),
  person: (id: number) => request<{ id: number; name: string; has_thumb: number; credits: ItemSummary[] }>(`/api/people/${id}`),
  search: (q: string) =>
    request<{ items: ItemSummary[]; people: { id: number; name: string; has_thumb: number; count: number }[] }>(
      `/api/search?q=${encodeURIComponent(q)}`,
    ),
  /** Manda el texto a la televisión, que lo recoge en su pantalla de buscar. */
  buscarEnLaTele: (texto: string) =>
    request<{ enviado: string }>('/api/mando/buscar', { method: 'POST', body: JSON.stringify({ texto }) }),
  stats: () => request<{ movies: number; shows: number; episodes: number; users: number; bytes: number }>('/api/stats'),
  sessions: () => request<{ id: string; title: string; mode: string; reasons: string[]; startedAt: string }[]>('/api/sessions'),

  playInfo: (fileId: number) => request<PlayInfo>(`/api/play/${fileId}/info?${capsQuery()}`),
  saveProgress: (body: { itemId: number; episodeId?: number | null; position: number; duration?: number; watched?: boolean }) =>
    post<{ ok: true }>('/api/progress', body),
  setWatched: (itemId: number, watched: boolean, episodeId?: number | null) =>
    post<{ ok: true }>(`/api/items/${itemId}/watched`, { watched, episodeId }),
  favorite: (itemId: number, favorite: boolean) => post<{ ok: true }>(`/api/items/${itemId}/favorite`, { favorite }),
  favorites: () => request<ItemSummary[]>('/api/favorites'),
  scan: () => post<{ started: boolean }>('/api/scan'),
  pairDevice: (code: string) => post<{ ok: true; user: string }>('/api/auth/device/claim', { code }),

  serverSettings: () => request<ServerSettings>('/api/server-settings'),
  saveServerSettings: (patch: Partial<ServerSettings> & { tmdbApiKey?: string }) =>
    request<{ ok: true; hasTmdbKey: boolean }>('/api/server-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  enrichStatus: () => request<EnrichStatus>('/api/enrich/status'),
  enrichScan: (limit: number) => post<{ started: boolean }>('/api/enrich/scan', { limit }),
  enrichCandidates: () => request<{ running: boolean; done: number; total: number; error: string | null; candidates: Candidate[] }>('/api/enrich/candidates'),
  enrichSearch: (query: string, kind: 'movie' | 'show', year?: number | null) =>
    post<{ results: Proposal[] }>('/api/enrich/search', { query, kind, year }),
  enrichApply: (body: { itemId: number; tmdbId: number; kind: 'movie' | 'show'; fields: string[]; overwrite?: boolean }) =>
    post<{ applied: string[]; title: string }>('/api/enrich/apply', body),
  enrichDismiss: (itemId: number) => post<{ ok: true }>('/api/enrich/dismiss', { itemId }),

  skipRanges: (episodeId: number) => request<{ ranges: SkipRange[] }>(`/api/episodes/${episodeId}/skip`),
  skipStatus: () => request<{ job: SkipJob; shows: SkipShow[] }>('/api/skip/status'),
  detectSkips: (showId: number, kind: 'cabecera' | 'creditos') => post<{ started: boolean }>('/api/skip/detect', { showId, kind }),

  searchDialogue: (q: string) =>
    request<{ hits: DialogueHit[]; stats: DialogueStats; error?: string }>(`/api/search/dialogue?q=${encodeURIComponent(q)}`),
  dialogueStatus: (language = 'spa') => request<DialogueStats>(`/api/dialogue/status?language=${encodeURIComponent(language)}`),
  indexDialogue: (language: string, reset = false) => post<{ started: boolean }>('/api/dialogue/index', { language, reset }),

  collections: () => request<CollectionSummary[]>('/api/collections'),
  collection: (name: string) => request<{ name: string; items: ItemSummary[] }>(`/api/collections/${encodeURIComponent(name)}`),

  trickplay: async (fileId: number): Promise<Trickplay | null> => {
    const res = await fetch(`/api/play/${fileId}/trickplay`, { credentials: 'same-origin' });
    if (res.status === 200) return res.json();
    return null;
  },

  enrichItem: (itemId: number) => request<Candidate>(`/api/enrich/item/${itemId}`),
  /** Todas las imagenes que TMDb tiene de ese titulo, por papeles. */
  enrichImagenes: (kind: 'movie' | 'show', tmdbId: number) =>
    request<Record<PapelArte, ImagenDisponible[]>>(`/api/enrich/imagenes/${kind}/${tmdbId}`),
  /** Poner una imagen concreta; con url null se suelta y vuelve la de la carpeta. */
  ponerArte: (itemId: number, papel: PapelArte, url: string | null) =>
    post<{ papel: PapelArte }>('/api/enrich/arte', { itemId, papel, url }),

  animeItem: (itemId: number) => request<CandidatoAnime>(`/api/anime/item/${itemId}`),
  animeSearch: (query: string, year?: number | null) =>
    post<{ results: PropuestaAnime[] }>('/api/anime/search', { query, year }),
  animeApply: (body: { itemId: number; animeId: string; campos: string[]; overwrite?: boolean }) =>
    post<{ aplicado: string[]; titulo: string; fuente: string }>('/api/anime/apply', body),

  descargas: () => request<{ perfiles: Record<string, { nombre: string }>; descargas: DescargaItem[] }>('/api/descargas'),
  descargaPedir: (fileId: number, perfil: 'movil' | 'tablet' | 'original') =>
    post<DescargaItem>('/api/descargas', { fileId, perfil }),
  descargaBorrar: (id: number) => request<{ borrado: true }>(`/api/descargas/${id}`, { method: 'DELETE' }),
  descargaUrl: (id: number) => `/api/descargas/${id}/fichero`,

  estadisticas: (dias = 30) => request<Estadisticas>(`/api/estadisticas?dias=${dias}`),

  numeracion: (showId: number) => request<EstadoNumeracion>(`/api/numeracion/${showId}`),
  numeracionSospechosas: () => request<{ series: EstadoNumeracion[] }>('/api/numeracion/sospechosas'),
  numeracionPlan: (showId: number, body: { modo?: string; reparto?: number[]; temporada?: number; desde?: number; delta?: number }) =>
    post<PlanNumeracion>(`/api/numeracion/${showId}/plan`, body),
  numeracionAplicar: (showId: number, plan: PlanNumeracion) =>
    post<{ movidos: number; estado: EstadoNumeracion }>(`/api/numeracion/${showId}/aplicar`, plan),

  capabilities: (force = false) => request<Capabilities>(`/api/capabilities${force ? '?force=1' : ''}`),
  applyCapabilities: () => post<{ applied: Capabilities['best'] }>('/api/capabilities/apply'),

  subtitlesAvailable: () => request<{ available: boolean; script: string }>('/api/subtitles/available'),
  subtitlesJob: () => request<SubtitleJob>('/api/subtitles/job'),
  subtitlesFetch: (body: { fileId: number; languages?: string; forced?: boolean; mux?: boolean; localOnly?: boolean; dryRun?: boolean }) =>
    post<{ started: boolean; title: string }>('/api/subtitles/fetch', body),
  transcribeJob: () => request<TranscribeJob>('/api/subtitles/transcribe'),
  transcribe: (body: { fileId?: number; fileIds?: number[]; model?: string; language?: string; force?: boolean }) =>
    post<{ started: boolean; title: string }>('/api/subtitles/transcribe', body),
  stopTranscribe: () => post<{ ok: true }>('/api/subtitles/transcribe/stop'),
  missingSubtitles: (limit = 60) =>
    request<{ stats: { ficheros: number; horas: number }; files: MissingSubtitleFile[] }>(`/api/subtitles/missing?limit=${limit}`),
};

export type MissingSubtitleFile = {
  id: number;
  duration: number | null;
  title: string;
  season: number | null;
  episode: number | null;
  library: string;
};

export type TranscribeJob = {
  running: boolean;
  fileId: number | null;
  title: string;
  log: string[];
  result: { frases: number; idioma: string; segundos: number } | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  queue: number[];
  done: number;
  failed: number;
};

export type SkipRange = { kind: 'intro' | 'credits'; start_s: number; end_s: number; confidence: number };

export type SkipJob = {
  running: boolean;
  showId: number | null;
  showTitle: string;
  season: number | null;
  kind: string;
  found: number;
  error: string | null;
  finishedAt: string | null;
};

export type SkipShow = { id: number; title: string; episodes: number; intros: number; credits: number };

export type DialogueHit = {
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

export type EstadoIndexado = {
  enCurso: boolean;
  idioma: string;
  hechos: number;
  total: number;
  frases: number;
  empezadoEn: string | null;
  terminadoEn: string | null;
  error: string | null;
};
export type DialogueStats = {
  ficheros: number;
  frases: number;
  disponibles: number;
  pendientes: number;
  indexado: EstadoIndexado;
};

export type CollectionSummary = {
  name: string;
  count: number;
  first_year: number | null;
  last_year: number | null;
  poster_id: number | null;
  fanart_id: number | null;
  seen?: number;
};

export type Trickplay = {
  fileId: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  sheets: number;
  times: number[];
};

export const trickplaySheet = (fileId: number, index: number) => `/api/play/${fileId}/trickplay/${index}.jpg`;

export type Capabilities = {
  detectedAt: string;
  cpu: { model: string; cores: number; memoryGb: number };
  gpus: { name: string; driver: string; memoryMb: number | null }[];
  hwaccels: string[];
  encoders: { name: string; label: string; compiled: boolean; working: boolean; realtimeFactor: number | null; note?: string }[];
  tonemap: { supported: boolean; note: string };
  best: { hwaccel: 'qsv' | 'none'; encoder: string; transcodeQuality: number; tonemap: boolean; concurrentStreams: number };
  notes: string[];
};

export type SubtitleJob = {
  running: boolean;
  fileId: number | null;
  title: string;
  log: string[];
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: string | null;
};

export type ServerSettings = {
  readOnly: boolean;
  hwaccel: 'qsv' | 'none';
  transcodeQuality: number;
  tonemap: boolean;
  tmdbLanguage: string;
  hasTmdbKey: boolean;
  port: number;
  transcodeDir: string;
  libraries: { name: string; path: string; kind: string }[];
};

export type Proposal = {
  tmdbId: number;
  kind: 'movie' | 'show';
  title: string;
  originalTitle?: string;
  year: number | null;
  overview: string | null;
  rating: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  logoUrl: string | null;
  genres: string[];
};

export type Candidate = {
  itemId: number;
  title: string;
  year: number | null;
  kind: 'movie' | 'show';
  libraryName: string;
  missing: string[];
  confidence: 'exact' | 'strong' | 'weak';
  matchedBy: string;
  proposal: Proposal | null;
  alternatives: Proposal[];
};

export type EnrichStatus = {
  configured: boolean;
  missing: { total: number; sin_poster: number; sin_fondo: number; sin_logo: number; sin_sinopsis: number; sin_valoracion: number };
  job: { running: boolean; done: number; total: number; error: string | null; finishedAt: string | null; found: number };
};

export const img = {
  poster: (id: number, w = 320) => `/api/items/${id}/poster?w=${w}`,
  fanart: (id: number, w = 1600) => `/api/items/${id}/fanart?w=${w}`,
  logo: (id: number, w = 500) => `/api/items/${id}/logo?w=${w}`,
  landscape: (id: number, w = 640) => `/api/items/${id}/landscape?w=${w}`,
  discart: (id: number, w = 600) => `/api/items/${id}/discart?w=${w}`,
  episode: (id: number, w = 420) => `/api/episodes/${id}/thumb?w=${w}`,
  person: (id: number, w = 160) => `/api/people/${id}/thumb?w=${w}`,
};

function supports(type: string): boolean {
  if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type)) return true;
  const probe = document.createElement('video');
  return probe.canPlayType(type) === 'probably';
}

let cachedCaps: string | null = null;

/** The server needs to know what this browser can decode before choosing copy vs encode. */
export function capsQuery(): string {
  if (cachedCaps) return cachedCaps;
  const params = new URLSearchParams();
  if (supports('video/mp4; codecs="hvc1.1.6.L93.B0"')) params.set('hevc', '1');
  if (supports('audio/mp4; codecs="ac-3"')) params.set('ac3', '1');
  if (supports('audio/mp4; codecs="ec-3"')) params.set('eac3', '1');
  cachedCaps = params.toString();
  return cachedCaps;
}

/**
 * ¿Estamos en casa?
 *
 * Dentro de la red local la tubería directa es mejor: una sola conexión, sin
 * trocear y sin recodificar. Fuera —por Tailscale o con datos— conviene HLS,
 * que baja la calidad solo si la línea no da y reintenta trozo a trozo en vez
 * de cortar la película.
 */
export function enRedLocal(): boolean {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // `.local` es Bonjour; el resto de nombres son de fuera.
  return h.endsWith('.local');
}

export function hlsUrl(
  fileId: number,
  opts: { audio?: number; downmix?: boolean; normalize?: boolean; audioMode?: string; audioDelayMs?: number } = {},
): string {
  const params = new URLSearchParams();
  if (opts.audio !== undefined) params.set('audio', String(opts.audio));
  if (opts.downmix === false) params.set('downmix', '0');
  if (opts.normalize) params.set('normalize', '1');
  if (opts.audioMode && opts.audioMode !== 'normal') params.set('audiomode', opts.audioMode);
  if (opts.audioDelayMs) params.set('audiodelay', String(Math.round(opts.audioDelayMs)));
  const q = params.toString();
  return `/api/play/${fileId}/hls/master.m3u8${q ? `?${q}` : ''}`;
}

export function streamUrl(
  fileId: number,
  opts: { t?: number; audio?: number; maxHeight?: number; downmix?: boolean; normalize?: boolean; audioMode?: string; audioDelayMs?: number } = {},
): string {
  const params = new URLSearchParams(capsQuery());
  if (opts.t) params.set('t', String(Math.floor(opts.t)));
  if (opts.audio !== undefined) params.set('audio', String(opts.audio));
  if (opts.maxHeight) params.set('maxHeight', String(opts.maxHeight));
  if (opts.downmix === false) params.set('downmix', '0');
  if (opts.normalize) params.set('normalize', '1');
  if (opts.audioMode && opts.audioMode !== 'normal') params.set('audiomode', opts.audioMode);
  if (opts.audioDelayMs) params.set('audiodelay', String(Math.round(opts.audioDelayMs)));
  return `/api/play/${fileId}/stream?${params}`;
}

export type ResyncState = { measuring: boolean; offsetMs: number | null; sigma: number | null; method: string | null };

export const subtitleSync = {
  state: (fileId: number, trackId: string) =>
    fetch(`/api/play/${fileId}/resync/${trackId}`, { credentials: 'same-origin' }).then((r) => r.json() as Promise<ResyncState>),
  start: (fileId: number, trackId: string, audio: number) =>
    fetch(`/api/play/${fileId}/resync/${trackId}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio }),
    }).then((r) => r.json()),
  setOffset: (fileId: number, trackId: string, offsetMs: number) =>
    fetch(`/api/play/${fileId}/offsets/${trackId}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offsetMs }),
    }).then((r) => r.json()),
};

export const subtitleUrl = (fileId: number, trackId: string) => `/api/play/${fileId}/subtitle/${trackId}.vtt`;
