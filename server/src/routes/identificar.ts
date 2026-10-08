import type { FastifyInstance } from 'fastify';
import { config, MODO_PORTABLE } from '../config.ts';
import { db } from '../db.ts';
import { estadoIdentificacion, identificando, identificarPendientes } from '../scanner/identificar.ts';
import { requireUser } from './auth.ts';

const CATEGORIAS = ['TP', '7', '12', '16', '18'];

/** Identificacion automatica por nombre (MediaWatch Server). Solo administrador. */
export default async function identificarRoutes(app: FastifyInstance) {
  app.get('/api/identificar/estado', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    return { portable: MODO_PORTABLE, configurada: Boolean(config.tmdbApiKey), enCurso: identificando(), ...estadoIdentificacion() };
  });

  app.post('/api/identificar/ejecutar', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    if (!config.tmdbApiKey) return reply.code(400).send({ error: 'Falta la clave de API de TMDb' });
    if (identificando()) return { arrancado: false, motivo: 'Ya hay una identificacion en curso' };
    void identificarPendientes(500).catch((e) => console.error('[identificar]', (e as Error).message));
    return { arrancado: true };
  });

  // Titulos que TMDb no clasifica por edades: el administrador la pone a mano.
  app.post('/api/identificar/clasificacion', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    const { itemId, categoria } = (req.body ?? {}) as { itemId?: number; categoria?: string };
    if (!itemId || !categoria || !CATEGORIAS.includes(categoria)) {
      return reply.code(400).send({ error: `La clasificacion tiene que ser una de: ${CATEGORIAS.join(', ')}` });
    }
    const pais = config.tmdbLanguage.split('-')[1] ?? 'ES';
    const r = db.prepare("UPDATE items SET mpaa = ? WHERE id = ? AND meta_origen = 'tmdb'").run(`${pais}:${categoria}`, itemId);
    if (r.changes === 0) return reply.code(404).send({ error: 'Ese titulo no esta identificado' });
    return { ok: true };
  });
}
