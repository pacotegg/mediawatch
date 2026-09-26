/**
 * Compara, sin tocar nada de `E:`, el subtítulo externo que ya hay (el de
 * Bazarr) contra el incrustado del mismo idioma, para saber **con datos** en
 * cuántos casos difieren de verdad antes de decidir si se sustituye alguno.
 *
 * Contexto (24-25/09): el usuario dice que «más de la mitad» de los `.srt` de
 * Bazarr estaban mal sincronizados — lo que implica que casi la mitad estaban
 * bien. Borrarlos todos a ciegas arreglaría ~1.600 y destruiría ~1.500 que
 * funcionaban, sin vuelta atrás. Esto mide antes de decidir.
 *
 * El incrustado extraído **se conserva** en `data/cache/subs-comparacion/`:
 * son ~15 KB cada uno y evitan tener que releer los vídeos enteros otra vez
 * si luego se decide sustituir. Leer los 1.861 ficheros es el coste caro
 * (horas); hacerlo dos veces sería tonto.
 *
 * Cómo compara: saca los tiempos de inicio de cada cue de los dos ficheros y,
 * para una muestra de los del incrustado, busca el cue más cercano del
 * externo. La **mediana** de esas diferencias es el desfase entre ambos; la
 * **desviación mediana** (MAD) dice si encajan de verdad o si son contenidos
 * distintos y la mediana no significa nada.
 *
 * Importante: esto dice si difieren **entre sí**, no cuál de los dos es el
 * correcto. Para eso haría falta medirlos contra el audio (`media/resync.ts`,
 * `scripts/resync.py`), que lee la pista entera y es mucho más caro.
 *
 * Reanudable: cada resultado se anota en `data/comparacion-subtitulos.jsonl`
 * según sale, y al arrancar se salta lo ya hecho.
 *
 *   node src/cli/comparar-subtitulos.ts --probar   (cuenta, no extrae)
 *   node src/cli/comparar-subtitulos.ts
 */
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR, config } from '../config.ts';
import { db } from '../db.ts';
import { esperarSiHayAlguienViendo } from '../media/ocupado.ts';
import { probeFile } from '../media/probe.ts';

const run = promisify(execFile);
const probar = process.argv.includes('--probar');
const CONCURRENCIA = 2;
const GUARDADOS = join(DATA_DIR, 'cache', 'subs-comparacion');
const RESULTADOS = join(DATA_DIR, 'comparacion-subtitulos.jsonl');
mkdirSync(GUARDADOS, { recursive: true });

type Tarea = { fileId: number; path: string; externos: { id: number; language: string | null; forced: number; ruta: string }[] };

let sigue = true;
process.on('SIGINT', () => { sigue = false; });

function yaHechos(): Set<number> {
  if (!existsSync(RESULTADOS)) return new Set();
  const hechos = new Set<number>();
  for (const linea of readFileSync(RESULTADOS, 'utf8').split('\n')) {
    if (!linea.trim()) continue;
    try { hechos.add(JSON.parse(linea).fileId as number); } catch { /* línea a medias */ }
  }
  return hechos;
}

/** Ficheros que tienen a la vez un externo y algún incrustado. */
function tareas(): Tarea[] {
  const filas = db
    .prepare(`SELECT s.id, s.file_id AS fileId, f.path, s.language, s.forced, s.external
                FROM sub_tracks s JOIN media_files f ON f.id = s.file_id
               WHERE s.external IS NOT NULL
                 AND EXISTS (SELECT 1 FROM sub_tracks i WHERE i.file_id = s.file_id AND i.external IS NULL)`)
    .all() as { id: number; fileId: number; path: string; language: string | null; forced: number; external: string }[];

  const porFichero = new Map<number, Tarea>();
  for (const f of filas) {
    const t = porFichero.get(f.fileId) ?? { fileId: f.fileId, path: f.path, externos: [] };
    t.externos.push({ id: f.id, language: f.language, forced: f.forced, ruta: f.external });
    porFichero.set(f.fileId, t);
  }
  return [...porFichero.values()];
}

/** Segundos de inicio de cada cue de un `.srt`. */
function tiemposDeSrt(texto: string): number[] {
  const tiempos: number[] = [];
  const re = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    tiempos.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000);
  }
  return tiempos;
}

/**
 * Desfase entre dos listas de tiempos. Para cada cue de `a` busca el más
 * cercano de `b`; la mediana de esas diferencias es el desfase, y la
 * desviación mediana dice si el encaje es real o casual.
 */
function desfase(a: number[], b: number[]): { mediana: number; mad: number; muestras: number } | null {
  if (a.length < 5 || b.length < 5) return null;
  const paso = Math.max(1, Math.floor(a.length / 300)); // muestra repartida, no los 1.000
  const difs: number[] = [];
  for (let i = 0; i < a.length; i += paso) {
    let mejor = Infinity;
    for (const t of b) {
      const d = t - a[i];
      if (Math.abs(d) < Math.abs(mejor)) mejor = d;
    }
    if (Number.isFinite(mejor)) difs.push(mejor);
  }
  if (difs.length < 5) return null;
  difs.sort((x, y) => x - y);
  const mediana = difs[Math.floor(difs.length / 2)];
  const desv = difs.map((d) => Math.abs(d - mediana)).sort((x, y) => x - y);
  return { mediana, mad: desv[Math.floor(desv.length / 2)], muestras: difs.length };
}

/**
 * Lee un `.srt` que puede no estar en UTF-8, con la misma escalera de
 * codificaciones que `subsfetch.leer_srt()` usa en el pipeline.
 *
 * Los subtítulos en español descargados suelen venir en Latin-1/cp1252.
 * `latin1` no puede fallar —todo byte es un carácter válido—, así que
 * siempre hay respuesta. Y para lo que hace este comparador da igual que
 * algún acento salga raro: `tiemposDeSrt` solo mira los códigos de tiempo,
 * que son ASCII puro en cualquiera de las cuatro codificaciones.
 */
function leerSrt(ruta: string): string {
  const bytes = readFileSync(ruta);
  const sinBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  for (const enc of ['utf-8', 'windows-1252']) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(sinBom);
    } catch {
      // siguiente codificación
    }
  }
  return sinBom.toString('latin1');
}

/**
 * Pasa cualquier formato de subtítulo a `.srt` en un temporal, para poder leer
 * sus tiempos.
 *
 * Un `.srt` **no pasa por ffmpeg**. Convertir SRT a SRT no aporta nada y metía
 * un fallo por el camino: ffmpeg se niega a decodificar un subtítulo que no sea
 * UTF-8 («Invalid UTF-8 in decoded subtitles text; maybe missing -sub_charenc
 * option») y el `catch` de aquí lo convertía en un silencioso «no se pudo leer
 * el externo». Medido el 26/09/2026: 12 ficheros descartados por esto, los doce
 * en español y los doce SRT perfectamente válidos, solo que en Latin-1.
 */
async function aSrt(origen: string, destino: string): Promise<boolean> {
  if (/\.srt$/i.test(origen)) {
    try {
      writeFileSync(destino, leerSrt(origen), 'utf8');
      return true;
    } catch {
      return false;
    }
  }
  try {
    await run(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', origen, '-f', 'srt', destino], { windowsHide: true });
    return existsSync(destino);
  } catch {
    return false;
  }
}

function nombreGuardado(fileId: number, lang: string, forced: boolean): string {
  return join(GUARDADOS, `${fileId}.${lang}${forced ? '.forced' : ''}.srt`);
}

async function comparar(t: Tarea): Promise<number> {
  let info;
  try {
    info = await probeFile(t.path);
  } catch (err) {
    appendFileSync(RESULTADOS, JSON.stringify({ fileId: t.fileId, path: t.path, error: 'ffprobe: ' + (err as Error).message }) + '\n');
    return 0;
  }

  const incrustados = info.subs.filter((s) => s.textual && s.language);
  let comparados = 0;

  for (const ext of t.externos) {
    const par = incrustados.find((s) => s.language === ext.language && s.forced === Boolean(ext.forced));
    if (!par) continue;

    const guardado = nombreGuardado(t.fileId, par.language!, par.forced);
    if (!existsSync(guardado)) {
      try {
        await run(
          config.ffmpeg,
          ['-hide_banner', '-loglevel', 'error', '-y', '-i', t.path, '-map', `0:${par.streamIndex}`, '-f', 'srt', guardado],
          { windowsHide: true },
        );
      } catch (err) {
        appendFileSync(RESULTADOS, JSON.stringify({ fileId: t.fileId, path: t.path, language: ext.language, error: 'extraer: ' + (err as Error).message }) + '\n');
        continue;
      }
    }
    if (!existsSync(guardado)) continue;

    const externoSrt = join(GUARDADOS, `${t.fileId}.${ext.language}${ext.forced ? '.forced' : ''}.externo.srt`);
    if (!existsSync(externoSrt) && !(await aSrt(ext.ruta, externoSrt))) {
      appendFileSync(RESULTADOS, JSON.stringify({ fileId: t.fileId, path: t.path, language: ext.language, error: 'no se pudo leer el externo' }) + '\n');
      continue;
    }

    const d = desfase(tiemposDeSrt(readFileSync(guardado, 'utf8')), tiemposDeSrt(readFileSync(externoSrt, 'utf8')));
    appendFileSync(
      RESULTADOS,
      JSON.stringify({
        fileId: t.fileId,
        path: t.path,
        language: ext.language,
        forced: Boolean(ext.forced),
        externo: ext.ruta,
        incrustado: guardado,
        desfaseSeg: d ? Number(d.mediana.toFixed(3)) : null,
        mad: d ? Number(d.mad.toFixed(3)) : null,
        muestras: d?.muestras ?? 0,
      }) + '\n',
    );
    comparados++;
  }

  if (comparados === 0) appendFileSync(RESULTADOS, JSON.stringify({ fileId: t.fileId, path: t.path, sinPareja: true }) + '\n');
  return comparados;
}

async function main() {
  const todas = tareas();
  const hechos = yaHechos();
  const pendientes = todas.filter((t) => !hechos.has(t.fileId));
  console.log(`${todas.length} ficheros con externo e incrustado · ya comparados ${hechos.size} · pendientes ${pendientes.length}`);

  if (probar) {
    console.log('Modo prueba: no se extrae ni se compara nada.');
    return;
  }
  if (pendientes.length === 0) { resumen(); return; }

  let hechas = 0;
  let comparaciones = 0;
  let indice = 0;

  async function trabajador() {
    while (indice < pendientes.length && sigue) {
      const t = pendientes[indice++];
      if (!(await esperarSiHayAlguienViendo(() => sigue))) break;
      comparaciones += await comparar(t);
      hechas++;
      if (hechas % 25 === 0 || hechas === pendientes.length) {
        console.log(`  ${hechas}/${pendientes.length} ficheros · ${comparaciones} comparaciones`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador));
  resumen();
}

function resumen() {
  if (!existsSync(RESULTADOS)) return;
  const filas = readFileSync(RESULTADOS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const conDato = filas.filter((f: any) => typeof f.desfaseSeg === 'number');
  const coinciden = conDato.filter((f: any) => Math.abs(f.desfaseSeg) <= 0.5 && f.mad <= 1);
  const leve = conDato.filter((f: any) => Math.abs(f.desfaseSeg) > 0.5 && Math.abs(f.desfaseSeg) <= 2 && f.mad <= 1);
  const difieren = conDato.filter((f: any) => Math.abs(f.desfaseSeg) > 2 && f.mad <= 1);
  const dudosos = conDato.filter((f: any) => f.mad > 1);
  const errores = filas.filter((f: any) => f.error);

  console.log('\n===== RESUMEN =====');
  console.log(`comparaciones con dato: ${conDato.length}`);
  console.log(`  coinciden (<=0,5 s):      ${coinciden.length}  -> da igual cuál se quede`);
  console.log(`  diferencia leve (<=2 s):  ${leve.length}`);
  console.log(`  DIFIEREN (>2 s):          ${difieren.length}  -> aquí hay uno malo`);
  console.log(`  dudosos (no encajan):     ${dudosos.length}  -> contenidos distintos, la mediana no vale`);
  console.log(`errores: ${errores.length}`);
  console.log(`\nDetalle por fichero en ${RESULTADOS}`);
}

main().catch((err) => { console.error('fallo general:', err); process.exit(1); });
