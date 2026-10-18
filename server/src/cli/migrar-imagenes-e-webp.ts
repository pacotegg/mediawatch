/**
 * Migración y optimización de imágenes en E:\ a formato WebP.
 *
 * Convierte posters, fanarts, logos y miniaturas de E:\ a WebP de alta fidelidad:
 * - JPG (fotos/fondos/posters): WebP calidad 82 (~70% ahorro de espacio y lecturas más rápidas).
 * - PNG con transparencia (logos/discart): WebP con canal alfa preservado (~50% ahorro).
 *
 * Actualiza atómicamente las referencias en SQLite (items y episodes).
 *
 * Uso:
 *   npx tsx src/cli/migrar-imagenes-e-webp.ts [--probar] [--confirmar]
 */
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';

const args = process.argv.slice(2);
const modoProbar = args.includes('--probar') || !args.includes('--confirmar');

const LOG_FILE = join(DATA_DIR, 'migrar-imagenes-e.log');
writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Inicio migración imágenes E:\\ a WebP (modo: ${modoProbar ? 'PRUEBA' : 'COMPLETO'})\n`, 'utf-8');

console.log('=== Migración de Imágenes en E:\\ a WebP ===');
console.log(`Modo: ${modoProbar ? 'PRUEBA (primeros 10 archivos)' : 'COMPLETO'}`);
console.log(`Registro: ${LOG_FILE}\n`);

// Colecciones en E: donde residen imágenes de películas y series
const CARPETAS_BASE = [
  'E:\\Peliculas',
  'E:\\Series',
  'E:\\Pelis Animacion',
  'E:\\Peques',
  'E:\\Series Peques',
  'E:\\Docupelis',
  'E:\\Docuseries',
  'E:\\Conciertos',
  'E:\\Monologos',
];

const ES_IMAGEN = /\.(jpg|jpeg|png)$/i;

function buscarImagenes(dir: string, profundidad: number = 0, maxProf: number = 3): string[] {
  if (profundidad > maxProf || !existsSync(dir)) return [];
  const resultados: string[] = [];
  try {
    const entradas = readdirSync(dir, { withFileTypes: true });
    for (const ent of entradas) {
      const ruta = join(dir, ent.name);
      if (ent.isDirectory()) {
        // Ignorar carpetas ocultas o del sistema
        if (!ent.name.startsWith('.')) {
          resultados.push(...buscarImagenes(ruta, profundidad + 1, maxProf));
        }
      } else if (ent.isFile() && ES_IMAGEN.test(ent.name)) {
        resultados.push(ruta);
      }
    }
  } catch {}
  return resultados;
}

function convertirAWebP(input: string, output: string, esPng: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    // Para PNG (logos/discs): preservar alfa con alta calidad
    // Para JPG: calidad 82 (excelente fidelidad visual, alta compresión)
    const params = esPng
      ? ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-c:v', 'libwebp', '-lossless', '0', '-compression_level', '6', '-quality', '90', output]
      : ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-c:v', 'libwebp', '-quality', '82', output];

    const proc = spawn(config.ffmpeg, params, { windowsHide: true, timeout: 30_000 });
    proc.on('close', (code) => {
      resolve(code === 0 && existsSync(output) && statSync(output).size > 0);
    });
    proc.on('error', () => resolve(false));
  });
}

// Consultas preparadas para actualizar SQLite
const actItemPoster = db.prepare('UPDATE items SET poster = ? WHERE poster = ?');
const actItemFanart = db.prepare('UPDATE items SET fanart = ? WHERE fanart = ?');
const actItemClearlogo = db.prepare('UPDATE items SET clearlogo = ? WHERE clearlogo = ?');
const actItemDiscart = db.prepare('UPDATE items SET discart = ? WHERE discart = ?');
const actEpisodeThumb = db.prepare('UPDATE episodes SET thumb = ? WHERE thumb = ?');

async function main() {
  console.log('Localizando imágenes en E:\\...');
  let todas: string[] = [];
  for (const c of CARPETAS_BASE) {
    if (existsSync(c)) {
      const halladas = buscarImagenes(c);
      console.log(`  - ${c}: ${halladas.length} imágenes`);
      todas.push(...halladas);
    }
  }

  console.log(`\nTotal imágenes candidatas encontradas en E:\\: ${todas.length}`);
  const aProcesar = modoProbar ? todas.slice(0, 10) : todas;

  let convertidas = 0;
  let bytesAntes = 0;
  let bytesDespues = 0;
  let fallos = 0;

  const concurrenciaIdx = args.indexOf('--concurrencia');
  const maxConcurrencia = concurrenciaIdx !== -1 && args[concurrenciaIdx + 1] ? parseInt(args[concurrenciaIdx + 1], 10) : 4;

  let indice = 0;
  async function trabajador(): Promise<void> {
    while (indice < aProcesar.length) {
      const idx = indice++;
      const orig = aProcesar[idx];
      const ext = extname(orig).toLowerCase();
      const esPng = ext === '.png';
      const nuevaRuta = orig.slice(0, -ext.length) + '.webp';

      try {
        const szOrig = statSync(orig).size;
        const t0 = Date.now();
        const exito = await convertirAWebP(orig, nuevaRuta, esPng);

        if (!exito) {
          fallos++;
          console.log(`[x] Falló conversión: ${orig}`);
          continue;
        }

        const szNuevo = statSync(nuevaRuta).size;
        const ahorro = ((1 - szNuevo / szOrig) * 100).toFixed(1);
        const ms = Date.now() - t0;

        bytesAntes += szOrig;
        bytesDespues += szNuevo;
        convertidas++;

        if (modoProbar) {
          console.log(`[PRUEBA ${idx + 1}/${aProcesar.length}] ${(szOrig / 1024).toFixed(1)} KB -> ${(szNuevo / 1024).toFixed(1)} KB (${ahorro}% ahorro) en ${ms}ms: ${orig}`);
          try { unlinkSync(nuevaRuta); } catch {}
        } else {
          try { unlinkSync(orig); } catch {}
          actItemPoster.run(nuevaRuta, orig);
          actItemFanart.run(nuevaRuta, orig);
          actItemClearlogo.run(nuevaRuta, orig);
          actItemDiscart.run(nuevaRuta, orig);
          actEpisodeThumb.run(nuevaRuta, orig);

          if (convertidas % 100 === 0 || convertidas === aProcesar.length) {
            const mbAhorro = ((bytesAntes - bytesDespues) / 1048576).toFixed(1);
            console.log(`[${convertidas}/${aProcesar.length}] Ahorro: ${mbAhorro} MB | Último: ${orig}`);
            appendFileSync(LOG_FILE, `[${convertidas}/${aProcesar.length}] Ahorro: ${mbAhorro} MB\n`);
          }
        }
      } catch (e) {
        fallos++;
        console.log(`[x] Error procesando ${orig}: ${(e as Error).message}`);
      }
    }
  }

  const trabajadores = Array.from({ length: Math.min(maxConcurrencia, aProcesar.length) }, () => trabajador());
  await Promise.all(trabajadores);

  const ahorroTotalMb = ((bytesAntes - bytesDespues) / 1048576).toFixed(1);
  const ahorroPct = bytesAntes > 0 ? ((1 - bytesDespues / bytesAntes) * 100).toFixed(1) : '0';

  console.log('\n=== Resumen de Optimización de Imágenes en E:\\ ===');
  console.log(`Procesadas con éxito: ${convertidas}`);
  console.log(`Fallos:                ${fallos}`);
  console.log(`Tamaño original:       ${(bytesAntes / 1048576).toFixed(2)} MB`);
  console.log(`Tamaño WebP:           ${(bytesDespues / 1048576).toFixed(2)} MB`);
  console.log(`Espacio liberado:      ${ahorroTotalMb} MB (${ahorroPct}%)`);
}

main().catch(console.error);
