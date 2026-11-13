/*
 * Dónde empieza REALMENTE un flujo cortado con `-ss`.
 *
 * Al saltar o reanudar, el servidor sirve la película cortada con `ffmpeg -ss N -c copy`. Con copia, ffmpeg arranca en el
 * fotograma clave anterior a N, no en N: en «Proyecto Salvación» hay uno cada 10 s, así que pedir 1805 empieza en 1800.
 * La app ponía el reloj a N y quedaba hasta 10 s por delante de la imagen (13/11/2026), con lo que todo lo que pinta ella
 * —subtítulos PGS y externos— salía antes de tiempo. Esto devuelve el segundo real para que la app ponga su reloj ahí.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.ts';

const run = promisify(execFile);

/**
 * De la salida de `ffprobe -show_entries packet=pts_time,flags -of csv=p=0` (una línea «pts,flags» por paquete), el
 * fotograma clave más tardío que no pasa de `t`. `null` si no hay ninguno.
 */
export function elegirInicio(salida: string, t: number): number | null {
  let mejor: number | null = null;
  for (const linea of salida.split(/\r?\n/)) {
    const [pts, banderas] = linea.trim().split(',');
    const v = Number(pts);
    if (!Number.isFinite(v) || !banderas || !banderas.includes('K')) continue;
    if (v <= t + 0.0005 && (mejor === null || v > mejor)) mejor = v;
  }
  return mejor;
}

const guardados = new Map<string, number>();

/** Segundo real en que empieza el flujo cortado en `t`. Sin dato fiable, `t` (como hasta ahora). */
export async function inicioDelCorte(ruta: string, tamano: number, t: number): Promise<number> {
  const entero = Math.floor(t);
  if (entero <= 0) return 0;
  const clave = `${ruta}:${tamano}:${entero}`;
  const antes = guardados.get(clave);
  if (antes !== undefined) return antes;
  let inicio = entero;
  let hallado = false;
  // Primero una ventana corta; si no hay fotograma clave dentro (GOP larga), una más ancha.
  for (const ventana of [30, 120]) {
    try {
      const { stdout } = await run(
        config.ffprobe,
        ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', `${Math.max(0, entero - ventana)}%${entero + 1}`,
          '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', ruta],
        { timeout: 20_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      );
      const v = elegirInicio(stdout, entero);
      if (v !== null) { inicio = v; hallado = true; break; }
    } catch {
      break;
    }
  }
  if (guardados.size > 500) guardados.clear();
  if (hallado) guardados.set(clave, inicio);
  return inicio;
}
