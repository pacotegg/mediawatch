/*
 * Identificacion automatica de titulos sin .nfo (MediaWatch Server).
 *
 * El titulo ya sale limpio del nombre (`nombres.ts`). Aqui se busca en TMDb y,
 * solo si la coincidencia es segura, se aplica. Lo dudoso NO se toca: queda para
 * la revision manual de siempre. Todo se escribe en la base de datos y en
 * `data/artwork/`, nunca en la biblioteca del usuario.
 */
import { db, normalize } from '../db.ts';
import { config } from '../config.ts';
import { applyProposal, search, TmdbError, type Proposal } from './tmdb.ts';
import { rellenarEpisodios } from './episodios-tmdb.ts';

const DIAS_ENTRE_INTENTOS = 30;
const PAUSA_MS = 300;

type Fila = { id: number; title: string; year: number | null; kind: 'movie' | 'show' };

const mismoTitulo = (a: string, p: Proposal) =>
  normalize(a) === normalize(p.title) || (p.originalTitle != null && normalize(a) === normalize(p.originalTitle));

/**
 * ¿Cual de los resultados es, con seguridad, este titulo? `null` si hay duda.
 * Con ano: titulo igual y ano a +-1. Sin ano: titulo igual y UN solo resultado
 * con ese titulo (dos «Dune» o dos «The Office» son ya una duda).
 */
export function coincidenciaSegura(item: { title: string; year: number | null }, resultados: Proposal[]): Proposal | null {
  const iguales = resultados.filter((r) => mismoTitulo(item.title, r));
  if (item.year != null) {
    return iguales.find((r) => r.year != null && Math.abs(r.year - item.year!) <= 1) ?? null;
  }
  return iguales.length === 1 ? iguales[0] : null;
}

export type ResumenIdentificacion = { revisados: number; identificados: number; dudosos: number; sinClave: boolean; error?: string };

let corriendo = false;
export const identificando = () => corriendo;

export async function identificarPendientes(limite = 150, log: (m: string) => void = console.log): Promise<ResumenIdentificacion> {
  const r: ResumenIdentificacion = { revisados: 0, identificados: 0, dudosos: 0, sinClave: false };
  if (!config.tmdbApiKey) return { ...r, sinClave: true };
  if (corriendo) return r;
  corriendo = true;
  try {
    const corte = new Date(Date.now() - DIAS_ENTRE_INTENTOS * 86_400_000).toISOString();
    const filas = db
      .prepare(
        `SELECT id, title, year, kind FROM items
         WHERE tmdb_id IS NULL AND meta_origen IS NULL AND (ident_intento IS NULL OR ident_intento < ?)
         ORDER BY id LIMIT ?`,
      )
      .all(corte, limite) as Fila[];

    for (const fila of filas) {
      r.revisados++;
      try {
        const mejor = coincidenciaSegura(fila, await search(fila.title, fila.kind, fila.year));
        if (mejor) {
          await applyProposal({
            itemId: fila.id, tmdbId: mejor.tmdbId, kind: fila.kind,
            fields: ['poster', 'fanart', 'logo', 'plot', 'rating', 'genres'], identidad: true,
          });
          if (fila.kind === 'show') await rellenarEpisodios(fila.id, mejor.tmdbId);
          r.identificados++;
        } else {
          r.dudosos++;
        }
        db.prepare('UPDATE items SET ident_intento = ? WHERE id = ?').run(new Date().toISOString(), fila.id);
      } catch (err) {
        // Sin clave valida no tiene sentido seguir; cualquier otro fallo es de un titulo.
        if (err instanceof TmdbError && /clave de API/.test(err.message)) {
          r.error = err.message;
          break;
        }
        log(`[identificar] ${fila.title}: ${(err as Error).message}`);
      }
      await new Promise((ok) => setTimeout(ok, PAUSA_MS));
    }
    log(`[identificar] ${r.revisados} revisados, ${r.identificados} identificados, ${r.dudosos} dudosos`);
    return r;
  } finally {
    corriendo = false;
  }
}

/** Lo que el administrador tiene que mirar. */
export function estadoIdentificacion() {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    pendientes: n("SELECT COUNT(*) n FROM items WHERE tmdb_id IS NULL AND meta_origen IS NULL AND ident_intento IS NULL"),
    dudosos: n("SELECT COUNT(*) n FROM items WHERE tmdb_id IS NULL AND meta_origen IS NULL AND ident_intento IS NOT NULL"),
    identificados: n("SELECT COUNT(*) n FROM items WHERE meta_origen = 'tmdb'"),
    sinClasificar: db
      .prepare("SELECT id, title, year, kind FROM items WHERE meta_origen = 'tmdb' AND mpaa IS NULL ORDER BY title")
      .all() as { id: number; title: string; year: number | null; kind: string }[],
  };
}
