/*
 * Mide con ffprobe los ficheros que nunca se han medido (probed = 0 o sin duración). El bucle vive en
 * media/medir-pendientes.ts desde el 01/11/2026, porque ahora lo usa también el servidor al acabar cada escaneo.
 *
 *   node src/cli/medir-pendientes.ts
 */
import { medirPendientes } from '../media/medir-pendientes.ts';

const r = await medirPendientes();
if (r && r.total === 0) console.log('[medir] 0 ficheros pendientes');
