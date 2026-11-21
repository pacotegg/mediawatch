/**
 * Dónde reabrir la película tras un error de reproducción.
 *
 * Cuando AVPlay pierde la conexión (un corte de Wi-Fi, un reinicio del router),
 * `getCurrentTime()` falla o devuelve 0 y `Reproductor.tiempo()` cae al desfase
 * (0 en directo). Reabrir ahí manda la película al principio y, a los 15 s,
 * el guardado de progreso pisa la posición buena que había en el servidor.
 *
 * Se toma la mayor entre la lectura actual y la última posición buena que
 * llegó por `onTiempo`. Un salto a medias (`destinoSalto`) manda sobre las dos.
 */
export function posicionDeReintento(destinoSalto: number | null, tiempoActual: number, ultimaBuena: number): number {
  if (destinoSalto !== null) return Math.max(0, destinoSalto);
  return Math.max(0, tiempoActual, ultimaBuena);
}
