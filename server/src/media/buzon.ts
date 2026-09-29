/**
 * El buzon de imagenes propias: `data/arte-entrada`.
 *
 * Para poner una imagen que no esta en TMDb hacen falta dos caminos, porque no
 * se usan igual: desde la web se sube con el dialogo de ficheros de siempre, y
 * desde la TELE no hay forma de navegar el disco con un mando, asi que lo que
 * se deja en esta carpeta aparece como una opcion mas.
 *
 * Vive aqui y no en una ruta porque lo usan dos: las imagenes de un titulo
 * (`routes/enrich.ts`) y la imagen de una saga (`routes/library.ts`).
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { DATA_DIR } from '../config.ts';

export const BUZON = join(DATA_DIR, 'arte-entrada');
export const IMAGENES = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Un nombre del buzon, sin dejar que se escape de la carpeta con `..` ni rutas. */
export function ficheroDelBuzon(nombre: string): string {
  const limpio = basename(nombre);
  if (!limpio || limpio !== nombre || !IMAGENES.has(extname(limpio).toLowerCase())) {
    throw new Error('Ese nombre no vale');
  }
  const ruta = join(BUZON, limpio);
  if (!existsSync(ruta)) throw new Error('Esa imagen ya no está en el buzón');
  return ruta;
}

/** Lo que hay ahora mismo, ordenado por nombre. */
export function loDelBuzon(): { nombre: string; bytes: number }[] {
  mkdirSync(BUZON, { recursive: true });
  const fuera: { nombre: string; bytes: number }[] = [];
  for (const n of readdirSync(BUZON)) {
    if (!IMAGENES.has(extname(n).toLowerCase())) continue;
    try {
      const st = statSync(join(BUZON, n));
      if (st.isFile()) fuera.push({ nombre: n, bytes: st.size });
    } catch {
      /* se lo han llevado mientras miraba */
    }
  }
  return fuera.sort((a, b) => a.nombre.localeCompare(b.nombre));
}
