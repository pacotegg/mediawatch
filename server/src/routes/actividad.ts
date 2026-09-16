/**
 * La pestaña de actividad del administrador: quién está conectado, qué ve
 * cada aparato, mandarle un mensaje o pararle la reproducción. Lo de Plex.
 *
 * «Conectado» es un aparato con sesión que ha hablado con el servidor en las
 * últimas horas; «viendo» es un visionado con informe de progreso en el
 * último minuto y sin terminar. Los reproductores informan cada quince
 * segundos, así que un minuto sin noticias es que ha cerrado sin avisar.
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db.ts';
import { enviarMensaje, pedirParada } from '../media/avisos.ts';
import { sessions } from '../media/transcode.ts';
import { requireUser } from './auth.ts';
import { cortarAparato } from './play.ts';

/** Sin noticias más de esto, ya no está viendo. */
const VIENDO_MS = 75_000;
/** Un aparato que no ha hablado en un día no cuenta como conectado. */
const CONECTADO_MS = 24 * 3600_000;

/** Aparatos parados hace poco: su último informe de progreso aún los haría parecer «viendo». */
const paradosHace = new Map<string, number>();

export default async function actividadRoutes(app: FastifyInstance) {
  const soloAdmin = (req: Parameters<typeof requireUser>[0], reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const yo = requireUser(req);
    if (!yo.is_admin) { reply.code(403).send({ error: 'Solo un administrador' }); return false; }
    return true;
  };

  app.get('/api/actividad', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const desdeConectado = new Date(Date.now() - CONECTADO_MS).toISOString();
    const desdeViendo = new Date(Date.now() - VIENDO_MS).toISOString();

    const aparatos = db
      .prepare(`SELECT substr(s.token, 1, 8) AS sesion, s.device AS dispositivo, COALESCE(s.last_seen, s.created_at) AS ultimaVez,
                       u.id AS userId, u.name AS usuario, u.color, u.is_admin AS esAdmin
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE COALESCE(s.last_seen, s.created_at) >= ?
                ORDER BY COALESCE(s.last_seen, s.created_at) DESC`)
      .all(desdeConectado) as any[];

    const viendo = db
      .prepare(`SELECT p.sesion, p.user_id AS userId, p.position, p.duration, p.modo, p.cliente, p.started_at AS desde, p.updated_at,
                       i.id AS itemId, i.title AS titulo, i.kind, e.season, e.episode, e.title AS episodio, p.file_id AS fileId
                FROM playbacks p JOIN items i ON i.id = p.item_id LEFT JOIN episodes e ON e.id = p.episode_id
                WHERE p.updated_at >= ? AND p.finished = 0
                ORDER BY p.updated_at DESC`)
      .all(desdeViendo) as any[];

    // Lo que hay en marcha en ffmpeg ahora mismo, por aparato: dice si es
    // transcodificación de verdad, no lo que el plan decía al empezar.
    const transcodificando = new Map<string, string>();
    for (const s of sessions.values()) if (s.sesion) transcodificando.set(s.sesion, s.plan.mode);

    return aparatos.map((a) => {
      // El visionado de este aparato; si el cliente viejo no mandó sesión, el
      // más reciente del mismo perfil que no esté ya asignado.
      const paradoHace = Date.now() - (paradosHace.get(a.sesion) ?? 0);
      const v = paradoHace < 90_000 ? null : (viendo.find((x) => x.sesion === a.sesion) ?? viendo.find((x) => !x.sesion && x.userId === a.userId));
      return {
        ...a,
        viendo: v
          ? {
              itemId: v.itemId,
              fileId: v.fileId,
              titulo: v.titulo,
              episodio: v.season != null ? `T${v.season}E${v.episode}${v.episodio ? ' · ' + v.episodio : ''}` : null,
              posicion: v.position,
              duracion: v.duration,
              modo: transcodificando.get(a.sesion) ?? v.modo,
              cliente: v.cliente,
              desde: v.desde,
            }
          : null,
      };
    });
  });

  app.post('/api/actividad/:sesion/mensaje', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const { texto } = (req.body ?? {}) as { texto?: string };
    const limpio = String(texto ?? '').trim().slice(0, 300);
    if (!limpio) return reply.code(400).send({ error: 'No hay mensaje' });
    enviarMensaje((req.params as { sesion: string }).sesion, limpio);
    return { enviado: true };
  });

  /** Parar lo que ve un aparato: se corta el flujo ya, y se le avisa para que salga del reproductor. */
  app.post('/api/actividad/:sesion/parar', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const sesion = (req.params as { sesion: string }).sesion;
    pedirParada(sesion);
    cortarAparato(sesion);
    paradosHace.set(sesion, Date.now());
    return { parado: true };
  });

  /** Cerrar la sesión de un aparato: tendrá que volver a entrar con el PIN. */
  app.delete('/api/actividad/:sesion', async (req, reply) => {
    if (!soloAdmin(req, reply)) return;
    const sesion = (req.params as { sesion: string }).sesion;
    cortarAparato(sesion);
    const r = db.prepare('DELETE FROM sessions WHERE substr(token, 1, 8) = ?').run(sesion);
    return { cerradas: r.changes };
  });
}
