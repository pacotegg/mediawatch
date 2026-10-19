/**
 * Logos de estudio que se lean sobre el fondo oscuro de la ficha sin perder su dibujo.
 *
 * Antes la tele les pasaba a todos `filter: brightness(0) invert(1)`: cada píxel visible a blanco. Para un logo de texto
 * negro (casi todos los de TMDb) da lo mismo, pero el león de MGM —dorado y lleno de detalle— salía como una mancha blanca.
 * Ahora se mira cada logo UNA vez: si lo que se ve de él es oscuro, se guarda una versión con la luminosidad invertida (el negro
 * pasa a blanco, un azul marino a azul claro, y el dibujo se conserva); si ya es claro o tiene color, se sirve tal cual.
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

// v4 (19/10/2026): dorado para los que no tienen color; aclarado que conserva el color para los oscuros con color.
// Las carpetas de versiones anteriores quedan sin usar.
const DIR_CLARO = join(DATA_DIR, 'artwork', 'studios-claro-v4');

/** Saturación media (0-1) de lo que se ve: por debajo de 0,15 el logo no tiene color propio (blanco, negro o gris). */
export function saturacionVisible(rgba: Uint8Array): number {
  let n = 0;
  let suma = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] <= 128) continue;
    n++;
    const mx = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    const mn = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    suma += mx ? (mx - mn) / mx : 0;
  }
  return n ? suma / n : 0;
}

export const UMBRAL_SIN_COLOR = 0.15;

/*
 * Se invierte SOLO la luminosidad (Y) y se deja el color (U, V) y el alfa: el negro pasa a blanco y un azul marino
 * (DreamWorks Animation) a azul claro; con hue=s=0 + negate todo quedaba en grises. Con un mínimo de 205: un rojo oscuro
 * (Malpaso, luminosidad 96) invertido se quedaba en un gris medio que no se leía.
 */
const ACLARAR = "format=yuva444p,lutyuv=y='max(255-val\\,205)'";

/*
 * Dorado metalizado suave para los logos sin color (pedido el 19/10/2026: los blancos «se ven aburridos»): cada canal del
 * logo, ya claro, por el tono del oro (1; 0,83; 0,52) y por un brillo vertical que sube hacia el tercio de arriba y baja
 * hacia el pie, como un metal pulido. geq va píxel a píxel, pero se hace una vez por logo y a 800 px como mucho.
 */
const BRILLO = '(0.80+0.25*cos(2*PI*(Y/H-0.3)))';
const DORADO = "format=rgba,geq=r='min(255\\,r(X\\,Y)*1.00*" + BRILLO + ")':g='min(255\\,g(X\\,Y)*0.83*" + BRILLO +
  ")':b='min(255\\,b(X\\,Y)*0.52*" + BRILLO + ")':a='alpha(X\\,Y)'";

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
    const oscuro = lumaVisible(stdout) < UMBRAL_OSCURO;
    const sinColor = saturacionVisible(stdout) < UMBRAL_SIN_COLOR;
    // Con color y claro (Warner, Pixar, Marvel…): tal cual. Oscuro: se aclara. Sin color: dorado (aclarado antes si es oscuro).
    if (!oscuro && !sinColor) {
      writeFileSync(talCual, '');
      return ruta;
    }
    const filtros = ["scale='min(800\\,iw)':-2"];
    if (oscuro) filtros.push(ACLARAR);
    if (sinColor) filtros.push(DORADO);
    await ejecutar(config.ffmpeg, ['-v', 'error', '-y', '-i', ruta, '-vf', filtros.join(','), '-c:v', 'libwebp', '-q:v', '90', claro],
      { timeout: 60_000, windowsHide: true });
    return existsSync(claro) ? claro : ruta;
  } catch {
    // Sin ffmpeg o con un fichero raro: mejor el original que nada (no se recuerda, se reintenta la próxima vez).
    return ruta;
  }
}
