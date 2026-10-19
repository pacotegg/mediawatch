/**
 * Barrido de logos de estudio con la mejor calidad que se encuentre, en WebP.
 *
 * Los de `data/artwork/studios` salieron de TMDb a 500 px de ancho (`/t/p/w500`). Medido el 19/10/2026 con siete estudios:
 * el tamaño `original` de TMDb da 2.000 px en seis de ellos, y Wikidata (P154, «logo image») → Commons da el SVG, que se
 * renderiza al tamaño que haga falta. Orden por estudio:
 *   1. TMDb `original`, solo si el nombre de la empresa casa EXACTO (normalizado) y mide >= 1.000 px de ancho: con «el
 *      primero que tenga logo» se colaría el de otra empresa de nombre parecido.
 *   2. Wikidata → Commons, renderizado a 2.000 px, si la etiqueta casa exacta. Despacio (1,2 s entre peticiones): Wikidata
 *      contesta 429 si se le pide rápido.
 *   3. Si nada mejora lo que hay (más ancho), se queda el actual.
 * Descartados: el paquete de Kodi (161 x 109 px, peor que lo actual), Google (sin API libre; raspar sus resultados va
 * contra sus condiciones) e IMDb (sin API pública de logos de productoras).
 *
 * Sin `--aplicar` solo deja los nuevos en `data/artwork/studios-nuevos/` con un informe (`informe.jsonl`), reanudable.
 * Con `--aplicar` los pone en su sitio y aparta los viejos (y su versión clara) a `data/artwork/studios-previo/`: no se
 * borra nada.
 *
 * Uso (desde server/): node src/cli/mejorar-logos-estudio.ts [--limite N] | --aplicar
 */
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';

const ejecutar = promisify(execFile);
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const iLim = args.indexOf('--limite');
const limite = iLim >= 0 ? Number(args[iLim + 1]) : Infinity;

const DIR = join(DATA_DIR, 'artwork', 'studios');
const NUEVOS = join(DATA_DIR, 'artwork', 'studios-nuevos');
const PREVIO = join(DATA_DIR, 'artwork', 'studios-previo');
const CLARO = join(DATA_DIR, 'artwork', 'studios-claro');
const INFORME = join(NUEVOS, 'informe.jsonl');
const UA = { 'User-Agent': 'MediaWatch/1.0 (servidor domestico; logos de estudio)' };

const slugDe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Los alias de library.ts guardan logo con un nombre corto: con qué empresa buscarlos. */
const NOMBRE_DE_ALIAS: Record<string, string> = {
  warner: 'Warner Bros. Pictures', universal: 'Universal Pictures', paramount: 'Paramount Pictures', fox: '20th Century Fox',
  columbia: 'Columbia Pictures', tristar: 'TriStar Pictures', disney: 'Walt Disney Pictures', marvel: 'Marvel Studios',
  pixar: 'Pixar', dreamworks: 'DreamWorks Pictures', mgm: 'Metro-Goldwyn-Mayer', lionsgate: 'Lionsgate',
  lucasfilm: 'Lucasfilm Ltd.', hbo: 'HBO', netflix: 'Netflix', newline: 'New Line Cinema', miramax: 'Miramax',
  touchstone: 'Touchstone Pictures', studiocanal: 'StudioCanal', canalplus: 'Canal+', a24: 'A24', orion: 'Orion Pictures',
  focus: 'Focus Features', blumhouse: 'Blumhouse Productions', bbc: 'BBC', eon: 'EON Productions', carolco: 'Carolco Pictures',
  illumination: 'Illumination', nickelodeon: 'Nickelodeon', movistar: 'Movistar Plus+',
};

async function pedir(url: string): Promise<Response> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (r.status !== 429) return r;
    await espera(10_000 * (i + 1));
  }
  throw new Error('429 repetido: ' + url);
}

async function ancho(f: string): Promise<number> {
  try {
    const { stdout } = await ejecutar(config.ffprobe, ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', f], { timeout: 30_000, windowsHide: true });
    return Number(String(stdout).trim().split('\n')[0]) || 0;
  } catch { return 0; }
}

async function desdeTmdb(nombre: string, tmp: string): Promise<string | null> {
  const clave = config.tmdbApiKey;
  if (!clave) return null;
  const r = await pedir(`https://api.themoviedb.org/3/search/company?query=${encodeURIComponent(nombre)}&api_key=${clave}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: { name: string; logo_path: string | null }[] };
  const c = (j.results || []).find((x) => x.logo_path && normal(x.name) === normal(nombre));
  if (!c || !c.logo_path) return null;
  const img = await pedir('https://image.tmdb.org/t/p/original' + c.logo_path);
  if (!img.ok) return null;
  const f = tmp + (c.logo_path.endsWith('.svg') ? '.svg' : '.png');
  writeFileSync(f, Buffer.from(await img.arrayBuffer()));
  return f;
}

async function desdeCommons(nombre: string, tmp: string): Promise<string | null> {
  const s = await pedir(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(nombre)}&language=en&type=item&limit=5&format=json`);
  await espera(1200);
  if (!s.ok) return null;
  const j = (await s.json()) as { search?: { id: string; label?: string }[] };
  for (const r of j.search || []) {
    if (!r.label || normal(r.label) !== normal(nombre)) continue;
    const e = await pedir(`https://www.wikidata.org/wiki/Special:EntityData/${r.id}.json`);
    await espera(1200);
    if (!e.ok) continue;
    const ent = (await e.json()) as { entities: Record<string, { claims?: Record<string, { mainsnak: { datavalue?: { value: string } } }[]> }> };
    const archivo = ent.entities[r.id]?.claims?.P154?.[0]?.mainsnak.datavalue?.value;
    if (!archivo) continue;
    const info = await pedir(`https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(archivo)}&prop=imageinfo&iiprop=url&iiurlwidth=2000&format=json`);
    await espera(1200);
    if (!info.ok) continue;
    const ij = (await info.json()) as { query: { pages: Record<string, { imageinfo?: { url: string; thumburl?: string }[] }> } };
    const ii = Object.values(ij.query.pages)[0]?.imageinfo?.[0];
    if (!ii) continue;
    const img = await pedir(ii.thumburl || ii.url);
    await espera(1200);
    if (!img.ok) continue;
    const f = tmp + '.png';
    writeFileSync(f, Buffer.from(await img.arrayBuffer()));
    return f;
  }
  return null;
}

/** A WebP con transparencia, como mucho 1.600 px de ancho (en la tele se ven a menos de 300). */
async function aWebp(origen: string, destino: string): Promise<boolean> {
  try {
    await ejecutar(config.ffmpeg, ['-v', 'error', '-y', '-i', origen, '-vf', "scale='min(1600,iw)':-2:flags=lanczos,format=yuva420p",
      '-c:v', 'libwebp', '-q:v', '92', destino], { timeout: 60_000, windowsHide: true });
    return existsSync(destino);
  } catch { return false; }
}

function actual(slug: string): string | null {
  for (const ext of ['webp', 'png']) { const f = join(DIR, `${slug}.${ext}`); if (existsSync(f)) return f; }
  return null;
}

async function barrer() {
  mkdirSync(NUEVOS, { recursive: true });
  const hechos = new Set<string>();
  if (existsSync(INFORME)) for (const l of readFileSync(INFORME, 'utf8').split('\n')) { try { hechos.add(JSON.parse(l).slug); } catch { /* línea a medias */ } }

  // Nombre de cada slug: el de los estudios guardados (el primero que aparezca) y los alias.
  const nombres = new Map<string, string>();
  for (const r of db.prepare("SELECT DISTINCT studio FROM items WHERE studio IS NOT NULL AND studio != ''").all() as { studio: string }[]) {
    for (const p of r.studio.split(/[,/]/).map((x) => x.trim()).filter(Boolean)) if (!nombres.has(slugDe(p))) nombres.set(slugDe(p), p);
  }
  for (const [s, n] of Object.entries(NOMBRE_DE_ALIAS)) nombres.set(s, n);
  // Solo los que tienen fichero o marca de «sin logo» en la carpeta: son los que se usan.
  const slugs = [...new Set(readdirSync(DIR).map((f) => f.replace(/\.(webp|png|missing)$/, '')))].filter((s) => nombres.has(s) && !hechos.has(s));
  console.log(`${slugs.length} estudios por revisar (${hechos.size} ya hechos)`);

  let n = 0;
  for (const slug of slugs) {
    if (n++ >= limite) break;
    const nombre = nombres.get(slug)!;
    const viejo = actual(slug);
    const anchoViejo = viejo ? await ancho(viejo) : 0;
    const tmp = join(NUEVOS, `${slug}.descarga`);
    let fuente = '', candidato: string | null = null, anchoNuevo = 0;
    try {
      candidato = await desdeTmdb(nombre, tmp);
      if (candidato) { anchoNuevo = await ancho(candidato); fuente = 'tmdb-original'; }
      if (!candidato || anchoNuevo < 1000) {
        if (candidato) { try { unlinkSync(candidato); } catch { /* ya no está */ } }
        candidato = await desdeCommons(nombre, tmp);
        anchoNuevo = candidato ? await ancho(candidato) : 0;
        fuente = candidato ? 'commons' : '';
      }
    } catch (e) { fuente = 'error: ' + (e as Error).message.slice(0, 80); }

    let resultado = 'se queda el actual';
    if (candidato && anchoNuevo > anchoViejo) {
      const destino = join(NUEVOS, `${slug}.webp`);
      if (await aWebp(candidato, destino)) resultado = 'mejorado';
      else resultado = 'fallo al convertir';
    }
    if (candidato) { try { unlinkSync(candidato); } catch { /* ya no está */ } }
    appendFileSync(INFORME, JSON.stringify({ slug, nombre, fuente, anchoViejo, anchoNuevo, resultado }) + '\n');
    console.log(`[${n}] ${nombre}: ${resultado} (${fuente || 'sin fuente'} ${anchoViejo} -> ${anchoNuevo} px)`);
  }
  console.log('Fin del barrido. Revisar data/artwork/studios-nuevos y luego --aplicar.');
}

function ponerEnSitio() {
  mkdirSync(PREVIO, { recursive: true });
  let puestos = 0;
  for (const f of readdirSync(NUEVOS).filter((x) => x.endsWith('.webp'))) {
    const slug = f.replace(/\.webp$/, '');
    // Lo viejo (logo, marca de «sin logo» y su versión clara) se aparta; no se borra.
    for (const ext of ['webp', 'png', 'missing']) {
      const v = join(DIR, `${slug}.${ext}`);
      if (existsSync(v)) renameSync(v, join(PREVIO, `${slug}.${ext}`));
    }
    for (const ext of ['webp', 'tal-cual']) {
      const c = join(CLARO, `${slug}.${ext}`);
      if (existsSync(c)) renameSync(c, join(PREVIO, `${slug}.claro.${ext}`));
    }
    renameSync(join(NUEVOS, f), join(DIR, f));
    puestos++;
  }
  console.log(`${puestos} logos nuevos en su sitio; los anteriores, en ${PREVIO}`);
}

if (aplicar) ponerEnSitio(); else await barrer();
