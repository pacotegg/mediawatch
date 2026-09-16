/**
 * El móvil como teclado de la televisión.
 *
 * Escribir «El halcón maltés» con las flechas del mando son cuarenta y tantas
 * pulsaciones, y es la queja de siempre en Plex, Jellyfin y la tele de turno.
 * Aquí el móvil —que ya tiene la sesión abierta en la web— manda el texto y la
 * tele lo recoge.
 *
 * No hace falta nada sofisticado para esto: el texto vive en memoria, es una
 * línea por usuario y lo recoge quien pregunte. Nada de WebSockets ni de una
 * tabla en la base para algo que dura dos segundos y que, si se pierde, se
 * vuelve a enviar pulsando otra vez.
 *
 * Dos detalles que sí importan:
 *
 * 1. **Se entrega una sola vez.** La tele pregunta cada segundo y medio; si el
 *    texto no se borrara al recogerlo, la búsqueda se repetiría en bucle y no
 *    habría manera de escribir nada más desde el propio mando.
 * 2. **Caduca.** Un envío que nadie recoge —la tele apagada, o en otra
 *    pantalla— no puede aparecer media hora después, cuando ya no viene a
 *    cuento. Al minuto se tira.
 */
import type { FastifyInstance } from 'fastify';
import { requireUser, sesionDe } from './auth.ts';
import { recogerAvisos } from '../media/avisos.ts';

/** Cuánto aguanta un envío sin que nadie lo recoja. */
const CADUCA_MS = 60_000;

type Orden = { texto: string; enviado: number };

const pendientes = new Map<number, Orden>();

/**
 * «Ver en la tele» desde el móvil: la película, el fichero y el segundo por el
 * que va. La tele lo recoge y arranca el reproductor ahí mismo. Es lo que
 * hace Chromecast, pero con la aplicación de la tele como receptor, que es lo
 * que tiene una Samsung sin Google Cast.
 */
export type OrdenDeReproduccion = { fileId: number; itemId: number; episodeId: number | null; position: number };
const reproducciones = new Map<number, OrdenDeReproduccion & { enviado: number }>();

/** Una orden de ver algo aguanta más: la tele puede estar en otra pantalla. */
const CADUCA_REPRODUCIR_MS = 120_000;

export function enviarReproduccion(userId: number, orden: OrdenDeReproduccion) {
  reproducciones.set(userId, { ...orden, enviado: Date.now() });
}

export function recogerReproduccion(userId: number): OrdenDeReproduccion | null {
  const orden = reproducciones.get(userId);
  if (!orden) return null;
  reproducciones.delete(userId);
  if (Date.now() - orden.enviado >= CADUCA_REPRODUCIR_MS) return null;
  const { enviado, ...resto } = orden;
  return resto;
}

/** Lo apunta la web del móvil. */
export function enviarBusqueda(userId: number, texto: string) {
  pendientes.set(userId, { texto, enviado: Date.now() });
}

/** Lo recoge la televisión, y se lo lleva: solo se entrega una vez. */
export function recogerBusqueda(userId: number): string | null {
  const orden = pendientes.get(userId);
  if (!orden) return null;
  pendientes.delete(userId);
  return Date.now() - orden.enviado < CADUCA_MS ? orden.texto : null;
}

export default async function mandoRoutes(app: FastifyInstance) {
  /** La televisión pregunta si hay algo que escribir. */
  app.get('/api/mando', async (req) => {
    const user = requireUser(req);
    // Las órdenes de buscar y reproducir son para la televisión (`?tele=1`):
    // si las recogiera el navegador o el móvil, que también preguntan por los
    // avisos, se las llevarían sin que nadie las viera.
    const tele = (req.query as { tele?: string }).tele === '1';
    // Y los avisos del administrador para este aparato: mensaje y «para».
    const avisos = recogerAvisos(sesionDe(req) ?? '');
    return {
      buscar: tele ? recogerBusqueda(user.id) : null,
      reproducir: tele ? recogerReproduccion(user.id) : null,
      mensaje: avisos.mensaje,
      parar: avisos.parar,
    };
  });

  /** El móvil manda «ver esto en la tele». */
  app.post('/api/mando/reproducir', async (req, reply) => {
    const user = requireUser(req);
    const { fileId, itemId, episodeId, position } = (req.body ?? {}) as Partial<OrdenDeReproduccion>;
    if (!fileId || !itemId) return reply.code(400).send({ error: 'Falta el fichero' });
    enviarReproduccion(user.id, {
      fileId: Number(fileId),
      itemId: Number(itemId),
      episodeId: episodeId ? Number(episodeId) : null,
      position: Math.max(0, Number(position ?? 0) || 0),
    });
    return { enviado: true };
  });

  /** El móvil manda el texto. */
  app.post('/api/mando/buscar', async (req, reply) => {
    const user = requireUser(req);
    const { texto } = (req.body ?? {}) as { texto?: string };
    const limpio = String(texto ?? '').trim().slice(0, 120);
    if (!limpio) return reply.code(400).send({ error: 'No hay nada que enviar' });
    enviarBusqueda(user.id, limpio);
    return { enviado: limpio };
  });
}
