/**
 * Logos de estudio que se lean sobre el fondo oscuro de la ficha sin perder su dibujo.
 *
 * Antes la tele les pasaba a todos `filter: brightness(0) invert(1)`: cada píxel visible a blanco. Para un logo de texto
 * negro (casi todos los de TMDb) da lo mismo, pero el león de MGM —dorado y lleno de detalle— salía como una mancha blanca.
 * Ahora se mira cada logo UNA vez: si lo que se ve de él es oscuro, se guarda una versión en grises invertida (el negro pasa
 * a blanco y los grises conservan el dibujo); si ya es claro o tiene color, se sirve tal cual.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.ts';

const ejecutar = promisify(execFile);

/** Por debajo de esta luminosidad media (0-255) de lo que se ve, el logo no se leería sobre fondo oscuro. */
export const UMBRAL_OSCURO = 100;

/**
 * Luminosidad media de los píxeles que se ven (alfa > 128) en un volcado RGBA; NaN si no hay ninguno.
 * Medido el 19/10/2026: EON, United Artists, Columbia, Pixar y Walt Disney Pictures dan 0 (texto negro); Walt Disney
 * Animation Studios, 31; el león de MGM, 126.
 */
export function lumaVisible(rgba: Uint8Array): number {
  let n = 0;
  let suma = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] <= 128) continue;
    n++;
    suma += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return n ? suma / n : NaN;
}

const DIR_CLARO = join(DATA_DIR, 'artwork', 'studios-claro');

/** El logo para fondo oscuro: la versión invertida si hace falta, o el mismo fichero. Se decide una vez y se recuerda. */
export async function versionClara(ruta: string): Promise<string> {
  const base = basename(ruta, extname(ruta));
  const claro = join(DIR_CLARO, base + '.webp');
  const talCual = join(DIR_CLARO, base + '.tal-cual');
  if (existsSync(claro)) return claro;
  if (existsSync(talCual)) return ruta;
  mkdirSync(DIR_CLARO, { recursive: true });
  try {
    const { stdout } = await ejecutar(config.ffmpeg, ['-v', 'error', '-i', ruta, '-vf', 'scale=64:-1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
      { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 20_000, windowsHide: true });
    const luma = lumaVisible(stdout);
    if (!(luma < UMBRAL_OSCURO)) {
      writeFileSync(talCual, '');
      return ruta;
    }
    // hue=s=0 deja grises; negate invierte el color pero no el alfa (negate_alpha vale 0 por defecto).
    await ejecutar(config.ffmpeg, ['-v', 'error', '-y', '-i', ruta, '-vf', 'format=rgba,hue=s=0,negate', '-c:v', 'libwebp', '-q:v', '90', claro],
      { timeout: 20_000, windowsHide: true });
    return existsSync(claro) ? claro : ruta;
  } catch {
    // Sin ffmpeg o con un fichero raro: mejor el original que nada (no se recuerda, se reintenta la próxima vez).
    return ruta;
  }
}
