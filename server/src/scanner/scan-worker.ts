/**
 * El escaneo completo, en su propio hilo.
 *
 * Trocear en lotes con `await` (scan.ts) bajó el peor bloqueo medido de 235 s
 * a unos 36 s, pero no a cero: una carpeta con muchos episodios —«Dr. Slump»,
 * 243— es una sola unidad síncrona entre dos puntos donde ceder, y mientras
 * se procesa esa carpeta el bucle de eventos del hilo que la ejecute sigue
 * parado. Sacarlo a un `worker_thread` quita el problema de raíz: pase lo que
 * pase aquí dentro, el hilo del servidor HTTP no se entera.
 *
 * `node:sqlite` funciona dentro de un worker —comprobado antes de escribir
 * esto, no dado por hecho—, y como cada hilo importa `db.ts` por su cuenta,
 * este worker abre su propia conexión al mismo fichero, no comparte la del
 * proceso principal. Modo WAL, ya puesto en `db.ts`: las lecturas del
 * servidor siguen sin esperar aunque este worker tenga una transacción de
 * escritura abierta; una escritura de verdad que coincida sí espera, hasta
 * los diez segundos de `timeout` que ya tenía la conexión —muy por debajo de
 * lo que antes tardaba el servidor entero en volver.
 */
import { parentPort } from 'node:worker_threads';
import { scanAll, type ScanProgress } from './scan.ts';

async function main() {
  try {
    const results = await scanAll((p: ScanProgress) => parentPort?.postMessage({ type: 'progress', progress: p }));
    parentPort?.postMessage({ type: 'done', results });
  } catch (err) {
    parentPort?.postMessage({ type: 'error', message: (err as Error).message });
  }
}

main();
