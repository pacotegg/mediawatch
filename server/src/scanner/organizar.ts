/*
 * «Organizar»: dejar carpetas y ficheros con los nombres que ponia tinyMediaManager (ver nombres-tmm.ts).
 *
 *   pelicula  Titulo (Ano)/Titulo (Ano) 1080p AC3.mkv            (tambien un video SUELTO en la raiz: se le crea su carpeta)
 *   serie     Serie (Ano)/Season N/Serie - S01E01 - Titulo.mkv
 * Los ficheros de al lado (subtitulos, .nfo, imagenes con el nombre del video) se renombran con el.
 *
 * Es escritura en la biblioteca, asi que:
 *   - `planOrganizar` dice EXACTAMENTE que se mueve a donde y no toca nada; `aplicarOrganizar` hace solo ese plan;
 *   - se niega si el destino ya existe (no se mezcla ni se pisa nada), si dos ficheros darian el mismo nombre, si alguien esta viendo algo
 *     o si hay un escaneo en curso;
 *   - las rutas de la base de datos se actualizan en el mismo paso: el fichero conserva su id (miniaturas de la barra, progreso, historial);
 *   - si algo falla (disco o base de datos), lo movido vuelve a su sitio.
 * Nunca borra nada: solo renombra y, para un video suelto, crea su carpeta.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import { db } from '../db.ts';
import { hayAlguienViendo } from '../media/ocupado.ts';
import { mediaInfo } from '../media/probe.ts';
import { escaneoEnCurso } from './scan.ts';
import { carpetaDePelicula, carpetaDeSerie, carpetaDeTemporada, codecDeAudio, ficheroDeEpisodio, ficheroDePelicula, formatoDeVideo } from './nombres-tmm.ts';

/** `hacia` es la ruta en el momento del paso; `final`, la ruta cuando ya se han hecho todos (lo que se ve al acabar). */
export type Paso = { tipo: 'fichero' | 'carpeta'; desde: string; hacia: string; final: string };
export type PlanOrganizar = { itemId: number; kind: 'movie' | 'show'; pasos: Paso[] };
export class OrganizarError extends Error {}

const VIDEO = /\.(mkv|mp4|avi|m4v|mov|wmv|mpg|mpeg|ts|webm)$/i;
// Lo que puede acompanar a un video con su mismo nombre: subtitulos, nfo e imagenes. Con sufijos tipo `.es`, `.eng.forced`, `-poster`.
const COMPANERO = /^([.-][^./\\]{1,24})*\.(srt|ass|ssa|sub|idx|vtt|nfo|jpe?g|png|webp)$/i;

export type Item = { id: number; kind: 'movie' | 'show'; title: string; year: number | null; folder: string };

function ficherosDeAlLado(dir: string, baseVieja: string): string[] {
  const b = baseVieja.toLowerCase();
  return readdirSync(dir)
    .filter((n) => n.toLowerCase().startsWith(b) && !VIDEO.test(n) && COMPANERO.test(n.slice(baseVieja.length)))
    .sort();
}

function itemDe(itemId: number): Item {
  const it = db.prepare('SELECT id, kind, title, year, folder FROM items WHERE id = ?').get(itemId) as Item | undefined;
  if (!it) throw new OrganizarError('El título ya no existe');
  return it;
}

/**
 * El servidor solo mide un video (ffprobe) la primera vez que alguien lo reproduce, asi que un titulo recien escrapeado esta SIN MEDIR. El
 * nombre lleva el formato y el audio del propio fichero: se miden aqui, al planificar (~1 s por fichero), en vez de pedir que se espere.
 */
export async function asegurarMedidos(itemId: number): Promise<void> {
  const it = db.prepare('SELECT kind FROM items WHERE id = ?').get(itemId) as { kind: string } | undefined;
  if (it?.kind !== 'movie') return; // el nombre de un episodio no lleva formato ni audio
  const sin = db.prepare('SELECT id FROM media_files WHERE item_id = ? AND (probed = 0 OR width IS NULL)').all(itemId) as { id: number }[];
  for (const f of sin) await mediaInfo(f.id).catch(() => { /* si no se puede medir, el plan dara su motivo */ });
}

export function planOrganizar(itemId: number, opciones: { edicion?: string | null } = {}): PlanOrganizar {
  const it = itemDe(itemId);
  const pasos = it.kind === 'movie' ? planPelicula(it, opciones.edicion ?? null) : planSerie(it);
  comprobarDestinos(pasos);
  const carpetas = pasos.filter((p) => p.tipo === 'carpeta');
  for (const p of pasos) p.final = trasCarpetas(p.hacia, carpetas);
  return { itemId, kind: it.kind, pasos };
}

function planPelicula(it: Item, edicion: string | null): Paso[] {
  const ficheros = db.prepare('SELECT id, path, width, height, probed FROM media_files WHERE item_id = ?').all(it.id) as { id: number; path: string; width: number | null; height: number | null; probed: number }[];
  if (ficheros.length === 0) throw new OrganizarError('El título no tiene vídeo registrado');
  if (ficheros.length > 1) throw new OrganizarError('El título tiene varios vídeos (partes o versiones): se organiza a mano');
  const f = ficheros[0];
  if (!f.probed || !f.width) throw new OrganizarError('El vídeo está sin medir: espera a que el servidor lo analice (formato y audio salen del propio fichero)');
  if (!it.year) throw new OrganizarError('Falta el año del título: empareja primero con TMDb');

  const audio = db.prepare('SELECT codec, title FROM audio_tracks WHERE file_id = ? ORDER BY idx LIMIT 1').get(f.id) as { codec: string | null; title: string | null } | undefined;
  const datos = { titulo: it.title, anio: it.year, edicion, formato: formatoDeVideo(f.width, f.height), audio: codecDeAudio(audio?.codec, audio?.title) };
  const nombre = ficheroDePelicula(datos);
  const carpeta = carpetaDePelicula(datos);
  const ext = extname(f.path);
  const dirVideo = dirname(f.path);
  const baseVieja = basename(f.path, ext);
  const suelto = VIDEO.test(it.folder) || !existsSync(it.folder) || !statSync(it.folder).isDirectory();

  const pasos: Paso[] = [];
  if (suelto) {
    // Video suelto en la raiz de la biblioteca: se le crea su carpeta y se mueve SOLO lo suyo.
    const destino = join(dirVideo, carpeta);
    pasos.push({ tipo: 'fichero', desde: f.path, hacia: join(destino, nombre + ext), final: '' });
    for (const n of ficherosDeAlLado(dirVideo, baseVieja)) pasos.push({ tipo: 'fichero', desde: join(dirVideo, n), hacia: join(destino, nombre + n.slice(baseVieja.length)), final: '' });
    return pasos;
  }
  if (dirVideo !== it.folder) throw new OrganizarError('El vídeo no está directamente en la carpeta del título: se organiza a mano');
  if (baseVieja !== nombre) {
    pasos.push({ tipo: 'fichero', desde: f.path, hacia: join(dirVideo, nombre + ext), final: '' });
    for (const n of ficherosDeAlLado(dirVideo, baseVieja)) pasos.push({ tipo: 'fichero', desde: join(dirVideo, n), hacia: join(dirVideo, nombre + n.slice(baseVieja.length)), final: '' });
  }
  const nueva = join(dirname(it.folder), carpeta);
  if (nueva !== it.folder) pasos.push({ tipo: 'carpeta', desde: it.folder, hacia: nueva, final: '' });
  return pasos;
}

function planSerie(it: Item): Paso[] {
  if (!it.year) throw new OrganizarError('Falta el año de la serie: empareja primero con TMDb');
  const eps = db.prepare(`SELECT e.season, e.episode, e.title, f.path FROM episodes e JOIN media_files f ON f.episode_id = e.id WHERE e.show_id = ? ORDER BY e.season, e.episode`).all(it.id) as { season: number; episode: number; title: string | null; path: string }[];
  if (eps.length === 0) throw new OrganizarError('La serie no tiene episodios registrados');

  const pasos: Paso[] = [];
  const dirsTemporada = new Map<string, number>(); // carpeta de temporada actual -> numero
  for (const e of eps) {
    const dir = dirname(e.path);
    const ext = extname(e.path);
    const baseVieja = basename(e.path, ext);
    const titulo = e.title && !/^Episodio \d+$/i.test(e.title) ? e.title : null;
    const nombre = ficheroDeEpisodio(it.title, e.season, e.episode, titulo);
    // Episodios sueltos en la carpeta de la serie: van a su Season N (que se crea).
    const destinoDir = dir === it.folder ? join(it.folder, carpetaDeTemporada(e.season)) : dir;
    if (dir !== it.folder) {
      const previo = dirsTemporada.get(dir);
      if (previo !== undefined && previo !== e.season) throw new OrganizarError(`La carpeta ${basename(dir)} mezcla temporadas: se organiza a mano`);
      dirsTemporada.set(dir, e.season);
    }
    if (baseVieja === nombre && destinoDir === dir) continue;
    pasos.push({ tipo: 'fichero', desde: e.path, hacia: join(destinoDir, nombre + ext), final: '' });
    for (const n of ficherosDeAlLado(dir, baseVieja)) pasos.push({ tipo: 'fichero', desde: join(dir, n), hacia: join(destinoDir, nombre + n.slice(baseVieja.length)), final: '' });
  }
  for (const [dir, temporada] of dirsTemporada) {
    const nueva = join(dirname(dir), carpetaDeTemporada(temporada));
    if (nueva !== dir) pasos.push({ tipo: 'carpeta', desde: dir, hacia: nueva, final: '' });
  }
  const nueva = join(dirname(it.folder), carpetaDeSerie(it.title, it.year));
  if (nueva !== it.folder) pasos.push({ tipo: 'carpeta', desde: it.folder, hacia: nueva, final: '' });
  return pasos;
}

const mismoSitio = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function comprobarDestinos(pasos: Paso[]) {
  const vistos = new Map<string, string>();
  for (const p of pasos) {
    const k = p.hacia.toLowerCase();
    if (vistos.has(k)) throw new OrganizarError(`Dos ficheros darían el mismo nombre: ${basename(p.hacia)}`);
    vistos.set(k, p.desde);
    // Un destino que ya existe y no es el propio origen (salvo cambio de mayusculas): no se pisa ni se mezcla.
    if (existsSync(p.hacia) && !mismoSitio(p.hacia, p.desde) && p.tipo === 'carpeta') throw new OrganizarError(`Ya existe ${p.hacia}`);
    if (p.tipo === 'fichero' && existsSync(p.hacia) && !mismoSitio(p.hacia, p.desde)) throw new OrganizarError(`Ya existe ${p.hacia}`);
  }
}

/** Donde acaba una ruta tras los renombrados de carpeta (en orden de ejecucion). */
function trasCarpetas(ruta: string, carpetas: Paso[]): string {
  let r = ruta;
  for (const c of carpetas) if (r === c.desde || r.startsWith(c.desde + sep)) r = c.hacia + r.slice(c.desde.length);
  return r;
}

export function aplicarOrganizar(itemId: number, opciones: { edicion?: string | null } = {}): { movidos: number } {
  if (hayAlguienViendo()) throw new OrganizarError('Alguien está viendo algo: espera a que termine para mover ficheros de la biblioteca');
  if (escaneoEnCurso()) throw new OrganizarError('Hay un escaneo de la biblioteca en curso: espera a que termine');
  const it = itemDe(itemId);
  const plan = planOrganizar(itemId, opciones);
  if (plan.pasos.length === 0) return { movidos: 0 };

  const ficheros = plan.pasos.filter((p) => p.tipo === 'fichero');
  const carpetas = plan.pasos.filter((p) => p.tipo === 'carpeta');
  // Donde acaba cada fichero, y donde la carpeta del titulo (un video suelto deja de ser su propia «carpeta»).
  const mapa = new Map(ficheros.map((p) => [p.desde, trasCarpetas(p.hacia, carpetas)]));
  const remap = (r: string | null): string | null => (r == null ? r : mapa.get(r) ?? trasCarpetas(r, carpetas));
  const suelto = VIDEO.test(it.folder) || !existsSync(it.folder) || !statSync(it.folder).isDirectory();
  const carpetaNueva = suelto ? dirname(ficheros[0].hacia) : remap(it.folder)!;

  const hechos: Paso[] = [];
  try {
    for (const p of [...ficheros, ...carpetas]) {
      if (p.tipo === 'fichero') mkdirSync(dirname(p.hacia), { recursive: true });
      renameSync(p.desde, p.hacia);
      hechos.push(p);
    }
    actualizarBase(it, remap, carpetaNueva, plan.pasos.map((p) => p.desde));
  } catch (e) {
    for (const p of hechos.reverse()) { try { renameSync(p.hacia, p.desde); } catch { /* se deja constancia abajo */ } }
    throw e;
  }
  return { movidos: plan.pasos.length };
}

/** Todas las rutas que la base guarda de este titulo, a su nueva ubicacion; en una transaccion. */
export function actualizarBase(it: Item, remap: (r: string | null) => string | null, carpetaNueva: string, origenes: string[], libraryId?: number) {
  const ids = it.kind === 'movie'
    ? (db.prepare('SELECT id, path FROM media_files WHERE item_id = ?').all(it.id) as { id: number; path: string }[])
    : (db.prepare('SELECT f.id, f.path FROM media_files f JOIN episodes e ON e.id = f.episode_id WHERE e.show_id = ?').all(it.id) as { id: number; path: string }[]);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE items SET folder = ?, library_id = COALESCE(?, library_id) WHERE id = ?').run(carpetaNueva, libraryId ?? null, it.id);
    const arte = db.prepare('SELECT poster, fanart, clearlogo, landscape, discart FROM items WHERE id = ?').get(it.id) as Record<string, string | null>;
    for (const c of ['poster', 'fanart', 'clearlogo', 'landscape', 'discart']) {
      const nuevo = remap(arte[c]);
      if (nuevo !== arte[c]) db.prepare(`UPDATE items SET ${c} = ? WHERE id = ?`).run(nuevo, it.id);
    }
    for (const f of ids) {
      const nuevo = remap(f.path);
      if (nuevo !== f.path) db.prepare('UPDATE media_files SET path = ? WHERE id = ?').run(nuevo, f.id);
      for (const s of db.prepare('SELECT id, external FROM sub_tracks WHERE file_id = ? AND external IS NOT NULL').all(f.id) as { id: number; external: string }[]) {
        const n = remap(s.external);
        if (n !== s.external) db.prepare('UPDATE sub_tracks SET external = ? WHERE id = ?').run(n, s.id);
      }
    }
    if (it.kind === 'show') {
      for (const e of db.prepare('SELECT id, thumb FROM episodes WHERE show_id = ? AND thumb IS NOT NULL').all(it.id) as { id: number; thumb: string }[]) {
        const n = remap(e.thumb);
        if (n !== e.thumb) db.prepare('UPDATE episodes SET thumb = ? WHERE id = ?').run(n, e.id);
      }
    }
    for (const x of db.prepare('SELECT id, path FROM extras WHERE item_id = ?').all(it.id) as { id: number; path: string }[]) {
      const n = remap(x.path);
      if (n !== x.path) db.prepare('UPDATE extras SET path = ? WHERE id = ?').run(n, x.id);
    }
    // Los sellos de imagen de las rutas viejas ya no valen; el siguiente escaneo pone los nuevos.
    for (const o of origenes) db.prepare('DELETE FROM imagen_sello WHERE ruta = ?').run(o);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
