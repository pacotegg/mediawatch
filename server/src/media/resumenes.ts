/**
 * «Anteriormente en…»: el resumen del principio de un episodio, para poder saltarlo.
 *
 * No se mira el audio (habría que leer episodios enteros de E:, terabytes en total) sino el índice de diálogos
 * que ya existe: un resumen es una racha de frases, al principio, que ya se dijeron en los episodios anteriores.
 * Medido el 15/10/2026 sobre los 1.106 episodios con diálogos indexados:
 *
 * - Los capítulos con nombre no sirven: 0 de 120 episodios al azar marcan el resumen (todos «Chapter N»).
 * - Un resumen de verdad (Deutschland 83, Evil, Manhattan) casa frases que salen de sitios DISPERSOS de los
 *   anteriores (E1 a 1.319 s, E2 a 159 s, a 2.180 s…).
 * - El falso positivo era un episodio doble con el mismo subtítulo que el anterior: cada frase casa en el MISMO
 *   segundo (0→0, 3→3…). Se descarta si la mayoría casan casi en la misma posición, y el resumen tiene tope.
 *
 * Se guarda en `skip_ranges` con `kind = 'recap'`. Los clientes que no lo conocen no lo reciben (ver la ruta).
 */
import { db } from '../db.ts';

export type Frase = { text: string; ms: number };
export type Resumen = { inicioMs: number; finMs: number; frases: number };

const VENTANA_MS = 6 * 60_000;    // dónde se busca: los primeros minutos (o hasta la cabecera)
const MIN_CHARS = 12;             // «¿Qué?», «Sí», «Vamos» se repiten en cualquier episodio
const MIN_FRASES = 4;
const HUECO_MS = 25_000;          // dos frases repetidas más separadas que esto ya no son la misma racha
const EMPIEZA_ANTES_MS = 90_000;  // un resumen empieza enseguida
const MAX_DURACION_MS = 180_000;  // más largo que esto no es un resumen
const MISMA_POSICION_MS = 10_000;
const MIN_DURACION_MS = 8_000;    // con los tiempos rotos (todo a 0 s) salía un «resumen» de 3 s
// Acotaciones para sordos («(THEME MUSIC PLAYING)», «[RISAS]», «♪ … ♪»): se repiten en cualquier episodio.
const ACOTACION = /^\s*(\(.*\)|\[.*\]|♪.*)\s*$/s;

export const normalizar = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Pura. `previos`: frases de los episodios anteriores; `limiteMs`: hasta dónde mirar (p. ej. el inicio de la cabecera). */
export function detectarResumen(actual: Frase[], previos: Frase[][], limiteMs = VENTANA_MS): Resumen | null {
  const origen = new Map<string, number[]>();
  for (const lista of previos) {
    for (const f of lista) {
      const n = normalizar(f.text);
      if (n.length < MIN_CHARS) continue;
      const l = origen.get(n);
      if (l) l.push(f.ms); else origen.set(n, [f.ms]);
    }
  }
  let inicio: number | null = null, fin = 0, frases = 0, ultimo = -Infinity, mismaPosicion = 0;
  for (const f of actual) {
    if (f.ms >= Math.min(limiteMs, VENTANA_MS)) break;
    if (ACOTACION.test(f.text)) continue;
    const n = normalizar(f.text);
    if (n.length < MIN_CHARS) continue;
    const donde = origen.get(n);
    if (donde) {
      if (inicio === null) {
        if (f.ms > EMPIEZA_ANTES_MS) break;
        inicio = f.ms;
      } else if (f.ms - ultimo > HUECO_MS) break;
      fin = f.ms;
      ultimo = f.ms;
      frases++;
      if (donde.some((ms) => Math.abs(ms - f.ms) < MISMA_POSICION_MS)) mismaPosicion++;
    } else if (inicio !== null && f.ms - ultimo > HUECO_MS) break;
  }
  if (inicio === null || frases < MIN_FRASES) return null;
  if (mismaPosicion > frases / 2) return null; // el mismo subtítulo repetido (episodio doble), no un resumen
  const finMs = fin + 3000; // el índice solo guarda dónde empieza cada frase
  if (finMs - inicio > MAX_DURACION_MS || finMs - inicio < MIN_DURACION_MS) return null;
  return { inicioMs: inicio, finMs, frases };
}

/**
 * Recorre todos los episodios con diálogos indexados y guarda los resúmenes. Solo base de datos (unos segundos);
 * cede el hilo cada pocos episodios para no congelar el servidor si se llama desde él.
 */
export async function detectarResumenes(): Promise<{ analizados: number; encontrados: number }> {
  type Ep = { ep: number; show_id: number; season: number; file: number };
  const eps = db.prepare(`SELECT e.id AS ep, e.show_id, e.season, f.id AS file FROM episodes e
    JOIN media_files f ON f.episode_id = e.id JOIN dialogue_files df ON df.file_id = f.id
    WHERE e.season > 0 ORDER BY e.show_id, e.season, e.episode`).all() as Ep[];
  // `file_id` no está indexado en la tabla FTS: una consulta por fichero recorre todo. Una sola pasada.
  const quiero = new Set(eps.map((e) => e.file));
  const porFichero = new Map<number, Frase[]>();
  let n = 0;
  for (const r of db.prepare('SELECT text, file_id, start_ms FROM dialogue').iterate() as Iterable<{ text: string; file_id: number | string; start_ms: number | string }>) {
    if (++n % 50_000 === 0) await new Promise((res) => setImmediate(res));
    const f = Number(r.file_id);
    if (!quiero.has(f)) continue;
    let l = porFichero.get(f);
    if (!l) porFichero.set(f, (l = []));
    l.push({ text: r.text, ms: Number(r.start_ms) });
  }
  for (const l of porFichero.values()) l.sort((a, b) => a.ms - b.ms);

  const cabecera = db.prepare("SELECT start_s FROM skip_ranges WHERE episode_id = ? AND kind = 'intro'");
  const guardar = db.prepare(`INSERT INTO skip_ranges (episode_id, kind, start_s, end_s, confidence, created_at)
    VALUES (?, 'recap', ?, ?, ?, ?) ON CONFLICT(episode_id, kind) DO UPDATE SET start_s = excluded.start_s,
    end_s = excluded.end_s, confidence = excluded.confidence, created_at = excluded.created_at`);
  const borrar = db.prepare("DELETE FROM skip_ranges WHERE episode_id = ? AND kind = 'recap'");

  let analizados = 0, encontrados = 0;
  for (let i = 0; i < eps.length; i++) {
    if (i % 25 === 0) await new Promise((res) => setImmediate(res));
    const e = eps[i];
    const previos = eps.slice(Math.max(0, i - 3), i)
      .filter((p) => p.show_id === e.show_id && (p.season === e.season || p.season === e.season - 1));
    if (!previos.length) continue;
    analizados++;
    const intro = cabecera.get(e.ep) as { start_s: number } | undefined;
    const r = detectarResumen(porFichero.get(e.file) ?? [], previos.map((p) => porFichero.get(p.file) ?? []),
      intro ? intro.start_s * 1000 + 5000 : undefined);
    if (r) {
      encontrados++;
      guardar.run(e.ep, r.inicioMs / 1000, r.finMs / 1000, Math.min(100, 50 + r.frases * 5), new Date().toISOString());
    } else {
      borrar.run(e.ep);
    }
  }
  return { analizados, encontrados };
}
