import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR, config } from '../config.ts';
import { db } from '../db.ts';
import { esperarSiHayAlguienViendo, hayAlguienViendo } from './ocupado.ts';

const run = promisify(execFile);
const ROOT = join(DATA_DIR, 'trickplay');
mkdirSync(ROOT, { recursive: true });

const TILE_WIDTH = 160;
const COLUMNS = 10;
const ROWS = 10;
const PER_SHEET = COLUMNS * ROWS;
const MAX_TILES = 2000;

export type TrickplayManifest = {
  fileId: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  sheets: number;
  /** Exact timestamp of every tile, in order. Spacing follows the keyframes. */
  times: number[];
  generatedAt: string;
};

const dirFor = (fileId: number) => join(ROOT, String(fileId));
const manifestFor = (fileId: number) => join(dirFor(fileId), 'manifest.json');
/*
 * Las hojas se guardan en WebP: medido regenerando una película entera, 954 KB contra los 1.416 KB
 * del JPEG, un 33 % menos. Proyectado a los 5.668 ficheros son unos 3,6 GB menos en el HTPC.
 * Las que ya estaban en JPEG se siguen sirviendo tal cual —regenerarlas costaría días— así que aquí
 * se mira primero el WebP.
 */
const hojaBase = (fileId: number, index: number) => join(dirFor(fileId), `sheet-${String(index + 1).padStart(3, '0')}`);
export const sheetPathNuevo = (fileId: number, index: number) => `${hojaBase(fileId, index)}.webp`;
export const sheetPath = (fileId: number, index: number) => {
  const webp = sheetPathNuevo(fileId, index);
  return existsSync(webp) ? webp : `${hojaBase(fileId, index)}.jpg`;
};

export function readManifest(fileId: number): TrickplayManifest | null {
  try {
    return JSON.parse(readFileSync(manifestFor(fileId), 'utf8')) as TrickplayManifest;
  } catch {
    return null;
  }
}

/** Reads keyframe positions from the container index without decoding anything. */
async function keyframeTimes(path: string): Promise<number[]> {
  // Listar los paquetes de vídeo lee casi la película entera del mismo disco que sirve el vídeo: igual que con ffmpeg,
  // si alguien se pone a ver algo se corta (la pieza se repite después, ver generarLote).
  const parar = new AbortController();
  const vigilante = setInterval(() => { if (hayAlguienViendo()) parar.abort(); }, 4000);
  let stdout: string;
  try {
    ({ stdout } = await run(
      config.ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path],
      // Tope de 30 min por si se cuelga; minutos de verdad en un 4K de E:.
      { maxBuffer: 128 * 1024 * 1024, windowsHide: true, timeout: 30 * 60_000, signal: parar.signal },
    ));
  } catch (err) {
    if (parar.signal.aborted) throw new Error('cortado: hay alguien viendo algo');
    throw err;
  } finally {
    clearInterval(vigilante);
  }
  const times: number[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.includes(',K')) continue;
    const value = Number.parseFloat(line);
    if (Number.isFinite(value)) times.push(value);
  }
  return times.sort((a, b) => a - b);
}

async function imageSize(path: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run(
    config.ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
    { windowsHide: true, timeout: 60_000 },
  );
  const [width, height] = stdout.trim().split(',').map(Number);
  return { width, height };
}

const running = new Map<number, Promise<TrickplayManifest | null>>();

/**
 * Sprite sheets for the scrub bar. Only keyframes are decoded, which is around
 * seventeen times faster than a full decode, and every tile is stamped with its
 * real timestamp so nothing has to be evenly spaced to stay accurate.
 */
export function generate(fileId: number): Promise<TrickplayManifest | null> {
  const existing = running.get(fileId);
  if (existing) return existing;

  const task = (async (): Promise<TrickplayManifest | null> => {
    const file = db.prepare('SELECT path FROM media_files WHERE id = ?').get(fileId) as { path: string } | undefined;
    if (!file) return null;

    const keys = await keyframeTimes(file.path);
    if (keys.length < 2) return null;

    // Only used to decide how much to thin out; the authoritative timestamps
    // come from ffmpeg itself below.
    const stride = Math.max(1, Math.ceil(keys.length / MAX_TILES));

    const dir = dirFor(fileId);
    mkdirSync(dir, { recursive: true });

    const filters = [
      ...(stride > 1 ? [`select=not(mod(n\\,${stride}))`] : []),
      `scale=${TILE_WIDTH}:-2`,
      'showinfo',
      `tile=${COLUMNS}x${ROWS}`,
    ].join(',');

    /*
     * The container index and the decoder disagree on how many keyframes exist
     * (1489 vs 1391 on a test film), so pairing index timestamps with decoded
     * tiles drifts the whole strip. showinfo sits right before the tiler and
     * reports exactly the frames that become tiles, in order.
     */
    const times: number[] = [];
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        config.ffmpeg,
        [
          '-hide_banner', '-loglevel', 'info',
          '-skip_frame', 'nokey',
          '-i', file.path,
          '-an', '-sn', '-dn',
          '-vf', filters,
          '-fps_mode', 'passthrough',
          /*
           * `-c:v libwebp` NO es opcional: sin él ffmpeg elige `libwebp_anim` y escribe UNA hoja
           * animada con todo dentro en vez de una por cada 100 miniaturas.
           * Calidad 60 (libwebp va de 0 a 100): medido sobre una película real, 954 KB frente a los
           * 1.416 KB del JPEG, un 33 % menos. A 50 bajaba a 844 KB pero ya se nota emborronado.
           */
          '-c:v', 'libwebp',
          '-quality', '60',
          join(dir, 'sheet-%03d.webp'),
        ],
        // Tope de 30 min (una 4K tarda unos 3): un ffmpeg colgado dejaba el lote parado para siempre.
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], timeout: 30 * 60_000 },
      );

      let pending = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        pending += chunk.toString('latin1');
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const match = /pts_time:\s*([0-9.]+)/.exec(line);
          if (match) times.push(Number.parseFloat(match[1]));
        }
      });

      /*
       * Si alguien se pone a ver algo, esto se corta a media pelicula.
       *
       * Comprobarlo solo entre ficheros no bastaba: generar una tira tarda un
       * minuto de media y hasta tres en una 4K, y en todo ese rato se sigue
       * leyendo del mismo disco del que sale el video. Lo empezado se tira, que
       * es barato: la pelicula se queda en la lista y se hace en la siguiente
       * tanda. Quien esta viendo algo manda.
       */
      const vigilante = setInterval(() => {
        if (hayAlguienViendo()) {
          clearInterval(vigilante);
          proc.kill('SIGKILL');
        }
      }, 4000);

      proc.on('close', (code) => {
        clearInterval(vigilante);
        if (code === 0) resolve();
        else reject(new Error(hayAlguienViendo() ? 'cortado: hay alguien viendo algo' : `ffmpeg salió con ${code}`));
      });
      proc.on('error', (err) => {
        clearInterval(vigilante);
        reject(err);
      });
    });

    // Un corte a la mitad deja hojas sueltas: se tiran para que la proxima vez
    // se rehaga entera y no quede media pelicula con miniaturas.
    if (hayAlguienViendo()) {
      rmSync(dir, { recursive: true, force: true });
      return null;
    }

    if (times.length === 0) return null;

    const first = sheetPath(fileId, 0);
    if (!existsSync(first)) return null;
    const size = await imageSize(first);

    // Trust the files on disk over the expected count, so the player can never
    // ask for a sheet that was never written.
    let sheets = 0;
    while (existsSync(sheetPath(fileId, sheets))) sheets++;

    const manifest: TrickplayManifest = {
      fileId,
      tileWidth: Math.round(size.width / COLUMNS),
      tileHeight: Math.round(size.height / ROWS),
      columns: COLUMNS,
      rows: ROWS,
      sheets,
      times: times.slice(0, sheets * PER_SHEET),
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(manifestFor(fileId), JSON.stringify(manifest));
    return manifest;
  })().finally(() => running.delete(fileId));

  running.set(fileId, task);
  return task;
}

/* ------------------------------------------------------------- por lotes */

export type LoteTrickplay = {
  running: boolean;
  total: number;
  hechas: number;
  fallos: number;
  actual: string;
  parando: boolean;
  /** En pausa porque hay alguien viendo algo. */
  esperando: boolean;
  finishedAt: string | null;
};

export const lote: LoteTrickplay = {
  running: false, total: 0, hechas: 0, fallos: 0, actual: '', parando: false, esperando: false, finishedAt: null,
};

export function pararLote() {
  if (!lote.running) return false;
  lote.parando = true;
  return true;
}

/**
 * Cuántos ficheros tienen ya su tira, de cuántos que la merecen. Contar carpetas es instantáneo
 * (no se abre ningún manifest) y vale de sobra para una barra de progreso.
 */
export function cobertura(): { hechas: number; total: number } {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM media_files WHERE duration > 300').get() as { n: number }).n;
  let hechas = 0;
  try {
    hechas = readdirSync(ROOT).length;
  } catch {
    // Aún no existe la carpeta.
  }
  return { hechas: Math.min(hechas, total), total };
}

/*
 * El lote vive en memoria: un reinicio del servidor (el vigilante, una actualización) lo mataba y
 * nadie lo relanzaba (el del 12/10 se quedó en el fichero 281 de 5.656). Mientras hay un lote en
 * marcha queda apuntado aquí; si el proceso muere, al arrancar se reanuda solo.
 */
const PENDIENTE = join(DATA_DIR, 'trickplay-lote.json');

export function reanudarLoteSiPendiente(): void {
  if (!existsSync(PENDIENTE) || lote.running) return;
  try {
    const { todo } = JSON.parse(readFileSync(PENDIENTE, 'utf8')) as { todo?: boolean };
    const total = generarLote(Boolean(todo));
    console.log(`[miniaturas] reanudado el lote pendiente: ${total} por hacer`);
  } catch (err) {
    console.error('[miniaturas] no se pudo reanudar el lote:', (err as Error).message);
  }
}

/**
 * Qué ficheros merecen la tira, y en qué orden.
 *
 * Medido: 170 s por película de hora y media. Con 5566 ficheros, hacerlas todas
 * son once días de máquina, así que por defecto solo se preparan las que se van
 * a ver pronto —lo que está a medias, el episodio siguiente de cada serie
 * empezada y lo añadido hace poco—, que son unas decenas. «Todo» existe para
 * quien quiera dejarlo corriendo semanas.
 */
const NOMBRE = `COALESCE(i.title, s.title || ' T' || e.season || 'E' || e.episode) AS nombre`;
const UNIONES = `LEFT JOIN items i ON i.id = f.item_id
                 LEFT JOIN episodes e ON e.id = f.episode_id
                 LEFT JOIN items s ON s.id = e.show_id`;

function porHacer(todo: boolean): { id: number; nombre: string }[] {
  type Fila = { id: number; nombre: string | null };
  const filas: Fila[] = [];

  // Primero lo que está a medias y lo añadido hace poco (lo que se va a ver antes); en el lote
  // completo, después todo lo demás.
  {
    // Primero lo que está a medias, que es lo que se va a abrir esta misma noche.
    filas.push(
      ...(db
        .prepare(`SELECT f.id, ${NOMBRE}
                    FROM progress p
                    JOIN media_files f ON (f.episode_id = p.episode_id OR (p.episode_id IS NULL AND f.item_id = p.item_id))
                    ${UNIONES}
                   WHERE p.watched = 0 AND p.position > 60 AND f.duration > 300
                   ORDER BY p.updated_at DESC`)
        .all() as Fila[]),
    );
    // Y después lo añadido hace poco, que es lo siguiente que se suele mirar.
    filas.push(
      ...(db
        .prepare(`SELECT f.id, ${NOMBRE}
                    FROM media_files f ${UNIONES}
                   WHERE f.duration > 300 AND i.added_at IS NOT NULL
                   ORDER BY i.added_at DESC LIMIT 120`)
        .all() as Fila[]),
    );
  }
  if (todo) {
    filas.push(
      ...(db
        .prepare(`SELECT f.id, ${NOMBRE} FROM media_files f ${UNIONES} WHERE f.duration > 300 ORDER BY f.id`)
        .all() as Fila[]),
    );
  }

  const vistos: Record<number, boolean> = {};
  const salida: { id: number; nombre: string }[] = [];
  for (const f of filas) {
    if (vistos[f.id]) continue;
    vistos[f.id] = true;
    // Solo mirar si existe: parsear miles de manifests aquí congelaba el servidor al arrancar el lote.
    if (existsSync(manifestFor(f.id))) continue;
    salida.push({ id: f.id, nombre: f.nombre ?? String(f.id) });
    if (!todo && salida.length >= 60) break;
  }
  return salida;
}

export function generarLote(todo = false) {
  if (lote.running) throw new Error('Ya hay miniaturas generándose');
  const pendientes = porHacer(todo);

  Object.assign(lote, {
    running: true, total: pendientes.length, hechas: 0, fallos: 0, actual: '', parando: false, esperando: false, finishedAt: null,
  });

  try {
    writeFileSync(PENDIENTE, JSON.stringify({ todo, desde: new Date().toISOString() }));
  } catch {
    // Sin el apunte solo se pierde la reanudación automática.
  }

  queueMicrotask(async () => {
    for (let i = 0; i < pendientes.length; i++) {
      const f = pendientes[i];
      if (lote.parando) break;
      // Leer los fotogramas clave de una película entera deja sin datos al
      // vídeo que se esté sirviendo del mismo disco: se espera.
      lote.esperando = hayAlguienViendo();
      if (!(await esperarSiHayAlguienViendo(() => !lote.parando))) break;
      lote.esperando = false;
      lote.actual = f.nombre;
      try {
        const hecho = await generate(f.id);
        if (hecho) lote.hechas++;
        else lote.fallos++;
      } catch (err) {
        const motivo = (err as Error).message;
        // Cortar porque alguien se ha puesto a ver algo no es un fallo: se repite esta misma
        // en cuanto quede libre (la vuelta siguiente espera). Antes se cortaba el lote entero,
        // y uno de varios días no llegaba nunca al final.
        if (motivo.indexOf('cortado') === 0) {
          console.log('[miniaturas] aparcada', f.nombre, '(hay alguien viendo algo): se reintenta despues');
          i--;
          continue;
        }
        lote.fallos++;
        console.error('[miniaturas]', f.nombre, motivo);
      }
    }
    lote.running = false;
    lote.parando = false;
    lote.esperando = false;
    lote.actual = '';
    lote.finishedAt = new Date().toISOString();
    // Terminado o parado a mano: ya no hay nada que reanudar.
    rmSync(PENDIENTE, { force: true });
    console.log(`[miniaturas] terminado: ${lote.hechas} hechas, ${lote.fallos} fallidas de ${lote.total}`);
  });

  return lote.total;
}

/**
 * Borra carpetas de miniaturas cuyo fichero ya no existe en la base.
 *
 * El escáner retira de `media_files` los ficheros que desaparecen del disco,
 * pero nunca tocaba `data/trickplay/<id>`: esas carpetas (varios MB cada una)
 * se quedaban para siempre. Al estilo del «vaciar papelera» de Plex; se llama
 * después de cada escaneo, cuando ya se sabe qué ids siguen vivos.
 */
export async function limpiarHuerfanas(): Promise<number> {
  let borradas = 0;
  let nombres: string[];
  try {
    nombres = readdirSync(ROOT);
  } catch {
    return 0;
  }
  const vivos = new Set((db.prepare('SELECT id FROM media_files').all() as { id: number }[]).map((r) => r.id));
  // Por lotes igual que la caché de imágenes: el borrado recursivo de una
  // carpeta huérfana es E/S de verdad, no una comparación en memoria.
  const LOTE = 200;
  for (let inicio = 0; inicio < nombres.length; inicio += LOTE) {
    for (const nombre of nombres.slice(inicio, inicio + LOTE)) {
      const id = Number(nombre);
      if (!Number.isInteger(id) || vivos.has(id)) continue;
      try {
        rmSync(join(ROOT, nombre), { recursive: true, force: true });
        borradas++;
      } catch {
        /* se reintenta en la próxima pasada */
      }
    }
    if (inicio + LOTE < nombres.length) await new Promise((r) => setImmediate(r));
  }
  return borradas;
}
