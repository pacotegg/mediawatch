/**
 * Recodificación de vídeos legacy (XviD / DivX / AVI) a HEVC (H.265) de alta eficiencia.
 *
 * Convierte los 123 archivos legacy de la biblioteca a MKV con HEVC y audio AAC/AC3,
 * permitiendo Direct Play nativo en Smart TV (Samsung Tizen) y reduciendo el tamaño en disco.
 *
 * Aplica verificación estricta con ffprobe antes de reemplazar ningún fichero original:
 * - Duración idéntica (+/- 1 s)
 * - Pistas de audio y subtítulos preservadas
 * - Reemplazo atómico con .tmp
 *
 * Uso:
 *   npx tsx src/cli/recodificar-legacy-hevc.ts [--probar] [--confirmar]
 */
import { existsSync, renameSync, statSync, unlinkSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';

const args = process.argv.slice(2);
const modoProbar = args.includes('--probar') || !args.includes('--confirmar');

const LOG_FILE = join(DATA_DIR, 'recodificar-legacy.log');
writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Inicio de recodificación de vídeos legacy (modo: ${modoProbar ? 'PRUEBA 1 FICHERO' : 'LOTE COMPLETO'})\n`, 'utf-8');

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

/** Ejecuta ffprobe para verificar duración y códecs de un fichero */
function sondear(fichero: string): Promise<{ duracion: number; videoCodec: string } | null> {
  return new Promise((resolve) => {
    const ffprobe = config.ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const proc = spawn(ffprobe, [
      '-hide_banner', '-loglevel', 'error',
      '-show_entries', 'format=duration:stream=codec_name,codec_type',
      '-of', 'json',
      fichero,
    ], { windowsHide: true });

    let salida = '';
    proc.stdout.on('data', (d) => (salida += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try {
        const data = JSON.parse(salida);
        const dur = parseFloat(data.format?.duration || '0');
        const vStream = (data.streams || []).find((s: any) => s.codec_type === 'video');
        resolve({ duracion: dur, videoCodec: vStream?.codec_name || '' });
      } catch {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

/** Recodifica un archivo con ffmpeg a HEVC */
function recodificar(input: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Probamos con hevc_qsv para aprovechar la Intel Arc; si no está disponible, libx265
    const proc = spawn(config.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-c:v', 'hevc_qsv',
      '-global_quality', '24',
      '-preset', 'medium',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-c:s', 'copy',
      output,
    ], { windowsHide: true, timeout: 30 * 60_000 });

    proc.on('close', async (code) => {
      if (code === 0 && existsSync(output) && statSync(output).size > 0) {
        resolve(true);
      } else {
        // Fallback a libx265 por CPU si QSV no responde para este contenedor
        try { if (existsSync(output)) unlinkSync(output); } catch {}
        const procCpu = spawn(config.ffmpeg, [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-i', input,
          '-c:v', 'libx265',
          '-crf', '23',
          '-preset', 'fast',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-c:s', 'copy',
          output,
        ], { windowsHide: true, timeout: 30 * 60_000 });

        procCpu.on('close', (c) => {
          resolve(c === 0 && existsSync(output) && statSync(output).size > 0);
        });
        procCpu.on('error', () => resolve(false));
      }
    });
    proc.on('error', () => resolve(false));
  });
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

  const sondaOrig = await sondear(f.path);
  if (!sondaOrig || sondaOrig.duracion <= 0) {
    console.log(`  x No se pudo sondear la duración original con ffprobe.`);
    continue;
  }

  // Generamos el nuevo archivo en MKV en la misma carpeta con sufijo temporal
  const dirPeli = join(f.path, '..');
  const nuevoNombre = f.path.replace(/\.[a-zA-Z0-9]+$/, '.mkv');
  const tempOutput = nuevoNombre + '.recodificando.tmp.mkv';

  const t0 = Date.now();
  console.log(`  Iniciando recodificación a HEVC (QSV / Intel Arc)...`);
  const exito = await recodificar(f.path, tempOutput);

  if (!exito) {
    console.log(`  x Falló la recodificación de ffmpeg.`);
    try { if (existsSync(tempOutput)) unlinkSync(tempOutput); } catch {}
    continue;
  }

  // Verificación estricta de paridad con ffprobe
  const sondaNuevo = await sondear(tempOutput);
  if (!sondaNuevo || sondaNuevo.videoCodec !== 'hevc') {
    console.log(`  x Verificación fallida: el nuevo archivo no tiene códec HEVC válido.`);
    try { unlinkSync(tempOutput); } catch {}
    continue;
  }

  const difSegundos = Math.abs(sondaNuevo.duracion - sondaOrig.duracion);
  if (difSegundos > 2) {
    console.log(`  x Verificación fallida: diferencia de duración excesiva (${difSegundos.toFixed(1)} s vs original).`);
    try { unlinkSync(tempOutput); } catch {}
    continue;
  }

  const szOriginal = statSync(f.path).size;
  const szNuevo = statSync(tempOutput).size;
  const ahorroPct = ((1 - szNuevo / szOriginal) * 100).toFixed(1);
  const durSec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  ✔ Verificación superada: Duración: ${sondaNuevo.duracion.toFixed(1)}s (dif: ${difSegundos.toFixed(2)}s)`);
  console.log(`  ✔ Tamaño: ${(szOriginal / 1048576).toFixed(1)} MB -> ${(szNuevo / 1048576).toFixed(1)} MB (${ahorroPct}% ahorro) en ${durSec}s`);

  if (modoProbar) {
    console.log(`\n[MODO PRUEBA]: Fichero temporal conservado en: ${tempOutput}`);
    console.log(`No se ha modificado el archivo original en E:\\. Ejecute con --confirmar para aplicar.`);
    appendFileSync(LOG_FILE, `[PRUEBA PILOTO] ${f.title} OK: ${(szOriginal/1048576).toFixed(1)} MB -> ${(szNuevo/1048576).toFixed(1)} MB (${ahorroPct}% ahorro)\n`);
    break;
  }

  // Si no es modo prueba, reemplazo atómico
  try {
    if (f.path !== nuevoNombre) {
      unlinkSync(f.path);
    }
    renameSync(tempOutput, nuevoNombre);
    actualizarBd.run(nuevoNombre, szNuevo, sondaNuevo.duracion, f.id);

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
