/**
 * Pasa por OCR, de antemano, los subtítulos PGS de la biblioteca y los deja en la misma caché que usa la tele
 * (`data/subtitles/<fileId>-<streamIndex>.vtt`, ver la ruta `/subtitle/` de `routes/play.ts`).
 *
 * Por qué: un PGS sin caché obliga al servidor a leer la película ENTERA y pasarle OCR cuando alguien lo elige.
 * Medido el 13/11/2026 con Proyecto Salvación (9,8 GB): 204 s. La tele esperaba 45 s y se quedaba sin subtítulos
 * toda la sesión; de 1.198 pistas PGS solo 34 estaban en caché.
 *
 * - Una sola lectura del vídeo por fichero, con todas sus pistas a la vez (como `extraer-subtitulos.ts`).
 * - Solo castellano e inglés salvo `--todos`: son los dos idiomas con `tessdata` instalado; el resto se leería
 *   con el OCR inglés y saldría mal.
 * - Nunca pisa una caché que ya exista. Se puede cortar (Ctrl+C) y relanzar: retoma por lo que falta.
 * - Respeta `hayAlguienViendo()` entre ficheros, como el resto de trabajos de fondo.
 * - Escribe solo en `data/subtitles`. No toca nada de E:.
 *
 *   node src/cli/precalentar-pgs.ts --probar        (cuenta, no lee vídeos)
 *   node src/cli/precalentar-pgs.ts --aplicar [--limite N] [--todos]
 */
import { execFile } from 'node:child_process';
import { existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { esperarSiHayAlguienViendo } from '../media/ocupado.ts';
import { ocrSupAVtt } from '../media/pgs-ocr.ts';
import { probeFile } from '../media/probe.ts';

const run = promisify(execFile);
const probar = process.argv.includes('--probar');
const todos = process.argv.includes('--todos');
const iLimite = process.argv.indexOf('--limite');
const limite = iLimite > 0 ? Number(process.argv[iLimite + 1]) || Infinity : Infinity;
if (!probar && !process.argv.includes('--aplicar')) {
  console.log('precalentar-pgs: usa --probar (solo cuenta) o --aplicar (lee los vídeos y guarda la caché).');
  process.exit(0);
}

const CACHE = join(DATA_DIR, 'subtitles');
const IDIOMAS = new Set(['spa', 'es', 'esp', 'eng', 'en']);

let sigue = true;
process.on('SIGINT', () => { sigue = false; console.log('\nCortando al terminar este fichero…'); });

type Fila = { fileId: number; path: string; size: number | null };
type Pista = { streamIndex: number; lang: string | undefined };

function ficheros(): Fila[] {
  // Castellano primero (lo que más se ve en casa), luego el resto; dentro, los más pequeños antes: más pelis por hora.
  return db
    .prepare(`SELECT f.id AS fileId, f.path, f.size,
                     MAX(CASE WHEN s.language IN ('spa','es','esp') THEN 1 ELSE 0 END) AS hayEsp
              FROM sub_tracks s JOIN media_files f ON f.id = s.file_id
              WHERE s.codec = 'hdmv_pgs_subtitle' AND s.external IS NULL
              GROUP BY f.id ORDER BY hayEsp DESC, f.size ASC`)
    .all() as Fila[];
}

const cachePath = (fileId: number, idx: number) => join(CACHE, `${fileId}-${idx}.vtt`);

async function pendientes(f: Fila): Promise<Pista[]> {
  // El índice real de ffmpeg, no el guardado: si el fichero se sustituyó después del escaneo, el guardado miente.
  const info = await probeFile(f.path);
  return info.subs
    .filter((s) => s.codec === 'hdmv_pgs_subtitle' && (todos || IDIOMAS.has(String(s.language ?? ''))))
    .filter((s) => !existsSync(cachePath(f.fileId, s.streamIndex)))
    .map((s) => ({ streamIndex: s.streamIndex, lang: s.language }));
}

async function procesar(f: Fila, pistas: Pista[]): Promise<{ hechas: number; fallidas: number }> {
  const sello = `pre_${process.pid}_${Date.now()}`;
  const sups = pistas.map((p) => join(CACHE, `${sello}_${p.streamIndex}.sup`));
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', f.path];
  pistas.forEach((p, i) => args.push('-map', `0:${p.streamIndex}`, '-c:s', 'copy', sups[i]));
  let hechas = 0;
  let fallidas = 0;
  try {
    try {
      await run(config.ffmpeg, args, { windowsHide: true, timeout: 60 * 60_000 });
    } catch (err) {
      console.error(`  [fallo] ffmpeg con ${f.path}: ${(err as Error).message.split('\n')[0]}`);
    }
    for (const [i, p] of pistas.entries()) {
      const destino = cachePath(f.fileId, p.streamIndex);
      if (existsSync(destino)) { hechas++; continue; } // la pidió la tele mientras tanto
      try {
        if (!existsSync(sups[i])) throw new Error('ffmpeg no escribió la pista');
        // Igual que la ruta: un .sup casi vacío es una pista sin frases, y se guarda vacía para no repetirla.
        const vtt = statSync(sups[i]).size < 64 ? 'WEBVTT\n\n' : await ocrSupAVtt(sups[i], sups[i] + '.srt', p.lang);
        if (!vtt) throw new Error('PgsToSrt no dejó salida');
        writeFileSync(destino, vtt, 'utf8');
        hechas++;
      } catch (err) {
        fallidas++;
        console.error(`  [fallo] pista ${p.streamIndex} de ${f.path}: ${(err as Error).message}`);
      }
    }
  } finally {
    for (const s of sups) try { if (existsSync(s)) unlinkSync(s); } catch {}
  }
  return { hechas, fallidas };
}

async function main() {
  const lista = ficheros();
  let ficherosHechos = 0, pistasHechas = 0, pistasFallidas = 0, totalPend = 0, gb = 0;
  const t0 = Date.now();
  console.log(`${lista.length} ficheros con PGS${probar ? ' (modo prueba: solo cuenta)' : ''}`);
  for (const f of lista) {
    if (!sigue || ficherosHechos >= limite) break;
    let pistas: Pista[];
    try { pistas = await pendientes(f); } catch (err) {
      console.error(`  [fallo] ffprobe con ${f.path}: ${(err as Error).message.split('\n')[0]}`);
      continue;
    }
    if (pistas.length === 0) continue;
    totalPend += pistas.length;
    gb += (f.size ?? 0) / 1e9;
    if (probar) continue;
    if (!(await esperarSiHayAlguienViendo(() => sigue))) break;
    const t = Date.now();
    const r = await procesar(f, pistas);
    ficherosHechos++;
    pistasHechas += r.hechas;
    pistasFallidas += r.fallidas;
    console.log(`  ${ficherosHechos} · ${Math.round((Date.now() - t) / 1000)} s · ${r.hechas}/${pistas.length} pistas · ${f.path}`);
  }
  if (probar) console.log(`Pendientes: ${totalPend} pistas en ${gb.toFixed(0)} GB de vídeo por leer.`);
  else console.log(`\nFicheros: ${ficherosHechos}. Pistas hechas: ${pistasHechas}. Fallidas: ${pistasFallidas}. ${Math.round((Date.now() - t0) / 60000)} min.`);
}

main().catch((err) => { console.error('fallo general:', err); process.exit(1); });
