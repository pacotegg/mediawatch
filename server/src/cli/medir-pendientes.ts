/*
 * Mide con ffprobe los ficheros que nunca se han medido (probed = 0 o sin duración). Sin duración no hay barra de
 * progreso, ni reanudar, ni «Seguir viendo» hasta la primera reproducción: el 28/10/2026 eran 197, entre ellos los
 * cinco episodios de Chernobyl. Solo lee cabeceras de E: y espera mientras alguien está viendo algo.
 *
 *   node src/cli/medir-pendientes.ts
 */
import { db } from '../db.ts';
import { mediaInfo } from '../media/probe.ts';
import { hayAlguienViendo } from '../media/ocupado.ts';

const pendientes = db.prepare('SELECT id, path FROM media_files WHERE probed = 0 OR duration IS NULL ORDER BY id').all() as { id: number; path: string }[];
console.log(`[medir] ${pendientes.length} ficheros pendientes`);
const t0 = Date.now();
let bien = 0, sinDuracion = 0, fallos = 0;

for (const [i, f] of pendientes.entries()) {
  while (hayAlguienViendo()) {
    console.log('[medir] alguien está viendo algo: espero 60 s');
    await new Promise((r) => setTimeout(r, 60_000));
  }
  try {
    const info = await mediaInfo(f.id);
    if (info.duration > 0) bien++;
    else { sinDuracion++; console.log(`[medir] sin duración: ${f.id} ${f.path}`); }
  } catch (e) {
    fallos++;
    console.log(`[medir] fallo ${f.id} ${f.path}: ${(e as Error).message}`);
  }
  if ((i + 1) % 20 === 0) console.log(`[medir] ${i + 1}/${pendientes.length}`);
}

console.log(`[medir] terminado en ${Math.round((Date.now() - t0) / 1000)} s: ${bien} medidos, ${sinDuracion} sin duración, ${fallos} fallos`);
