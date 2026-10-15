/**
 * Descargas para ver sin conexión.
 *
 * La entrega admite rangos porque en el móvil las descargas se cortan: sin
 * `Accept-Ranges` el gestor de descargas vuelve a empezar desde cero cada vez
 * que se va la wifi, que es exactamente la queja que tiene la gente con Plex.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileRow, permitidoParaUsuario } from './play.ts';
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth.ts';
import { parsearRango } from '../media/rango.ts';
import { borrar, listar, nombreFichero, pedir, una, PERFILES, type Perfil, type Codec } from '../media/descargas.ts';

export default async function descargaRoutes(app: FastifyInstance) {
  app.get('/api/descargas', async (req) => {
    const user = requireUser(req);
    return { perfiles: PERFILES, descargas: listar(user.id) };
  });

  app.post('/api/descargas', async (req, reply) => {
    const user = requireUser(req);
    const { fileId, perfil, codec } = req.body as { fileId?: number; perfil?: Perfil; codec?: Codec };
    if (!fileId) return reply.code(400).send({ error: 'Falta el fichero' });
    if (perfil !== 'baja' && perfil !== 'movil' && perfil !== 'tablet' && perfil !== 'fhd' && perfil !== 'original') {
      return reply.code(400).send({ error: 'Perfil desconocido' });
    }
    const codecFinal: Codec = codec === 'h264' ? 'h264' : 'h265';
    // Una copia descargada es el vídeo entero: un perfil infantil no puede pedirla de lo que no puede ver.
    const fila = fileRow(Number(fileId));
    if (fila && !permitidoParaUsuario(fila, user)) return reply.code(403).send({ error: 'Contenido no disponible para este perfil' });
    // Asíncrono primero: E: se duerme y despertarlo tarda ~7 s; `pedir` lo comprueba en síncrono y, con el
    // disco dormido, congelaba el servidor entero ese rato.
    if (fila && !(await stat(fila.path).catch(() => null))) return reply.code(410).send({ error: 'El fichero ya no está en disco' });
    try {
      return pedir(user.id, fileId, perfil, codecFinal);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/api/descargas/:id', async (req, reply) => {
    const user = requireUser(req);
    try {
      return borrar(user.id, Number((req.params as { id: string }).id));
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.get('/api/descargas/:id/fichero', async (req, reply) => {
    const user = requireUser(req);
    const d = una(Number((req.params as { id: string }).id));
    if (!d || d.user_id !== user.id) return reply.code(404).send({ error: 'Descarga no encontrada' });
    // Asíncrono: con el perfil «original» la ruta es el fichero de E:, que puede estar dormido (~7 s).
    const st = d.estado === 'lista' && d.ruta ? await stat(d.ruta).catch(() => null) : null;
    if (!st || !d.ruta) {
      return reply.code(409).send({ error: 'La copia todavía no está lista' });
    }
    const tipo = d.ruta.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';

    reply
      .header('Content-Type', tipo)
      .header('Accept-Ranges', 'bytes')
      // El asterisco con UTF-8 es lo que hace que un título con tildes llegue bien.
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nombreFichero(d))}`);

    const rango = parsearRango(req.headers.range, st.size);
    if (rango === null) return reply.code(416).header('Content-Range', `bytes */${st.size}`).send();
    if (rango) {
      const { desde, hasta } = rango;
      return reply
        .code(206)
        .header('Content-Range', `bytes ${desde}-${hasta}/${st.size}`)
        .header('Content-Length', hasta - desde + 1)
        .send(createReadStream(d.ruta, { start: desde, end: hasta }));
    }

    return reply.header('Content-Length', st.size).send(createReadStream(d.ruta));
  });
}
