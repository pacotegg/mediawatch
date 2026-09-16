import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DATA_DIR, config } from '../config.ts';

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
export async function thumbnail(source: string, width: number): Promise<string> {
  let stat;
  try {
    stat = statSync(source);
  } catch {
    throw new Error('imagen no encontrada');
  }

  const isPng = extname(source).toLowerCase() === '.png';
  const key = createHash('sha1').update(`${source}|${stat.mtimeMs}|${stat.size}|${width}`).digest('hex');
  const out = join(CACHE_DIR, `${key}${isPng ? '.png' : '.jpg'}`);
  if (existsSync(out)) return out;

  const pending = inFlight.get(out);
  if (pending) return pending;

  const task = (async () => {
    await acquire();
    try {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', source,
        '-frames:v', '1',
        '-vf', `scale=${width}:-1:flags=lanczos`,
        ...(isPng ? [] : ['-q:v', '4']),
        out,
      ];
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(config.ffmpeg, args, { windowsHide: true, stdio: 'ignore' });
        proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
        proc.on('error', reject);
      });
      return out;
    } finally {
      release();
      inFlight.delete(out);
    }
  })();

  inFlight.set(out, task);
  return task;
}
