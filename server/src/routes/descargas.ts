/**
 * Descargas para ver sin conexión.
 *
 * La entrega admite rangos porque en el móvil las descargas se cortan: sin
 * `Accept-Ranges` el gestor de descargas vuelve a empezar desde cero cada vez
 * que se va la wifi, que es exactamente la queja que tiene la gente con Plex.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { requireUser } from './auth.ts';
import { borrar, listar, nombreFichero, pedir, una, PERFILES, type Perfil } from '../media/descargas.ts';

export default async function descargaRoutes(app: FastifyInstance) {
  app.get('/api/descargas', async (req) => {
    const user = requireUser(req);
    return { perfiles: PERFILES, descargas: listar(user.id) };
  });

  app.post('/api/descargas', async (req, reply) => {
    const user = requireUser(req);
    const { fileId, perfil } = req.body as { fileId?: number; perfil?: Perfil };
    if (!fileId) return reply.code(400).send({ error: 'Falta el fichero' });
    if (perfil !== 'movil' && perfil !== 'tablet' && perfil !== 'original') {
      return reply.code(400).send({ error: 'Perfil desconocido' });
    }
    try {
      return pedir(user.id, fileId, perfil);
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
    if (d.estado !== 'lista' || !d.ruta || !existsSync(d.ruta)) {
      return reply.code(409).send({ error: 'La copia todavía no está lista' });
    }

    const stat = statSync(d.ruta);
    const tipo = d.ruta.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';

    reply
      .header('Content-Type', tipo)
      .header('Accept-Ranges', 'bytes')
      // El asterisco con UTF-8 es lo que hace que un título con tildes llegue bien.
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nombreFichero(d))}`);

    const rango = req.headers.range;
    if (rango) {
      const m = /bytes=(\d*)-(\d*)/.exec(rango);
      const desde = Number(m?.[1] || 0);
      const hasta = m?.[2] ? Number(m[2]) : stat.size - 1;
      return reply
        .code(206)
        .header('Content-Range', `bytes ${desde}-${hasta}/${stat.size}`)
        .header('Content-Length', hasta - desde + 1)
        .send(createReadStream(d.ruta, { start: desde, end: hasta }));
    }

    return reply.header('Content-Length', stat.size).send(createReadStream(d.ruta));
  });
}
