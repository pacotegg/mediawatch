/**
 * Etiqueta de la ficha para una calificación «sin calificar» (`NR` en la base). Es la única que se resuelve aquí: el resto
 * (7, 12, 16, 18, PG-13…) las calcula `generarAvisoEdad` de main.ts. Devuelve `null` para cualquier otro valor.
 */
export function etiquetaNR(mpaa: string | null | undefined, esEspanol: boolean): string | null {
  if ((mpaa || '').trim().toUpperCase() !== 'NR') return null;
  return esEspanol ? 'Sin calificación' : 'NR';
}
