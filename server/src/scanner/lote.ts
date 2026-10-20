/*
 * El flujo de tMM sobre una SELECCION de titulos nuevos: buscar coincidencias, aplicar los datos, renombrar.
 *
 *   `listarCandidatos`  la LISTA de ficheros de las fuentes (como tMM): el usuario marca los que quiere escrapear.
 *   `buscarNuevos`      TMDb propone un emparejado SOLO para los titulos marcados (solo lee; nada se aplica).
 *   `aplicarDatos`      aplica la ficha completa y el arte de los emparejados que el usuario ha aceptado (BD y data/artwork).
 *   `planesDeLote`      el plan de renombrado de TODOS los titulos de la seleccion, sin tocar nada.
 *   `ejecutarLote`      hace esos renombrados, uno a uno; un titulo que falla no frena a los demas. Lo unico que escribe en la biblioteca.
 *
 * Cada fase corre como un trabajo en segundo plano con progreso (`EstadoLote`) que la web consulta.
 */
import { basename } from 'node:path';
import { db, normalize } from '../db.ts';
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

const SIN_ESCRAPEAR = "(i.tmdb_id IS NULL OR i.tmdb_id = '') AND i.meta_origen IS NULL";

export type Candidato = { id: number; titulo: string; anio: number | null; kind: 'movie' | 'show'; carpeta: string; biblioteca: string; ruta: string; alta: string | null; escrapeado: boolean };

/**
 * Los ficheros de las fuentes, como la lista de tMM. Por defecto solo los SIN escrapear (sin id de TMDb y que nadie ha emparejado: lo que
 * llega nuevo, sin .nfo); con `todos`, tambien los ya escrapeados (marcados). `carpeta` es el nombre que tiene en disco, que es lo que el usuario reconoce.
 */
export function listarCandidatos(o: { biblioteca?: string; q?: string; todos?: boolean; limite?: number }): Candidato[] {
  const donde: string[] = [o.todos ? '1' : SIN_ESCRAPEAR];
  const params: (string | number)[] = [];
  if (o.biblioteca) { donde.push('l.path = ?'); params.push(o.biblioteca); }
  const q = normalize(o.q ?? '');
  if (q) { donde.push('(i.search_title LIKE ? OR LOWER(i.folder) LIKE ?)'); params.push(`%${q}%`, `%${(o.q ?? '').toLowerCase().trim()}%`); }
  const filas = db
    .prepare(`SELECT i.id, i.title, i.year, i.kind, i.folder, i.added_at, i.tmdb_id, i.meta_origen, l.name AS biblioteca, l.path AS ruta
              FROM items i JOIN libraries l ON l.id = i.library_id WHERE ${donde.join(' AND ')} ORDER BY i.added_at DESC, i.id DESC LIMIT ?`)
    .all(...params, Math.min(Math.max(1, o.limite ?? 500), 1000)) as { id: number; title: string; year: number | null; kind: 'movie' | 'show'; folder: string; added_at: string | null; tmdb_id: string | null; meta_origen: string | null; biblioteca: string; ruta: string }[];
  return filas.map((f) => ({
    id: f.id, titulo: f.title, anio: f.year, kind: f.kind, carpeta: basename(f.folder), biblioteca: f.biblioteca, ruta: f.ruta, alta: f.added_at,
    escrapeado: Boolean(f.tmdb_id) || f.meta_origen != null,
  }));
}

/** Las fuentes con cuantos ficheros les quedan por escrapear (para el selector). */
export function fuentesConPendientes() {
  return db
    .prepare(`SELECT l.name, l.path AS ruta, l.kind, COUNT(i.id) AS pendientes FROM libraries l
              LEFT JOIN items i ON i.library_id = l.id AND ${SIN_ESCRAPEAR} GROUP BY l.id ORDER BY l.id`)
    .all() as { name: string; ruta: string; kind: 'movie' | 'show'; pendientes: number }[];
}
export const totalPendientes = () => (db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${SIN_ESCRAPEAR}`).get() as { n: number }).n;

/* ------------------------------------------------------------------ 1. buscar */

export const busqueda: EstadoLote<FilaNueva> = vacio();

export async function buscarNuevos(ids: number[]): Promise<void> {
  if (busqueda.corriendo) return;
  if (!config.tmdbApiKey) { Object.assign(busqueda, vacio(), { error: 'Falta la clave de API de TMDb' }); return; }
  const filas = ids.map((id) => db.prepare('SELECT i.id, i.title, i.year, i.kind, l.name AS biblioteca FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?').get(id) as { id: number; title: string; year: number | null; kind: 'movie' | 'show'; biblioteca: string } | undefined).filter((f): f is NonNullable<typeof f> => Boolean(f));
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
