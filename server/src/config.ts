import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..', '..');
/*
 * Variables de entorno de MediaWatch Server (la app de escritorio las pone al
 * lanzar el servidor). Sin ellas, todo queda como en el HTPC original.
 *   MEDIAWATCH_DATA_DIR   carpeta de datos del usuario; activa el modo «portable»:
 *                         sin las bibliotecas de E:\ ni la carpeta temporal de G:\
 *   MEDIAWATCH_HOST/PORT  direccion de escucha (127.0.0.1 mientras dura el asistente)
 *   MEDIAWATCH_FFMPEG / _FFPROBE / _PYTHON / _TMP_DIR / _SUBSFETCH
 */
const env = (nombre: string): string => (process.env[nombre] ?? '').trim();
const PORTABLE = env('MEDIAWATCH_DATA_DIR') !== '';
/** Instalacion de MediaWatch Server (sin .nfo ni bibliotecas de tinyMediaManager). */
export const MODO_PORTABLE = PORTABLE;
export const DATA_DIR = PORTABLE ? resolve(env('MEDIAWATCH_DATA_DIR')) : join(ROOT, 'data');
export const CONFIG_PATH = join(DATA_DIR, 'config.json');

export type LibraryKind = 'movie' | 'show';

export type LibraryConfig = {
  name: string;
  path: string;
  kind: LibraryKind;
};

export type AppConfig = {
  port: number;
  host: string;
  libraries: LibraryConfig[];
  transcodeDir: string;
  ffmpeg: string;
  ffprobe: string;
  python: string;
  hwaccel: 'qsv' | 'none';
  transcodeQuality: number;
  tonemap: boolean;
  tmdbApiKey: string;
  tmdbLanguage: string;
  /** Clave de OMDb: trae IMDb, Rotten Tomatoes y Metacritic de una vez. */
  omdbApiKey: string;
  /** Clave de fanart.tv: logotipos, fondos y apaisadas que TMDb no tiene. */
  fanartApiKey: string;
  /** Clave de TheTVDB v4: segunda fuente de logotipos, con el idioma puesto. */
  tvdbApiKey: string;
  /**
   * Clave de Watchmode: el enlace directo a un título dentro de Prime, Movistar+ o
   * Apple TV+. Plan gratuito: 2.500 llamadas al mes, caché de 30 días como máximo
   * y atribución obligatoria. Sin clave, «Ver» solo abre la app de la plataforma.
   */
  watchmodeApiKey: string;
  /*
   * Direccion publica, si la hay: `https://tv.midominio.org`.
   *
   * Existe para que los clientes no tengan que saberla. Se configura una vez
   * aqui y cada aparato se la descarga al conectarse dentro de casa, igual que
   * Plex le dice a sus aplicaciones cual es su direccion de fuera. Sin esto
   * habria que escribirla a mano en cada movil, y volver a escribirla el dia
   * que cambie el dominio.
   */
  publicUrl: string;
};

const DEFAULT_LIBRARIES: LibraryConfig[] = [
  { name: 'Películas', path: 'E:\\Peliculas', kind: 'movie' },
  { name: 'Animación', path: 'E:\\Pelis Animacion', kind: 'movie' },
  { name: 'Peques', path: 'E:\\Peques', kind: 'movie' },
  { name: 'Documentales', path: 'E:\\Docupelis', kind: 'movie' },
  { name: 'Conciertos', path: 'E:\\Conciertos', kind: 'movie' },
  { name: 'Monólogos', path: 'E:\\Monologos', kind: 'movie' },
  { name: 'Series', path: 'E:\\Series', kind: 'show' },
  { name: 'Docuseries', path: 'E:\\Docuseries', kind: 'show' },
  { name: 'Series Peques', path: 'E:\\Series Peques', kind: 'show' },
];

/*
 * ffmpeg y ffprobe por ruta absoluta, nunca por el PATH.
 *
 * El servidor lo arranca un vigilante desde el inicio de sesion, y en ese
 * entorno el PATH es el minimo de Windows: `spawn ffprobe ENOENT`, y con eso se
 * caen a la vez las pistas de audio, los subtitulos, las miniaturas, la
 * transcodificacion y el HLS. Desde la consola funcionaba porque heredaba el
 * PATH de la consola, y por eso tardo en verse.
 *
 * Es la misma regla que ya tenia el pipeline en `mediabox-paths.ps1`. Se
 * prueban las rutas conocidas y solo si ninguna existe se cae al nombre pelado.
 */
// Barras normales a proposito: Node las acepta en Windows y no tienen secuencias
// de escape. Con barras invertidas, '\U' se comia la letra y la ruta salia mal.
const RUTAS_FFMPEG = [
  'C:/Users/HTPC/AppData/Local/Microsoft/WinGet/Links',
  'C:/ffmpeg/bin',
  'C:/Program Files/ffmpeg/bin',
];

const RUTAS_PYTHON = [
  'C:/Users/HTPC/AppData/Local/Programs/Python/Python314',
  'C:/Users/HTPC/AppData/Local/Programs/Python/Python313',
  'C:/Python314',
  'C:/Python313',
];

function localizar(nombre: 'ffmpeg' | 'ffprobe' | 'python'): string {
  const deEntorno = env('MEDIAWATCH_' + nombre.toUpperCase());
  if (deEntorno) return deEntorno;
  const dirs = nombre === 'python' ? RUTAS_PYTHON : RUTAS_FFMPEG;
  for (const dir of dirs) {
    const ruta = join(dir, nombre + '.exe');
    if (existsSync(ruta)) return ruta;
  }
  return nombre;
}

function defaultConfig(): AppConfig {
  return {
    port: 8730,
    host: '0.0.0.0',
    publicUrl: '',
    libraries: PORTABLE ? [] : DEFAULT_LIBRARIES.filter((l) => existsSync(l.path)),
    transcodeDir: env('MEDIAWATCH_TMP_DIR') || (!PORTABLE && existsSync('G:\\') ? 'G:\\TvWatchTmp' : join(DATA_DIR, 'transcode')),
    ffmpeg: localizar('ffmpeg'),
    ffprobe: localizar('ffprobe'),
    python: localizar('python'),
    hwaccel: 'qsv',
    transcodeQuality: 20,
    tonemap: true,
    tmdbApiKey: '',
    tmdbLanguage: 'es-ES',
    omdbApiKey: '',
    fanartApiKey: '',
    tvdbApiKey: '',
    watchmodeApiKey: '',
  };
}

/*
 * Las variables de entorno mandan sobre config.json, pero no se guardan en el:
 * si la app cambia de sitio ffmpeg o el asistente pone 127.0.0.1, el siguiente
 * arranque tiene que poder volver a lo que hubiera antes.
 */
const POR_ENTORNO: Partial<Record<keyof AppConfig, string>> = {
  host: env('MEDIAWATCH_HOST'),
  port: env('MEDIAWATCH_PORT'),
  ffmpeg: env('MEDIAWATCH_FFMPEG'),
  ffprobe: env('MEDIAWATCH_FFPROBE'),
  python: env('MEDIAWATCH_PYTHON'),
  transcodeDir: env('MEDIAWATCH_TMP_DIR'),
};
let guardadoPrevio: Partial<AppConfig> = {};

function load(): AppConfig {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    const cfg = defaultConfig();
    aplicarEntorno(cfg);
    const aDisco: Partial<AppConfig> = { ...cfg };
    for (const k of Object.keys(POR_ENTORNO) as (keyof AppConfig)[]) if (POR_ENTORNO[k]) delete aDisco[k];
    writeFileSync(CONFIG_PATH, JSON.stringify(aDisco, null, 2), 'utf8');
    return cfg;
  }
  const guardado = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<AppConfig>;
  guardadoPrevio = guardado;
  const cfg = { ...defaultConfig(), ...guardado };
  // Un config.json antiguo trae «ffmpeg» a secas: no vale en el entorno del
  // vigilante, asi que se resuelve igual que el valor por defecto.
  if (cfg.ffmpeg === 'ffmpeg') cfg.ffmpeg = localizar('ffmpeg');
  if (cfg.ffprobe === 'ffprobe') cfg.ffprobe = localizar('ffprobe');
  if (!cfg.python || cfg.python === 'python') cfg.python = localizar('python');
  aplicarEntorno(cfg);
  return cfg;
}

function aplicarEntorno(cfg: AppConfig) {
  const o = POR_ENTORNO;
  if (o.host) cfg.host = o.host;
  if (o.port && Number.isInteger(Number(o.port))) cfg.port = Number(o.port);
  if (o.ffmpeg) cfg.ffmpeg = o.ffmpeg;
  if (o.ffprobe) cfg.ffprobe = o.ffprobe;
  if (o.python) cfg.python = o.python;
  if (o.transcodeDir) cfg.transcodeDir = o.transcodeDir;
}

export const config = load();

// Los scripts de Python que lanza el servidor leen la ruta de ffmpeg de aqui
// (heredan el entorno del proceso).
process.env.MEDIAWATCH_FFMPEG = config.ffmpeg;

export function saveConfig(next: AppConfig) {
  const aDisco: Partial<AppConfig> = { ...next };
  for (const k of Object.keys(POR_ENTORNO) as (keyof AppConfig)[]) {
    if (!POR_ENTORNO[k]) continue;
    if (k in guardadoPrevio) (aDisco as Record<string, unknown>)[k] = guardadoPrevio[k];
    else delete aDisco[k];
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(aDisco, null, 2), 'utf8');
  Object.assign(config, next);
}

mkdirSync(config.transcodeDir, { recursive: true });
