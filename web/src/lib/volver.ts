import type { NavigateFunction } from 'react-router-dom';

/**
 * Volver atrás sin salirse de la web: si la página se abrió directamente (un enlace, una recarga, la ficha
 * abierta desde fuera), no hay nada antes en la app y `navigate(-1)` sacaba de Media Watch o no hacía nada.
 * React Router guarda en `history.state.idx` cuántas páginas propias hay por detrás.
 */
export function volver(navigate: NavigateFunction, siNoHay: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate(siNoHay, { replace: true });
}
