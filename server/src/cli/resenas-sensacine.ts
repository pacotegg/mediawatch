/**
 * Reseñas de SensaCine, en castellano, para las películas: de espectadores
 * (texto completo) y de prensa (extracto, con el medio y el crítico).
 *
 *   node src/cli/resenas-sensacine.ts              todas las que falten
 *   node src/cli/resenas-sensacine.ts --limite 5   solo cinco, para probar
 *
 * Solo para uso doméstico. El buscador de SensaCine no se usa (su robots.txt
 * lo prohíbe): el enlace sale del id de AlloCiné que guarda Wikidata (P1265),
 * que es el mismo número que usa SensaCine. Comprobado el 07/10: lo tienen
 * 1.575 de las 1.713 películas con id de IMDb (92 %).
 *
 * Una página por película y fuente, una cada 3 s. De espectadores se guardan
 * las 4 con más votos de «útil» (sin las de menos de 80 caracteres ni las
 * copiadas); de prensa, las 4 primeras. Nada se borra ni se sobrescribe; lo
 * ya mirado se apunta en `resenas_revisadas` por fuente y no se vuelve a
 * pedir, así que se puede parar y relanzar sin repetir trabajo. Si SensaCine
 * responde 403 o 429, se para en seco.
 */
import { db } from '../db.ts';
import '../media/reviews.ts';

const POR_PELICULA = 4;
const PAUSA_MS = 3000;
const AGENTE = 'MediaWatch/1.0 (servidor domestico, uso personal)';
const MINIMO_CARACTERES = 80;
/** Lo que identifica un texto copiado: sus primeras 60 letras, sin espacios ni signos. */
const huellaDe = (t: string) => t.toLowerCase().replace(/[^a-záéíóúüñ0-9]/g, '').slice(0, 60);

const args = process.argv.slice(2);
const limite = args.includes('--limite') ? Number(args[args.indexOf('--limite') + 1]) : Infinity;

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

type Elegida = { autor: string; contenido: string; valor: number | null; fecha: string | null; pie: string | null; ancla: string };
type Fuente = { clave: string; ruta: string; elegir: (html: string) => Elegida[] };

/* ------------------------------------------------------------- utilidades */

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

/** «MANUEL YÁÑEZ» → «Manuel Yáñez»; lo que ya viene en mayúsculas y minúsculas, igual. */
function nombrePropio(t: string): string {
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

/* ------------------------------------------------------------ espectadores */

function espectadores(html: string): Elegida[] {
  const lista: (Elegida & { utiles: number })[] = [];
  for (const t of html.split('class="hred review-card cf"').slice(1, 11)) {
    const id = /id="review_(\d+)"/.exec(t)?.[1];
    const autor = /<div class="meta-title">\s*<[^>]+>([^<]+)</.exec(t)?.[1];
    const cuerpo = /class="content-txt review-card-content">([\s\S]*?)<\/div>/.exec(t)?.[1];
    if (!id || !autor || !cuerpo) continue;
    const nota = /class="stareval-note">([\d,]+)</.exec(t)?.[1];
    const fecha = /review-card-meta-date light">\s*([^<]+?)\s*</.exec(t)?.[1] ?? null;
    lista.push({
      autor: texto(autor),
      contenido: texto(cuerpo),
      // De 0,5 a 5 en SensaCine; ×2 para la misma escala que las de TMDb.
      valor: nota ? Number(nota.replace(',', '.')) * 2 : null,
      fecha: fecha ? texto(fecha).replace(/^Publicada el\s+/i, '') : null,
      pie: null,
      ancla: `review_${id}`,
      utiles: Number(/helpfulCount&quot;:(\d+)/.exec(t)?.[1] ?? 0),
    });
  }
  // Fuera las de una línea («Obra maestra») y las copiadas: en la prueba de
  // «101 dálmatas» había dos casi idénticas firmadas por autores distintos.
  const vistas = new Set<string>();
  return lista
    .filter((c) => {
      const huella = huellaDe(c.contenido);
      if (c.contenido.length < MINIMO_CARACTERES || vistas.has(huella)) return false;
      vistas.add(huella);
      return true;
    })
    .sort((a, b) => b.utiles - a.utiles)
    .slice(0, POR_PELICULA);
}

/* ------------------------------------------------------------------ prensa */

/*
 * SensaCine solo publica un extracto de cada crítica de prensa y remite al
 * medio para leerla entera: se guarda el extracto, con el medio como autor y
 * el crítico y el medio en el pie. Las webs de cada medio no se tocan.
 */
function prensa(html: string): Elegida[] {
  const lista: Elegida[] = [];
  for (const t of html.split('class="item hred" id="pressreview').slice(1, POR_PELICULA + 1)) {
    const id = /^(\d+)"/.exec(t)?.[1];
    const medio = /<h2 class="title">([\s\S]*?)<\/h2>/.exec(t)?.[1];
    const cuerpo = /<p class="text">([\s\S]*?)<\/p>/.exec(t)?.[1];
    if (!id || !medio || !cuerpo) continue;
    const estrellas = /rating-mdl n(\d+)/.exec(t)?.[1];
    const critico = /<span class="author">\s*por\s+([^<]+?)\s*</.exec(t)?.[1];
    const nombreMedio = texto(medio); // tal cual: «ABC» no es «Abc»
    const contenido = texto(cuerpo).replace(/^"\s*|\s*"$/g, '');
    if (!contenido) continue;
    lista.push({
      autor: nombreMedio,
      contenido,
      // n45 = 4,5 estrellas de 5; ×2 como las demás. n00 es «sin nota».
      valor: estrellas && Number(estrellas) > 0 ? Number(estrellas) / 5 : null,
      fecha: null,
      pie: (critico ? nombrePropio(texto(critico)) + ' · ' : '') + 'Crítica completa en ' + nombreMedio,
      ancla: `pressreview${id}`,
    });
  }
  return lista;
}

const FUENTES: Fuente[] = [
  { clave: 'sensacine', ruta: 'criticas-espectadores', elegir: espectadores },
  { clave: 'sensacine-prensa', ruta: 'criticas-prensa', elegir: prensa },
];

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

/* --------------------------------------------------------------- el lote */

// Una fila por id de IMDb: las películas en varias ediciones se pedían una vez
// por edición (unas 80 peticiones de más en la primera pasada).
const peliculas = db
  .prepare(`SELECT imdb_id, MIN(title) AS title FROM items
            WHERE kind = 'movie' AND imdb_id LIKE 'tt%' GROUP BY imdb_id ORDER BY title`)
  .all() as { imdb_id: string; title: string }[];
const revisada = db.prepare('SELECT 1 FROM resenas_revisadas WHERE imdb_id = ? AND fuente = ?');
const pendientes = peliculas
  .map((p) => ({ ...p, fuentes: FUENTES.filter((f) => !revisada.get(p.imdb_id, f.clave)) }))
  .filter((p) => p.fuentes.length > 0);

console.log(`${pendientes.length} películas con alguna fuente sin mirar en SensaCine.`);

const insertar = db.prepare(`INSERT OR IGNORE INTO resenas_externas (imdb_id, fuente, autor, contenido, valor, url, fecha, pie, guardada)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const marcar = db.prepare('INSERT OR IGNORE INTO resenas_revisadas (imdb_id, fuente, revisada, encontradas) VALUES (?, ?, ?, ?)');

const lote = pendientes.slice(0, limite);
const ids = await idsSensacine(lote.map((p) => p.imdb_id));
console.log(`${ids.size} de ${lote.length} con enlace a SensaCine en Wikidata.\n`);

const cuenta: Record<string, { con: number; sin: number; guardadas: number }> = {};
for (const f of FUENTES) cuenta[f.clave] = { con: 0, sin: 0, guardadas: 0 };
let sinEnlace = 0;
let fallos = 0;
let parar = false;

for (let i = 0; i < lote.length && !parar; i++) {
  const p = lote[i];
  const allo = ids.get(p.imdb_id);
  if (!allo) {
    // Sin enlace no se apunta como mirada: Wikidata puede ganarlo más adelante.
    sinEnlace++;
    continue;
  }
  const partes: string[] = [];
  for (const f of p.fuentes) {
    const url = `https://www.sensacine.com/peliculas/pelicula-${allo}/${f.ruta}/`;
    const ahora = new Date().toISOString();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(30_000) });
      if (r.status === 403 || r.status === 429) {
        console.log(`[${i + 1}/${lote.length}] ${p.title}: SensaCine respondió ${r.status}. Se para aquí; relanzar sigue donde se quedó.`);
        parar = true;
        break;
      }
      let elegidas: Elegida[] = [];
      if (r.status !== 404) {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        elegidas = f.elegir(await r.text());
      }
      for (const c of elegidas) {
        insertar.run(p.imdb_id, f.clave, c.autor, c.contenido, c.valor, `${url}#${c.ancla}`, c.fecha, c.pie, ahora);
      }
      marcar.run(p.imdb_id, f.clave, ahora, elegidas.length);
      cuenta[f.clave].guardadas += elegidas.length;
      if (elegidas.length) cuenta[f.clave].con++;
      else cuenta[f.clave].sin++;
      partes.push(`${f.clave === 'sensacine' ? 'espectadores' : 'prensa'} ${elegidas.length}`);
    } catch (e) {
      fallos++;
      partes.push(`${f.clave}: fallo (${(e as Error).message})`);
    }
    await espera(PAUSA_MS);
  }
  if (partes.length) console.log(`[${i + 1}/${lote.length}] ${p.title}: ${partes.join(', ')}`);
}

console.log(
  '\nHecho: ' +
    FUENTES.map((f) => `${f.clave}: ${cuenta[f.clave].con} con reseñas (${cuenta[f.clave].guardadas} guardadas), ${cuenta[f.clave].sin} sin ninguna`).join(' | ') +
    ` | ${sinEnlace} sin enlace en Wikidata, ${fallos} fallos.`,
);
