/**
 * Biografías, fechas y fotos del reparto por id de TMDb, y fotos por TheTVDB
 * para quien TMDb no tiene. Ver `scanner/detalles-personas.ts`.
 *
 *   node src/cli/completar-detalles.ts
 */
import { completarDetalles, estadoDetalles } from '../scanner/detalles-personas.ts';

console.log('Completando fichas del reparto…');
const empezado = Date.now();
const pasada = completarDetalles();
const enTerminal = Boolean(process.stdout.isTTY);
const reloj = setInterval(() => {
  const e = estadoDetalles();
  const linea = `${new Date().toISOString().slice(11, 19)}  [${e.fase}] ${e.hechos}/${e.total} · biografías ${e.biografias} · fotos ${e.fotos} + tvdb ${e.fotosTvdb} · ${e.ultimo}`;
  if (enTerminal) process.stdout.write(`\r${linea.slice(0, 160).padEnd(160)}`);
  else console.log(linea);
}, enTerminal ? 2000 : 60_000);
await pasada;
clearInterval(reloj);
const e = estadoDetalles();
if (enTerminal) process.stdout.write('\r'.padEnd(162) + '\r');
console.log('Biografías:', e.biografias, '· fotos de TMDb:', e.fotos, '· fotos de TVDB:', e.fotosTvdb);
if (e.error) console.log('Falló:', e.error);
console.log(`Tiempo: ${((Date.now() - empezado) / 60000).toFixed(1)} min`);
