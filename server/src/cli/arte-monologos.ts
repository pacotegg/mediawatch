/**
 * Cartel y fondo para los monólogos que no tienen arte (los 106 de la biblioteca de Monólogos, 19/10/2026).
 *
 * Son cortes de televisión («Leo Harlem; Cocina moderna - El Club de la Comedia»): no hay cartel de cada uno en ninguna
 * base de datos. Por título:
 *   - Cartel: la foto del humorista en TMDb (las de persona ya son 2:3). Se saca el nombre de lo que va antes del primer
 *     «;», « - » o comilla (quitando «El Club de la Comedia» delante); sin separador, las dos o tres primeras palabras.
 *     Solo si TMDb tiene a alguien con ese nombre EXACTO (sin contar acentos) y con foto: si no, la cara de otro.
 *   - Si no: un fotograma del vídeo recortado a 2:3 por el centro, donde suele estar el humorista.
 *   - Fondo: un fotograma del vídeo a 16:9. Se prueban el 30, el 45 y el 60 % y se queda el más luminoso (evita negros).
 * Solo lee E:. Escribe en data/artwork/<id>/ y marca poster y fanart como fijados (el escáner no los pisa).
 * Se aparta si alguien está viendo algo. Reanudable: salta los que ya tienen cartel.
 *
 * Uso (desde server/): node src/cli/arte-monologos.ts [--limite N]
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { hayAlguienViendo } from '../media/ocupado.ts';

const ejecutar = promisify(execFile);
const iLim = process.argv.indexOf('--limite');
const limite = iLim >= 0 ? Number(process.argv[iLim + 1]) : Infinity;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Nombres candidatos del humorista a partir del título. */
export function candidatosNombre(titulo: string): string[] {
  const t = titulo.replace(/^el club de la comedia\s*[-;:]\s*/i, '').trim();
  const corte = t.search(/;|\s-\s|-\s|'|"|\(|«/);
  if (corte > 0) return [t.slice(0, corte).trim()];
  const p = t.split(/\s+/);
  return [p.slice(0, 2).join(' '), p.slice(0, 3).join(' ')].filter((x, i, a) => x && a.indexOf(x) === i);
}

async function fotoTmdb(nombre: string): Promise<Buffer | null> {
  const clave = config.tmdbApiKey;
  if (!clave) return null;
  const r = await fetch(`https://api.themoviedb.org/3/search/person?query=${encodeURIComponent(nombre)}&api_key=${clave}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: { name: string; profile_path: string | null }[] };
  const p = (j.results || []).find((x) => x.profile_path && normal(x.name) === normal(nombre));
  if (!p) return null;
  const img = await fetch('https://image.tmdb.org/t/p/w780' + p.profile_path, { signal: AbortSignal.timeout(20_000) });
  return img.ok ? Buffer.from(await img.arrayBuffer()) : null;
}

/**
 * Segunda fuente: la foto de la persona en Wikidata (P18, «image») servida por Commons a 800 px. Etiqueta en español o
 * inglés EXACTA (sin acentos) y que sea un humano (P31 = Q5): «Leo Harlem» no puede traer un pueblo ni una película.
 */
async function fotoWikidata(nombre: string): Promise<Buffer | null> {
  const ua = { 'User-Agent': 'MediaWatch/1.0 (servidor domestico; carteles de monologos)' };
  const s = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(nombre)}&language=es&type=item&limit=5&format=json`,
    { headers: ua, signal: AbortSignal.timeout(15_000) });
  await espera(1200);
  if (!s.ok) return null;
  const j = (await s.json()) as { search?: { id: string; label?: string }[] };
  for (const r of j.search || []) {
    if (!r.label || normal(r.label) !== normal(nombre)) continue;
    const e = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${r.id}.json`, { headers: ua, signal: AbortSignal.timeout(15_000) });
    await espera(1200);
    if (!e.ok) continue;
    const ent = (await e.json()) as { entities: Record<string, { claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]> }> };
    const c = ent.entities[r.id]?.claims ?? {};
    const esHumano = (c.P31 ?? []).some((x) => (x.mainsnak.datavalue?.value as { id?: string } | undefined)?.id === 'Q5');
    const archivo = c.P18?.[0]?.mainsnak.datavalue?.value as string | undefined;
    if (!esHumano || !archivo) continue;
    const img = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(archivo)}?width=800`, { headers: ua, signal: AbortSignal.timeout(20_000) });
    await espera(1200);
    return img.ok ? Buffer.from(await img.arrayBuffer()) : null;
  }
  return null;
}

/** Luminosidad media de un fotograma (0-255), para no quedarse con uno en negro. */
async function luma(f: string): Promise<number> {
  try {
    const { stderr } = await ejecutar(config.ffmpeg, ['-v', 'info', '-i', f, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], { timeout: 30_000, windowsHide: true });
    const m = /YAVG=([\d.]+)/.exec(String(stderr));
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

async function fotograma(video: string, t: number, salida: string, filtro: string): Promise<boolean> {
  try {
    await ejecutar(config.ffmpeg, ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', filtro, '-c:v', 'libwebp', '-q:v', '85', salida],
      { timeout: 60_000, windowsHide: true });
    return existsSync(salida);
  } catch { return false; }
}

const filas = db.prepare(`SELECT i.id, i.title, i.fanart, i.arte_fijado, (SELECT path FROM media_files m WHERE m.item_id = i.id LIMIT 1) ruta,
    (SELECT duration FROM media_files m WHERE m.item_id = i.id LIMIT 1) dur
  FROM items i JOIN libraries l ON l.id = i.library_id WHERE l.name = 'Monólogos' AND i.poster IS NULL ORDER BY i.id`).all() as
  { id: number; title: string; fanart: string | null; arte_fijado: string | null; ruta: string | null; dur: number | null }[];
console.log(`${filas.length} monólogos sin cartel`);

let n = 0, conFoto = 0, conFotograma = 0, fallos = 0;
for (const f of filas) {
  if (n++ >= limite) break;
  while (hayAlguienViendo()) { console.log('  alguien está viendo algo: espero 1 min'); await espera(60_000); }
  if (!f.ruta || !existsSync(f.ruta) || !f.dur) { fallos++; console.log(`[${n}] ${f.title}: sin fichero`); continue; }
  const dir = join(DATA_DIR, 'artwork', String(f.id));
  mkdirSync(dir, { recursive: true });

  // El fotograma más luminoso de tres.
  let mejor = -1, mejorT = f.dur * 0.3;
  for (const pct of [0.3, 0.45, 0.6]) {
    const prueba = join(dir, 'prueba.webp');
    if (await fotograma(f.ruta, f.dur * pct, prueba, 'scale=320:-2')) {
      const l = await luma(prueba);
      if (l > mejor) { mejor = l; mejorT = f.dur * pct; }
    }
  }
  const fondo = join(dir, 'fanart-fotograma.webp');
  const hayFondo = await fotograma(f.ruta, mejorT, fondo, 'scale=1280:-2');

  let cartel = join(dir, 'poster-humorista.webp');
  let fuente = '';
  for (const nombre of candidatosNombre(f.title)) {
    try {
      const foto = await fotoTmdb(nombre);
      if (foto) {
        const tmp = join(dir, 'humorista.jpg');
        writeFileSync(tmp, foto);
        await ejecutar(config.ffmpeg, ['-v', 'error', '-y', '-i', tmp, '-vf', 'scale=600:-2', '-c:v', 'libwebp', '-q:v', '88', cartel], { timeout: 30_000, windowsHide: true });
        if (existsSync(cartel)) { fuente = 'TMDb: ' + nombre; break; }
      }
    } catch { /* sin red o sin resultado: se prueba lo siguiente */ }
    await espera(300);
  }
  // Wikidata/Commons: foto de cualquier proporción; se recorta a 2:3 por arriba-centro (la cara suele estar arriba).
  for (const nombre of fuente ? [] : candidatosNombre(f.title)) {
    try {
      const foto = await fotoWikidata(nombre);
      if (foto) {
        const tmp = join(dir, 'humorista-commons.jpg');
        writeFileSync(tmp, foto);
        await ejecutar(config.ffmpeg, ['-v', 'error', '-y', '-i', tmp, '-vf', "crop='min(iw,ih*2/3)':'min(ih,iw*3/2)':(iw-ow)/2:0,scale=600:-2",
          '-c:v', 'libwebp', '-q:v', '88', cartel], { timeout: 30_000, windowsHide: true });
        if (existsSync(cartel)) { fuente = 'Wikidata: ' + nombre; break; }
      }
    } catch { /* se prueba lo siguiente */ }
  }
  if (!fuente) {
    cartel = join(dir, 'poster-fotograma.webp');
    // 2:3 por el centro del fotograma, a 600 px de ancho.
    if (await fotograma(f.ruta, mejorT, cartel, 'crop=ih*2/3:ih,scale=600:-2')) fuente = 'fotograma';
  }
  if (!fuente) { fallos++; console.log(`[${n}] ${f.title}: sin cartel`); continue; }

  const fijados = new Set((f.arte_fijado ?? '').split(',').filter(Boolean));
  fijados.add('poster');
  const ponerFondo = hayFondo && !f.fanart;
  if (ponerFondo) fijados.add('fanart');
  db.prepare(`UPDATE items SET poster = ?, fanart = CASE WHEN ? THEN ? ELSE fanart END, arte_fijado = ?, arte_actualizado = ? WHERE id = ?`)
    .run(cartel, ponerFondo ? 1 : 0, fondo, [...fijados].join(','), new Date().toISOString(), f.id);
  if (fuente === 'fotograma') conFotograma++; else conFoto++;
  console.log(`[${n}] ${f.title.slice(0, 60)}: cartel ${fuente}${ponerFondo ? ' + fondo' : ''}`);
}
console.log(`Fin: ${conFoto} con foto del humorista, ${conFotograma} con fotograma, ${fallos} sin arte.`);
