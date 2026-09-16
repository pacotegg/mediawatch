/**
 * Avisos del administrador a un aparato concreto: «cenamos en diez minutos»,
 * o parar lo que está viendo. Lo de Plex en la pestaña de actividad.
 *
 * Van por sesión (los ocho primeros caracteres del token, que es como se
 * identifica un aparato en toda la aplicación), no por perfil: si alguien
 * tiene el móvil y la tableta con el mismo perfil, el mensaje llega al que se
 * elige. Viven en memoria y se entregan una vez, cuando el aparato pregunta
 * en `/api/mando`, que los reproductores consultan cada cinco segundos.
 *
 * Un mensaje que nadie recoge en cinco minutos se tira: llegaría fuera de
 * contexto.
 */

const CADUCA_MS = 5 * 60_000;

type Aviso = { texto: string; enviado: number };

const mensajes = new Map<string, Aviso[]>();
const paradas = new Map<string, number>();

export function enviarMensaje(sesion: string, texto: string) {
  const lista = mensajes.get(sesion) ?? [];
  lista.push({ texto, enviado: Date.now() });
  mensajes.set(sesion, lista);
}

export function pedirParada(sesion: string) {
  paradas.set(sesion, Date.now());
}

/** Lo que hay para este aparato; se lo lleva. */
export function recogerAvisos(sesion: string): { mensaje: string | null; parar: boolean } {
  const ahora = Date.now();
  const lista = (mensajes.get(sesion) ?? []).filter((a) => ahora - a.enviado < CADUCA_MS);
  mensajes.delete(sesion);
  const parar = (paradas.get(sesion) ?? 0) > ahora - CADUCA_MS;
  paradas.delete(sesion);
  return { mensaje: lista.length ? lista.map((a) => a.texto).join('\n') : null, parar };
}
