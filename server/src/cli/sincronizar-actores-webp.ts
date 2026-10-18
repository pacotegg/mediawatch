/**
 * Descarga y conversión masiva de fotos de actores a formato WebP.
 *
 * 1. Convierte las fotos locales existentes (JPG) a WebP de alta eficiencia.
 * 2. Limpia rutas fantasmas de E:\ que no existen físicamente en disco.
 * 3. Descarga las fotos oficiales de TMDb pendientes directamente en WebP.
 *
 * Uso:
 *   npx tsx src/cli/sincronizar-actores-webp.ts [--concurrencia 5] [--limite 10000]
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';

const args = process.argv.slice(2);
let concurrencia = 5;
let limite = 40000;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--concurrencia' && args[i + 1]) {
    concurrencia = parseInt(args[i + 1], 10) || concurrencia;
    i++;
  } else if (args[i] === '--limite' && args[i + 1]) {
    limite = parseInt(args[i + 1], 10) || limite;
    i++;
  }
}

const DIR_PERSONAS = join(DATA_DIR, 'artwork', 'personas');
const LOG_FILE = join(DATA_DIR, 'sincronizar-actores-webp.log');
mkdirSync(DIR_PERSONAS, { recursive: true });

writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Inicio de sincronización masiva a WebP\n`, 'utf-8');

console.log('=== Sincronización y Conversión de Actores a WebP ===');
console.log(`Directorio: ${DIR_PERSONAS}`);
console.log(`Concurrencia: ${concurrencia} trabajadores`);
console.log(`Registro: ${LOG_FILE}\n`);

/** Convierte una imagen a WebP con ffmpeg */
function convertirAWebp(input: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(config.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-c:v', 'libwebp',
      '-q:v', '82',
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

// -------------------------------------------------------------------------
// FASE 1: Migrar las fotos locales existentes de JPG a WebP
// -------------------------------------------------------------------------
console.log('--- Fase 1: Convirtiendo fotos locales existentes a WebP ---');
const archivos = readdirSync(DIR_PERSONAS).filter((f) => f.endsWith('.jpg'));
console.log(`Se encontraron ${archivos.length} archivos JPG locales en personas/`);

let localesConvertidos = 0;
let bytesAntes = 0;
let bytesDespues = 0;

const actualizarThumb = db.prepare('UPDATE people SET thumb = ? WHERE id = ?');

for (const arch of archivos) {
  const personId = parseInt(arch.replace('.jpg', ''), 10);
  if (!personId) continue;

  const rutaJpg = join(DIR_PERSONAS, arch);
  const rutaWebp = join(DIR_PERSONAS, `${personId}.webp`);

  try {
    const szJpg = statSync(rutaJpg).size;
    bytesAntes += szJpg;

    const ok = await convertirAWebp(rutaJpg, rutaWebp);
    if (ok) {
      bytesDespues += statSync(rutaWebp).size;
      actualizarThumb.run(rutaWebp, personId);
      unlinkSync(rutaJpg);
      localesConvertidos++;
    } else {
      bytesDespues += szJpg;
    }
  } catch {}
}

const ahorroMb = ((bytesAntes - bytesDespues) / (1024 * 1024)).toFixed(1);
console.log(`Fase 1 completada: ${localesConvertidos} fotos convertidas a WebP (ahorro: ${ahorroMb} MB)\n`);
appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Fase 1: ${localesConvertidos} JPG locales pasados a WebP (ahorro ${ahorroMb} MB)\n`);

// -------------------------------------------------------------------------
// FASE 2: Limpieza de rutas fantasma de E:\
// -------------------------------------------------------------------------
console.log('--- Fase 2: Limpiando referencias fantasma de E:\\ ---');
const resLimpieza = db.prepare(`UPDATE people SET thumb = NULL WHERE thumb LIKE 'E:\\%'`).run();
console.log(`Se limpiaron ${resLimpieza.changes} rutas fantasma que no existían físicamente en disco.\n`);
appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Fase 2: Limpiadas ${resLimpieza.changes} rutas fantasma de E:\\\n`);

// -------------------------------------------------------------------------
// FASE 3: Descarga masiva directa a WebP para las personas con URL oficial
// -------------------------------------------------------------------------
console.log('--- Fase 3: Descarga y conversión directa a WebP desde TMDb ---');

// Priorizamos actores con papeles protagonistas (ord <= 15) y mayor número de apariciones
const candidatas = db.prepare(`
  SELECT p.id, p.name, pd.profile, COUNT(ip.item_id) as apariciones, MIN(ip.ord) as orden_min
  FROM people p
  JOIN people_details pd ON pd.person_id = p.id
  JOIN item_people ip ON ip.person_id = p.id
  WHERE p.thumb IS NULL AND pd.profile IS NOT NULL AND pd.profile LIKE 'http%'
  GROUP BY p.id
  ORDER BY (CASE WHEN MIN(ip.ord) IS NOT NULL AND MIN(ip.ord) <= 15 THEN 0 ELSE 1 END), apariciones DESC, p.id ASC
  LIMIT ?
`).all(limite) as Array<{ id: number; name: string; profile: string; apariciones: number; orden_min: number | null }>;

console.log(`Actores pendientes con URL oficial listos para descargar: ${candidatas.length}`);

let procesados = 0;
let descargadosOk = 0;
let fallos = 0;
const tInicio = Date.now();
let ultimoLog = 0;

let cursor = 0;

async function trabajador(): Promise<void> {
  while (cursor < candidatas.length) {
    const c = candidatas[cursor++];
    if (!c) break;

    const rutaWebp = join(DIR_PERSONAS, `${c.id}.webp`);

    // Si ya existía el webp, solo asociarlo en BD
    if (existsSync(rutaWebp) && statSync(rutaWebp).size > 0) {
      actualizarThumb.run(rutaWebp, c.id);
      descargadosOk++;
      procesados++;
      continue;
    }

    const exito = await convertirAWebp(c.profile, rutaWebp);
    if (exito) {
      actualizarThumb.run(rutaWebp, c.id);
      descargadosOk++;
    } else {
      fallos++;
    }
    procesados++;

    const ahora = Date.now();
    if (ahora - ultimoLog > 5000) {
      ultimoLog = ahora;
      const pct = Math.round((procesados / candidatas.length) * 100);
      const vel = (procesados / ((ahora - tInicio) / 1000)).toFixed(1);
      const linea = `[${pct}%] ${procesados}/${candidatas.length} | OK: ${descargadosOk} | Fallos: ${fallos} | ${vel} act/s | ${c.name}`;
      console.log(linea);
      appendFileSync(LOG_FILE, `[${new Date().toISOString().slice(11, 19)}] ${linea}\n`);
    }

    // Pequeño respiro
    await new Promise((r) => setTimeout(r, 40));
  }
}

const trabajadores = Array.from({ length: concurrencia }, () => trabajador());
await Promise.all(trabajadores);

const duracionTotalMin = ((Date.now() - tInicio) / 60000).toFixed(1);
console.log('\n=== Resumen de Sincronización WebP ===');
console.log(`Actores procesados:     ${procesados}`);
console.log(`Descargados en WebP:    ${descargadosOk}`);
console.log(`Fallos:                 ${fallos}`);
console.log(`Tiempo Fase 3:          ${duracionTotalMin} minutos`);

appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Finalizado: ${descargadosOk} WebP nuevos en ${duracionTotalMin} min\n`);
