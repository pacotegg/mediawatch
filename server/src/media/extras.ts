/**
 * Extras de un titulo: featurettes, tomas falsas, «cómo se hizo», escenas
 * eliminadas. Viven en subcarpetas de la pelicula o la serie -«Featurettes»,
 * «Behind the scenes», «Other», «Extras»- que el escaner salta a proposito,
 * porque no son la pelicula. Contados el 29/09/2026: 1.111 ficheros repartidos
 * por 126 titulos, que hasta ahora no se veian por ningun sitio.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';

const run = promisify(execFile);

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.webm', '.ts', '.m2ts']);

/** Carpetas donde tinyMediaManager y Plex dejan los extras. */
const CARPETAS: Record<string, string> = {
  'featurettes': 'Featurette',
  'featurette': 'Featurette',
  'behind the scenes': 'Cómo se hizo',
  'deleted scenes': 'Escenas eliminadas',
  'interviews': 'Entrevistas',
  'scenes': 'Escenas',
  'shorts': 'Cortos',
  'trailers': 'Tráilers',
  'extras': 'Extra',
  'extra': 'Extra',
  'other': 'Extra',
};

/** Y los mismos, puestos como sufijo del nombre junto a la pelicula. */
const SUFIJOS: [string, string][] = [
  ['-featurette', 'Featurette'],
  ['-behindthescenes', 'Cómo se hizo'],
  ['-deleted', 'Escenas eliminadas'],
  ['-interview', 'Entrevistas'],
  ['-scene', 'Escenas'],
  ['-short', 'Cortos'],
  ['-clip', 'Extra'],
  ['-trailer', 'Tráiler'],
  ['-other', 'Extra'],
];

export type Extra = {
  id: number;
  titulo: string;
  tipo: string;
  duration: number | null;
  size: number | null;
  /** «Temporada 3» cuando los extras vienen repartidos por temporada. */
  grupo: string | null;
};

const upsert = db.prepare(`
  INSERT INTO extras (item_id, path, titulo, tipo, size, duration, grupo, scanned_at)
  VALUES (?,?,?,?,?,?,?,?)
  ON CONFLICT(path) DO UPDATE SET
    item_id=excluded.item_id, titulo=excluded.titulo, tipo=excluded.tipo,
    size=excluded.size, grupo=excluded.grupo, scanned_at=excluded.scanned_at
  RETURNING id`);

/** «Season 3» -> «Temporada 3»; lo demas se deja como este en el disco. */
const nombreGrupo = (n: string | null) =>
  n ? n.replace(/^season\s*/i, 'Temporada ').replace(/^specials?$/i, 'Especiales') : null;

/**
 * El nombre de fichero, presentable: sin extension, sin el sufijo que marca el
 * tipo y sin el titulo de la pelicula delante, que ya se sabe cual es.
 */
function tituloDe(archivo: string, tituloItem: string): string {
  let n = basename(archivo, extname(archivo));
  for (const [suf] of SUFIJOS) {
    if (n.toLowerCase().endsWith(suf)) n = n.slice(0, -suf.length);
  }
  const sinTitulo = n.replace(new RegExp(`^${tituloItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–]?\\s*`, 'i'), '');
  return (sinTitulo.trim() || n.trim()).replace(/[._]+/g, ' ').trim();
}

function tipoDe(dir: string, archivo: string): string | null {
  const carpeta = CARPETAS[basename(dir).toLowerCase()];
  if (carpeta) return carpeta;
  const n = basename(archivo, extname(archivo)).toLowerCase();
  return SUFIJOS.find(([suf]) => n.endsWith(suf))?.[1] ?? null;
}

function listar(dir: string): { path: string; isDir: boolean; name: string }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name, path: join(dir, e.name), isDir: e.isDirectory(),
    }));
  } catch {
    return [];
  }
}

/**
 * Registra los extras de un titulo y devuelve cuantos hay. Se le pasa la
 * carpeta porque el item ya la tiene guardada, y asi sirve igual para una
 * pelicula que para una serie.
 */
export function indexarExtras(itemId: number, carpeta: string, tituloItem: string, now: string): number {
  if (!existsSync(carpeta)) return 0;
  const encontrados: string[] = [];

  /*
   * `heredado` es el tipo de la carpeta de extras en la que ya estamos. Dentro
   * de una puede haber otra division por temporadas -«Featurettes/Season 3» en
   * Breaking Bad-, y bajando un solo nivel se perdian 185 ficheros de los 1.111
   * contados el 29/09/2026. Con el tipo heredado a null no se baja: asi no se
   * recorre la serie entera buscando extras donde no los hay.
   */
  const mirar = (dir: string, heredado: string | null, grupo: string | null, hondura = 0) => {
    for (const e of listar(dir)) {
      if (e.isDir) {
        // Al bajar, la subcarpeta es el grupo: «Featurettes/Season 3».
        if (heredado && hondura < 3) mirar(e.path, heredado, grupo ?? e.name, hondura + 1);
        continue;
      }
      if (!VIDEO_EXT.has(extname(e.name).toLowerCase())) continue;
      const tipo = heredado ?? tipoDe(dir, e.name);
      if (!tipo) continue;
      let size: number | null = null;
      try {
        size = statSync(e.path).size;
      } catch {
        continue;
      }
      upsert.get(itemId, e.path, tituloDe(e.name, tituloItem), tipo, size, null, nombreGrupo(grupo), now);
      encontrados.push(e.path);
    }
  };

  // Los sufijos van junto a la pelicula; las carpetas, dentro.
  mirar(carpeta, null, null);
  for (const sub of listar(carpeta)) {
    if (!sub.isDir) continue;
    const tipo = CARPETAS[sub.name.toLowerCase()];
    if (tipo) {
      mirar(sub.path, tipo, null);
      continue;
    }
    /*
     * Y al reves: la carpeta de extras DENTRO de la de temporada, como
     * «Breaking Bad/Season 1/Featurettes». Las dos formas conviven en la misma
     * serie, asi que hay que mirar las dos.
     */
    for (const nieto of listar(sub.path)) {
      const tipoNieto = CARPETAS[nieto.name.toLowerCase()];
      // Aqui el grupo es la temporada que los contiene, no la carpeta de extras.
      if (nieto.isDir && tipoNieto) mirar(nieto.path, tipoNieto, sub.name);
    }
  }

  // Un extra borrado del disco no puede quedarse en la ficha.
  const vivos = new Set(encontrados.map((p) => p.toLowerCase()));
  for (const fila of db.prepare('SELECT id, path FROM extras WHERE item_id = ?').all(itemId) as { id: number; path: string }[]) {
    if (!vivos.has(fila.path.toLowerCase())) db.prepare('DELETE FROM extras WHERE id = ?').run(fila.id);
  }
  return encontrados.length;
}

export function extrasDe(itemId: number): Extra[] {
  return db
    .prepare('SELECT id, titulo, tipo, duration, size, grupo FROM extras WHERE item_id = ? ORDER BY tipo, grupo, titulo')
    .all(itemId) as Extra[];
}

export function extraPorId(id: number): { id: number; path: string; titulo: string } | undefined {
  return db.prepare('SELECT id, path, titulo FROM extras WHERE id = ?').get(id) as
    | { id: number; path: string; titulo: string }
    | undefined;
}

const CARPETA_MINIATURAS = join(DATA_DIR, 'extras-thumbs');

/**
 * Un fotograma del extra, cacheado. Se saca al 10 % de su duracion y no al
 * principio, que en estos suele ser negro o una claqueta.
 */
export async function miniatura(id: number): Promise<string | null> {
  const extra = extraPorId(id);
  if (!extra || !existsSync(extra.path)) return null;
  mkdirSync(CARPETA_MINIATURAS, { recursive: true });
  const destino = join(CARPETA_MINIATURAS, `${id}.jpg`);
  if (existsSync(destino)) return destino;

  const fila = db.prepare('SELECT duration FROM extras WHERE id = ?').get(id) as { duration: number | null };
  let segundos = fila?.duration ? fila.duration * 0.1 : 0;
  if (!segundos) {
    try {
      const { stdout } = await run(config.ffprobe, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', extra.path,
      ], { windowsHide: true });
      const d = Number(stdout.trim());
      if (d > 0) {
        db.prepare('UPDATE extras SET duration = ? WHERE id = ?').run(d, id);
        segundos = d * 0.1;
      }
    } catch {
      segundos = 5;
    }
  }

  try {
    await run(config.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-ss', String(Math.max(1, Math.round(segundos))),
      '-i', extra.path,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', '-y', destino,
    ], { windowsHide: true, timeout: 60_000 });
  } catch {
    return null;
  }
  return existsSync(destino) ? destino : null;
}
