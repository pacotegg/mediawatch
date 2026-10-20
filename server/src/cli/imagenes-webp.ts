/**
 * Pasa a WebP las imagenes JPG/PNG que haya ahora mismo en las carpetas de la biblioteca (lo mismo que hace el escaneo si `imagenesAWebp` esta puesto).
 *
 *   node src/cli/imagenes-webp.ts                       ensayo: cuenta lo que hay, no escribe nada
 *   node src/cli/imagenes-webp.ts --aplicar             convierte y RETIRA el original a <raiz>/_retirados/<fecha>/
 *   node src/cli/imagenes-webp.ts --aplicar --borrar    convierte y BORRA el original
 */
import { statSync } from 'node:fs';
import { config } from '../config.ts';
import { candidatas, comprimirCarpetas } from '../media/imagenes-webp.ts';

const carpetas = config.libraries.map((l) => l.path);
if (!process.argv.includes('--aplicar')) {
  let n = 0, bytes = 0;
  for (const c of carpetas) for (const r of candidatas(c)) { n++; try { bytes += statSync(r).size; } catch { /* desaparecio */ } }
  console.log(`${n} imagenes JPG/PNG (${(bytes / 1e6).toFixed(0)} MB). Ensayo: no se ha tocado nada. Con --aplicar se convierten.`);
} else {
  const modo = process.argv.includes('--borrar') ? 'borrar' : 'retirar';
  const r = await comprimirCarpetas(carpetas, modo);
  console.log(`${r.convertidas} convertidas (${(r.ahorroBytes / 1e6).toFixed(1)} MB menos), ${r.saltadas} saltadas, ${r.errores} con error${r.interrumpido ? '; parado: ' + r.interrumpido : ''}`);
}
process.exit(0);
