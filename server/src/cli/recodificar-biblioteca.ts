/**
 * Recodifica a HEVC los vídeos H.264 de la biblioteca PASANDO POR EL PIPELINE (encode.ps1), por tandas y sin perder nada.
 *
 * Sustituye a los lotes de Gemini del 18/10 (`recodificar-lote-h264.ts`, `recodificar-legacy-hevc.ts`), que codificaban
 * con sus propios parámetros (GQ 24, 8 bits, sin filtros), sin `-map 0` y borrando el original: 190 ficheros perdieron
 * pistas. Aquí la calidad, el audio y los subtítulos los decide `encode.ps1`, igual que para todo lo que entra nuevo.
 *
 * Por cada fichero:
 *   1. Se copia (no se mueve) a `C:\Media\encode_queue\mw<id>.<ext>`; `encode-watch.ps1` lo codifica y la salida
 *      queda en `C:\Media\encoded\mw<id>.mkv`.
 *   2. Se verifica contra el original: duración (±1 % y ±3 s), resolución, TODOS los idiomas de audio y de subtítulos,
 *      y que ahorre al menos un 15 %. Si algo falla, el original no se toca (el motivo queda en el registro).
 *
 * Solo entran los que, con las reglas de encode.ps1, deberían ahorrar al menos un 20 %. Medido el 19/10 con tres de
 * prueba: un H.264 de 1,8 Mbps sale MÁS GRANDE (el pipeline no baja de 2,0 Mbps en 1080p), así que recodificar los de
 * poco bitrate solo añadiría pérdida. Estimación sobre los 429 pendientes: 241 bajan un 20 % o más (~460 GB).
 *   3. Solo con `--aplicar`: la salida se copia a E: como `.new`, el original se aparta a `<unidad>\_retirados\<fecha>\`
 *      (no se borra: eso es a mano) y la nueva ocupa su sitio con extensión .mkv.
 *
 * Reanudable: `data/recodificar-biblioteca.jsonl` guarda una línea por fichero con su RUTA (los ids cambian al
 * reescanear). Pausa entre ficheros si alguien está viendo algo. Parada limpia: crear `data/recodificar-biblioteca.stop`.
 *
 * Uso (desde server/):
 *   node src/cli/recodificar-biblioteca.ts --limite 3                 prueba: codifica y verifica, no toca E:
 *   node src/cli/recodificar-biblioteca.ts --aplicar --tanda-gb 150   lote real, por tandas de 150 GB
 */
import { execFile } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { hayAlguienViendo } from '../media/ocupado.ts';
import { mediaInfo, probeFile, type MediaInfo } from '../media/probe.ts';
import { retirarOriginal, verificarRecodificado } from '../media/recodificar.ts';

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const valor = (n: string, def: number) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def; };
const limite = valor('--limite', Infinity);
const tandaGb = valor('--tanda-gb', 150);

const COLA = 'C:\\Media\\encode_queue';
const SALIDA = 'C:\\Media\\encoded';
const EN_CURSO = 'C:\\Media\\encode_running';
const COMPLETADOS = 'C:\\Media\\encode_logs\\completed.jsonl';
const REGISTRO = join(DATA_DIR, 'recodificar-biblioteca.jsonl');
const PARADA = join(DATA_DIR, 'recodificar-biblioteca.stop');
const TOPE_ESPERA_MS = 6 * 3600_000; // un fichero que no sale en 6 h se da por atascado

type Fila = { id: number; path: string; size: number };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const anotar = (o: object) => appendFileSync(REGISTRO, JSON.stringify({ cuando: new Date().toISOString(), ...o }) + '\n');

const hechos = new Set<string>();
if (existsSync(REGISTRO)) {
  for (const l of readFileSync(REGISTRO, 'utf8').split('\n')) {
    try { const o = JSON.parse(l); if (o.ruta && (o.resultado === 'sustituido' || o.resultado === 'rechazado')) hechos.add(o.ruta); } catch { /* línea a medias */ }
  }
}

/*
 * Lo que dejaría encode.ps1, con sus reglas (ver la skill arc-qsv-facts): objetivo de tabla (SDR: 5,0 película / 4,0
 * serie en 1080p; 8,5 / 5,5 en 4K), tope del 70 % del bitrate de la fuente pasado a HEVC (H.264 × 0,65) y suelo absoluto
 * (2,0 en 1080p, 5,0 en 4K). El audio se estima por códec. Es una estimación para no perder horas en lo que no baja;
 * la decisión real la toma la verificación tras codificar.
 */
function ahorroEstimado(f: Fila & { duration: number; height: number; serie: number; audio: number }): number {
  const vFuente = Math.max(0.3, (f.size * 8) / f.duration / 1e6 - f.audio);
  const es4k = f.height >= 2000, serie = f.serie === 1 || f.duration < 3600;
  const tabla = es4k ? (serie ? 5.5 : 8.5) : serie ? 4.0 : 5.0;
  const v = Math.max(es4k ? 5.0 : 2.0, Math.min(tabla, vFuente * 0.65 * 0.7));
  return 1 - ((v + f.audio) * f.duration * 1e6) / 8 / f.size;
}
const candidatos = (db.prepare(`SELECT m.id, m.path, m.size, m.duration, m.height, (m.episode_id IS NOT NULL) serie,
    COALESCE((SELECT SUM(CASE WHEN a.codec LIKE 'truehd%' THEN 4 WHEN a.codec LIKE 'dts%' THEN 1.5 WHEN a.codec IN ('ac3','eac3') THEN 0.5 ELSE 0.2 END)
      FROM audio_tracks a WHERE a.file_id = m.id), 0.3) audio
  FROM media_files m WHERE m.video_codec = 'h264' AND m.duration > 0 ORDER BY m.size ASC`).all() as (Fila & { duration: number; height: number; serie: number; audio: number })[])
  .filter((f) => !hechos.has(f.path) && existsSync(f.path) && ahorroEstimado(f) >= 0.2);

/** Lo que tiene que conservar: cada idioma de audio y de subtítulos (los externos no van dentro del fichero). */
function idiomas(info: MediaInfo) {
  const norm = (l?: string) => (l || 'und').toLowerCase();
  return { audio: new Set(info.audio.map((a) => norm(a.language))), subs: new Set(info.subs.map((s) => norm(s.language))) };
}

/*
 * Duración de la pista de VÍDEO, no la del contenedor: esa la marca la pista más larga, que suele ser el audio. Casino
 * Royale (encode del 17/09) tiene el vídeo 7 min más corto que el audio y el contenedor dice la duración entera.
 * MKV la guarda en la etiqueta DURATION de la pista; MP4, en `duration`. NaN si no hay forma de saberla.
 */
async function duracionVideo(ruta: string): Promise<number> {
  const { stdout } = await promisify(execFile)(config.ffprobe, ['-v', 'error', '-select_streams', 'V:0', '-show_entries', 'stream=duration:stream_tags=DURATION',
    '-of', 'json', ruta], { timeout: 60_000, windowsHide: true });
  const s = (JSON.parse(stdout).streams ?? [])[0] ?? {};
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(s.tags?.DURATION ?? '').trim());
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number(s.duration ?? NaN);
}

/*
 * Terminado = el pipeline ha anotado el trabajo en completed.jsonl (salida `mw<id>.mkv`, posterior a ponerlo en cola).
 * NO vale mirar encode_running: el pipeline deja ahí las fuentes al acabar bien y las barre horas después.
 */
async function esperarSalida(id: number, desde: number): Promise<string | null> {
  const salida = join(SALIDA, `mw${id}.mkv`);
  while (Date.now() - desde < TOPE_ESPERA_MS) {
    await espera(30_000);
    let hecho = false;
    try {
      for (const l of readFileSync(COMPLETADOS, 'utf8').split('\n')) {
        if (!l.includes(`"mw${id}.mkv"`)) continue;
        try { const o = JSON.parse(l); if (o.output === `mw${id}.mkv` && o.ts * 1000 >= desde - 60_000) hecho = true; } catch { /* línea a medias */ }
      }
    } catch { /* aún no existe */ }
    if (hecho && existsSync(salida)) return salida;
  }
  return null;
}

async function procesar(f: Fila) {
  while (hayAlguienViendo()) { console.log('  alguien está viendo algo: espero 2 min'); await espera(120_000); }
  const ext = extname(f.path);
  const orig = await probeFile(f.path);
  const vOrig = await duracionVideo(f.path);
  const puesto = Date.now();
  copyFileSync(f.path, join(COLA, `mw${f.id}${ext}`));
  console.log(`  en cola: mw${f.id}${ext}`);
  const salida = await esperarSalida(f.id, puesto);
  if (!salida) { anotar({ ruta: f.path, id: f.id, resultado: 'atascado' }); console.log('  x no salió en 6 h'); return; }
  // La copia de la fuente es nuestra: fuera en cuanto el pipeline la ha usado, que son GB en C:.
  try { unlinkSync(join(EN_CURSO, `mw${f.id}${ext}`)); } catch { /* ya no estaba */ }
  const nuevo = await probeFile(salida);
  const tamNuevo = statSync(salida).size;
  const vNuevo = await duracionVideo(salida);
  const fallo = verificarRecodificado(orig, nuevo, f.size, tamNuevo, vOrig, vNuevo);
  const resumen = `${(f.size / 1e6).toFixed(0)} -> ${(tamNuevo / 1e6).toFixed(0)} MB; vídeo ${vOrig.toFixed(0)} -> ${vNuevo.toFixed(0)} s; audio ${[...idiomas(orig).audio]} -> ${[...idiomas(nuevo).audio]}; subs ${[...idiomas(orig).subs]} -> ${[...idiomas(nuevo).subs]}`;
  if (fallo) {
    anotar({ ruta: f.path, id: f.id, resultado: 'rechazado', motivo: fallo, resumen });
    unlinkSync(salida);
    console.log(`  x RECHAZADO (${fallo}); original intacto`);
    return;
  }
  if (!aplicar) { anotar({ ruta: f.path, id: f.id, resultado: 'verificado', resumen }); unlinkSync(salida); console.log(`  ok verificado (${resumen}); sin --aplicar no se toca E:`); return; }

  const destino = join(dirname(f.path), basename(f.path, ext) + '.mkv');
  const temporal = destino + '.new';
  copyFileSync(salida, temporal);
  if (statSync(temporal).size !== tamNuevo) { unlinkSync(temporal); throw new Error('la copia a E: no cuadra en tamaño'); }
  const retirado = retirarOriginal(f.path);
  try { renameSync(temporal, destino); } catch (e) { renameSync(retirado, f.path); throw e; }
  unlinkSync(salida);
  db.prepare('UPDATE media_files SET path = ?, size = ?, probed = 0 WHERE id = ?').run(destino, tamNuevo, f.id);
  await mediaInfo(f.id).catch(() => null);
  anotar({ ruta: f.path, id: f.id, resultado: 'sustituido', destino, retirado, resumen });
  console.log(`  ok SUSTITUIDO (${resumen}); original en ${retirado}`);
}

console.log(`${candidatos.length} vídeos H.264 pendientes (${(candidatos.reduce((s, f) => s + f.size, 0) / 1e9).toFixed(0)} GB). ${aplicar ? 'CON --aplicar: se sustituye en E:' : 'Prueba: no se toca E:'}`);
let hechosAhora = 0;
while (hechosAhora < limite && candidatos.length) {
  // Tanda: lo que quepa en `tandaGb` (siempre al menos uno).
  const tanda: Fila[] = [];
  let gb = 0;
  while (candidatos.length && hechosAhora + tanda.length < limite && (tanda.length === 0 || gb + candidatos[0].size / 1e9 <= tandaGb)) {
    const f = candidatos.shift()!; tanda.push(f); gb += f.size / 1e9;
  }
  console.log(`\nTanda de ${tanda.length} (${gb.toFixed(1)} GB)`);
  for (const f of tanda) {
    if (existsSync(PARADA)) { console.log('Parada pedida: salgo.'); process.exit(0); }
    console.log(`[${++hechosAhora}] ${f.path}`);
    try { await procesar(f); } catch (e) { anotar({ ruta: f.path, id: f.id, resultado: 'error', motivo: (e as Error).message }); console.log(`  x error: ${(e as Error).message}`); }
  }
}
console.log('\nTerminado.');
