/**
 * Editar a mano los datos de un título (como el diálogo de editar de Plex): título, título de orden, título original, año,
 * lema, sinopsis, estudio, calificación por edades, géneros y saga.
 *
 * Todo lo editado queda en `campos_fijados` (una lista «,plot,genres,»): el escáner no lo pisa desde el .nfo, tampoco si se
 * dejó vacío a propósito. Antes de cambiar se toma la instantánea del scraper, así que se deshace con «Deshacer». Solo toca la
 * base de datos: el .nfo de la biblioteca no se toca nunca desde aquí.
 */
import { db, normalize } from '../db.ts';
import { tomarInstantanea } from './historial.ts';

export class MetadatosError extends Error {
  readonly codigo: number;
  constructor(mensaje: string, codigo = 400) {
    super(mensaje);
    this.codigo = codigo;
  }
}

type Texto = { etiqueta: string; max: number; obligatorio?: boolean; multilinea?: boolean };
const TEXTOS: Record<string, Texto> = {
  title: { etiqueta: 'El título', max: 200, obligatorio: true },
  sort_title: { etiqueta: 'El título de orden', max: 200 },
  original_title: { etiqueta: 'El título original', max: 200 },
  tagline: { etiqueta: 'El lema', max: 300 },
  plot: { etiqueta: 'La sinopsis', max: 5000, multilinea: true },
  studio: { etiqueta: 'El estudio', max: 200 },
  mpaa: { etiqueta: 'La calificación por edades', max: 30 },
  collection: { etiqueta: 'La saga', max: 120 },
};
const CAMPOS = [...Object.keys(TEXTOS), 'year', 'genres'];
const MAX_GENEROS = 15;

function texto(campo: string, valor: unknown): string | null {
  const t = TEXTOS[campo];
  if (valor === null) {
    if (t.obligatorio) throw new MetadatosError(`${t.etiqueta} no puede quedar vacío`);
    return null;
  }
  if (typeof valor !== 'string') throw new MetadatosError(`${t.etiqueta} no es válido`);
  if (t.multilinea ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(valor) : /[\u0000-\u001f\u007f]/.test(valor)) {
    throw new MetadatosError(`${t.etiqueta} lleva caracteres no válidos`);
  }
  const limpio = t.multilinea ? valor.trim() : valor.trim().replace(/\s+/g, ' ');
  if (!limpio) {
    if (t.obligatorio) throw new MetadatosError(`${t.etiqueta} no puede quedar vacío`);
    return null;
  }
  if (limpio.length > t.max) throw new MetadatosError(`${t.etiqueta} es demasiado largo (máximo ${t.max})`);
  return limpio;
}

function anio(valor: unknown): number | null {
  if (valor === null || valor === '') return null;
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 1870 || valor > 2100) throw new MetadatosError('El año no es válido (1870-2100)');
  return valor;
}

function generos(valor: unknown): string[] {
  if (!Array.isArray(valor)) throw new MetadatosError('Los géneros tienen que ser una lista');
  if (valor.length > MAX_GENEROS) throw new MetadatosError(`Demasiados géneros (máximo ${MAX_GENEROS})`);
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const g of valor) {
    if (typeof g !== 'string' || /[\u0000-\u001f\u007f]/.test(g)) throw new MetadatosError('Un género no es válido');
    const limpio = g.trim().replace(/\s+/g, ' ');
    if (!limpio) continue;
    if (limpio.length > 40) throw new MetadatosError('Un género es demasiado largo (máximo 40)');
    const k = limpio.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    salida.push(limpio);
  }
  return salida;
}

export type Cambios = Partial<Record<'title' | 'sort_title' | 'original_title' | 'tagline' | 'plot' | 'studio' | 'mpaa' | 'collection', string | null>> & { year?: number | null; genres?: string[] };

/** Valida TODO antes de tocar nada; devuelve los campos con su valor ya limpio. */
export function validarCambios(cuerpo: unknown): Cambios {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new MetadatosError('Faltan los datos a cambiar');
  const entrada = cuerpo as Record<string, unknown>;
  const claves = Object.keys(entrada);
  if (claves.length === 0) throw new MetadatosError('No hay nada que cambiar');
  const desconocidas = claves.filter((k) => !CAMPOS.includes(k));
  if (desconocidas.length) throw new MetadatosError(`Campo no editable: ${desconocidas.join(', ')}`);
  const salida: Record<string, unknown> = {};
  for (const k of claves) {
    if (k === 'year') salida.year = anio(entrada.year);
    else if (k === 'genres') salida.genres = generos(entrada.genres);
    else salida[k] = texto(k, entrada[k]);
  }
  return salida as Cambios;
}

const ETIQUETAS: Record<string, string> = {
  title: 'título', sort_title: 'título de orden', original_title: 'título original', year: 'año', tagline: 'lema', plot: 'sinopsis',
  studio: 'estudio', mpaa: 'edad', collection: 'saga', genres: 'géneros',
};

export function editarMetadatos(itemId: number, cuerpo: unknown): { campos: string[]; anterior: Record<string, unknown> } {
  const cambios = validarCambios(cuerpo);
  const it = db.prepare('SELECT title, sort_title, original_title, year, tagline, plot, studio, mpaa, collection, campos_fijados FROM items WHERE id = ?').get(itemId) as
    | (Record<string, unknown> & { campos_fijados: string | null }) | undefined;
  if (!it) throw new MetadatosError('El título ya no existe', 404);
  const campos = Object.keys(cambios);
  const anterior = Object.fromEntries(campos.filter((c) => c !== 'genres').map((c) => [c, it[c] ?? null]));

  tomarInstantanea(itemId, `Editar a mano: ${campos.map((c) => ETIQUETAS[c]).join(', ')}`);
  db.exec('BEGIN');
  try {
    const columnas = campos.filter((c) => c !== 'genres');
    if (columnas.length) {
      const sets = columnas.map((c) => `${c} = ?`);
      const valores = columnas.map((c) => (cambios as Record<string, unknown>)[c] ?? null);
      if (columnas.includes('title')) { sets.push('search_title = ?'); valores.push(normalize(String(cambios.title))); }
      db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...(valores as never[]), itemId);
    }
    if (cambios.genres) {
      db.prepare('DELETE FROM item_genres WHERE item_id = ?').run(itemId);
      const buscar = db.prepare('SELECT id FROM genres WHERE name = ? COLLATE NOCASE');
      const crear = db.prepare('INSERT INTO genres (name) VALUES (?) RETURNING id');
      const enlazar = db.prepare('INSERT OR IGNORE INTO item_genres (item_id, genre_id) VALUES (?,?)');
      for (const g of cambios.genres) {
        const fila = (buscar.get(g) as { id: number } | undefined) ?? (crear.get(g) as { id: number });
        enlazar.run(itemId, fila.id);
      }
    }
    const fijados = new Set(String(it.campos_fijados ?? '').split(',').filter(Boolean));
    for (const c of campos) fijados.add(c);
    db.prepare('UPDATE items SET campos_fijados = ? WHERE id = ?').run(`,${[...fijados].join(',')},`, itemId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { campos, anterior };
}
