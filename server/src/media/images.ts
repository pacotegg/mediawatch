import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { access, stat as statAsync, utimes } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { DATA_DIR, config } from '../config.ts';
import { db } from '../db.ts';
import { hermanaDeArte } from './arte-hermana.ts';

const CACHE_DIR = join(DATA_DIR, 'cache', 'images');
mkdirSync(CACHE_DIR, { recursive: true });

// Cada miniatura es un proceso de ffmpeg de vida corta; con 16 hilos, cuatro a
// la vez dejaban la primera visita a una biblioteca esperando sin necesidad.
const MAX_PARALLEL = 8;
let running = 0;
const queue: (() => void)[] = [];

function acquire(): Promise<void> {
  if (running < MAX_PARALLEL) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => { running++; resolve(); }));
}

function release() {
  running--;
  queue.shift()?.();
}

const inFlight = new Map<string, Promise<string>>();

/** Resizes with ffmpeg and caches to disk; returns the path to serve. */
/*
 * Todo el sistema de ficheros de aqui es asincrono. Se llama una vez por
 * caratula, tambien cuando ya esta en cache, y el `stat` del original va a E:
 * (disco duro): medido el 07/10, p99 9,4 ms y maximo 14,5 ms por llamada con el
 * disco despierto. Sincrono, una rejilla entera paraba el bucle segundos.
 */
const existe = (ruta: string) => access(ruta).then(() => true, () => false);

/*
 * Sellos (fecha y tamano) de las imagenes de la BIBLIOTECA.
 *
 * La clave de la miniatura lleva la fecha y el tamano del original, asi que cada peticion hacia un `stat` en E: aunque la
 * miniatura estuviera ya en C:. Ahora esos dos datos salen de `imagen_sello`, que rellena el escaner (y la primera peticion,
 * si falta). Las claves son las mismas de siempre: no se rehace ninguna miniatura.
 *
 * Solo para lo que hay FUERA de data/: ahi escriben otros modulos con el mismo nombre de fichero (poster.webp...) y un sello
 * atrasado serviria la imagen vieja; un `stat` en C: es barato. Coste de lo de E:: si alguien cambia una imagen sin que pase
 * un escaneo (cada 24 h, al arrancar y al reescanear un titulo), se sirve la miniatura anterior hasta entonces.
 */
const sello = {
  leer: db.prepare('SELECT mtime_ms, size FROM imagen_sello WHERE ruta = ?'),
  poner: db.prepare('INSERT INTO imagen_sello (ruta, mtime_ms, size) VALUES (?,?,?) ON CONFLICT(ruta) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size'),
  quitar: db.prepare('DELETE FROM imagen_sello WHERE ruta = ?'),
};

function esDeLosDatos(ruta: string): boolean {
  const r = relative(DATA_DIR, ruta);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/** Lo que hace el escaner con cada imagen de la biblioteca: mide una vez y lo apunta (o lo quita si ya no esta). */
export function refrescarSello(ruta: string | null | undefined): void {
  if (!ruta || esDeLosDatos(ruta)) return;
  try {
    const st = statSync(ruta);
    sello.poner.run(ruta, st.mtimeMs, st.size);
  } catch {
    sello.quitar.run(ruta);
  }
}

async function selloDe(ruta: string): Promise<{ mtimeMs: number; size: number }> {
  if (!esDeLosDatos(ruta)) {
    const f = sello.leer.get(ruta) as { mtime_ms: number; size: number } | undefined;
    if (f) return { mtimeMs: f.mtime_ms, size: f.size };
  }
  const st = await statAsync(ruta);
  if (!esDeLosDatos(ruta)) sello.poner.run(ruta, st.mtimeMs, st.size);
  return { mtimeMs: st.mtimeMs, size: st.size };
}

export async function thumbnail(source: string, width: number): Promise<string> {
  let stat;
  try {
    stat = await selloDe(source);
  } catch {
    // La fila puede ser de antes de pasar el arte a WebP: se prueba la hermana (.webp, .jpg, .png).
    const hermana = await hermanaDeArte(source);
    if (!hermana) throw new Error('imagen no encontrada');
    return thumbnail(hermana, width);
  }

  const key = createHash('sha1').update(`${source}|${stat.mtimeMs}|${stat.size}|${width}`).digest('hex');
  const out = join(CACHE_DIR, `${key}.webp`);
  if (await existe(out)) {
    const ahora = new Date();
    utimes(out, ahora, ahora).catch(() => { /* no es crítico */ });
    return out;
  }

  // Fallback: la caché anterior era jpg/png; servirla mientras exista.
  // Sin tocar mtime: a los 45 días limpiarCache() la borra y la siguiente
  // petición genera el webp.
  for (const ext of ['.jpg', '.png']) {
    const legacy = join(CACHE_DIR, `${key}${ext}`);
    if (await existe(legacy)) return legacy;
  }

  const pending = inFlight.get(out);
  if (pending) return pending;

  const task = (async () => {
    await acquire();
    const tmp = `${out}.tmp`;
    try {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', source,
        '-frames:v', '1',
        '-vf', `scale=${width}:-1:flags=lanczos`,
        '-q:v', '60',
        '-f', 'webp',
        tmp,
      ];
      // Temporal + renombrado: una salida a medias o vacía de un ffmpeg fallido
      // se serviría como imagen rota y el navegador la guarda 30 días.
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(config.ffmpeg, args, { windowsHide: true, stdio: 'ignore', timeout: 60_000 });
          proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
          proc.on('error', reject);
        });
        renameSync(tmp, out);
      } catch (e) {
        try { unlinkSync(tmp); } catch { /* puede no existir */ }
        throw e;
      }
      return out;
    } finally {
      release();
      inFlight.delete(out);
    }
  })();

  inFlight.set(out, task);
  return task;
}

/**
 * Borra miniaturas que llevan sin pedirse más de `diasRetencion`.
 *
 * La clave de caché mete el mtime y el tamaño del origen, así que elegir otra
 * carátula o rescrapear un título no borra la miniatura vieja: simplemente
 * deja de pedirse, y sin esto se quedaba en disco para siempre. `thumbnail()`
 * toca el mtime en cada acierto, así que lo que se sigue viendo nunca cumple
 * el plazo aunque sea antiguo.
 */
/*
 * Async y por lotes, cediendo el hilo entre lotes.
 *
 * Esta caché ha llegado a tener 63.613 ficheros: un `statSync` por cada uno,
 * sin ceder, medía 6,5 segundos bloqueado en el bucle de eventos —el mismo
 * tipo de fallo que el escaneo completo, solo que más corto y por eso más
 * difícil de ver sin el latido puesto.
 */
export async function limpiarCache(diasRetencion = 45): Promise<number> {
  const limite = Date.now() - diasRetencion * 86_400_000;
  let borradas = 0;
  let nombres: string[];
  try {
    nombres = readdirSync(CACHE_DIR);
  } catch {
    return 0;
  }
  const LOTE = 500;
  for (let inicio = 0; inicio < nombres.length; inicio += LOTE) {
    for (const nombre of nombres.slice(inicio, inicio + LOTE)) {
      const ruta = join(CACHE_DIR, nombre);
      try {
        if (statSync(ruta).mtimeMs < limite) {
          unlinkSync(ruta);
          borradas++;
        }
      } catch {
        /* se reintenta en la próxima pasada */
      }
    }
    if (inicio + LOTE < nombres.length) await new Promise((r) => setImmediate(r));
  }
  return borradas;
}

