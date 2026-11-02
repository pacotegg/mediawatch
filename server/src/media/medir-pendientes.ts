/*
 * Mide con ffprobe los ficheros que nunca se han medido (probed = 0 o sin duración). Sin duración no hay barra de
 * progreso, ni reanudar, ni «Seguir viendo» hasta la primera reproducción: el 28/10/2026 eran 197, entre ellos los
 * cinco episodios de Chernobyl. Solo lee cabeceras de E: y espera mientras alguien está viendo algo.
 *
 * Desde el 01/11/2026 la llama también el servidor al acabar cada escaneo: un fichero sustituido se quedaba con lo
 * del .nfo viejo hasta reproducirlo («Freddy contra Jason» salía 2160p SDR siendo 1632p HDR10). Antes solo lo hacía
 * a mano src/cli/medir-pendientes.ts.
 */
import { db } from '../db.ts';
import { mediaInfo } from './probe.ts';
import { hayAlguienViendo } from './ocupado.ts';

export type ResultadoMedir = { total: number; bien: number; sinDuracion: number; fallos: number; segundos: number };

let midiendo = false;

/**
 * `soloBiblioteca`: solo lo que se ve en la biblioteca (el servidor tras escanear). Las carpetas de entrada del scraper
 * pueden tener ficheros que ya no existen y fallarían en cada pasada. El CLI lo mide todo, como siempre.
 * Devuelve null si ya hay una medición en marcha.
 */
export async function medirPendientes(opciones: { soloBiblioteca?: boolean; log?: (texto: string) => void } = {}): Promise<ResultadoMedir | null> {
  if (midiendo) return null;
  midiendo = true;
  const log = opciones.log ?? ((t: string) => console.log(t));
  try {
    const tabla = opciones.soloBiblioteca ? 'media_files_biblioteca' : 'media_files';
    const pendientes = db.prepare(`SELECT id, path FROM ${tabla} WHERE probed = 0 OR duration IS NULL ORDER BY id`).all() as { id: number; path: string }[];
    const t0 = Date.now();
    let bien = 0, sinDuracion = 0, fallos = 0;
    if (pendientes.length) log(`[medir] ${pendientes.length} ficheros pendientes`);
    for (const [i, f] of pendientes.entries()) {
      while (hayAlguienViendo()) {
        log('[medir] alguien está viendo algo: espero 60 s');
        await new Promise((r) => setTimeout(r, 60_000));
      }
      try {
        const info = await mediaInfo(f.id);
        if (info.duration > 0) bien++;
        else { sinDuracion++; log(`[medir] sin duración: ${f.id} ${f.path}`); }
      } catch (e) {
        fallos++;
        log(`[medir] fallo ${f.id} ${f.path}: ${(e as Error).message}`);
      }
      if ((i + 1) % 20 === 0) log(`[medir] ${i + 1}/${pendientes.length}`);
    }
    const r = { total: pendientes.length, bien, sinDuracion, fallos, segundos: Math.round((Date.now() - t0) / 1000) };
    if (pendientes.length) log(`[medir] terminado en ${r.segundos} s: ${bien} medidos, ${sinDuracion} sin duración, ${fallos} fallos`);
    return r;
  } finally {
    midiendo = false;
  }
}
