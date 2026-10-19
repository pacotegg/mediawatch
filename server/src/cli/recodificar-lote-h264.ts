/**
 * Lote automatizado de recodificación de vídeos H.264 (AVC) a HEVC (H.265).
 *
 * Objetivo: Migrar los 702 archivos H.264 de la biblioteca a HEVC para liberar ~700 GB en E:\.
 *
 * Características de seguridad y convivencia:
 * 1. Pausa automática si alguien ve algo: Monitoriza `hayAlguienViendo()`. Si detecta
 *    reproducción en Smart TV, móvil o web, cancela/pausa inmediatamente para liberar el disco E:\.
 * 2. Codificación en SSD local: Escribe en `G:\MediaTmp\recodificar-h264\`, nunca directamente en E:\.
 * 3. Verificación antes de reemplazar: duración (+/- 2 s), códec hevc, tamaño menor y LAS MISMAS PISTAS de audio y
 *    subtítulos que el original (ver `media/recodificar.ts`: sin `-map 0` se perdieron pistas en 101 ficheros).
 * 4. El original no se borra: se aparta a `<unidad>\_retirados\<fecha>\` y se actualiza SQLite.
 * 5. Reanudable: Guarda progreso en `data/recodificar-h264.log` y avanza archivo a archivo.
 *
 * Uso:
 *   node --experimental-strip-types server/src/cli/recodificar-lote-h264.ts [--limite N] [--probar]
 */
import { existsSync, mkdirSync, copyFileSync, renameSync, statSync, unlinkSync, appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, extname, join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { hayAlguienViendo } from '../media/ocupado.ts';
import { mediaInfo, probeFile, type MediaInfo } from '../media/probe.ts';
import { argumentosHevc, pistasQueFaltan, retirarOriginal } from '../media/recodificar.ts';

const args = process.argv.slice(2);
const modoProbar = args.includes('--probar');
const limiteIdx = args.indexOf('--limite');
const limite = limiteIdx !== -1 && args[limiteIdx + 1] ? parseInt(args[limiteIdx + 1], 10) : Infinity;

const TEMP_DIR = 'G:\\MediaTmp\\recodificar-h264';
if (!existsSync(TEMP_DIR)) {
  try { mkdirSync(TEMP_DIR, { recursive: true }); } catch {}
}

const LOG_FILE = join(DATA_DIR, 'recodificar-h264.log');
const ESTADO_FILE = join(DATA_DIR, 'recodificar-h264-estado.json');

console.log('=== Lote de Recodificación H.264 -> HEVC (Intel Arc A730M) ===');
console.log(`Modo: ${modoProbar ? 'PRUEBA (sin tocar E:\\)' : 'COMPLETO (con reemplazo verificado)'}`);
console.log(`Límite: ${Number.isFinite(limite) ? limite + ' archivos' : 'todos los pendientes'}`);
console.log(`Directorio temporal: ${TEMP_DIR}`);
console.log(`Registro: ${LOG_FILE}\n`);

type FilaH264 = {
  id: number;
  path: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
};

// Obtenemos los archivos H.264 ordenados de menor a mayor tamaño
const candidatos = db.prepare(`
  SELECT id, path, size, duration, width, height
  FROM media_files
  WHERE video_codec = 'h264'
  ORDER BY size ASC
`).all() as FilaH264[];

console.log(`Total candidatos H.264 en la biblioteca: ${candidatos.length}`);

async function esperarTranquilidad(): Promise<void> {
  if (!hayAlguienViendo()) return;
  console.log(`[Pausa] Reproducción detectada en la casa. Liberando disco E:\\...`);
  while (hayAlguienViendo()) {
    await new Promise((r) => setTimeout(r, 15_000));
  }
  console.log(`[Reanudando] Casa tranquila. Reanudando lote.`);
}

function codificarAHevc(input: string, output: string, original: MediaInfo): Promise<{ ok: boolean; interrumpido: boolean }> {
  return new Promise((resolve) => {
    let interrumpido = false;
    const params = argumentosHevc(input, output, original);

    // Tope: lo que dura el vídeo (QSV va muy por encima de tiempo real), y nunca menos de 20 min.
    const proc = spawn(config.ffmpeg, params, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: Math.max(20 * 60_000, (original.duration || 0) * 1000),
    });

    // Vigilante de reproducción: si alguien ve algo, cancela el encode actual para soltar el disco
    const vigilante = setInterval(() => {
      if (hayAlguienViendo()) {
        interrumpido = true;
        clearInterval(vigilante);
        try { proc.kill('SIGTERM'); } catch {}
      }
    }, 4000);

    proc.on('close', (code) => {
      clearInterval(vigilante);
      if (interrumpido) {
        try { if (existsSync(output)) unlinkSync(output); } catch {}
        return resolve({ ok: false, interrumpido: true });
      }
      const ok = code === 0 && existsSync(output) && statSync(output).size > 0;
      resolve({ ok, interrumpido: false });
    });

    proc.on('error', () => {
      clearInterval(vigilante);
      try { if (existsSync(output)) unlinkSync(output); } catch {}
      resolve({ ok: false, interrumpido });
    });
  });
}

async function procesar() {
  let convertidos = 0;
  let bytesAhorrados = 0;
  let fallos = 0;
  try {
    if (existsSync(ESTADO_FILE)) {
      const prev = JSON.parse(readFileSync(ESTADO_FILE, 'utf-8'));
      if (typeof prev.convertidos === 'number') convertidos = prev.convertidos;
      if (prev.ahorroTotalMb) bytesAhorrados = Math.round(parseFloat(prev.ahorroTotalMb) * 1048576);
    }
  } catch {}

  for (let i = 0; i < candidatos.length && convertidos < limite; i++) {
    const f = candidatos[i];
    await esperarTranquilidad();

    if (!existsSync(f.path)) {
      console.log(`[Omitido] Fichero no encontrado en disco: ${f.path}`);
      continue;
    }

    const nombreBase = basename(f.path, extname(f.path));
    const tmpSalida = join(TEMP_DIR, `${nombreBase}.tmp.mkv`);
    const szOriginal = statSync(f.path).size;

    console.log(`\n[${convertidos + 1}/${Math.min(candidatos.length, limite)}] Codificando: ${nombreBase}`);
    console.log(`  Tamaño original: ${(szOriginal / 1048576).toFixed(1)} MB (${f.width || '?'}x${f.height || '?'})`);

    const sondaOrig = await probeFile(f.path).catch(() => null);
    if (!sondaOrig) {
      fallos++;
      console.log(`  x No se pudo sondear el original: no se toca.`);
      continue;
    }

    let t0 = Date.now();
    let res = await codificarAHevc(f.path, tmpSalida, sondaOrig);

    // Si fue interrumpido por reproducción, esperamos y reintentamos este mismo fichero
    while (res.interrumpido) {
      console.log(`  [Pausa] Interrumpido por reproducción activa. Esperando a que termine...`);
      await esperarTranquilidad();
      t0 = Date.now();
      res = await codificarAHevc(f.path, tmpSalida, sondaOrig);
    }

    if (!res.ok) {
      fallos++;
      console.log(`  x Falló la codificación de este archivo.`);
      try { if (existsSync(tmpSalida)) unlinkSync(tmpSalida); } catch {}
      continue;
    }

    // Verificación de paridad con ffprobe
    const sondaNuevo = await probeFile(tmpSalida).catch(() => null);
    if (!sondaNuevo || !sondaNuevo.video || sondaNuevo.video.codec !== 'hevc') {
      fallos++;
      console.log(`  x Verificación fallida: no se detectó flujo HEVC válido.`);
      try { if (existsSync(tmpSalida)) unlinkSync(tmpSalida); } catch {}
      continue;
    }

    const faltan = pistasQueFaltan(sondaOrig, sondaNuevo);
    if (faltan) {
      fallos++;
      console.log(`  x Verificación fallida: faltan pistas (${faltan}).`);
      try { if (existsSync(tmpSalida)) unlinkSync(tmpSalida); } catch {}
      continue;
    }

    const durNuevo = sondaNuevo.duration;
    const durOrig = f.duration || durNuevo;
    const difDur = Math.abs(durNuevo - durOrig);

    if (durOrig > 10 && difDur > 2.0) {
      fallos++;
      console.log(`  x Verificación fallida: diferencia de duración excesiva (${difDur.toFixed(1)}s).`);
      try { if (existsSync(tmpSalida)) unlinkSync(tmpSalida); } catch {}
      continue;
    }

    const szNuevo = statSync(tmpSalida).size;
    const ahorroBytes = szOriginal - szNuevo;
    const ahorroPct = ((ahorroBytes / szOriginal) * 100).toFixed(1);
    const durEncodeSec = ((Date.now() - t0) / 1000).toFixed(1);

    // Si por alguna razón el archivo nuevo no es más pequeño, no compensa sustituirlo
    if (szNuevo >= szOriginal) {
      console.log(`  x Omitido: el archivo resultante no reduce tamaño (${(szNuevo / 1048576).toFixed(1)} MB vs ${(szOriginal / 1048576).toFixed(1)} MB).`);
      try { if (existsSync(tmpSalida)) unlinkSync(tmpSalida); } catch {}
      continue;
    }

    console.log(`  ✔ Verificado: ${(szOriginal / 1048576).toFixed(1)} MB -> ${(szNuevo / 1048576).toFixed(1)} MB (${ahorroPct}% ahorro en ${durEncodeSec}s)`);

    if (modoProbar) {
      console.log(`  [Modo Prueba] Archivo generado en ${tmpSalida}. No se modifica E:\\.`);
      convertidos++;
      continue;
    }

    // Sustitución atómica en E:\
    try {
      const extVieja = extname(f.path);
      const nuevaRuta = f.path.slice(0, -extVieja.length) + '.mkv';
      const rutaDestinoTmp = nuevaRuta + '.new';

      // 1. Copiar de SSD a E:\ como .new
      copyFileSync(tmpSalida, rutaDestinoTmp);
      if (!existsSync(rutaDestinoTmp) || statSync(rutaDestinoTmp).size !== szNuevo) {
        throw new Error('Fallo al copiar archivo a E:\\');
      }

      // 2. Apartar el original (no se borra) y poner el nuevo en su sitio; si esto último falla, el original vuelve.
      const retirado = retirarOriginal(f.path);
      try {
        renameSync(rutaDestinoTmp, nuevaRuta);
      } catch (e) {
        renameSync(retirado, f.path);
        throw e;
      }
      unlinkSync(tmpSalida);
      console.log(`  Original apartado en ${retirado}`);

      // 3. Actualizar base de datos
      db.prepare(`
        UPDATE media_files
        SET path = ?, container = 'mkv', video_codec = 'hevc', size = ?, duration = ?, probed = 1
        WHERE id = ?
      `).run(nuevaRuta, szNuevo, durNuevo, f.id);

      // 4. Actualizar metadatos de pistas
      await mediaInfo(f.id).catch(() => null);

      convertidos++;
      bytesAhorrados += ahorroBytes;

      const logMsg = `[${new Date().toLocaleTimeString()}] ${nombreBase}: ${(szOriginal/1048576).toFixed(1)} MB -> ${(szNuevo/1048576).toFixed(1)} MB (${ahorroPct}% ahorro)\n`;
      appendFileSync(LOG_FILE, logMsg, 'utf-8');

      // Guardar checkpoint de estado
      writeFileSync(ESTADO_FILE, JSON.stringify({
        ultimaActualizacion: new Date().toISOString(),
        convertidos,
        ahorroTotalMb: (bytesAhorrados / 1048576).toFixed(1),
        ultimoArchivo: nombreBase,
        pendientes: candidatos.length - (i + 1),
      }, null, 2), 'utf-8');

    } catch (err) {
      fallos++;
      console.log(`  x Error al sustituir archivo en E:\\: ${(err as Error).message}`);
    }
  }

  console.log('\n=== Resumen de la sesión ===');
  console.log(`Archivos convertidos: ${convertidos}`);
  console.log(`Espacio liberado:     ${(bytesAhorrados / 1048576).toFixed(1)} MB (${(bytesAhorrados / (1024*1024*1024)).toFixed(2)} GB)`);
  console.log(`Fallos u omitidos:    ${fallos}`);
}

void procesar();
