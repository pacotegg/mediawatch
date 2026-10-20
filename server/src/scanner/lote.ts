/*
 * El flujo de tMM sobre una SELECCION de titulos nuevos: buscar coincidencias, aplicar los datos, renombrar.
 *
 *   `buscarNuevos`      TMDb propone un emparejado para cada titulo sin identificar (solo lee; nada se aplica).
 *   `aplicarDatos`      aplica la ficha completa y el arte de los emparejados que el usuario ha aceptado (BD y data/artwork).
 *   `planesDeLote`      el plan de renombrado de TODOS los titulos de la seleccion, sin tocar nada.
 *   `ejecutarLote`      hace esos renombrados, uno a uno; un titulo que falla no frena a los demas. Lo unico que escribe en la biblioteca.
 *
 * Cada fase corre como un trabajo en segundo plano con progreso (`EstadoLote`) que la web consulta.
 */
import { db } from '../db.ts';
import { config } from '../config.ts';
import { applyProposal, search, TmdbError, type Proposal } from './tmdb.ts';
import { coincidenciaSegura } from './identificar.ts';
import { rellenarEpisodios } from './episodios-tmdb.ts';
import { aplicarOrganizar, planOrganizar, type PlanOrganizar } from './organizar.ts';
import { aplicarArteCarpeta } from './arte-carpeta.ts';
import { aplicarNfo } from './nfo-escribir.ts';

export type Confianza = 'segura' | 'probable' | 'dudosa' | 'ninguna';
export type FilaNueva = {
  itemId: number; titulo: string; anio: number | null; kind: 'movie' | 'show'; biblioteca: string;
  propuesta: Proposal | null; alternativas: Proposal[]; confianza: Confianza;
};
export type ResultadoItem = { itemId: number; titulo: string; ok: boolean; error?: string; movidos?: number; detalle?: string };
export type EstadoLote<T> = { corriendo: boolean; hechos: number; total: number; error: string | null; resultados: T[]; terminado: string | null };

const vacio = <T>(): EstadoLote<T> => ({ corriendo: false, hechos: 0, total: 0, error: null, resultados: [], terminado: null });
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Los titulos sin identificar: sin id de TMDb y que nadie ha emparejado (los nuevos, sin .nfo). */
export function pendientes(limite = 100) {
  return db
    .prepare(`SELECT i.id, i.title, i.year, i.kind, l.name AS biblioteca FROM items i JOIN libraries l ON l.id = i.library_id
              WHERE (i.tmdb_id IS NULL OR i.tmdb_id = '') AND i.meta_origen IS NULL ORDER BY i.added_at DESC LIMIT ?`)
    .all(limite) as { id: number; title: string; year: number | null; kind: 'movie' | 'show'; biblioteca: string }[];
}
export const totalPendientes = () => (db.prepare("SELECT COUNT(*) AS n FROM items WHERE (tmdb_id IS NULL OR tmdb_id = '') AND meta_origen IS NULL").get() as { n: number }).n;

/* ------------------------------------------------------------------ 1. buscar */

export const busqueda: EstadoLote<FilaNueva> = vacio();

export async function buscarNuevos(limite = 40): Promise<void> {
  if (busqueda.corriendo) return;
  if (!config.tmdbApiKey) { Object.assign(busqueda, vacio(), { error: 'Falta la clave de API de TMDb' }); return; }
  const filas = pendientes(limite);
  Object.assign(busqueda, vacio(), { corriendo: true, total: filas.length });
  try {
    for (const f of filas) {
      let resultados: Proposal[] = [];
      try { resultados = await search(f.title, f.kind, f.year); } catch (e) { if (e instanceof TmdbError && /clave/.test(e.message)) throw e; }
      const segura = coincidenciaSegura(f, resultados);
      const mejor = segura ?? resultados[0] ?? null;
      const mismoTitulo = mejor && mejor.title.toLowerCase() === f.title.toLowerCase();
      busqueda.resultados.push({
        itemId: f.id, titulo: f.title, anio: f.year, kind: f.kind, biblioteca: f.biblioteca,
        propuesta: mejor, alternativas: resultados.filter((r) => r.tmdbId !== mejor?.tmdbId).slice(0, 5),
        confianza: segura ? 'segura' : !mejor ? 'ninguna' : mismoTitulo ? 'probable' : 'dudosa',
      });
      busqueda.hechos++;
      await pausa(250);
    }
  } catch (e) {
    busqueda.error = (e as Error).message;
  } finally {
    busqueda.corriendo = false;
    busqueda.terminado = new Date().toISOString();
  }
}

/* ------------------------------------------------------------------ 2. aplicar datos */

export const aplicacion: EstadoLote<ResultadoItem> = vacio();

export async function aplicarDatos(elegidos: { itemId: number; tmdbId: number }[]): Promise<void> {
  if (aplicacion.corriendo) return;
  Object.assign(aplicacion, vacio(), { corriendo: true, total: elegidos.length });
  try {
    for (const e of elegidos) {
      const it = db.prepare('SELECT title, kind FROM items WHERE id = ?').get(e.itemId) as { title: string; kind: 'movie' | 'show' } | undefined;
      try {
        if (!it) throw new Error('El título ya no existe');
        await applyProposal({
          itemId: e.itemId, tmdbId: e.tmdbId, kind: it.kind, overwrite: false,
          fields: ['poster', 'fanart', 'logo', 'plot', 'rating', 'genres', 'cast', 'studio', 'ratings'],
          // Un titulo nuevo no tiene nada propio: TMDb pasa a ser su identidad (titulo, ano, edad...), y de ahi saldran los nombres.
          identidad: true,
        });
        if (it.kind === 'show') await rellenarEpisodios(e.itemId, e.tmdbId);
        aplicacion.resultados.push({ itemId: e.itemId, titulo: it.title, ok: true });
      } catch (err) {
        aplicacion.resultados.push({ itemId: e.itemId, titulo: it?.title ?? String(e.itemId), ok: false, error: (err as Error).message });
      }
      aplicacion.hechos++;
      await pausa(250);
    }
  } finally {
    aplicacion.corriendo = false;
    aplicacion.terminado = new Date().toISOString();
  }
}

/* ------------------------------------------------------------------ 3. renombrar */

export type PlanDeLote = { itemId: number; titulo: string; pasos: PlanOrganizar['pasos']; error?: string };

export function planesDeLote(ids: number[]): PlanDeLote[] {
  return ids.map((id) => {
    const titulo = (db.prepare('SELECT title FROM items WHERE id = ?').get(id) as { title: string } | undefined)?.title ?? String(id);
    try {
      return { itemId: id, titulo, pasos: planOrganizar(id).pasos };
    } catch (e) {
      return { itemId: id, titulo, pasos: [], error: (e as Error).message };
    }
  });
}

export const renombrado: EstadoLote<ResultadoItem> = vacio();

/** Ejecuta los renombrados de la lista. `alAvanzar` recibe el progreso (para pruebas); el estado compartido se actualiza solo. */
export async function ejecutarLote(ids: number[], opciones: { copiarArte: boolean; escribirNfo?: boolean }, alAvanzar?: (p: { hechos: number; total: number }) => void): Promise<ResultadoItem[]> {
  const resultados: ResultadoItem[] = [];
  Object.assign(renombrado, vacio(), { corriendo: true, total: ids.length, resultados });
  try {
    for (const id of ids) {
      const titulo = (db.prepare('SELECT title FROM items WHERE id = ?').get(id) as { title: string } | undefined)?.title ?? String(id);
      try {
        const { movidos } = aplicarOrganizar(id);
        const detalles: string[] = [];
        if (opciones.copiarArte) {
          try { detalles.push(`arte copiado: ${aplicarArteCarpeta(id).escritos.length}`); } catch (e) { detalles.push(`arte no copiado (${(e as Error).message})`); }
        }
        if (opciones.escribirNfo) {
          try { detalles.push(`NFO escritos: ${aplicarNfo(id).escritos.length}`); } catch (e) { detalles.push(`NFO no escrito (${(e as Error).message})`); }
        }
        const detalle = detalles.length ? detalles.join(', ') : undefined;
        resultados.push({ itemId: id, titulo, ok: true, movidos, detalle });
      } catch (e) {
        resultados.push({ itemId: id, titulo, ok: false, error: (e as Error).message });
      }
      renombrado.hechos++;
      alAvanzar?.({ hechos: renombrado.hechos, total: ids.length });
      await pausa(0);
    }
  } finally {
    renombrado.corriendo = false;
    renombrado.terminado = new Date().toISOString();
  }
  return resultados;
}
