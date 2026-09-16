/**
 * Fotos e ids de TMDb para el reparto, título a título. Ver `scanner/personas.ts`.
 *
 *   node src/cli/completar-personas.ts
 */
import { completarPersonas, estadoPersonas } from '../scanner/personas.ts';

console.log('Casando el reparto con TMDb…');
const empezado = Date.now();
const pasada = completarPersonas();
const enTerminal = Boolean(process.stdout.isTTY);
const reloj = setInterval(() => {
  const e = estadoPersonas();
  const linea = `${new Date().toISOString().slice(11, 19)}  ${e.hechos}/${e.total} · fotos ${e.fotos} · identificadas ${e.identificadas} · ${e.ultimo}`;
  if (enTerminal) process.stdout.write(`\r${linea.slice(0, 160).padEnd(160)}`);
  else console.log(linea);
}, enTerminal ? 2000 : 60_000);
await pasada;
clearInterval(reloj);
const e = estadoPersonas();
if (enTerminal) process.stdout.write('\r'.padEnd(162) + '\r');
console.log('Títulos:', e.hechos, 'de', e.total, '· fotos nuevas:', e.fotos, '· personas identificadas:', e.identificadas, '· sin reparto en TMDb:', e.sinCredits);
if (e.error) console.log('Falló:', e.error);
console.log(`Tiempo: ${((Date.now() - empezado) / 60000).toFixed(1)} min`);
