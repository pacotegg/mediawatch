/**
 * Cambiar o quitar la saga (colección) de un título desde el editor.
 *
 * El escáner reescribe `collection` desde el .nfo en cada pasada, y con `meta_origen` 'tmdb' o 'servidor' un valor del .nfo
 * gana sobre el nuestro, así que quitar una saga no se sostenía (el .nfo la volvía a poner). `coleccion_fijada = 1` hace que
 * el escáner respete lo que se puso a mano, incluido «sin saga». Antes de cambiar se toma la instantánea del scraper: se
 * puede deshacer desde ahí. Solo toca la base de datos; el .nfo de la biblioteca no se toca.
 */
import { db } from '../db.ts';
import { tomarInstantanea } from './historial.ts';

export class ColeccionError extends Error {
  readonly codigo: number;
  constructor(mensaje: string, codigo = 400) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/** `null` quita la saga; un texto la asigna (recortado y sin espacios dobles). */
export function ponerColeccion(itemId: number, nombre: unknown): { anterior: string | null; coleccion: string | null } {
  const it = db.prepare('SELECT collection, coleccion_fijada FROM items WHERE id = ?').get(itemId) as { collection: string | null; coleccion_fijada: number } | undefined;
  if (!it) throw new ColeccionError('El título ya no existe', 404);
  let nuevo: string | null;
  if (nombre === null) nuevo = null;
  else if (typeof nombre === 'string') {
    if (/[\u0000-\u001f\u007f]/.test(nombre)) throw new ColeccionError('El nombre de la saga lleva caracteres no válidos');
    nuevo = nombre.trim().replace(/\s+/g, ' ');
    if (!nuevo) throw new ColeccionError('Falta el nombre de la saga');
    if (nuevo.length > 120) throw new ColeccionError('El nombre de la saga es demasiado largo (máximo 120)');
  } else throw new ColeccionError('El nombre de la saga no es válido');

  if (it.coleccion_fijada === 1 && (it.collection ?? null) === nuevo) return { anterior: it.collection, coleccion: nuevo };
  tomarInstantanea(itemId, `Saga: «${it.collection ?? 'sin saga'}» -> «${nuevo ?? 'sin saga'}»`);
  db.prepare('UPDATE items SET collection = ?, coleccion_fijada = 1 WHERE id = ?').run(nuevo, itemId);
  return { anterior: it.collection, coleccion: nuevo };
}
