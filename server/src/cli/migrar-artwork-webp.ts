/**
 * Conversión masiva de arte local (posters, fanarts, logos, discos) a formato WebP.
 *
 * Convierte todos los PNG y JPG de `data/artwork/<itemId>/` y `data/artwork/sagas/` a WebP,
 * liberando cientos de MB en disco y actualizando las rutas en la base de datos SQLite.
 *
 * Uso:
 *   npx tsx src/cli/migrar-artwork-webp.ts [--concurrencia 4]
 */
import { existsSync, readdirSync, statSync, unlinkSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';

const args = process.argv.slice(2);
let concurrencia = 4;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--concurrencia' && args[i + 1]) {
    concurrencia = parseInt(args[i + 1], 10) || concurrencia;
    i++;
  }
}

const ARTWORK_DIR = join(DATA_DIR, 'artwork');
const LOG_FILE = join(DATA_DIR, 'migrar-artwork-webp.log');

writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Inicio de migración de artwork a WebP\n`, 'utf-8');

console.log('=== Migración de Arte Local a WebP (Posters, Fanarts, Logos, Discos) ===');
console.log(`Directorio: ${ARTWORK_DIR}`);
console.log(`Concurrencia: ${concurrencia} trabajadores`);
console.log(`Registro: ${LOG_FILE}\n`);

/** Convierte una imagen a WebP con ffmpeg */
function convertirAWebp(input: string, output: string, esPng: boolean): Promise<boolean> {
  const flags = esPng
    ? ['-c:v', 'libwebp', '-lossless', '0', '-q:v', '85', '-preset', 'drawing']
    : ['-c:v', 'libwebp', '-q:v', '82'];

  return new Promise((resolve) => {
    const proc = spawn(config.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      ...flags,
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

// 1. Recorrer directorios de data/artwork (excluyendo personas/)
const archivosAConvertir: Array<{ ruta: string; esPng: boolean; size: number }> = [];

function escanear(dir: string) {
  try {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) {
        if (f.name === 'personas') continue; // personas se gestiona por su propio script
        escanear(p);
      } else {
        const ext = extname(f.name).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
          archivosAConvertir.push({
            ruta: p,
            esPng: ext === '.png',
            size: statSync(p).size,
          });
        }
      }
    }
  } catch {}
}

escanear(ARTWORK_DIR);
console.log(`Encontrados ${archivosAConvertir.length} archivos para migrar a WebP`);

let bytesAntes = 0;
let bytesDespues = 0;
let convertidosOk = 0;
let fallos = 0;
const tInicio = Date.now();
let cursor = 0;
let ultimoLog = 0;

async function trabajador(): Promise<void> {
  while (cursor < archivosAConvertir.length) {
    const item = archivosAConvertir[cursor++];
    if (!item) break;

    const ext = extname(item.ruta);
    const rutaWebp = item.ruta.slice(0, -ext.length) + '.webp';

    bytesAntes += item.size;

    const ok = await convertirAWebp(item.ruta, rutaWebp, item.esPng);
    if (ok) {
      const szWebp = statSync(rutaWebp).size;
      bytesDespues += szWebp;
      try { unlinkSync(item.ruta); } catch {}
      convertidosOk++;
    } else {
      bytesDespues += item.size;
      fallos++;
    }

    const ahora = Date.now();
    if (ahora - ultimoLog > 5000) {
      ultimoLog = ahora;
      const pct = Math.round((cursor / archivosAConvertir.length) * 100);
      const linea = `[${pct}%] ${cursor}/${archivosAConvertir.length} | OK: ${convertidosOk} | Fallos: ${fallos}`;
      console.log(linea);
      appendFileSync(LOG_FILE, `[${new Date().toISOString().slice(11, 19)}] ${linea}\n`);
    }
  }
}

const trabajadores = Array.from({ length: concurrencia }, () => trabajador());
await Promise.all(trabajadores);

// 2. Actualizar rutas en la base de datos SQLite
console.log('\n--- Actualizando referencias en la base de datos ---');
const cols = ['poster', 'fanart', 'clearlogo', 'landscape', 'discart'];
for (const col of cols) {
  const rJpg = db.prepare(`UPDATE items SET ${col} = REPLACE(${col}, '.jpg', '.webp') WHERE ${col} LIKE 'C:\\tvwatch\\data\\artwork\\%'`).run();
  const rPng = db.prepare(`UPDATE items SET ${col} = REPLACE(${col}, '.png', '.webp') WHERE ${col} LIKE 'C:\\tvwatch\\data\\artwork\\%'`).run();
  if (rJpg.changes > 0 || rPng.changes > 0) {
    console.log(`  - items.${col}: ${rJpg.changes} jpg y ${rPng.changes} png actualizados a webp`);
  }
}

// Colección imagen (sagas)
try {
  const rPost = db.prepare(`UPDATE coleccion_imagen SET poster = REPLACE(poster, '.jpg', '.webp'), poster = REPLACE(poster, '.png', '.webp') WHERE poster LIKE 'C:\\tvwatch\\data\\artwork\\%'`).run();
  const rFondo = db.prepare(`UPDATE coleccion_imagen SET fondo = REPLACE(fondo, '.jpg', '.webp'), fondo = REPLACE(fondo, '.png', '.webp') WHERE fondo LIKE 'C:\\tvwatch\\data\\artwork\\%'`).run();
  console.log(`  - coleccion_imagen: ${rPost.changes} posters y ${rFondo.changes} fondos actualizados`);
} catch {}

const ahorroMb = ((bytesAntes - bytesDespues) / (1024 * 1024)).toFixed(1);
const duracionMin = ((Date.now() - tInicio) / 60000).toFixed(1);

console.log('\n=== Resumen de Migración Artwork a WebP ===');
console.log(`Archivos convertidos:   ${convertidosOk} de ${archivosAConvertir.length}`);
console.log(`Fallos:                 ${fallos}`);
console.log(`Tamaño anterior:        ${(bytesAntes / (1024 * 1024)).toFixed(1)} MB`);
console.log(`Tamaño nuevo:           ${(bytesDespues / (1024 * 1024)).toFixed(1)} MB`);
console.log(`Espacio liberado:       ${ahorroMb} MB (${((1 - bytesDespues / bytesAntes) * 100).toFixed(1)}% de reducción)`);
console.log(`Tiempo total:           ${duracionMin} minutos`);

appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Finalizado: ${convertidosOk} archivos pasados a WebP, liberados ${ahorroMb} MB en ${duracionMin} min\n`);
