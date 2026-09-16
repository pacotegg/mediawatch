/**
 * Rellena las valoraciones que no vienen en los ficheros.
 *
 * Los `.nfo` de esta biblioteca ya traen IMDb (98 % de las películas), el
 * tomatómetro (85 %) y TheMovieDb (97 %). Lo que falta está casi todo en las
 * series: de 99, solo una tiene tomatómetro y una TVDB. OMDb devuelve IMDb,
 * Rotten Tomatoes y Metacritic en una sola consulta por título, así que con una
 * llamada por serie se tapa el hueco.
 *
 * **Los ficheros mandan.** Lo de OMDb entra con `INSERT OR IGNORE` y marcado
 * como `origen='omdb'`: si el `.nfo` ya traía esa nota, se queda la del fichero,
 * y cuando el escáner reescribe las suyas solo borra las que puso él. Así un
 * reescaneo no se lleva por delante lo que se ha traído de fuera, que es
 * exactamente el error que costó 107 duraciones.
 */
import { config } from '../config.ts';
import { db } from '../db.ts';

export type LoteOmdb = {
  running: boolean;
  total: number;
  hechos: number;
  anadidas: number;
  sinDatos: number;
  error: string | null;
  actual: string;
  parando: boolean;
  finishedAt: string | null;
};

export const loteOmdb: LoteOmdb = {
  running: false, total: 0, hechos: 0, anadidas: 0, sinDatos: 0,
  error: null, actual: '', parando: false, finishedAt: null,
};

export function pararOmdb() {
  if (!loteOmdb.running) return false;
  loteOmdb.parando = true;
  return true;
}

/** Cómo llama OMDb a cada sitio y cómo lo llamamos nosotros. */
const FUENTES: Record<string, { nuestra: string; maximo: number }> = {
  'Internet Movie Database': { nuestra: 'imdb', maximo: 10 },
  'Rotten Tomatoes': { nuestra: 'tomatometerallcritics', maximo: 100 },
  Metacritic: { nuestra: 'metacritic', maximo: 100 },
};

/** «7.6/10», «85%» y «67/100» -> número. */
function valorDe(texto: string): number | null {
  const m = /^([\d.]+)\s*(?:%|\/\s*\d+)?$/.exec(texto.trim());
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pendientes(todos: boolean): { id: number; title: string; imdb_id: string }[] {
  const falta = `NOT EXISTS (SELECT 1 FROM item_ratings r WHERE r.item_id = i.id AND r.fuente = 'tomatometerallcritics')`;
  return db
    .prepare(`SELECT i.id, i.title, i.imdb_id
                FROM items i
               WHERE i.imdb_id IS NOT NULL AND i.imdb_id != ''
                 ${todos ? '' : 'AND ' + falta}
               ORDER BY i.kind = 'show' DESC, i.title`)
    .all() as { id: number; title: string; imdb_id: string }[];
}

export function rellenarConOmdb(todos = false) {
  if (loteOmdb.running) throw new Error('Ya hay una consulta en curso');
  if (!config.omdbApiKey) throw new Error('Falta la clave de OMDb');

  const lista = pendientes(todos);
  Object.assign(loteOmdb, {
    running: true, total: lista.length, hechos: 0, anadidas: 0, sinDatos: 0,
    error: null, actual: '', parando: false, finishedAt: null,
  });

  queueMicrotask(async () => {
    const meter = db.prepare(
      'INSERT OR IGNORE INTO item_ratings (item_id, fuente, valor, maximo, votos, origen) VALUES (?,?,?,?,?,?)',
    );
    try {
      for (const it of lista) {
        if (loteOmdb.parando) break;
        loteOmdb.actual = it.title;

        try {
          const res = await fetch(
            `http://www.omdbapi.com/?i=${encodeURIComponent(it.imdb_id)}&apikey=${encodeURIComponent(config.omdbApiKey)}`,
            { signal: AbortSignal.timeout(15_000) },
          );
          const datos = (await res.json()) as {
            Response?: string;
            Error?: string;
            imdbVotes?: string;
            Ratings?: { Source: string; Value: string }[];
          };

          if (datos.Response !== 'True') {
            // «Request limit reached» corta la tanda: seguir solo gastaría el
            // cupo del día para nada.
            if (/limit/i.test(datos.Error ?? '')) throw new Error(datos.Error);
            loteOmdb.sinDatos++;
          } else {
            const votos = Number((datos.imdbVotes ?? '').replace(/[^\d]/g, '')) || 0;
            let puestas = 0;
            for (const r of datos.Ratings ?? []) {
              const f = FUENTES[r.Source];
              const valor = f ? valorDe(r.Value) : null;
              if (!f || valor === null) continue;
              const cambio = meter.run(it.id, f.nuestra, valor, f.maximo, f.nuestra === 'imdb' ? votos : 0, 'omdb');
              puestas += cambio.changes;
            }
            if (puestas) loteOmdb.anadidas += puestas;
            else loteOmdb.sinDatos++;
          }
        } catch (err) {
          const motivo = (err as Error).message;
          if (/limit/i.test(motivo)) {
            loteOmdb.error = 'OMDb ha cortado por cupo diario: ' + motivo;
            break;
          }
          loteOmdb.sinDatos++;
        }

        loteOmdb.hechos++;
        // Sin prisa: son mil consultas al día y no hay ninguna urgencia.
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      loteOmdb.running = false;
      loteOmdb.parando = false;
      loteOmdb.actual = '';
      loteOmdb.finishedAt = new Date().toISOString();
      console.log(
        `[omdb] terminado: ${loteOmdb.hechos}/${loteOmdb.total} títulos, ${loteOmdb.anadidas} notas nuevas, ${loteOmdb.sinDatos} sin datos`,
      );
    }
  });

  return loteOmdb.total;
}
