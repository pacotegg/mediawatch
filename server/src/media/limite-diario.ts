/**
 * Límite diario de tiempo para un perfil (pensado para los infantiles): minutos al día, o nada.
 *
 * Se cuenta con lo que ya registra `playbacks.seconds` (los segundos vistos de verdad, sin los saltos), en
 * todos los aparatos a la vez, desde la medianoche de la hora del servidor. Al agotarse: no se puede empezar
 * nada (`/api/play/.../info`, el flujo y la lista HLS dan 403) y lo que esté en marcha se para con la orden
 * «parar» del mando, que web, tele y Android ya obedecen.
 */
import { db } from '../db.ts';

/** La medianoche de hoy en la hora local del servidor, en ISO (UTC) para comparar con `updated_at`. */
export function medianocheLocal(ahora = new Date()): string {
  const m = new Date(ahora);
  m.setHours(0, 0, 0, 0);
  return m.toISOString();
}

export function minutosVistosHoy(userId: number, ahora = new Date()): number {
  const r = db
    .prepare('SELECT COALESCE(SUM(seconds), 0) AS s FROM playbacks WHERE user_id = ? AND updated_at >= ?')
    .get(userId, medianocheLocal(ahora)) as { s: number };
  return r.s / 60;
}

export type EstadoLimite = { limite: number; vistos: number; agotado: boolean } | null;

export function estadoLimite(userId: number): EstadoLimite {
  const u = db.prepare('SELECT limite_diario_min AS l FROM users WHERE id = ?').get(userId) as { l: number | null } | undefined;
  if (!u || u.l === null || u.l === undefined) return null;
  const vistos = minutosVistosHoy(userId);
  return { limite: u.l, vistos: Math.floor(vistos), agotado: vistos >= u.l };
}

export const MENSAJE_LIMITE = 'Se ha acabado el tiempo de hoy. ¡Mañana más!';
