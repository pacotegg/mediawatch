/**
 * Detecta los «Anteriormente en…» de los episodios con diálogos indexados (ver media/resumenes.ts).
 * Solo lee y escribe la base: no toca E:. `npm run resumenes` desde server/.
 */
import { detectarResumenes } from '../media/resumenes.ts';

const t0 = Date.now();
const r = await detectarResumenes();
console.log(`resúmenes: ${r.encontrados} en ${r.analizados} episodios analizados (${Date.now() - t0} ms)`);
