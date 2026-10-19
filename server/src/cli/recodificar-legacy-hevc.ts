/**
 * Recodificación de vídeos legacy (XviD / DivX / AVI) a HEVC (H.265) de alta eficiencia.
 *
 * Convierte los archivos legacy de la biblioteca a MKV con HEVC. El audio y los subtítulos se copian tal cual
 * (MKV admite MP3, AC3 y AAC): recomprimirlos a AAC solo perdía calidad.
 *
 * Verificación con ffprobe antes de sustituir nada (ver `media/recodificar.ts`):
 * - Duración (+/- 2 s) y códec HEVC
 * - Las mismas pistas de audio y subtítulos que el original. Esta comprobación la anunciaba la versión anterior
 *   pero no la hacía, y sin `-map 0` ffmpeg se quedaba con un solo audio.
 * - El original se aparta a `<unidad>\_retirados\<fecha>\`, no se borra.
 *
 * Uso:
 *   npx tsx src/cli/recodificar-legacy-hevc.ts [--probar] [--confirmar]
 */
import { existsSync, renameSync, statSync, unlinkSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { probeFile, type MediaInfo } from '../media/probe.ts';
import { argumentosHevc, pistasQueFaltan, retirarOriginal } from '../media/recodificar.ts';

const args = process.argv.slice(2);
const modoProbar = args.includes('--probar') || !args.includes('--confirmar');

const LOG_FILE = join(DATA_DIR, 'recodificar-legacy.log');
// Se añade al final: sobrescribirlo en cada ejecución borraba el rastro de las anteriores.
appendFileSync(LOG_FILE, `[${new Date().toISOString()}] Inicio de recodificación de vídeos legacy (modo: ${modoProbar ? 'PRUEBA 1 FICHERO' : 'LOTE COMPLETO'})\n`, 'utf-8');

console.log('=== Recodificador de Vídeos Legacy (XviD/DivX -> HEVC QSV/NVENC/CPU) ===');
console.log(`Modo: ${modoProbar ? 'PRUEBA (solo 1 fichero piloto)' : 'COMPLETO (con reemplazo verificado)'}`);
console.log(`Registro: ${LOG_FILE}\n`);

type FilaLegacy = {
  id: number;
  path: string;
  video_codec: string;
  container: string;
  size: number;
  duration: number | null;
  title: string;
};

const candidatas = db.prepare(`
  SELECT mf.id, mf.path, mf.video_codec, mf.container, mf.size, mf.duration,
         COALESCE(e.title, i.title) as title
  FROM media_files mf
  LEFT JOIN episodes e ON e.id = mf.episode_id
  JOIN items i ON i.id = COALESCE(e.show_id, mf.item_id)
  WHERE mf.video_codec IN ('xvid', 'divx', 'mpeg4') OR mf.container = 'avi'
  ORDER BY mf.size ASC
`).all() as FilaLegacy[];

console.log(`Total vídeos legacy detectados en la biblioteca: ${candidatas.length}`);
const aProcesar = modoProbar ? candidatas.slice(0, 1) : candidatas;

/** Recodifica un archivo con ffmpeg a HEVC: QSV, y si falla, libx265 por CPU. Mismas pistas en los dos casos. */
function lanzar(args: string[], tope: number): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(config.ffmpeg, args, { windowsHide: true, timeout: tope });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function recodificar(input: string, output: string, original: MediaInfo): Promise<boolean> {
  const tope = Math.max(30 * 60_000, (original.duration || 0) * 2000);
  const qsv = argumentosHevc(input, output, original);
  if ((await lanzar(qsv, tope)) && existsSync(output) && statSync(output).size > 0) return true;
  try { if (existsSync(output)) unlinkSync(output); } catch {}
  const i = qsv.indexOf('hevc_qsv');
  const cpu = [...qsv.slice(0, i), 'libx265', '-crf', '23', '-preset', 'fast', ...qsv.slice(i + 5)];
  return (await lanzar(cpu, tope * 4)) && existsSync(output) && statSync(output).size > 0;
}

const actualizarBd = db.prepare(`
  UPDATE media_files
  SET path = ?, container = 'mkv', video_codec = 'hevc', size = ?, duration = ?
  WHERE id = ?
`);

let procesados = 0;
let convertidos = 0;
let bytesOriginales = 0;
let bytesFinales = 0;

for (const f of aProcesar) {
  procesados++;
  console.log(`\n[${procesados}/${aProcesar.length}] Procesando: ${f.title} (${(f.size / 1048576).toFixed(1)} MB)`);
  console.log(`  Ruta original: ${f.path}`);

  if (!existsSync(f.path)) {
    console.log(`  x El fichero no existe en disco. Omitiendo.`);
    continue;
  }

  const sondaOrig = await probeFile(f.path).catch(() => null);
  if (!sondaOrig || sondaOrig.duration <= 0) {
    console.log(`  x No se pudo sondear la duración original con ffprobe.`);
    continue;
  }

  // Generamos el nuevo archivo en MKV en la misma carpeta con sufijo temporal
  const dirPeli = join(f.path, '..');
  const nuevoNombre = f.path.replace(/\.[a-zA-Z0-9]+$/, '.mkv');
  const tempOutput = nuevoNombre + '.recodificando.tmp.mkv';

  const t0 = Date.now();
  console.log(`  Iniciando recodificación a HEVC (QSV / Intel Arc)...`);
  const exito = await recodificar(f.path, tempOutput, sondaOrig);

  if (!exito) {
    console.log(`  x Falló la recodificación de ffmpeg.`);
    try { if (existsSync(tempOutput)) unlinkSync(tempOutput); } catch {}
    continue;
  }

  // Verificación estricta de paridad con ffprobe
  const sondaNuevo = await probeFile(tempOutput).catch(() => null);
  if (!sondaNuevo || sondaNuevo.video?.codec !== 'hevc') {
    console.log(`  x Verificación fallida: el nuevo archivo no tiene códec HEVC válido.`);
    try { unlinkSync(tempOutput); } catch {}
    continue;
  }

  const faltan = pistasQueFaltan(sondaOrig, sondaNuevo);
  if (faltan) {
    console.log(`  x Verificación fallida: faltan pistas (${faltan}).`);
    try { unlinkSync(tempOutput); } catch {}
    continue;
  }

  const difSegundos = Math.abs(sondaNuevo.duration - sondaOrig.duration);
  if (difSegundos > 2) {
    console.log(`  x Verificación fallida: diferencia de duración excesiva (${difSegundos.toFixed(1)} s vs original).`);
    try { unlinkSync(tempOutput); } catch {}
    continue;
  }

  const szOriginal = statSync(f.path).size;
  const szNuevo = statSync(tempOutput).size;
  const ahorroPct = ((1 - szNuevo / szOriginal) * 100).toFixed(1);
  const durSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  ✔ Verificación superada: Duración: ${sondaNuevo.duration.toFixed(1)}s (dif: ${difSegundos.toFixed(2)}s)`);
  console.log(`  ✔ Tamaño: ${(szOriginal / 1048576).toFixed(1)} MB -> ${(szNuevo / 1048576).toFixed(1)} MB (${ahorroPct}% ahorro) en ${durSec}s`);

  if (modoProbar) {
    console.log(`\n[MODO PRUEBA]: Fichero temporal conservado en: ${tempOutput}`);
    console.log(`No se ha modificado el archivo original en E:\\. Ejecute con --confirmar para aplicar.`);
    appendFileSync(LOG_FILE, `[PRUEBA PILOTO] ${f.title} OK: ${(szOriginal/1048576).toFixed(1)} MB -> ${(szNuevo/1048576).toFixed(1)} MB (${ahorroPct}% ahorro)\n`);
    break;
  }

  // Si no es modo prueba, reemplazo atómico
  try {
    const retirado = retirarOriginal(f.path);
    try {
      renameSync(tempOutput, nuevoNombre);
    } catch (e) {
      renameSync(retirado, f.path);
      throw e;
    }
    actualizarBd.run(nuevoNombre, szNuevo, sondaNuevo.duration, f.id);
    console.log(`  Original apartado en ${retirado}`);

    bytesOriginales += szOriginal;
    bytesFinales += szNuevo;
    convertidos++;

    appendFileSync(LOG_FILE, `[CONVERTIDO] ${f.title}: ${(szOriginal/1048576).toFixed(1)} MB -> ${(szNuevo/1048576).toFixed(1)} MB (${ahorroPct}% ahorro)\n`);
  } catch (err) {
    console.log(`  x Error al reemplazar fichero: ${(err as Error).message}`);
  }
}

if (!modoProbar) {
  const ahorroTotalMb = ((bytesOriginales - bytesFinales) / 1048576).toFixed(1);
  console.log('\n=== Resumen de Recodificación Legacy ===');
  console.log(`Convertidos:        ${convertidos} de ${candidatas.length}`);
  console.log(`Espacio liberado:   ${ahorroTotalMb} MB`);
}
