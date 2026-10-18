/**
 * CLI para enriquecer masivamente las fotos de actores y cineastas en MediaWatch.
 *
 * Busca fotos de alta calidad y actuales en TMDb, Wikipedia y Wikidata
 * para los actores de la biblioteca que carecen de foto.
 *
 * Uso:
 *   npx tsx src/cli/enriquecer-fotos-actores.ts [--limite 500] [--todos] [--concurrencia 3]
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { enriquecerFotosActores, type EstadoEnriquecerActores } from '../scanner/fotos-actores.ts';

const args = process.argv.slice(2);
let limite = 25000;
let soloPrincipales = true;
let concurrencia = 3;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limite' && args[i + 1]) {
    limite = parseInt(args[i + 1], 10) || limite;
    i++;
  } else if (args[i] === '--todos') {
    soloPrincipales = false;
  } else if (args[i] === '--concurrencia' && args[i + 1]) {
    concurrencia = parseInt(args[i + 1], 10) || concurrencia;
    i++;
  }
}

const LOG_FILE = join(DATA_DIR, 'enriquecer-actores.log');
const enTerminal = Boolean(process.stdout.isTTY);
const inicio = Date.now();

console.log('=== Enriquecedor de Fotos de Actores (TMDb + Wikipedia + Wikidata) ===');
console.log(`Configuración: Límite: ${limite} | Prioridad: ${soloPrincipales ? 'Principales / Reparto relevante' : 'Todas'} | Concurrencia: ${concurrencia}`);
console.log(`Registro detallado en: ${LOG_FILE}\n`);

writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Inicio de enriquecimiento de fotos de actores\n`, 'utf-8');

let ultimoLog = 0;

function reportarProgreso(e: EstadoEnriquecerActores, forzar = false) {
  const ahora = Date.now();
  if (!forzar && ahora - ultimoLog < (enTerminal ? 1500 : 15000)) return;
  ultimoLog = ahora;

  const pct = e.total > 0 ? Math.round((e.procesados / e.total) * 100) : 0;
  const tasa = e.procesados > 0 ? ((e.procesados / ((ahora - inicio) / 1000))).toFixed(1) : '0';
  const linea = `[${pct}%] ${e.procesados}/${e.total} | Nuevas: ${e.fotosNuevas} (TMDb: ${e.fotosTmdb}, Wiki: ${e.fotosWikipedia}, Wikidata: ${e.fotosWikidata}) | Sin foto: ${e.sinFoto} | ${tasa} p/s | ${e.ultimo.slice(0, 40)}`;

  if (enTerminal) {
    process.stdout.write(`\r${linea.padEnd(120)}`);
  } else {
    console.log(linea);
  }

  appendFileSync(LOG_FILE, `[${new Date().toISOString().slice(11, 19)}] ${linea}\n`, 'utf-8');
}

const resultado = await enriquecerFotosActores({
  limite,
  soloPrincipales,
  concurrencia,
  alAvanzar: (e) => reportarProgreso(e),
});

reportarProgreso(resultado, true);
if (enTerminal) process.stdout.write('\n');

const duracionMin = ((Date.now() - inicio) / 60000).toFixed(1);
console.log('\n=== Resumen del Enriquecimiento de Actores ===');
console.log(`Personas analizadas:    ${resultado.procesados} de ${resultado.total}`);
console.log(`Fotos nuevas obtenidas: ${resultado.fotosNuevas}`);
console.log(`  - Desde TMDb:         ${resultado.fotosTmdb}`);
console.log(`  - Desde Wikipedia:    ${resultado.fotosWikipedia}`);
console.log(`  - Desde Wikidata:     ${resultado.fotosWikidata}`);
console.log(`Sin foto encontrada:    ${resultado.sinFoto}`);
console.log(`Errores de descarga:    ${resultado.errores}`);
console.log(`Tiempo total:           ${duracionMin} minutos`);

appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Finalizado: ${resultado.fotosNuevas} fotos nuevas en ${duracionMin} min\n`, 'utf-8');
