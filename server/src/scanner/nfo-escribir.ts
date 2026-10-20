/*
 * Escribir el NFO (formato Kodi, el que escribia tinyMediaManager) junto al video.
 *
 * Para que los datos VIAJEN con la carpeta: se prepara un titulo en una carpeta de entrada (C:\Videos), se mueve a la biblioteca (E:\) y el
 * escaneo de alli recupera todo del NFO y de las imagenes. Sin esto, lo escrapeado vive solo en la base de datos y al mover la carpeta
 * se perderia. Tambien lo lee cualquier otro programa que entienda NFO (Kodi, Jellyfin, el agente «Plex NFO»).
 *
 * Es escritura en la biblioteca, asi que, igual que `arte-carpeta.ts`: hay PLAN (que ficheros se crean y cuales se apartan), solo se aplica
 * ese plan, lo sustituido va a `<raiz>/_retirados/<fecha>/...` (nunca se borra) y cada fichero se escribe a `.parte` y se renombra.
 * Lo que se escribe sale de la base de datos y se comprueba contra el propio lector (`parseNfo`) en las pruebas.
 *
 *   pelicula  `<nombre del video>.nfo`        serie  `tvshow.nfo` + un `<episodio>.nfo` por cada episodio
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { db } from '../db.ts';
import { hayAlguienViendo } from '../media/ocupado.ts';

export type PasoNfo = { tipo: 'pelicula' | 'serie' | 'episodio'; hacia: string; retira: string | null; xml: string };
export class NfoError extends Error {}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const etiqueta = (nombre: string, valor: unknown, sangria = '  ') => (valor == null || valor === '' ? '' : `${sangria}<${nombre}>${esc(valor)}</${nombre}>\n`);
const lista = (nombre: string, valores: string[]) => valores.map((v) => etiqueta(nombre, v)).join('');
const partes = (s: string | null) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** `2026-10-20T10:30:00` (de un .nfo, sin zona) tal cual; un instante UTC (`...Z`), a la hora local como la escribe tMM. */
function fechaAlta(iso: string | null): string | null {
  if (!iso) return null;
  if (!/Z$|[+-]\d\d:\d\d$/.test(iso)) return iso.slice(0, 19).replace('T', ' ');
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

type Fila = Record<string, any>;

function valoraciones(itemId: number, it: Fila): string {
  const filas = db.prepare('SELECT fuente, valor, maximo, votos FROM item_ratings WHERE item_id = ? ORDER BY fuente').all(itemId) as Fila[];
  if (filas.length === 0 && it.rating == null) return '';
  const lista = filas.length ? filas : [{ fuente: 'default', valor: it.rating, maximo: 10, votos: it.votes ?? 0 }];
  const principal = lista.find((r) => r.fuente === 'imdb') ?? lista.find((r) => r.fuente === 'themoviedb') ?? lista[0];
  return `  <ratings>\n${lista.map((r) => `    <rating name="${esc(r.fuente)}" max="${r.maximo}" default="${r === principal}">\n      <value>${r.valor}</value>\n      <votes>${r.votos ?? 0}</votes>\n    </rating>\n`).join('')}  </ratings>\n`;
}

function gente(itemId: number): string {
  const filas = db.prepare(`SELECT p.name, ip.role, ip.character, ip.ord FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = ?
                            ORDER BY CASE ip.role WHEN 'actor' THEN 0 WHEN 'director' THEN 1 ELSE 2 END, ip.ord, p.name`).all(itemId) as Fila[];
  let s = '';
  for (const f of filas.filter((x) => x.role === 'director')) s += etiqueta('director', f.name);
  for (const f of filas.filter((x) => x.role === 'writer')) s += etiqueta('credits', f.name);
  for (const f of filas.filter((x) => x.role === 'actor')) {
    s += `  <actor>\n    <name>${esc(f.name)}</name>\n${f.character ? `    <role>${esc(f.character)}</role>\n` : ''}${f.ord != null ? `    <order>${f.ord}</order>\n` : ''}  </actor>\n`;
  }
  return s;
}

function datosTecnicos(fileId: number): string {
  const f = db.prepare('SELECT width, height, duration, video_codec, hdr FROM media_files WHERE id = ?').get(fileId) as Fila | undefined;
  if (!f || !f.width) return '';
  const audios = db.prepare('SELECT codec, language, channels FROM audio_tracks WHERE file_id = ? ORDER BY idx').all(fileId) as Fila[];
  return `  <fileinfo>\n    <streamdetails>\n      <video>\n${etiqueta('codec', f.video_codec, '        ')}${etiqueta('width', f.width, '        ')}${etiqueta('height', f.height, '        ')}`
    + `${f.duration ? etiqueta('durationinseconds', Math.round(f.duration), '        ') : ''}${etiqueta('hdrtype', f.hdr, '        ')}      </video>\n`
    + audios.map((a) => `      <audio>\n${etiqueta('codec', a.codec, '        ')}${etiqueta('language', a.language, '        ')}${a.channels ? etiqueta('channels', a.channels, '        ') : ''}      </audio>\n`).join('')
    + `    </streamdetails>\n  </fileinfo>\n`;
}

const CABECERA = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!--created by MediaWatch-->\n';

function cuerpoComun(itemId: number, it: Fila): string {
  const generos = (db.prepare('SELECT g.name FROM item_genres ig JOIN genres g ON g.id = ig.genre_id WHERE ig.item_id = ? ORDER BY ig.genre_id').all(itemId) as Fila[]).map((g) => g.name);
  return etiqueta('title', it.title) + etiqueta('originaltitle', it.original_title) + etiqueta('sorttitle', it.sort_title) + etiqueta('year', it.year)
    + valoraciones(itemId, it) + etiqueta('plot', it.plot) + (it.plot ? etiqueta('outline', it.plot) : '') + etiqueta('tagline', it.tagline) + etiqueta('runtime', it.runtime)
    + etiqueta('mpaa', it.mpaa) + etiqueta('certification', it.mpaa)
    + (it.imdb_id ? etiqueta('id', it.imdb_id) : '') + etiqueta('tmdbid', it.tmdb_id)
    + (it.tmdb_id ? `  <uniqueid type="tmdb" default="false">${esc(it.tmdb_id)}</uniqueid>\n` : '') + (it.imdb_id ? `  <uniqueid type="imdb" default="true">${esc(it.imdb_id)}</uniqueid>\n` : '')
    + lista('country', partes(it.country)) + etiqueta('premiered', it.premiered) + lista('genre', generos) + lista('studio', partes(it.studio))
    + (it.collection ? `  <set>\n    <name>${esc(it.collection)}</name>\n  </set>\n` : '') + gente(itemId) + etiqueta('dateadded', fechaAlta(it.added_at));
}

const itemDe = (itemId: number) => {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Fila | undefined;
  if (!it) throw new NfoError('El título ya no existe');
  return it;
};

export function generarNfoPelicula(itemId: number): string {
  const it = itemDe(itemId);
  const f = db.prepare('SELECT id FROM media_files WHERE item_id = ? ORDER BY size DESC LIMIT 1').get(itemId) as { id: number } | undefined;
  return `${CABECERA}<movie>\n${cuerpoComun(itemId, it)}${f ? datosTecnicos(f.id) : ''}</movie>\n`;
}

export function generarNfoSerie(itemId: number): string {
  return `${CABECERA}<tvshow>\n${cuerpoComun(itemId, itemDe(itemId))}</tvshow>\n`;
}

export function generarNfoEpisodio(episodeId: number): string {
  const e = db.prepare('SELECT e.*, s.title AS serie FROM episodes e JOIN items s ON s.id = e.show_id WHERE e.id = ?').get(episodeId) as Fila | undefined;
  if (!e) throw new NfoError('El episodio ya no existe');
  const f = db.prepare('SELECT id FROM media_files WHERE episode_id = ? LIMIT 1').get(episodeId) as { id: number } | undefined;
  const valor = e.rating != null ? `  <ratings>\n    <rating name="default" max="10" default="true">\n      <value>${e.rating}</value>\n      <votes>0</votes>\n    </rating>\n  </ratings>\n` : '';
  return `${CABECERA}<episodedetails>\n${etiqueta('title', e.title)}${etiqueta('showtitle', e.serie)}${etiqueta('season', e.season)}${etiqueta('episode', e.episode)}${valor}`
    + `${etiqueta('plot', e.plot)}${etiqueta('aired', e.aired)}${etiqueta('runtime', e.runtime)}${f ? datosTecnicos(f.id) : ''}</episodedetails>\n`;
}

const VIDEO = /\.(mkv|mp4|avi|m4v|mov|wmv|mpg|mpeg|ts|webm)$/i;
const leer = (r: string) => { try { return readFileSync(r, 'utf8'); } catch { return null; } };

export function planNfo(itemId: number): PasoNfo[] {
  const it = itemDe(itemId);
  const carpeta = it.folder as string;
  if (VIDEO.test(carpeta)) throw new NfoError('Este título es un vídeo suelto en la raíz, sin carpeta propia: organízalo primero');
  if (!existsSync(carpeta)) throw new NfoError('La carpeta del título no existe (¿el disco está desconectado?)');

  const pasos: PasoNfo[] = [];
  const poner = (tipo: PasoNfo['tipo'], dir: string, nombre: string, xml: string, otrosNfo: boolean) => {
    const hacia = join(dir, nombre);
    if (leer(hacia) === xml) return;
    // Otro .nfo suelto con otro nombre (de antes de renombrar): el escaner cogeria el primero que encuentre, asi que se aparta.
    const otro = existsSync(hacia) ? hacia
      : otrosNfo ? (readdirSync(dir).filter((n) => /\.nfo$/i.test(n) && n.toLowerCase() !== nombre.toLowerCase()).map((n) => join(dir, n))[0] ?? null) : null;
    pasos.push({ tipo, hacia, retira: otro, xml });
  };

  if (it.kind === 'movie') {
    const v = db.prepare('SELECT path FROM media_files WHERE item_id = ? ORDER BY size DESC LIMIT 1').get(itemId) as { path: string } | undefined;
    if (!v) throw new NfoError('El título no tiene vídeo registrado');
    if (dirname(v.path) !== carpeta) throw new NfoError('El vídeo no está directamente en la carpeta del título: se organiza a mano');
    poner('pelicula', carpeta, `${basename(v.path, extname(v.path))}.nfo`, generarNfoPelicula(itemId), true);
  } else {
    poner('serie', carpeta, 'tvshow.nfo', generarNfoSerie(itemId), false);
    const eps = db.prepare('SELECT e.id, f.path FROM episodes e JOIN media_files f ON f.episode_id = e.id WHERE e.show_id = ? ORDER BY e.season, e.episode').all(itemId) as { id: number; path: string }[];
    for (const e of eps) poner('episodio', dirname(e.path), `${basename(e.path, extname(e.path))}.nfo`, generarNfoEpisodio(e.id), false);
  }
  return pasos;
}

export function aplicarNfo(itemId: number): { escritos: string[]; retirados: string[] } {
  if (hayAlguienViendo()) throw new NfoError('Alguien está viendo algo: espera a que termine para escribir en la biblioteca');
  const plan = planNfo(itemId);
  const raiz = (db.prepare('SELECT l.path FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?').get(itemId) as { path: string }).path;
  const dia = new Date().toISOString().slice(0, 10);
  const escritos: string[] = [];
  const retirados: string[] = [];
  for (const p of plan) {
    if (p.retira) {
      let d = join(raiz, '_retirados', dia, relative(raiz, p.retira));
      if (existsSync(d)) d += `.${Date.now()}`;
      mkdirSync(dirname(d), { recursive: true });
      renameSync(p.retira, d);
      retirados.push(d);
    }
    const parte = p.hacia + '.parte';
    writeFileSync(parte, p.xml, 'utf8');
    renameSync(parte, p.hacia);
    escritos.push(p.hacia);
  }
  return { escritos, retirados };
}
