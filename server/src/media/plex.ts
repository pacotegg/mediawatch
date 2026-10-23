/**
 * Integración bidireccional en tiempo real entre Plex y Media Watch.
 *
 * 1. Media Watch -> Plex: cada vez que el usuario principal guarda progreso en TvWatch,
 *    se notifica a la API local de Plex (/:/progress o /:/scrobble) en segundo plano.
 * 2. Plex -> Media Watch: endpoint Webhook (/api/plex/webhook) que recibe los eventos
 *    (media.pause, media.stop, media.scrobble) y actualiza TvWatch en milisegundos.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { db } from '../db.ts';

const PLEX_DB = 'C:/Users/HTPC/AppData/Local/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db';
const PLEX_TOKEN_FILE = 'C:/Users/HTPC/AppData/Local/Plex Media Server/.LocalAdminToken';
const PLEX_BASE_URL = 'http://127.0.0.1:32400';
const TVWATCH_USER_ID = 1;

let plexDbInstancia: DatabaseSync | null = null;
function getPlexDb(): DatabaseSync | null {
  if (plexDbInstancia) return plexDbInstancia;
  try {
    plexDbInstancia = new DatabaseSync(PLEX_DB, { readOnly: true });
    return plexDbInstancia;
  } catch {
    return null;
  }
}

export function traerTokenLocal(): string | null {
  try {
    return readFileSync(PLEX_TOKEN_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

export async function marcarEnPlex(token: string, ratingKey: number, watched: boolean, positionSec: number): Promise<void> {
  const params = new URLSearchParams({ key: String(ratingKey), identifier: 'com.plexapp.plugins.library', 'X-Plex-Token': token });
  let url: string;
  let method: string;
  if (watched) {
    url = `${PLEX_BASE_URL}/:/scrobble?${params}`;
    method = 'GET';
  } else {
    params.set('time', String(Math.round(positionSec * 1000)));
    params.set('state', 'stopped');
    url = `${PLEX_BASE_URL}/:/progress?${params}`;
    method = 'PUT';
  }
  const resp = await fetch(url, { method, signal: AbortSignal.timeout(3000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

/**
 * Busca el ratingKey de Plex para un fichero dado consultando la base de datos de Plex.
 */
export function buscarRatingKeyPlex(rutaFichero: string): number | null {
  const plex = getPlexDb();
  if (!plex) return null;
  try {
    const fila = plex.prepare(`
      SELECT mi.id AS ratingKey
        FROM media_parts mp
        JOIN media_items med ON med.id = mp.media_item_id
        JOIN metadata_items mi ON mi.id = med.metadata_item_id
       WHERE mp.file = ? COLLATE NOCASE
       LIMIT 1
    `).get(rutaFichero) as { ratingKey: number } | undefined;
    return fila?.ratingKey ?? null;
  } catch {
    return null;
  }
}

/**
 * Notifica a Plex el nuevo progreso alcanzado en Media Watch en segundo plano.
 * Fire-and-forget: captura cualquier fallo sin afectar a TvWatch.
 */
export function notificarProgresoAPlex(rutaFichero: string, positionSec: number, watched: boolean): void {
  const token = traerTokenLocal();
  if (!token) return;
  const ratingKey = buscarRatingKeyPlex(rutaFichero);
  if (!ratingKey) return;

  marcarEnPlex(token, ratingKey, watched, positionSec).catch((err) => {
    // Si Plex no está corriendo o responde lento, se ignora en silencio
  });
}

/**
 * Procesa un evento recibido vía Webhook desde Plex.
 */
export function procesarWebhookPlex(payload: any): { ok: boolean; motivo?: string } {
  if (!payload || typeof payload !== 'object') return { ok: false, motivo: 'payload vacio o invalido' };

  const event = String(payload.event ?? '');
  // Solo procesamos eventos relevantes de cambio de estado
  if (!['media.pause', 'media.stop', 'media.scrobble'].includes(event)) {
    return { ok: true, motivo: `evento ignorado (${event})` };
  }

  // Comprobar que sea el dueño del servidor (cuenta principal)
  const accountId = payload.Account?.id;
  if (accountId !== undefined && accountId !== 1) {
    return { ok: true, motivo: `cuenta no principal (${accountId})` };
  }

  const meta = payload.Metadata;
  if (!meta) return { ok: false, motivo: 'falta Metadata' };

  // Intentar obtener la ruta del fichero:
  // 1) Directamente de payload.Metadata.Media[0].Part[0].file
  // 2) Buscando por ratingKey en la BD local de Plex
  let rutaFichero: string | null = meta.Media?.[0]?.Part?.[0]?.file ?? null;
  if (!rutaFichero && meta.ratingKey) {
    const plex = getPlexDb();
    if (plex) {
      try {
        const fila = plex.prepare(`
          SELECT mp.file
            FROM media_items med
            JOIN media_parts mp ON mp.media_item_id = med.id
           WHERE med.metadata_item_id = ?
           LIMIT 1
        `).get(meta.ratingKey) as { file: string } | undefined;
        if (fila?.file) rutaFichero = fila.file;
      } catch {}
    }
  }

  if (!rutaFichero) return { ok: false, motivo: 'no se encontro ruta del fichero' };

  // Buscar el item en TvWatch
  const buscarFichero = db.prepare(`
    SELECT COALESCE(f.item_id, e.show_id) AS item_id, f.episode_id, f.duration
      FROM media_files f LEFT JOIN episodes e ON e.id = f.episode_id
     WHERE f.path = ? COLLATE NOCASE
  `);
  const fichero = buscarFichero.get(rutaFichero) as { item_id: number; episode_id: number | null; duration: number | null } | undefined;
  if (!fichero) return { ok: false, motivo: `fichero no catalogado en TvWatch (${rutaFichero})` };

  const duracion = meta.duration ? meta.duration / 1000 : fichero.duration;
  const esScrobble = event === 'media.scrobble';
  const viewOffsetMs = typeof meta.viewOffset === 'number' ? meta.viewOffset : 0;
  const posicion = esScrobble ? (duracion ?? 0) : viewOffsetMs / 1000;
  const visto = esScrobble ? 1 : 0;

  // Si no es scrobble y la posición es mínima (menos de 60 s), se ignora para no ensuciar
  if (!esScrobble && posicion <= 60) {
    return { ok: true, motivo: `posicion menor a 60s (${posicion.toFixed(1)}s)` };
  }

  const actualizadoIso = new Date().toISOString();

  // Guardar en la tabla progress de TvWatch (mismo upsert con IS)
  const cambio = db
    .prepare(`UPDATE progress SET position = ?, duration = COALESCE(?, duration), watched = ?, updated_at = ?
               WHERE user_id = ? AND item_id = ? AND episode_id IS ?`)
    .run(posicion, duracion, visto, actualizadoIso, TVWATCH_USER_ID, fichero.item_id, fichero.episode_id);

  if (cambio.changes === 0) {
    db.prepare(`INSERT INTO progress (user_id, item_id, episode_id, position, duration, watched, updated_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(TVWATCH_USER_ID, fichero.item_id, fichero.episode_id, posicion, duracion, visto, actualizadoIso);
  }

  return { ok: true, motivo: `progreso guardado (${posicion.toFixed(0)}s, visto=${visto})` };
}
