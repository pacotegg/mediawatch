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
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { db, normalize } from '../db.ts';
import { config, type LibraryConfig } from '../config.ts';
import { applyProposal, search, TmdbError, type Proposal } from './tmdb.ts';
import { coincidenciaSegura } from './identificar.ts';
import { rellenarEpisodios } from './episodios-tmdb.ts';
import { aplicarOrganizar, asegurarMedidos, planOrganizar, type PlanOrganizar } from './organizar.ts';
import { aplicarArteCarpeta } from './arte-carpeta.ts';
import { escaneoEnCurso, JUNK, MIN_VIDEO_BYTES, scanAllEnWorker, SKIP_DIRS, VIDEO_EXT } from './scan.ts';
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

/* ---- lo que hay en el DISCO de la fuente y el servidor aun no ha analizado ---- */

export type SinRegistrar = { carpeta: string; ruta: string; tipo: 'carpeta' | 'video'; biblioteca: string };
const mismo = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
/** Bibliotecas de verdad y carpetas de entrada del scraper: de todas se puede escrapear. */
const todasLasFuentes = (): LibraryConfig[] => [...config.libraries, ...config.fuentesScraper];
const esVideo = (ruta: string) => VIDEO_EXT.has(extname(ruta).toLowerCase()) && !JUNK.test(basename(ruta));
const grande = (ruta: string) => { try { return statSync(ruta).size >= MIN_VIDEO_BYTES; } catch { return false; } };

/** ¿Hay algun video de tamano real en esta carpeta (en las series, tambien un nivel mas: Season N)? */
function tieneVideos(dir: string, niveles: number): boolean {
  let entradas;
  try { entradas = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entradas) {
    const p = join(dir, e.name);
    if (e.isFile() && esVideo(p) && grande(p)) return true;
    if (e.isDirectory() && niveles > 0 && !SKIP_DIRS.has(e.name.toLowerCase()) && tieneVideos(p, niveles - 1)) return true;
  }
  return false;
}

/**
 * Lo que hay en la fuente y todavia no esta en la base: carpetas con video y videos sueltos (en bibliotecas de peliculas). Mismas reglas que el
 * escaner (ignora lo pequeno, los extras y las carpetas que empiezan por `_`), y barato: lista la raiz y mira dentro solo de lo desconocido.
 */
export function sinRegistrar(rutaFuente: string): SinRegistrar[] {
  const fuente = todasLasFuentes().find((l) => mismo(l.path, rutaFuente));
  if (!fuente) return [];
  const conocidos = new Set((db.prepare('SELECT i.folder FROM items i JOIN libraries l ON l.id = i.library_id WHERE LOWER(l.path) = LOWER(?)').all(fuente.path) as { folder: string }[]).map((r) => resolve(r.folder).toLowerCase()));
  let raiz;
  try { raiz = readdirSync(fuente.path, { withFileTypes: true }); } catch { return []; }
  const out: SinRegistrar[] = [];
  for (const e of raiz) {
    const p = join(fuente.path, e.name);
    if (conocidos.has(resolve(p).toLowerCase())) continue;
    if (e.isDirectory()) {
      if (e.name.startsWith('_') || e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue;
      if (tieneVideos(p, fuente.kind === 'show' ? 1 : 0)) out.push({ carpeta: e.name, ruta: p, tipo: 'carpeta', biblioteca: fuente.name });
    } else if (fuente.kind === 'movie' && e.isFile() && esVideo(p) && grande(p)) {
      out.push({ carpeta: e.name, ruta: p, tipo: 'video', biblioteca: fuente.name });
    }
  }
  return out.sort((a, b) => a.carpeta.localeCompare(b.carpeta));
}

/** Escanea las fuentes de las rutas dadas (solo ellas) y devuelve los ids de esas carpetas/videos ya registrados. */
export async function registrarRutas(rutas: string[], escanear: (p?: undefined, solo?: string[]) => Promise<unknown> = scanAllEnWorker): Promise<number[]> {
  if (escaneoEnCurso()) throw new Error('Hay un escaneo de la biblioteca en curso: espera a que termine');
  const fuentes = new Set<string>();
  for (const r of rutas) {
    const f: LibraryConfig | undefined = todasLasFuentes().find((l) => resolve(r).toLowerCase().startsWith(resolve(l.path).toLowerCase() + sep));
    if (!f) throw new Error(`${r} no pertenece a ninguna fuente configurada`);
    fuentes.add(f.path);
  }
  if (fuentes.size > 0) await escanear(undefined, [...fuentes]);
  const ids: number[] = [];
  for (const r of rutas) {
    const f = db.prepare('SELECT id FROM items WHERE LOWER(folder) = LOWER(?)').get(resolve(r)) as { id: number } | undefined;
    if (f) ids.push(f.id);
  }
  return ids;
}

/** Las fuentes (bibliotecas y carpetas de entrada, aunque aun no se hayan escaneado) con cuantos ficheros les quedan por escrapear. */
export function fuentesConPendientes() {
  const contar = db.prepare(`SELECT COUNT(i.id) AS n FROM libraries l JOIN items i ON i.library_id = l.id AND ${SIN_ESCRAPEAR} WHERE LOWER(l.path) = LOWER(?)`);
  const marca = (l: LibraryConfig, entrada: boolean) => ({ name: l.name, ruta: l.path, kind: l.kind, entrada, pendientes: (contar.get(l.path) as { n: number }).n });
  return [...config.libraries.map((l) => marca(l, false)), ...config.fuentesScraper.map((l) => marca(l, true))];
}

/**
 * Valida las carpetas de entrada del scraper antes de guardarlas. Una carpeta no puede ser a la vez entrada y biblioteca (ni estar dentro de una
 * biblioteca, ni contenerla): el escaneo cogeria dos veces lo mismo y la entrada dejaria de estar separada.
 */
export function validarFuentes(nuevas: { name?: unknown; path?: unknown; kind?: unknown }[]): LibraryConfig[] {
  const out: LibraryConfig[] = [];
  for (const f of nuevas) {
    const name = String(f.name ?? '').trim();
    const ruta = String(f.path ?? '').trim();
    if (!name || name.length > 60) throw new Error('Nombre de fuente inválido');
    if (f.kind !== 'movie' && f.kind !== 'show') throw new Error('El tipo debe ser películas o series');
    if (!ruta) throw new Error('Falta la ruta de la fuente');
    if (!existsSync(ruta)) throw new Error(`La ruta «${ruta}» no existe en el servidor`);
    const r = resolve(ruta);
    if (out.some((o) => mismo(o.path, r))) throw new Error(`La fuente ${r} está repetida`);
    for (const b of config.libraries) {
      const rb = resolve(b.path).toLowerCase();
      const rr = r.toLowerCase();
      if (rr === rb) throw new Error(`${r} ya es una biblioteca («${b.name}»): una carpeta no puede ser entrada y biblioteca a la vez`);
      if (rr.startsWith(rb + sep)) throw new Error(`${r} está dentro de la biblioteca «${b.name}»`);
      if (rb.startsWith(rr + sep)) throw new Error(`${r} contiene la biblioteca «${b.name}»`);
    }
    out.push({ name, path: r, kind: f.kind });
  }
  return out;
}

/** Deja la base como dice la configuracion: la biblioteca de una fuente del scraper es de ENTRADA (oculta a los clientes); las demas no. */
export function marcarEntradas(): void {
  db.exec('BEGIN');
  try {
    for (const b of config.libraries) db.prepare('UPDATE libraries SET entrada = 0 WHERE LOWER(path) = LOWER(?)').run(b.path);
    for (const f of config.fuentesScraper) db.prepare('UPDATE libraries SET entrada = 1 WHERE LOWER(path) = LOWER(?)').run(f.path);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export const totalPendientes = () => (db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${SIN_ESCRAPEAR}`).get() as { n: number }).n;

/* ------------------------------------------------------------------ 1. buscar */

export const busqueda: EstadoLote<FilaNueva> & { fase?: string } = vacio();

export async function buscarNuevos(ids: number[], rutas: string[] = [], escanear?: Parameters<typeof registrarRutas>[1]): Promise<void> {
  if (busqueda.corriendo) return;
  if (!config.tmdbApiKey) { Object.assign(busqueda, vacio(), { error: 'Falta la clave de API de TMDb' }); return; }
  Object.assign(busqueda, vacio(), { corriendo: true, total: ids.length + rutas.length, fase: rutas.length ? 'analizando' : 'buscando' });
  let filas: { id: number; title: string; year: number | null; kind: 'movie' | 'show'; biblioteca: string }[] = [];
  try {
    // Lo marcado que el servidor aun no habia analizado: se escanea SOLO su fuente y se recogen sus ids.
    const todos = [...ids, ...(rutas.length ? await registrarRutas(rutas, escanear) : [])];
    filas = todos.map((id) => db.prepare('SELECT i.id, i.title, i.year, i.kind, l.name AS biblioteca FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?').get(id) as (typeof filas)[number] | undefined).filter((f): f is NonNullable<typeof f> => Boolean(f));
    busqueda.total = filas.length;
    busqueda.fase = 'buscando';
  } catch (err) {
    busqueda.error = (err as Error).message;
    busqueda.corriendo = false;
    busqueda.terminado = new Date().toISOString();
    return;
  }
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

/** El plan del lote, midiendo antes (ffprobe) lo que aun no se haya medido. */
export async function planesDeLoteMedidos(ids: number[]): Promise<PlanDeLote[]> {
  for (const id of ids) await asegurarMedidos(id);
  return planesDeLote(ids);
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
        await asegurarMedidos(id);
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
