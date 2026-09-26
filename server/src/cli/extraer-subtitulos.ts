/**
 * Extrae a `.srt`, junto al vídeo, las pistas de subtítulo incrustadas que no
 * tienen ya un externo del mismo idioma y del mismo tipo (forzado o no).
 *
 * Por qué: solo un externo se puede desajustar en la app (ver
 * `routes/play.ts`, `media/resync.ts`) — un incrustado en crudo viaja dentro
 * del MKV y el servidor no lo toca. El usuario tiene 12.909 pistas incrustadas
 * en 4.247 ficheros por 3.289 externas en 1.863, así que la mayoría de sus
 * subtítulos hoy no se pueden retocar. Nombrando el fichero como ya reconoce
 * el escáner (`<vídeo>.<idioma>.srt`, `<vídeo>.<idioma>.forced.srt` — ver
 * `externalSubs()` en `scanner/scan.ts`), el próximo escaneo lo registra solo
 * como externo.
 *
 * Medido el 24/09: los 4.247 ficheros candidatos suman **35 TB**, y a ~18 s
 * por GB (medido: 75 s en 4,1 GB) eso son del orden de **6-7 días de disco**
 * leyendo sin parar. Los `.srt` resultantes pesan nada (10-20 KB cada uno,
 * ~70 MB en total) — el coste es todo lectura, nada de espacio.
 *
 * El `idx` guardado en `sub_tracks` para un incrustado **no sirve** para
 * `-map` si el fichero no se ha probado nunca: viene de la posición en el NFO
 * de tinyMediaManager (0, 1, 2…), no del índice real de ffmpeg. Comprobado el
 * 24/09: de los 4.247 ficheros con incrustados, 4.185 no estaban probados.
 * Por eso este script llama a `probeFile()` (ffprobe, sin tocar la base) por
 * cada fichero en vez de fiarse de lo guardado.
 *
 * **Una sola pasada de ffmpeg por fichero**, con todas sus pistas candidatas
 * a la vez (`-map`/`-f srt` repetido, varias salidas en la misma llamada):
 * el coste es leer el vídeo entero, así que un fichero con tres idiomas no
 * debe leerse tres veces.
 *
 * Reglas, todas puestas a propósito:
 * - Nunca pisa un `.srt` que ya exista, ni el de Bazarr ni uno de una pasada
 *   anterior de este mismo script.
 * - Solo pistas de texto (`textual`, ver `probe.ts`): PGS y demás formatos de
 *   imagen no se pueden convertir a texto.
 * - Solo la primera pista (menor índice) por combinación (idioma, forzado):
 *   dos «Español» normales en el mismo fichero colisionarían en el nombre. Se
 *   cuenta cuántas se saltan por eso para poder revisarlas aparte si hace
 *   falta.
 * - Sin idioma reconocido, se salta: no hay nombre de fichero válido que el
 *   escáner sepa leer.
 * - Respeta `hayAlguienViendo()` como el resto de trabajos de fondo: si hay
 *   alguien viendo algo, espera. Se comprueba entre ficheros, no a mitad de
 *   una llamada a ffmpeg ya en marcha.
 * - Concurrencia baja (2 ficheros a la vez, no 8 como las miniaturas): cada
 *   uno lee su vídeo entero de un disco mecánico de cabezal único, meter
 *   muchos a la vez satura el disco en vez de acelerarlo.
 *
 *   node src/cli/extraer-subtitulos.ts --probar   (cuenta y mide, no escribe)
 *   node src/cli/extraer-subtitulos.ts
 */
import { execFile } from 'node:child_process';
import { existsSync, unlinkSync, renameSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { esperarSiHayAlguienViendo } from '../media/ocupado.ts';
import { probeFile } from '../media/probe.ts';

const run = promisify(execFile);
const probar = process.argv.includes('--probar');
const CONCURRENCIA = 2;

type Fichero = { fileId: number; path: string };
type Pista = { streamIndex: number; lang: string; forced: boolean };
type FicheroConPistas = { fileId: number; path: string; pistas: Pista[] };

function ficherosConIncrustados(): Fichero[] {
  return db
    .prepare(`SELECT DISTINCT s.file_id AS fileId, f.path FROM sub_tracks s
              JOIN media_files f ON f.id = s.file_id WHERE s.external IS NULL`)
    .all() as Fichero[];
}

function externosExistentes(fileId: number): Set<string> {
  const filas = db
    .prepare(`SELECT language, forced FROM sub_tracks WHERE file_id = ? AND external IS NOT NULL`)
    .all(fileId) as { language: string | null; forced: number }[];
  return new Set(filas.map((f) => `${f.language ?? '?'}:${f.forced ? 1 : 0}`));
}

function rutaDestino(videoPath: string, lang: string, forced: boolean): string {
  const base = basename(videoPath, extname(videoPath));
  const nombre = forced ? `${base}.${lang}.forced.srt` : `${base}.${lang}.srt`;
  return join(dirname(videoPath), nombre);
}

let sigue = true;
process.on('SIGINT', () => { sigue = false; });

/** Qué pistas hacen falta de un fichero, sin tocar ffmpeg todavía. */
async function pistasDe(f: Fichero): Promise<{ pistas: Pista[]; saltadosDuplicado: number }> {
  let info;
  try {
    info = await probeFile(f.path);
  } catch (err) {
    console.error(`  [fallo] ffprobe con ${f.path}: ${(err as Error).message}`);
    return { pistas: [], saltadosDuplicado: 0 };
  }
  const yaExternos = externosExistentes(f.fileId);
  const porGrupo = new Map<string, Pista>();
  let saltadosDuplicado = 0;

  for (const s of info.subs) {
    if (!s.textual || !s.language) continue;
    const clave = `${s.language}:${s.forced ? 1 : 0}`;
    if (yaExternos.has(clave)) continue; // ya hay externo de ese idioma/tipo
    const destino = rutaDestino(f.path, s.language, s.forced);
    if (existsSync(destino)) continue; // ya extraído en una pasada anterior

    if (porGrupo.has(clave)) {
      saltadosDuplicado++;
      continue; // segunda pista del mismo idioma/tipo en el mismo fichero
    }
    porGrupo.set(clave, { streamIndex: s.streamIndex, lang: s.language, forced: s.forced });
  }
  return { pistas: [...porGrupo.values()], saltadosDuplicado };
}

/**
 * Una sola llamada a ffmpeg con todas las pistas de este fichero: cada una va
 * a un temporal propio, y solo se renombran a su nombre final las que de
 * verdad haya escrito ffmpeg. Si el proceso entero falla, no queda ningún
 * `.parcial` suelto.
 */
async function extraerFichero(fc: FicheroConPistas): Promise<{ hechas: number; fallidas: number }> {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', fc.path];
  const temporales: { destino: string; temporal: string }[] = [];
  for (const p of fc.pistas) {
    const destino = rutaDestino(fc.path, p.lang, p.forced);
    const temporal = destino + '.parcial';
    temporales.push({ destino, temporal });
    args.push('-map', `0:${p.streamIndex}`, '-f', 'srt', temporal);
  }

  try {
    await run(config.ffmpeg, args, { windowsHide: true });
  } catch (err) {
    console.error(`  [fallo] ffmpeg con ${fc.path}: ${(err as Error).message}`);
  }

  let hechas = 0;
  for (const { destino, temporal } of temporales) {
    if (existsSync(temporal)) {
      renameSync(temporal, destino);
      hechas++;
    }
  }
  for (const { temporal } of temporales) {
    try { unlinkSync(temporal); } catch { /* ya renombrado o nunca se creó */ }
  }
  return { hechas, fallidas: temporales.length - hechas };
}

async function main() {
  const ficheros = ficherosConIncrustados();
  console.log(`${ficheros.length} ficheros con al menos una pista incrustada${probar ? '  (modo prueba: no se escribe nada, no se llama a ffmpeg)' : ''}`);

  const conPistas: FicheroConPistas[] = [];
  let totalPistas = 0;
  let saltadosDuplicado = 0;

  for (const [i, f] of ficheros.entries()) {
    if (!sigue) break;
    const r = await pistasDe(f);
    saltadosDuplicado += r.saltadosDuplicado;
    if (r.pistas.length > 0) {
      conPistas.push({ fileId: f.fileId, path: f.path, pistas: r.pistas });
      totalPistas += r.pistas.length;
    }
    if ((i + 1) % 200 === 0) console.log(`  probados ${i + 1}/${ficheros.length} · pistas candidatas hasta ahora: ${totalPistas}`);
  }
  console.log(
    `\nFicheros a tocar: ${conPistas.length}. Pistas a extraer: ${totalPistas}.` +
      ` Duplicados del mismo idioma en el mismo fichero (se saltan): ${saltadosDuplicado}.`,
  );

  if (probar) {
    console.log('Modo prueba: no se ha escrito ni extraído nada.');
    return;
  }
  if (conPistas.length === 0) return;

  console.log(`\nExtrayendo con concurrencia ${CONCURRENCIA} (ficheros, no pistas)...`);
  let ficherosHechos = 0;
  let pistasHechas = 0;
  let pistasFallidas = 0;
  let indice = 0;

  async function trabajador() {
    while (indice < conPistas.length && sigue) {
      const fc = conPistas[indice++];
      const siguio = await esperarSiHayAlguienViendo(() => sigue);
      if (!siguio) break;
      const r = await extraerFichero(fc);
      ficherosHechos++;
      pistasHechas += r.hechas;
      pistasFallidas += r.fallidas;
      if (ficherosHechos % 25 === 0 || ficherosHechos === conPistas.length) {
        console.log(`  ${ficherosHechos}/${conPistas.length} ficheros · pistas: ${pistasHechas} hechas, ${pistasFallidas} fallidas`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajador));

  console.log(`\nFicheros procesados: ${ficherosHechos}/${conPistas.length}. Pistas extraídas: ${pistasHechas}. Fallidas: ${pistasFallidas}.`);
  console.log('Se registrarán como externos en el próximo escaneo (02:00, o "Actualizar biblioteca ahora").');
}

main().catch((err) => { console.error('fallo general:', err); process.exit(1); });
