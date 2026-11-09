import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { deFuera } from './auth.ts';
import { aplicacion, aplicarDatos, buscarNuevos, busqueda, ejecutarLote, planesDeLoteMedidos, renombrado } from '../scanner/lote.ts';
import { hayAlguienViendoEn } from '../media/ocupado.ts';
import { claveValida, procesarAuto, type Deps, type ResultadoAuto } from '../scanner/servicio-auto.ts';

/*
 * Servicio para TorrentDWN (opción B). NO usa sesiones de usuario: se entra con una clave de servicio propia
 * (`servicioClave` en data/config.json; vacía = servicio apagado), solo desde la red de casa, y solo se pueden
 * pedir estas dos cosas. Las dos rutas están en ABIERTAS (index.ts) porque la clave se comprueba AQUÍ.
 */

const trabajos = new Map<string, ResultadoAuto & { en: string }>(); // última respuesta por carpeta
const enCurso = new Set<string>();
let fallos = 0;
let bloqueadoHasta = 0;

const depsReales: Deps = {
  ocupado: () => busqueda.corriendo || aplicacion.corriendo || renombrado.corriendo,
  buscar: async (ruta) => {
    await buscarNuevos([], [ruta]);
    if (busqueda.error) return { error: busqueda.error };
    const f = busqueda.resultados[busqueda.resultados.length - 1];
    if (!f) return {};
    return { fila: { itemId: f.itemId, titulo: f.titulo, confianza: f.confianza, tmdbId: f.propuesta?.tmdbId ?? null, propuesta: f.propuesta?.title ?? null } };
  },
  aplicar: async (itemId, tmdbId) => {
    await aplicarDatos([{ itemId, tmdbId }]);
    const r = aplicacion.resultados[aplicacion.resultados.length - 1];
    return { ok: Boolean(r?.ok), error: r?.error };
  },
  plan: async (itemId) => {
    const p = (await planesDeLoteMedidos([itemId]))[0];
    return { error: p?.error, pasos: (p?.pasos ?? []).map((s) => ({ desde: s.desde, hacia: s.hacia, final: s.final })) };
  },
  renombrar: async (itemId) => {
    const [r] = await ejecutarLote([itemId], { copiarArte: true, escribirNfo: true });
    return { ok: Boolean(r?.ok), error: r?.error, detalle: r?.detalle };
  },
  alguienViendo: (carpeta) => hayAlguienViendoEn(carpeta),
  carpetaDe: (itemId) => (db.prepare('SELECT folder FROM items WHERE id = ?').get(itemId) as { folder: string } | undefined)?.folder ?? null,
};

export default async function servicioRoutes(app: FastifyInstance) {
  const autorizar = (req: Parameters<typeof deFuera>[0] & { headers: Record<string, unknown> }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }): boolean => {
    if (!config.servicioClave) return (reply.code(503).send({ error: 'Servicio apagado' }), false);
    if (deFuera(req)) return (reply.code(403).send({ error: 'Solo accesible desde la red local' }), false);
    if (Date.now() < bloqueadoHasta) return (reply.code(429).send({ error: 'Demasiados intentos' }), false);
    if (!claveValida(String(req.headers['x-servicio-clave'] ?? ''), config.servicioClave)) {
      if (++fallos >= 5) { bloqueadoHasta = Date.now() + 10 * 60 * 1000; fallos = 0; }
      return (reply.code(401).send({ error: 'Clave de servicio no válida' }), false);
    }
    fallos = 0;
    return true;
  };

  // Pide procesar una carpeta (dentro de una fuente o biblioteca). Responde al instante; el resultado se consulta aparte.
  app.post('/api/servicio/torrdwn/procesar', async (req, reply) => {
    if (!autorizar(req as never, reply)) return;
    const ruta = String(((req.body ?? {}) as { ruta?: unknown }).ruta ?? '').trim();
    if (!ruta) return reply.code(400).send({ error: 'Falta la carpeta (ruta)' });
    const k = ruta.toLowerCase();
    if (enCurso.has(k)) return { started: false, motivo: 'ya se está procesando' };
    enCurso.add(k);
    trabajos.set(k, { estado: 'en_curso', en: new Date().toISOString() });
    void procesarAuto(ruta, { renombrar: config.servicioRenombrar === true }, depsReales)
      .then((r) => trabajos.set(k, { ...r, en: new Date().toISOString() }))
      .catch((e) => trabajos.set(k, { estado: 'error', error: (e as Error).message, en: new Date().toISOString() }))
      .finally(() => enCurso.delete(k));
    return { started: true };
  });

  app.get('/api/servicio/torrdwn/estado', async (req, reply) => {
    if (!autorizar(req as never, reply)) return;
    const ruta = String(((req.query ?? {}) as { ruta?: string }).ruta ?? '').trim().toLowerCase();
    return ruta ? (trabajos.get(ruta) ?? { estado: 'desconocido' }) : { renombrar: config.servicioRenombrar === true, trabajos: trabajos.size };
  });
}
