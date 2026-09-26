/**
 * Encoge los discos redondos de `data/artwork/` a los 600 px que de verdad se
 * consumen.
 *
 * Medido el 24/09 sobre la biblioteca real: 1.439 `disc.png` ocupando 1.341 MB
 * —el 79% de toda la carpeta de arte—, guardados a 1000x1000 cuando tanto la
 * tele (`tv/src/main.ts`, `imagen.disco(id, 600)`) como la web
 * (`web/src/lib/api.ts`, `discart: (id, w = 600)`) los piden siempre a 600 y
 * nunca más grandes. Un disco de ejemplo pasa de 1.463.790 a 704.075 bytes:
 * un 52% menos sin tocar lo que se ve, porque 600 px es justo lo que ya se
 * pintaba.
 *
 * Se descartó cuantizar a paleta (que daba un 86%): ffmpeg conserva el alfa
 * pero deja los píxeles transparentes en verde puro, y al reescalar ese verde
 * sangra en el borde antialiado del disco. Comprobado leyendo los píxeles, no
 * supuesto.
 *
 * Es idempotente: lo que ya esté a 600 o menos se salta. Y nunca sustituye un
 * fichero por otro más grande ni por uno que no tenga alfa.
 *
 *   node src/cli/encoger-discos.ts --probar   (no escribe nada, solo cuenta)
 *   node src/cli/encoger-discos.ts
 */
import { execFile } from 'node:child_process';
import { readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR, config } from '../config.ts';

const run = promisify(execFile);
const ARTWORK = join(DATA_DIR, 'artwork');
const ANCHO = 600;
const probar = process.argv.includes('--probar');

async function medir(ruta: string): Promise<{ ancho: number; alto: number; pix: string } | null> {
  try {
    const { stdout } = await run(
      config.ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', ruta],
      { windowsHide: true },
    );
    const [ancho, alto, pix] = stdout.trim().split(',');
    return { ancho: Number(ancho), alto: Number(alto), pix: pix ?? '' };
  } catch {
    return null;
  }
}

function discos(): string[] {
  const encontrados: string[] = [];
  let carpetas: string[];
  try {
    carpetas = readdirSync(ARTWORK);
  } catch {
    return encontrados;
  }
  for (const carpeta of carpetas) {
    const ruta = join(ARTWORK, carpeta, 'disc.png');
    try {
      if (statSync(ruta).isFile()) encontrados.push(ruta);
    } catch {
      /* esa carpeta no tiene disco */
    }
  }
  return encontrados;
}

const lista = discos();
console.log(`${lista.length} discos en ${ARTWORK}${probar ? '  (modo prueba: no se escribe nada)' : ''}`);

let tocados = 0;
let saltados = 0;
let fallos = 0;
let antesTotal = 0;
let despuesTotal = 0;

for (const [i, ruta] of lista.entries()) {
  const original = await medir(ruta);
  if (!original) {
    console.error(`  [fallo] no se pudo leer ${ruta}`);
    fallos++;
    continue;
  }
  if (original.ancho <= ANCHO) {
    saltados++;
    continue;
  }

  const bytesAntes = statSync(ruta).size;
  // La extensión tiene que seguir siendo `.png`: ffmpeg elige el muxer por
  // ella, y con un `disc.png.nuevo` falla con «Invalid argument» en los 1.439.
  // Como se buscan ficheros llamados exactamente `disc.png`, un temporal
  // llamado `disc.nuevo.png` no se cuela en la lista.
  const temporal = ruta.replace(/disc\.png$/i, 'disc.nuevo.png');

  try {
    await run(
      config.ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', ruta, '-vf', `scale=${ANCHO}:-1:flags=lanczos`, temporal],
      { windowsHide: true },
    );
  } catch (err) {
    console.error(`  [fallo] ffmpeg con ${ruta}: ${(err as Error).message}`);
    fallos++;
    try { unlinkSync(temporal); } catch { /* puede no existir */ }
    continue;
  }

  /*
   * Tres comprobaciones antes de pisar nada, porque el original no se
   * recupera salvo volviendo a scrapear: que el nuevo se pueda leer, que
   * siga teniendo alfa (sin transparencia el disco sale como un cuadrado
   * sobre el vídeo) y que de verdad sea más pequeño.
   */
  const nuevo = await medir(temporal);
  const bytesDespues = (() => { try { return statSync(temporal).size; } catch { return 0; } })();
  /*
   * «No perder el alfa» se compara contra el original, no contra una lista de
   * formatos. La primera versión hacía `pix.includes('a')`, que además de
   * `rgba` acepta `pal8` —la «a» de «pal»—, justo el formato sin
   * transparencia que había que vigilar. No hizo daño porque ffmpeg conserva
   * el alfa al escalar (comprobado: entrada rgba -> salida rgba), pero la
   * comprobación no comprobaba lo que decía.
   */
  const teniaAlfa = original.pix.includes('rgba') || original.pix.includes('ya');
  const mantieneAlfa = !teniaAlfa || (nuevo !== null && (nuevo.pix.includes('rgba') || nuevo.pix.includes('ya')));
  const valido = nuevo !== null && nuevo.ancho === ANCHO && mantieneAlfa && bytesDespues > 0 && bytesDespues < bytesAntes;

  if (!valido) {
    console.error(`  [fallo] descartado ${ruta}: ${nuevo ? `${nuevo.ancho}px ${nuevo.pix} ${bytesDespues}B` : 'ilegible'}`);
    fallos++;
    try { unlinkSync(temporal); } catch { /* puede no existir */ }
    continue;
  }

  antesTotal += bytesAntes;
  despuesTotal += bytesDespues;
  tocados++;

  if (probar) {
    try { unlinkSync(temporal); } catch { /* puede no existir */ }
  } else {
    renameSync(temporal, ruta);
  }

  if (tocados % 50 === 0 || i === lista.length - 1) {
    console.log(`  ${i + 1}/${lista.length} · ${tocados} encogidos · ${(antesTotal / 1e6).toFixed(0)} MB -> ${(despuesTotal / 1e6).toFixed(0)} MB`);
  }
}

console.log(
  `\n${probar ? 'Se habrían encogido' : 'Encogidos'} ${tocados}, saltados ${saltados} (ya estaban a ${ANCHO} o menos), fallos ${fallos}.`,
);
if (tocados) {
  console.log(
    `${(antesTotal / 1e6).toFixed(0)} MB -> ${(despuesTotal / 1e6).toFixed(0)} MB` +
      `  (${(100 - (despuesTotal / antesTotal) * 100).toFixed(0)}% menos, ${((antesTotal - despuesTotal) / 1e6).toFixed(0)} MB libres)`,
  );
}
