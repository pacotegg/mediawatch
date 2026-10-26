import { access } from 'node:fs/promises';
import { join, parse } from 'node:path';

const EXTENSIONES = ['.webp', '.jpg', '.jpeg', '.png'];

/**
 * El arte debería estar siempre en WebP, pero hay filas de la base anteriores a la conversión (`poster.jpg`
 * cuando en disco solo queda `poster.webp`) y ficheros que todavía no se han pasado. Si la ruta guardada no
 * existe, se busca su hermana con otra extensión, WebP primero. Solo se llama cuando falta el fichero: con
 * la ruta buena no cuesta ni un acceso más.
 */
export async function hermanaDeArte(ruta: string): Promise<string | null> {
  const { dir, name, ext } = parse(ruta);
  for (const e of EXTENSIONES) {
    if (e === ext.toLowerCase()) continue;
    const candidata = join(dir, name + e);
    try {
      await access(candidata);
      return candidata;
    } catch {
      /* siguiente */
    }
  }
  return null;
}
