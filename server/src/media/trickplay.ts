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
export const sheetPath = (fileId: number, index: number) => join(dirFor(fileId), `sheet-${String(index + 1).padStart(3, '0')}.jpg`);

export function readManifest(fileId: number): TrickplayManifest | null {
  try {
    return JSON.parse(readFileSync(manifestFor(fileId), 'utf8')) as TrickplayManifest;
  } catch {
    return null;
  }
}

/** Reads keyframe positions from the container index without decoding anything. */
async function keyframeTimes(path: string): Promise<number[]> {
  const { stdout } = await run(
    config.ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path],
    { maxBuffer: 128 * 1024 * 1024, windowsHide: true },
  );
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
    { windowsHide: true },
  );
  const [width, height] = stdout.trim().split(',').map(Number);
  return { width, height };
}

const running = new Map<number, Promise<TrickplayManifest | null>>();

export const isGenerating = (fileId: number) => running.has(fileId);

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
          '-q:v', '5',
          join(dir, 'sheet-%03d.jpg'),
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
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

  if (todo) {
    filas.push(
      ...(db
        .prepare(`SELECT f.id, ${NOMBRE} FROM media_files f ${UNIONES} WHERE f.duration > 300 ORDER BY f.id`)
        .all() as Fila[]),
    );
  } else {
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

  const vistos: Record<number, boolean> = {};
  const salida: { id: number; nombre: string }[] = [];
  for (const f of filas) {
    if (vistos[f.id]) continue;
    vistos[f.id] = true;
    if (readManifest(f.id)) continue;
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

  queueMicrotask(async () => {
    for (const f of pendientes) {
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
        // Cortar porque alguien se ha puesto a ver algo no es un fallo: la
        // pelicula se queda pendiente y se hace en la siguiente tanda.
        if (motivo.indexOf('cortado') === 0) {
          console.log('[miniaturas] aparcada', f.nombre, '(hay alguien viendo algo)');
          break;
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
    console.log(`[miniaturas] terminado: ${lote.hechas} hechas, ${lote.fallos} fallidas de ${lote.total}`);
  });

  return lote.total;
}

export function ensure(fileId: number): TrickplayManifest | null {
  const cached = readManifest(fileId);
  if (cached) return cached;
  if (!running.has(fileId)) generate(fileId).catch((err) => console.error(`[trickplay ${fileId}]`, err.message));
  return null;
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
