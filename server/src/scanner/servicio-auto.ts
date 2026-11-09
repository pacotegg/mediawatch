import { dirname, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

/*
 * Vía máquina a máquina para TorrentDWN (opción B, 09/11/2026): cuando TorrentDWN deja un título en una carpeta,
 * pide aquí que se «escrapee» solo SI ESTÁ SEGURO. Lo dudoso NO se toca: se queda en la cola del Asistente a la
 * espera del clic de siempre. Este módulo solo DECIDE (las operaciones reales entran por `deps`), para poder
 * probar las reglas sin base de datos ni TMDb.
 *
 * Reglas:
 *  1. Solo se aplica la ficha con confianza «segura» (coincidencia por título+año con TMDb, la misma que el Asistente
 *     marca como segura). «probable», «dudosa» o «ninguna» -> estado `dudoso`/`sin_coincidencia`, sin tocar nada.
 *  2. Renombrar + arte + NFO es OPCIONAL (`servicioRenombrar`, apagado por defecto) y solo si el plan es SEGURO:
 *     todos los pasos son movimientos dentro de la carpeta de la biblioteca del título (nada cruza de carpeta
 *     ni de disco) y nadie está viendo algo.
 *  3. Si el Asistente está ocupado, no se pisa: `ocupado` (TorrentDWN reintenta luego).
 */

export type Confianza = 'segura' | 'probable' | 'dudosa' | 'ninguna';
export type FilaBusqueda = { itemId: number; titulo: string; confianza: Confianza; tmdbId: number | null; propuesta: string | null };
export type PasoPlan = { desde: string; hacia: string; final: string };

export type Estado = 'en_curso' | 'ocupado' | 'sin_video' | 'sin_coincidencia' | 'dudoso' | 'aplicado' | 'renombrado' | 'error';
export type ResultadoAuto = { estado: Estado; itemId?: number; titulo?: string; tmdbId?: number; confianza?: Confianza; propuesta?: string; detalle?: string; error?: string };

export type Deps = {
  ocupado: () => boolean;
  buscar: (ruta: string) => Promise<{ error?: string; fila?: FilaBusqueda }>;
  aplicar: (itemId: number, tmdbId: number) => Promise<{ ok: boolean; error?: string }>;
  plan: (itemId: number) => Promise<{ error?: string; pasos: PasoPlan[] }>;
  renombrar: (itemId: number) => Promise<{ ok: boolean; error?: string; detalle?: string }>;
  alguienViendo: (ruta: string) => boolean;
  carpetaDe: (itemId: number) => string | null;
};

/** ¿Todos los pasos del plan se quedan DENTRO de la carpeta que contiene al título (misma biblioteca, mismo disco)? */
export function pasosSeguros(pasos: PasoPlan[], carpetaTitulo: string): boolean {
  if (pasos.length === 0) return false;
  const raiz = resolve(dirname(carpetaTitulo)).toLowerCase();
  const dentro = (p: string) => {
    const r = resolve(p).toLowerCase();
    return r === raiz || r.startsWith(raiz + sep);
  };
  return pasos.every((p) => dentro(p.desde) && dentro(p.hacia) && dentro(p.final));
}

/** Comparación en tiempo constante de la clave de servicio (sin pistas por tiempo). */
export function claveValida(dada: string, esperada: string): boolean {
  if (!esperada || esperada.length < 24) return false;
  const a = Buffer.from(String(dada));
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function procesarAuto(ruta: string, opciones: { renombrar: boolean }, deps: Deps): Promise<ResultadoAuto> {
  if (deps.ocupado()) return { estado: 'ocupado', detalle: 'El Asistente está en marcha: se reintentará' };

  const busca = await deps.buscar(ruta);
  if (busca.error) return { estado: 'error', error: busca.error };
  const fila = busca.fila;
  if (!fila) return { estado: 'sin_video', detalle: 'No hay vídeo reconocible en esa carpeta' };

  const base = { itemId: fila.itemId, titulo: fila.titulo, confianza: fila.confianza, propuesta: fila.propuesta ?? undefined };
  if (fila.confianza === 'ninguna' || !fila.tmdbId) return { estado: 'sin_coincidencia', ...base };
  if (fila.confianza !== 'segura') return { estado: 'dudoso', ...base, tmdbId: fila.tmdbId };

  const aplicado = await deps.aplicar(fila.itemId, fila.tmdbId);
  if (!aplicado.ok) return { estado: 'error', ...base, tmdbId: fila.tmdbId, error: aplicado.error ?? 'No se pudo aplicar la ficha' };

  const hecho: ResultadoAuto = { estado: 'aplicado', ...base, tmdbId: fila.tmdbId };
  if (!opciones.renombrar) return hecho;

  // Renombrar + arte + NFO: solo con plan seguro y nadie viendo nada
  const carpeta = deps.carpetaDe(fila.itemId);
  if (!carpeta) return { ...hecho, detalle: 'Ficha aplicada; no se renombra (no se conoce la carpeta)' };
  if (deps.alguienViendo(carpeta)) return { ...hecho, detalle: 'Ficha aplicada; no se renombra porque alguien está viendo algo' };
  const plan = await deps.plan(fila.itemId);
  if (plan.error) return { ...hecho, detalle: `Ficha aplicada; no se renombra (${plan.error})` };
  if (plan.pasos.length === 0) return { ...hecho, detalle: 'Ficha aplicada; los nombres ya estaban bien' };
  if (!pasosSeguros(plan.pasos, carpeta)) return { ...hecho, detalle: 'Ficha aplicada; el renombrado sale de la carpeta de la biblioteca: queda esperando tu confirmación' };

  const r = await deps.renombrar(fila.itemId);
  if (!r.ok) return { ...hecho, detalle: `Ficha aplicada; el renombrado falló: ${r.error ?? 'error'}` };
  return { ...hecho, estado: 'renombrado', detalle: r.detalle };
}
