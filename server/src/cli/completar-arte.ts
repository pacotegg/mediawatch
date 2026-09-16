/**
 * Completar y arreglar las imágenes de la biblioteca desde la línea de órdenes.
 *
 *   node src/cli/completar-arte.ts            → rellena lo que falta
 *   node src/cli/completar-arte.ts --sustituir → y cambia logotipos y apaisadas
 *                                                en otros idiomas por español/inglés
 *   … --forzar                                 → repite la comparación también en
 *                                                lo revisado hace menos de un mes
 *
 * Va contra la misma base que el servidor, así que puede correr con él
 * encendido: SQLite aguanta un escritor y varios lectores. Lo que baja lo deja
 * en `data/artwork/<id>/` y marcado como fijado; las carpetas de la biblioteca
 * no se tocan. Ver `scanner/fanart.ts` para el detalle.
 */
import { completarConFanart, estadoFanart } from '../scanner/fanart.ts';

const sustituir = process.argv.includes('--sustituir');
const forzar = process.argv.includes('--forzar');
console.log(`Completando imágenes con fanart.tv y TheTVDB${sustituir ? ', y sustituyendo idiomas' : ''}…`);

const empezado = Date.now();
const pasada = completarConFanart(sustituir, forzar);

// En una terminal, una línea que se sobreescribe; en un fichero de registro,
// una línea nueva por minuto.
const enTerminal = Boolean(process.stdout.isTTY);
const reloj = setInterval(() => {
  const e = estadoFanart();
  const linea = `${new Date().toISOString().slice(11, 19)}  ${e.hechos}/${e.total} · nuevas ${JSON.stringify(e.rellenados)} · sustituidas ${JSON.stringify(e.sustituidos)} · ${e.ultimo}`;
  if (enTerminal) process.stdout.write(`\r${linea.slice(0, 160).padEnd(160)}`);
  else console.log(linea);
}, enTerminal ? 2000 : 60_000);

await pasada;
clearInterval(reloj);
const e = estadoFanart();
if (enTerminal) process.stdout.write('\r'.padEnd(162) + '\r');
console.log('Títulos recorridos:', e.hechos, 'de', e.total);
console.log('Nuevas:', e.rellenados);
if (sustituir) console.log('Sustituidas:', e.sustituidos);
console.log('Sin nada en fanart.tv:', e.sinFanart, '· sin identificar (sin TMDb/TVDB):', e.sinId);
if (e.error) console.log('Falló:', e.error);
console.log(`Tiempo: ${((Date.now() - empezado) / 60000).toFixed(1)} min`);
