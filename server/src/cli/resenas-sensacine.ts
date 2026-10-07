/**
 * Reseñas de espectadores de SensaCine, en castellano, para las películas.
 *
 *   node src/cli/resenas-sensacine.ts              todas las que falten
 *   node src/cli/resenas-sensacine.ts --limite 5   solo cinco, para probar
 *
 * Solo para uso doméstico. El buscador de SensaCine no se usa (su robots.txt
 * lo prohíbe): el enlace sale del id de AlloCiné que guarda Wikidata (P1265),
 * que es el mismo número que usa SensaCine. Comprobado el 07/10: lo tienen
 * 1.575 de las 1.713 películas con id de IMDb (92 %).
 *
 * Una página por película, una cada 3 s, y de sus 10 primeras críticas se
 * guardan las 4 con más votos de «útil». Nada se borra ni se sobrescribe; lo
 * ya mirado se apunta en `resenas_revisadas` y no se vuelve a pedir, así que
 * se puede parar y relanzar sin repetir trabajo. Si SensaCine responde 403 o
 * 429, se para en seco.
 */
import { db } from '../db.ts';
import '../media/reviews.ts';

const FUENTE = 'sensacine';
const POR_PELICULA = 4;
const PAUSA_MS = 3000;
const AGENTE = 'MediaWatch/1.0 (servidor domestico, uso personal)';
const MINIMO_CARACTERES = 80;
/** Lo que identifica un texto copiado: sus primeras 60 letras, sin espacios ni signos. */
const huellaDe = (t: string) => t.toLowerCase().replace(/[^a-záéíóúüñ0-9]/g, '').slice(0, 60);

const args = process.argv.slice(2);
const limite = args.includes('--limite') ? Number(args[args.indexOf('--limite') + 1]) : Infinity;

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const pendientes = (db
  .prepare(`SELECT DISTINCT i.imdb_id, i.title FROM items i
            WHERE i.kind = 'movie' AND i.imdb_id LIKE 'tt%'
              AND NOT EXISTS (SELECT 1 FROM resenas_revisadas r WHERE r.imdb_id = i.imdb_id AND r.fuente = ?)
            ORDER BY i.title`)
  .all(FUENTE) as { imdb_id: string; title: string }[]);

console.log(`${pendientes.length} películas sin mirar en SensaCine.`);

/* ---------------------------------------------------- enlace por Wikidata */

async function idsSensacine(imdb: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < imdb.length; i += 300) {
    const valores = imdb.slice(i, i + 300).map((t) => `"${t}"`).join(' ');
    const q = `SELECT ?imdb ?allo WHERE { VALUES ?imdb { ${valores} } ?item wdt:P345 ?imdb; wdt:P1265 ?allo }`;
    const r = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(q), {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': AGENTE },
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`Wikidata respondió ${r.status}`);
    const j = (await r.json()) as { results: { bindings: { imdb: { value: string }; allo: { value: string } }[] } };
    for (const b of j.results.bindings) if (/^\d+$/.test(b.allo.value)) mapa.set(b.imdb.value, b.allo.value);
    await espera(1000);
  }
  return mapa;
}

/* ------------------------------------------------------------- la página */

function texto(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Critica = { id: string; autor: string; contenido: string; valor: number | null; fecha: string | null; utiles: number };

function criticas(html: string): Critica[] {
  const trozos = html.split('class="hred review-card cf"').slice(1);
  const lista: Critica[] = [];
  for (const t of trozos) {
    const id = /id="review_(\d+)"/.exec(t)?.[1];
    const autor = /<div class="meta-title">\s*<[^>]+>([^<]+)</.exec(t)?.[1];
    const cuerpo = /class="content-txt review-card-content">([\s\S]*?)<\/div>/.exec(t)?.[1];
    if (!id || !autor || !cuerpo) continue;
    const nota = /class="stareval-note">([\d,]+)</.exec(t)?.[1];
    const fecha = /review-card-meta-date light">\s*([^<]+?)\s*</.exec(t)?.[1] ?? null;
    const utiles = Number(/helpfulCount&quot;:(\d+)/.exec(t)?.[1] ?? 0);
    const contenido = texto(cuerpo);
    if (!contenido) continue;
    lista.push({
      id,
      autor: texto(autor),
      contenido,
      // De 0,5 a 5 en SensaCine; ×2 para la misma escala que las de TMDb.
      valor: nota ? Number(nota.replace(',', '.')) * 2 : null,
      fecha: fecha ? texto(fecha).replace(/^Publicada el\s+/i, '') : null,
      utiles,
    });
  }
  return lista;
}

/* --------------------------------------------------------------- el lote */

const insertar = db.prepare(`INSERT OR IGNORE INTO resenas_externas (imdb_id, fuente, autor, contenido, valor, url, fecha, guardada)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const marcar = db.prepare('INSERT OR IGNORE INTO resenas_revisadas (imdb_id, fuente, revisada, encontradas) VALUES (?, ?, ?, ?)');

const lote = pendientes.slice(0, limite);
const ids = await idsSensacine(lote.map((p) => p.imdb_id));
console.log(`${ids.size} de ${lote.length} con enlace a SensaCine en Wikidata.\n`);

let conResenas = 0;
let sinResenas = 0;
let sinEnlace = 0;
let fallos = 0;
let guardadas = 0;

for (let i = 0; i < lote.length; i++) {
  const p = lote[i];
  const ahora = new Date().toISOString();
  const allo = ids.get(p.imdb_id);
  const prefijo = `[${i + 1}/${lote.length}] ${p.title}`;
  if (!allo) {
    // Sin enlace no se apunta como mirada: Wikidata puede ganarlo más adelante.
    sinEnlace++;
    continue;
  }

  const url = `https://www.sensacine.com/peliculas/pelicula-${allo}/criticas-espectadores/`;
  let html: string;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(30_000) });
    if (r.status === 403 || r.status === 429) {
      console.log(`${prefijo}: SensaCine respondió ${r.status}. Se para aquí; relanzar más tarde sigue donde se quedó.`);
      break;
    }
    if (r.status === 404) {
      marcar.run(p.imdb_id, FUENTE, ahora, 0);
      sinResenas++;
      console.log(`${prefijo}: no existe en SensaCine`);
      await espera(PAUSA_MS);
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
  } catch (e) {
    fallos++;
    console.log(`${prefijo}: fallo (${(e as Error).message}), se reintentará en otra pasada`);
    await espera(PAUSA_MS);
    continue;
  }

  // Fuera las de una línea («Obra maestra») y las copiadas: en la prueba de
  // «101 dálmatas» había dos casi idénticas firmadas por autores distintos.
  const vistas = new Set<string>();
  const elegidas = criticas(html)
    .slice(0, 10)
    .filter((c) => {
      const huella = huellaDe(c.contenido);
      if (c.contenido.length < MINIMO_CARACTERES || vistas.has(huella)) return false;
      vistas.add(huella);
      return true;
    })
    .sort((a, b) => b.utiles - a.utiles)
    .slice(0, POR_PELICULA);
  for (const c of elegidas) {
    insertar.run(p.imdb_id, FUENTE, c.autor, c.contenido, c.valor, `${url}#review_${c.id}`, c.fecha, ahora);
  }
  marcar.run(p.imdb_id, FUENTE, ahora, elegidas.length);
  guardadas += elegidas.length;
  if (elegidas.length) conResenas++;
  else sinResenas++;
  console.log(`${prefijo}: ${elegidas.length} reseñas`);
  await espera(PAUSA_MS);
}

console.log(`\nHecho: ${conResenas} películas con reseñas (${guardadas} guardadas), ${sinResenas} sin ninguna, ` +
  `${sinEnlace} sin enlace en Wikidata, ${fallos} fallos.`);
