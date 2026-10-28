/*
 * Registro técnico de la tele, el mismo que manda Android desde la 3.36 (`POST /api/cliente/log`, plataforma «tele»).
 *
 * La tele es lo que más se usa y, hasta el 28/10/2026, cuando algo fallaba ahí no quedaba nada que mirar en el
 * servidor. Aquí solo se apunta: las líneas esperan en localStorage (sobreviven a un cierre o a un fallo antes de
 * poder mandarlas) y `api.ts` las envía. Sin dependencias, para que cualquier módulo pueda apuntar sin ciclos.
 */
const CLAVE = 'tvwatch.registro';
const CLAVE_APARATO = 'tvwatch.aparato';
const MAX = 200;

let cola: string[] = [];
try {
  const crudo = localStorage.getItem(CLAVE);
  if (crudo) cola = JSON.parse(crudo) as string[];
} catch (e) {
  cola = [];
}

function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(cola)); } catch (e) { /* lleno o sin almacenamiento */ }
}

/** Una línea, con fecha y hora local. Sin tokens: las direcciones se pasan por `sinToken`. */
export function apuntar(texto: string) {
  const d = new Date();
  const dos = (n: number) => (n < 10 ? '0' + n : String(n));
  const sello = d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes()) + ':' + dos(d.getSeconds());
  cola.push(sello + ' ' + sinToken(texto).slice(0, 900));
  if (cola.length > MAX) cola = cola.slice(cola.length - MAX);
  guardar();
}

export function sinToken(texto: string): string {
  return String(texto).replace(/token=[^&\s"']+/g, 'token=oculto');
}

export function pendientes(): string[] {
  return cola.slice(0, MAX);
}

/** Quita las `n` primeras, ya recibidas por el servidor. */
export function confirmar(n: number) {
  cola = cola.slice(n);
  guardar();
}

/** Identificador inventado y fijo de esta instalación (no el DUID de la tele). */
export function idAparato(): string {
  try {
    let id = localStorage.getItem(CLAVE_APARATO);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
      localStorage.setItem(CLAVE_APARATO, id);
    }
    return id;
  } catch (e) {
    return 'sin-id';
  }
}
