/**
 * Cabecera `Range` de una sola franja, para las tres rutas que sirven ficheros.
 *
 * - `undefined`: no hay rango o no se entiende; se sirve el fichero entero
 *   (es lo que manda la RFC 9110 ante un rango mal formado).
 * - `null`: el rango cae fuera del fichero; toca un 416.
 *
 * Antes cada ruta lo parseaba a su manera y `bytes=-500` («los ultimos 500»)
 * servia los 500 primeros, y un final pasado del tamano mandaba un
 * `Content-Length` falso.
 */
export function parsearRango(cabecera: string | undefined, tamano: number): { desde: number; hasta: number } | null | undefined {
  if (!cabecera) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecera.trim());
  if (!m || (m[1] === '' && m[2] === '')) return undefined;

  if (m[1] === '') {
    const ultimos = Number(m[2]);
    if (ultimos === 0 || tamano === 0) return null;
    return { desde: Math.max(0, tamano - ultimos), hasta: tamano - 1 };
  }

  const desde = Number(m[1]);
  if (desde >= tamano) return null;
  const hasta = m[2] === '' ? tamano - 1 : Math.min(Number(m[2]), tamano - 1);
  if (hasta < desde) return undefined;
  return { desde, hasta };
}
