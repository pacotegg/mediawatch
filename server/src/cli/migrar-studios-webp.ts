import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR } from '../config.ts';

const dir = join(DATA_DIR, 'artwork', 'studios');
if (!existsSync(dir)) {
  console.log('No existe carpeta de logos');
  process.exit(0);
}

const pngs = readdirSync(dir).filter((f) => f.endsWith('.png'));
console.log(`Convirtiendo ${pngs.length} logos de PNG a WebP...`);

function convertir(archivo: string): Promise<boolean> {
  return new Promise((resolve) => {
    const src = join(dir, archivo);
    const dst = join(dir, archivo.replace(/\.png$/, '.webp'));
    const proc = spawn('ffmpeg', ['-y', '-v', 'error', '-i', src, '-c:v', 'libwebp', '-lossless', '1', dst], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 10_000,
    });
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          unlinkSync(src);
          resolve(true);
        } catch {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
    proc.on('error', () => resolve(false));
  });
}

async function run() {
  const t0 = Date.now();
  let done = 0;
  let cursor = 0;
  const workers = 6;

  async function worker() {
    while (cursor < pngs.length) {
      const idx = cursor++;
      const ok = await convertir(pngs[idx]);
      if (ok) done++;
      if (done % 100 === 0) {
        console.log(`Progreso: ${done}/${pngs.length} (${Math.round((done / pngs.length) * 100)}%)`);
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  console.log(`Completado: ${done}/${pngs.length} convertidos a WebP en ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
}

void run();
