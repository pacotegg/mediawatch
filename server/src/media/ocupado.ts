/**
 * Si hay alguien viendo algo, el servidor no se pone a trabajar por su cuenta.
 *
 * La biblioteca vive en un disco mecánico de 12 TB. Los trabajos por lotes
 * —huellas acústicas para detectar cabeceras, miniaturas de la barra— leen ese
 * mismo plato, y con los dos a la vez el vídeo se queda sin datos: la película
 * no arranca y las peticiones a la API empiezan a agotar el tiempo de espera.
 * Pasó de verdad, en el salón, mientras los dos lotes corrían de fondo.
 *
 * No hace falta nada sofisticado: cada petición de vídeo deja su hora aquí, y
 * los lotes miran el reloj antes de empezar cada pieza. El margen es generoso
 * a propósito —una reproducción directa pide el fichero una sola vez y luego se
 * pasa dos horas sin volver a hablar— así que se cuenta también el progreso que
 * el cliente va guardando mientras ve algo.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { config, DATA_DIR } from '../config.ts';

/** Cuánto se considera «todavía viendo» desde la última señal. */
const MARGEN_MS = 5 * 60_000;

const ARCHIVO_ACTIVIDAD = join(DATA_DIR, 'actividad.timestamp');
let ultimaSenal = 0;
let ultimoEscrito = 0;

/** La llaman la ruta de vídeo y la de progreso. */
export function marcarActividad() {
  ultimaSenal = Date.now();
  if (ultimaSenal - ultimoEscrito > 5000) {
    ultimoEscrito = ultimaSenal;
    try {
      writeFileSync(ARCHIVO_ACTIVIDAD, String(ultimaSenal), 'utf-8');
    } catch {}
  }
}

export function hayAlguienViendo(): boolean {
  let senal = ultimaSenal;
  try {
    if (existsSync(ARCHIVO_ACTIVIDAD)) {
      const fsSenal = parseInt(readFileSync(ARCHIVO_ACTIVIDAD, 'utf-8'), 10);
      if (Number.isFinite(fsSenal) && fsSenal > senal) {
        senal = fsSenal;
      }
    }
  } catch {}
  return Date.now() - senal < MARGEN_MS;
}

/** Solo frena lo que cae dentro de una biblioteca: las carpetas de entrada del scraper no son el disco que se está leyendo. */
export function hayAlguienViendoEn(ruta: string): boolean {
  const r = resolve(ruta).toLowerCase();
  const enBiblioteca = config.libraries.some((l) => {
    const p = resolve(l.path).toLowerCase();
    return r === p || r.startsWith(p + sep);
  });
  return enBiblioteca && hayAlguienViendo();
}

/**
 * Espera a que la casa se quede tranquila. Devuelve false si le dicen que pare
 * mientras espera, para que el lote pueda cortar sin terminar la pieza.
 */
export async function esperarSiHayAlguienViendo(sigueEnMarcha: () => boolean): Promise<boolean> {
  while (hayAlguienViendo()) {
    if (!sigueEnMarcha()) return false;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return sigueEnMarcha();
}
