/*
 * Copiar el arte elegido (data/artwork/<id>/) a la carpeta del titulo, con los nombres de tinyMediaManager.
 *
 * Para quien siga leyendo la biblioteca con otro programa (Plex con «usar activos locales», Jellyfin, Kodi). Es OPCIONAL y es
 * escritura en la biblioteca, asi que:
 *   - `planArteCarpeta` dice EXACTAMENTE que ficheros se crean y cuales se apartan, sin tocar nada;
 *   - `aplicarArteCarpeta` hace solo ese plan, y solo si nadie esta viendo algo;
 *   - lo que se sustituye no se borra: se aparta a `<raiz de la biblioteca>/_retirados/<fecha>/...` (el escaner no entra en `_*`);
 *   - cada fichero se escribe a `.parte` y se renombra, asi que una copia a medias nunca cuenta.
 * El servidor no lo necesita: sigue sirviendo el arte de data/artwork (`arte_fijado`).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { hayAlguienViendoEn } from '../media/ocupado.ts';

export type PapelCarpeta = 'poster' | 'fanart' | 'clearlogo' | 'landscape';
const PAPELES: PapelCarpeta[] = ['poster', 'fanart', 'clearlogo', 'landscape'];
export type PasoArte = { papel: PapelCarpeta; desde: string; hacia: string; retira: string | null };

export class ArteCarpetaError extends Error {}

const VIDEO = /\.(mkv|mp4|avi|m4v|mov|wmv|mpg|mpeg|ts|webm)$/i;
const dentroDeDatos = (ruta: string) => { const r = relative(DATA_DIR, ruta); return !r.startsWith('..') && r !== '' && !/^[a-z]:/i.test(r); };

export function planArteCarpeta(itemId: number): PasoArte[] {
  const it = db
    .prepare(`SELECT i.kind, i.folder, i.poster, i.fanart, i.clearlogo, i.landscape, l.path AS raiz
              FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?`)
    .get(itemId) as Record<string, string | null> | undefined;
  if (!it) throw new ArteCarpetaError('El título ya no existe');
  const carpeta = it.folder as string;
  if (VIDEO.test(carpeta)) throw new ArteCarpetaError('Este título es un vídeo suelto en la raíz, sin carpeta propia: no hay dónde dejar sus imágenes');
  if (!existsSync(carpeta)) throw new ArteCarpetaError('La carpeta del título no existe (¿el disco está desconectado?)');

  let base = '';
  if (it.kind === 'movie') {
    const v = db.prepare('SELECT path FROM media_files WHERE item_id = ? ORDER BY size DESC LIMIT 1').get(itemId) as { path: string } | undefined;
    if (!v) throw new ArteCarpetaError('El título no tiene vídeo registrado');
    base = basename(v.path, extname(v.path));
  }

  const ficheros = readdirSync(carpeta);
  const plan: PasoArte[] = [];
  for (const papel of PAPELES) {
    const desde = it[papel] as string | null;
    // Solo lo elegido/descargado por el servidor (data/); lo que ya esta en la carpeta es de la carpeta.
    if (!desde || !dentroDeDatos(desde) || !existsSync(desde)) continue;
    const ext = extname(desde).toLowerCase();
    const nombre = it.kind === 'movie' ? `${base}-${papel}${ext}` : `${papel}${ext}`;
    const hacia = join(carpeta, nombre);
    if (existsSync(hacia) && sonIguales(desde, hacia)) continue;
    // Lo que ya hay de ese papel con otro nombre (el video se recodifico y se renombro): se aparta para no dejar dos.
    const papelRe = new RegExp(`(^|-)${papel}\\d*\\.(jpe?g|png|webp)$`, 'i');
    const otro = existsSync(hacia) ? hacia : ficheros.map((f) => join(carpeta, f)).find((f) => papelRe.test(basename(f)) && f !== hacia) ?? null;
    plan.push({ papel, desde, hacia, retira: otro });
  }
  return plan;
}

function sonIguales(a: string, b: string): boolean {
  try {
    return statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

export function aplicarArteCarpeta(itemId: number): { escritos: string[]; retirados: string[] } {
  const raiz = (db.prepare('SELECT l.path FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?').get(itemId) as { path: string }).path;
  if (hayAlguienViendoEn(raiz)) throw new ArteCarpetaError('Alguien está viendo algo: espera a que termine para escribir en la biblioteca');
  const plan = planArteCarpeta(itemId);
  const dia = new Date().toISOString().slice(0, 10);
  const escritos: string[] = [];
  const retirados: string[] = [];
  for (const p of plan) {
    if (p.retira) {
      let destino = join(raiz, '_retirados', dia, relative(raiz, p.retira));
      if (existsSync(destino)) destino += `.${Date.now()}`;
      mkdirSync(dirname(destino), { recursive: true });
      renameSync(p.retira, destino);
      retirados.push(destino);
    }
    const parte = p.hacia + '.parte';
    copyFileSync(p.desde, parte);
    renameSync(parte, p.hacia);
    escritos.push(p.hacia);
  }
  return { escritos, retirados };
}
