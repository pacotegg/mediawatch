/*
 * Peticiones en curso. Con la tele en reposo los temporizadores se congelan: una petición empezada antes de
 * apagar se quedaba colgada al encender (la portada tardó 78 s el 21/11; hay «lentas» de horas en el registro).
 * Al volver a primer plano se cancelan las que empezaron antes del reposo, para repetirlas sin gastar intento.
 */
export interface Vuelo { ctrl: { abort(): void }; desde: number; despertada: boolean }

const enVuelo: Vuelo[] = [];
let ocultaDesde = 0;

export function registrar(ctrl: { abort(): void }, ahora = Date.now()): Vuelo {
  const v = { ctrl, desde: ahora, despertada: false };
  enVuelo.push(v);
  return v;
}

export function quitar(v: Vuelo | null) {
  if (!v) return;
  const i = enVuelo.indexOf(v);
  if (i >= 0) enVuelo.splice(i, 1);
}

export function alOcultar(ahora = Date.now()) {
  ocultaDesde = ahora;
}

/** Cancela las que empezaron antes del reposo. Devuelve cuántas. */
export function alVolver(): number {
  let n = 0;
  for (const v of enVuelo.slice()) {
    if (ocultaDesde && v.desde <= ocultaDesde && !v.despertada) {
      v.despertada = true;
      v.ctrl.abort();
      n++;
    }
  }
  return n;
}
