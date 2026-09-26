/**
 * `VACUUM` y la copia de seguridad diaria, en su propio hilo.
 *
 * Mismo patrón y mismo motivo que `scanner/scan-worker.ts`: medido sobre la
 * base real (168 MB), `optimizarBaseDeDatos()` bloqueaba el proceso ~1,3 s y
 * `backupBaseDeDatos()` (`VACUUM INTO`) ~466 ms — poco comparado con el
 * escaneo, pero el mismo fallo de fondo. El primero se llamaba directo desde
 * la ruta de Ajustes → Mantenimiento; el segundo corría solo, sin que nadie
 * lo pidiera, una vez al día. En los dos casos el servidor dejaba de
 * contestar a nadie mientras duraba.
 *
 * Importa `db.ts` tal cual —no repite el SQL aquí—, así que este hilo abre su
 * propia conexión al mismo fichero y vuelve a pasar la migración entera
 * (`CREATE TABLE IF NOT EXISTS`, `anadirColumna`...); es idempotente y es lo
 * mismo que ya hace `scan-worker.ts`, probado hoy contra la biblioteca real.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { backupBaseDeDatos, optimizarBaseDeDatos } from './db.ts';

type Peticion = { accion: 'optimizar' } | { accion: 'backup' };

try {
  const accion = (workerData as Peticion | undefined)?.accion;
  if (accion === 'optimizar') {
    optimizarBaseDeDatos();
    parentPort?.postMessage({ ok: true });
  } else if (accion === 'backup') {
    const destino = backupBaseDeDatos();
    parentPort?.postMessage({ ok: true, destino });
  } else {
    throw new Error(`acción desconocida: ${String(accion)}`);
  }
} catch (err) {
  parentPort?.postMessage({ ok: false, error: (err as Error).message });
}
