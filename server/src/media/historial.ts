/**
 * Historial de reproducción.
 *
 * `progress` solo guarda por dónde va cada uno ahora mismo, y se sobreescribe:
 * sirve para reanudar, no para saber qué se vio la semana pasada. Esto lleva la
 * cuenta aparte, una fila por sesión de visionado.
 *
 * El tiempo visto se acumula sumando los avances pequeños entre dos informes
 * del reproductor. Un salto grande es que alguien ha adelantado, no que haya
 * visto ese trozo, así que no cuenta: de otro modo bastaría con arrastrar la
 * barra hasta el final para «ver» una película entera.
 */
import { db } from '../db.ts';

/** Dos ratos separados por más de esto son dos sesiones, no una. */
const CORTE_SESION_MS = 30 * 60 * 1000;

/** Avance máximo que se cree de verdad entre dos informes seguidos. */
const SALTO_MAXIMO = 90;

const ahora = () => new Date().toISOString();

type Clave = { userId: number; itemId: number; episodeId?: number | null };

function sesionAbierta({ userId, itemId, episodeId }: Clave, margenMs: number) {
  const fila = db
    .prepare(
      `SELECT id, position, updated_at FROM playbacks
        WHERE user_id = ? AND item_id = ? AND episode_id IS ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, itemId, episodeId ?? null) as { id: number; position: number; updated_at: string } | undefined;

  if (!fila) return null;
  return Date.now() - Date.parse(fila.updated_at) <= margenMs ? fila : null;
}

/** Marca el arranque de una reproducción. Reutiliza la sesión si es una pausa corta. */
export function comenzar(
  datos: Clave & { fileId: number | null; duracion?: number | null; modo?: string; cliente?: string | null },
) {
  if (!datos.userId) return null;

  const abierta = sesionAbierta(datos, CORTE_SESION_MS);
  if (abierta) {
    db.prepare('UPDATE playbacks SET updated_at = ?, modo = COALESCE(?, modo) WHERE id = ?').run(ahora(), datos.modo ?? null, abierta.id);
    return abierta.id;
  }

  const t = ahora();
  const res = db
    .prepare(
      `INSERT INTO playbacks (user_id, item_id, episode_id, file_id, started_at, updated_at, position, seconds, duration, modo, cliente, finished)
       VALUES (?,?,?,?,?,?,0,0,?,?,?,0)`,
    )
    .run(datos.userId, datos.itemId, datos.episodeId ?? null, datos.fileId, t, t, datos.duracion ?? null, datos.modo ?? null, datos.cliente ?? null);
  return Number(res.lastInsertRowid);
}

/** Suma lo visto desde el informe anterior. Se llama desde `/api/progress`. */
export function avanzar(datos: Clave & { position: number; duracion?: number | null; vista?: boolean }) {
  if (!datos.userId) return;

  // Seis horas: una película larga con pausas largas sigue siendo la misma sesión.
  const abierta = sesionAbierta(datos, 6 * 60 * 60 * 1000);
  const id = abierta ? abierta.id : comenzar({ ...datos, fileId: null, duracion: datos.duracion });
  if (!id) return;

  const avance = abierta ? datos.position - abierta.position : 0;
  const visto = avance > 0 && avance <= SALTO_MAXIMO ? avance : 0;

  db.prepare(
    `UPDATE playbacks
        SET position = ?, seconds = seconds + ?, updated_at = ?,
            duration = COALESCE(?, duration),
            finished = CASE WHEN ? THEN 1 ELSE finished END
      WHERE id = ?`,
  ).run(datos.position, visto, ahora(), datos.duracion ?? null, datos.vista ? 1 : 0, id);
}

/** Nombre corto del cliente, para saber desde dónde se ve sin guardar el user-agent entero. */
export function nombreCliente(userAgent: string | undefined): string {
  if (!userAgent) return 'Desconocido';
  if (/tizen|smart-?tv|web0s|netcast/i.test(userAgent)) return 'Televisión';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ios/i.test(userAgent)) return 'iOS';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/chrome|chromium/i.test(userAgent)) return 'Chrome';
  if (/safari/i.test(userAgent)) return 'Safari';
  return 'Otro';
}
