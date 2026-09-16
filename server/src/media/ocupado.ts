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

/** Cuánto se considera «todavía viendo» desde la última señal. */
const MARGEN_MS = 5 * 60_000;

let ultimaSenal = 0;

/** La llaman la ruta de vídeo y la de progreso. */
export function marcarActividad() {
  ultimaSenal = Date.now();
}

export function hayAlguienViendo(): boolean {
  return Date.now() - ultimaSenal < MARGEN_MS;
}

/** Segundos desde la última señal, para poder contarlo en la interfaz. */
export function desdeLaUltimaSenal(): number {
  return ultimaSenal ? Math.round((Date.now() - ultimaSenal) / 1000) : -1;
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
