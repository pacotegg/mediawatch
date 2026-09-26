/**
 * Duplicar el estado de visionado entre Plex y Media Watch, en los dos
 * sentidos.
 *
 *   node src/cli/plex-sync.ts
 *
 * Es la versión repetible de la migración puntual del 13/09 (ver
 * MEDIAWATCH-PROYECTO.md), ampliada: al principio solo traía lo visto en Plex;
 * ahora también empuja hacia Plex lo que se vea únicamente en Media Watch, así
 * que da igual desde cuál de los dos se vea algo.
 *
 * PLEX → MEDIA WATCH se lee directamente de la base sqlite de Plex, de solo
 * lectura: Plex la deja en modo WAL, así que un lector más no le molesta
 * mientras escribe. No hace falta token para esto.
 *
 * MEDIA WATCH → PLEX sí necesita hablar con la API HTTP local de Plex
 * (`:/scrobble`, `:/progress`): escribir a mano en su sqlite mientras el
 * propio Plex la tiene abierta y cacheada en memoria es la forma segura de
 * corromperla. El token es el `.LocalAdminToken` que Plex deja en su carpeta
 * de datos para scripts locales — lo genera de nuevo cada vez que arranca el
 * servicio, así que se lee del fichero en cada pasada y nunca se guarda fijo.
 *
 * La cuenta 1 de Plex es siempre el dueño del servidor (la reserva para la
 * cuenta con la que se configuró por primera vez) y en Media Watch solo existe
 * un perfil, «Casa» (id 1): no hay que adivinar a qué usuario corresponde cada
 * cosa.
 *
 * El cruce entre las dos bases es por ruta de fichero: las dos apuntan al
 * mismo `E:\`, así que `media_parts.file` de Plex y `media_files.path` de
 * Media Watch son literalmente la misma cadena (comprobado a mano: coinciden
 * incluso con tildes, las dos guardan NFC). Lo que uno tiene y el otro no
 * tiene en su biblioteca simplemente no cruza, y se salta.
 *
 * Quién gana un conflicto: el que tenga `updated_at` más reciente, en
 * cualquiera de los dos sentidos. Después de empujar un cambio a Plex, su
 * propio `updated_at` queda al día, así que la próxima pasada ya no lo vuelve
 * a mandar.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { db } from '../db.ts';

const PLEX_DB =
  'C:/Users/HTPC/AppData/Local/Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db';
const PLEX_TOKEN_FILE = 'C:/Users/HTPC/AppData/Local/Plex Media Server/.LocalAdminToken';
const PLEX_BASE_URL = 'http://127.0.0.1:32400';
const PLEX_OWNER_ACCOUNT_ID = 1;
const TVWATCH_USER_ID = 1;
/*
 * Abrir el reproductor y cerrarlo a los dos segundos también deja un
 * `updated_at` fresquísimo con posición casi cero. Sin este suelo, esa
 * apertura accidental "gana" por fecha a una película ya vista de verdad en
 * el otro sitio y la deja marcada como "en progreso desde el principio".
 * Mismo umbral que ya usa el propio Media Watch para decidir qué entra en
 * "Continuar viendo" (`p.position > 60` en routes/library.ts): por debajo de
 * eso no se considera que haya empezado a verse.
 */
const POSICION_MINIMA_SEG = 60;

type FilaPlex = { view_offset: number | null; view_count: number; updated_at: number; file: string; duration: number | null };
type FilaRuta = { file: string; ratingKey: number; guid: string };
type FilaSettings = { guid: string; view_offset: number | null; view_count: number; updated_at: number };
type FilaProgreso = { item_id: number; episode_id: number | null; position: number; duration: number | null; watched: number; updated_at: string };

/**
 * Mismo upsert manual que `guardarProgreso` en routes/library.ts: la clave de
 * `progress` incluye `episode_id`, NULL en las películas, y SQLite no
 * considera iguales dos NULL en un `ON CONFLICT`. El operador `IS` sí.
 */
function guardarProgreso(itemId: number, episodeId: number | null, position: number, duration: number | null, watched: number, actualizadoIso: string) {
  const cambio = db
    .prepare(`UPDATE progress SET position = ?, duration = COALESCE(?, duration), watched = ?, updated_at = ?
               WHERE user_id = ? AND item_id = ? AND episode_id IS ?`)
    .run(position, duration, watched, actualizadoIso, TVWATCH_USER_ID, itemId, episodeId);

  if (cambio.changes === 0) {
    db.prepare(`INSERT INTO progress (user_id, item_id, episode_id, position, duration, watched, updated_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run(TVWATCH_USER_ID, itemId, episodeId, position, duration, watched, actualizadoIso);
  }
}

function traerTokenLocal(): string | null {
  try { return readFileSync(PLEX_TOKEN_FILE, 'utf8').trim(); } catch { return null; }
}

async function marcarEnPlex(token: string, ratingKey: number, watched: boolean, positionSec: number): Promise<void> {
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
  const resp = await fetch(url, { method, signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

function plexAMediaWatch(plex: DatabaseSync) {
  const vistos = plex
    .prepare(
      `SELECT mis.view_offset, mis.view_count, mis.updated_at, mp.file, mi.duration
         FROM metadata_item_settings mis
         JOIN metadata_items mi ON mi.guid = mis.guid
         JOIN media_items med ON med.metadata_item_id = mi.id
         JOIN media_parts mp ON mp.media_item_id = med.id
        WHERE mis.account_id = ?
          AND (mis.view_offset IS NOT NULL OR mis.view_count > 0)
          AND (mis.guid LIKE 'plex://movie/%' OR mis.guid LIKE 'plex://episode/%')`,
    )
    .all(PLEX_OWNER_ACCOUNT_ID) as unknown as FilaPlex[];

  // En un episodio, `media_files.item_id` es NULL — la serie a la que pertenece
  // sale de `episodes.show_id`, que es lo que de verdad pide `progress.item_id`.
  const buscarFichero = db.prepare(`
    SELECT COALESCE(f.item_id, e.show_id) AS item_id, f.episode_id, f.duration
      FROM media_files f LEFT JOIN episodes e ON e.id = f.episode_id
     WHERE f.path = ? COLLATE NOCASE`);
  const buscarProgreso = db.prepare('SELECT updated_at FROM progress WHERE user_id = ? AND item_id = ? AND episode_id IS ?');

  let actualizados = 0, sinCruzar = 0, masReciente = 0, ruido = 0;

  for (const fila of vistos) {
    const fichero = buscarFichero.get(fila.file) as { item_id: number; episode_id: number | null; duration: number | null } | undefined;
    if (!fichero) { sinCruzar++; continue; }

    const plexActualizado = fila.updated_at * 1000;
    const existente = buscarProgreso.get(TVWATCH_USER_ID, fichero.item_id, fichero.episode_id) as { updated_at: string } | undefined;
    if (existente && Date.parse(existente.updated_at) >= plexActualizado) { masReciente++; continue; }

    const duracion = fila.duration ? fila.duration / 1000 : fichero.duration;
    const enProgreso = fila.view_offset != null && fila.view_offset > 0;
    const posicion = enProgreso ? fila.view_offset! / 1000 : (duracion ?? 0);
    if (enProgreso && posicion <= POSICION_MINIMA_SEG) { ruido++; continue; }
    const visto = enProgreso ? 0 : 1;

    guardarProgreso(fichero.item_id, fichero.episode_id, posicion, duracion, visto, new Date(plexActualizado).toISOString());
    actualizados++;
  }

  return { total: vistos.length, actualizados, sinCruzar, masReciente, ruido };
}

async function mediaWatchAPlex(plex: DatabaseSync) {
  const token = traerTokenLocal();
  if (!token) return { total: 0, empujados: 0, sinToken: true, sinCruzar: 0, masReciente: 0, fallidos: 0, ruido: 0 };

  const rutas = plex
    .prepare(
      `SELECT mp.file, mi.id AS ratingKey, mi.guid
         FROM metadata_items mi
         JOIN media_items med ON med.metadata_item_id = mi.id
         JOIN media_parts mp ON mp.media_item_id = med.id
        WHERE mi.guid LIKE 'plex://movie/%' OR mi.guid LIKE 'plex://episode/%'`,
    )
    .all() as unknown as FilaRuta[];
  const porRuta = new Map(rutas.map((r) => [r.file.toLowerCase(), r]));

  const settings = plex
    .prepare('SELECT guid, view_offset, view_count, updated_at FROM metadata_item_settings WHERE account_id = ?')
    .all(PLEX_OWNER_ACCOUNT_ID) as unknown as FilaSettings[];
  const porGuid = new Map(settings.map((s) => [s.guid, s]));

  const rutaDePelicula = db.prepare('SELECT path FROM media_files WHERE item_id = ? AND episode_id IS NULL');
  const rutaDeEpisodio = db.prepare('SELECT path FROM media_files WHERE episode_id = ?');
  const progresoLocal = db
    .prepare('SELECT item_id, episode_id, position, duration, watched, updated_at FROM progress WHERE user_id = ?')
    .all(TVWATCH_USER_ID) as unknown as FilaProgreso[];

  let empujados = 0, sinCruzar = 0, masReciente = 0, fallidos = 0, ruido = 0;

  for (const p of progresoLocal) {
    const filaRuta = (p.episode_id != null ? rutaDeEpisodio.get(p.episode_id) : rutaDePelicula.get(p.item_id)) as { path: string } | undefined;
    const destino = filaRuta && porRuta.get(filaRuta.path.toLowerCase());
    if (!destino) { sinCruzar++; continue; }

    // Ver dos segundos y cerrar deja aquí mismo una fila con posición casi
    // cero y `updated_at` recién puesto: no es una señal real de "esto ya no
    // está visto", así que no debe poder tumbar un "visto" que ya hubiera en
    // Plex. Un "visto" confirmado (watched=1) sí cuenta siempre.
    if (!p.watched && p.position <= POSICION_MINIMA_SEG) { ruido++; continue; }

    const actual = porGuid.get(destino.guid);
    const plexActualizado = actual ? actual.updated_at * 1000 : 0;
    if (Date.parse(p.updated_at) <= plexActualizado) { masReciente++; continue; }

    const yaVisto = Boolean(actual && actual.view_offset == null && actual.view_count > 0);
    const posicionActual = actual?.view_offset != null ? actual.view_offset / 1000 : (yaVisto ? (p.duration ?? 0) : 0);
    if (Boolean(p.watched) === yaVisto && Math.abs(p.position - posicionActual) < 5) { masReciente++; continue; }

    try {
      await marcarEnPlex(token, destino.ratingKey, Boolean(p.watched), p.position);
      empujados++;
    } catch (err) {
      console.error(`  ! No se pudo marcar en Plex "${filaRuta!.path}": ${(err as Error).message}`);
      fallidos++;
    }
  }

  return { total: progresoLocal.length, empujados, sinToken: false, sinCruzar, masReciente, fallidos, ruido };
}

async function sincronizar() {
  const plex = new DatabaseSync(PLEX_DB, { readOnly: true, timeout: 5000 });
  try {
    const haciaMediaWatch = plexAMediaWatch(plex);
    const haciaPlex = await mediaWatchAPlex(plex);
    return { haciaMediaWatch, haciaPlex };
  } finally {
    plex.close();
  }
}

const { haciaMediaWatch: h1, haciaPlex: h2 } = await sincronizar();
console.log(
  `[${new Date().toISOString()}] Plex→Media Watch: ${h1.actualizados} actualizados, ${h1.sinCruzar} sin fichero, ${h1.masReciente} ya al día, ${h1.ruido} aperturas sin ver (de ${h1.total}). ` +
    (h2.sinToken
      ? 'Media Watch→Plex: sin token local (¿Plex parado?), no se ha empujado nada.'
      : `Media Watch→Plex: ${h2.empujados} empujados, ${h2.sinCruzar} sin fichero, ${h2.masReciente} ya al día, ${h2.ruido} aperturas sin ver, ${h2.fallidos} fallidos (de ${h2.total}).`),
);
