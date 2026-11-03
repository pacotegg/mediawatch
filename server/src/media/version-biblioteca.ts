/**
 * Un sello que cambia solo cuando la biblioteca cambia de verdad.
 *
 * Los clientes se guardan la portada en memoria —cinco minutos en Android y en
 * la tele— para que ir y volver sea instantáneo y el destacado no salte de
 * película cada vez. El precio era que lo que acababa de entrar no se veía
 * hasta cerrar la aplicación. Con este sello no hay que elegir entre las dos
 * cosas: el cliente lo pregunta al volver al primer plano (una respuesta de
 * treinta bytes) y solo tira lo guardado si no coincide con el suyo.
 *
 * Dos decisiones que importan:
 *
 * - **Vive en un fichero, no en memoria.** El servidor se reinicia a diario; un
 *   contador en memoria volvería a empezar y el cliente creería que la
 *   biblioteca no ha cambiado justo después de un reinicio.
 * - **Se marca solo cuando un escaneo encuentra cambios**, no en cada escaneo.
 *   Si no, la pasada de las 02:00 recargaría la portada de todos los aparatos
 *   cada noche sin motivo, y volvería el «destacado inquieto» que la caché de
 *   los clientes existe para evitar.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';

const ARCHIVO = join(DATA_DIR, 'version-biblioteca.txt');
let sello = '';

/** El sello de ahora. Sin fichero todavía vale `0`: el cliente recarga una vez y ya. */
export function versionBiblioteca(): string {
  if (sello) return sello;
  try {
    if (existsSync(ARCHIVO)) sello = readFileSync(ARCHIVO, 'utf-8').trim();
  } catch {
    /* ilegible: se trata como si no hubiera */
  }
  if (!sello) sello = '0';
  return sello;
}

/** La llaman los escaneos que han añadido o retirado algo. Devuelve el sello nuevo. */
export function marcarCambioBiblioteca(): string {
  sello = String(Date.now());
  try {
    writeFileSync(ARCHIVO, sello, 'utf-8');
  } catch {
    /* sin disco el sello vive en memoria hasta el próximo reinicio: peor es tumbar el escaneo por esto */
  }
  return sello;
}
