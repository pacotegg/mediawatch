import type { FastifyInstance } from 'fastify';
import { config, saveConfig } from '../config.ts';
import { estadoLicenciaServidor, parsearYVerificarLicencia } from '../media/licencia.ts';
import { requireUser } from './auth.ts';

export default async function licenciaRoutes(app: FastifyInstance) {
  /**
   * Consulta el estado de la licencia del servidor (tier, validez y funciones activas).
   * Requiere sesión activa.
   */
  app.get('/api/licencia', async (req) => {
    requireUser(req);
    return estadoLicenciaServidor();
  });

  /**
   * Aplica o actualiza una clave de licencia en el servidor.
   * Solo administradores.
   */
  app.put('/api/licencia', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo administradores' });

    const body = req.body as { licenseKey?: string };
    const clave = String(body?.licenseKey ?? '').trim();
    if (!clave) {
      return reply.code(400).send({ error: 'Falta la clave de licencia' });
    }

    const resultado = parsearYVerificarLicencia(clave);
    if (!resultado.valid) {
      return reply.code(400).send({ error: resultado.error || 'Licencia no válida' });
    }

    config.licenseKey = clave;
    saveConfig(config);

    return { ok: true, licencia: resultado };
  });

  /**
   * Elimina la clave de licencia del servidor y vuelve al modo gratuito.
   * Solo administradores.
   */
  app.delete('/api/licencia', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo administradores' });

    delete config.licenseKey;
    saveConfig(config);

    return { ok: true, licencia: estadoLicenciaServidor() };
  });
}
