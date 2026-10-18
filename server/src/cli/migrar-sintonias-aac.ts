/**
 * Conversión masiva de sintonías (themes) a AAC-LC (.m4a a 96 kbps).
 *
 * El formato AAC-LC es el más compatible universalmente con Smart TV (Samsung Tizen),
 * Android, Web y Desktop, y reduce el tamaño de las sintonías en más de un 50%
 * manteniendo una fidelidad acústica superior a MP3.
 *
 * Uso:
 *   npx tsx src/cli/migrar-sintonias-aac.ts [--concurrencia 4]
 */
import { existsSync, readdirSync, statSync, unlinkSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';

const args = process.argv.slice(2);
let concurrencia = 4;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--concurrencia' && args[i + 1]) {
    concurrencia = parseInt(args[i + 1], 10) || concurrencia;
    i++;
  }
}

const THEMES_DIR = join(DATA_DIR, 'themes');
const LOG_FILE = join(DATA_DIR, 'migrar-sintonias-aac.log');

writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Inicio de migración de sintonías a AAC\n`, 'utf-8');

console.log('=== Migración de Sintonías a AAC-LC (M4A 96 kbps) ===');
console.log(`Directorio: ${THEMES_DIR}`);
console.log(`Concurrencia: ${concurrencia} trabajadores`);
console.log(`Registro: ${LOG_FILE}\n`);

function convertirAAac(input: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(config.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      output,
    ], { windowsHide: true, stdio: 'ignore', timeout: 30_000 });

    proc.on('close', (code) => {
      if (code === 0 && existsSync(output) && statSync(output).size > 0) {
        resolve(true);
      } else {
        try { if (existsSync(output)) unlinkSync(output); } catch {}
        resolve(false);
      }
    });
    proc.on('error', () => {
      try { if (existsSync(output)) unlinkSync(output); } catch {}
      resolve(false);
    });
  });
}

const archivos = readdirSync(THEMES_DIR).filter((f) => f.endsWith('.mp3'));
console.log(`Encontradas ${archivos.length} sintonías en formato MP3 para migrar a AAC`);

let bytesAntes = 0;
let bytesDespues = 0;
let convertidosOk = 0;
let fallos = 0;
const tInicio = Date.now();
let cursor = 0;
let ultimoLog = 0;

async function trabajador(): Promise<void> {
  while (cursor < archivos.length) {
    const f = archivos[cursor++];
    if (!f) break;

    const rutaMp3 = join(THEMES_DIR, f);
    const rutaM4a = join(THEMES_DIR, f.replace('.mp3', '.m4a'));

    const szMp3 = statSync(rutaMp3).size;
    bytesAntes += szMp3;

    const ok = await convertirAAac(rutaMp3, rutaM4a);
    if (ok) {
      bytesDespues += statSync(rutaM4a).size;
      try { unlinkSync(rutaMp3); } catch {}
      convertidosOk++;
    } else {
      bytesDespues += szMp3;
      fallos++;
    }

    const ahora = Date.now();
    if (ahora - ultimoLog > 5000) {
      ultimoLog = ahora;
      const pct = Math.round((cursor / archivos.length) * 100);
      const linea = `[${pct}%] ${cursor}/${archivos.length} | OK: ${convertidosOk} | Fallos: ${fallos}`;
      console.log(linea);
      appendFileSync(LOG_FILE, `[${new Date().toISOString().slice(11, 19)}] ${linea}\n`);
    }
  }
}

const trabajadores = Array.from({ length: concurrencia }, () => trabajador());
await Promise.all(trabajadores);

const ahorroMb = ((bytesAntes - bytesDespues) / (1024 * 1024)).toFixed(1);
const duracionMin = ((Date.now() - tInicio) / 60000).toFixed(1);

console.log('\n=== Resumen de Migración de Sintonías ===');
console.log(`Sintonías convertidas:  ${convertidosOk} de ${archivos.length}`);
console.log(`Fallos:                 ${fallos}`);
console.log(`Tamaño anterior:        ${(bytesAntes / (1024 * 1024)).toFixed(1)} MB`);
console.log(`Tamaño nuevo:           ${(bytesDespues / (1024 * 1024)).toFixed(1)} MB`);
console.log(`Espacio liberado:       ${ahorroMb} MB (${((1 - bytesDespues / bytesAntes) * 100).toFixed(1)}% de reducción)`);
console.log(`Tiempo total:           ${duracionMin} minutos`);

appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Finalizado: ${convertidosOk} sintonías pasadas a AAC, liberados ${ahorroMb} MB en ${duracionMin} min\n`);
