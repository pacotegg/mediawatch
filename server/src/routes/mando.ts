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
import { estadoLimite, MENSAJE_LIMITE } from '../media/limite-diario.ts';

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

export type TeclaMando = 'arriba' | 'abajo' | 'izquierda' | 'derecha' | 'ok' | 'atras' | 'play_pause';
const TECLAS: string[] = ['arriba', 'abajo', 'izquierda', 'derecha', 'ok', 'atras', 'play_pause'];
/*
 * Cola, no una sola tecla: con una, dos pulsaciones seguidas en el móvil se pisaban y la tele recibía solo la última.
 * Tope de 20 por si nadie recoge.
 */
const teclas = new Map<number, { tecla: TeclaMando; enviado: number }[]>();

export function enviarTecla(userId: number, tecla: TeclaMando) {
  const cola = teclas.get(userId) ?? [];
  cola.push({ tecla, enviado: Date.now() });
  teclas.set(userId, cola.slice(-20));
}

/** Las teclas vigentes, en orden. `una`: solo la primera (teles antiguas, que leen una por consulta). */
export function recogerTeclas(userId: number, una = false): TeclaMando[] {
  const cola = (teclas.get(userId) ?? []).filter((o) => Date.now() - o.enviado < 10_000);
  const sale = una ? cola.slice(0, 1) : cola;
  const queda = cola.slice(sale.length);
  if (queda.length) teclas.set(userId, queda);
  else teclas.delete(userId);
  return sale.map((o) => o.tecla);
}

/** Una tecla, como antes (la usan las pruebas y quien solo quiera la siguiente). */
export function recogerTecla(userId: number): TeclaMando | null {
  return recogerTeclas(userId, true)[0] ?? null;
}

/** Lo que una consulta de la tele puede llevarse ya, sin sacarlo. */
function hayParaLaTele(userId: number): boolean {
  return pendientes.has(userId) || reproducciones.has(userId) || (teclas.get(userId)?.length ?? 0) > 0;
}

/** Cuánto se sostiene como mucho una consulta con `espera=1` antes de contestar vacía. */
const ESPERA_MAX_MS = 8_000;

export default async function mandoRoutes(app: FastifyInstance) {
  /** La televisión pregunta si hay algo que escribir o pulsar. */
  app.get('/api/mando', async (req, reply) => {
    const user = requireUser(req);
    // Las órdenes de buscar, reproducir y teclas son para la televisión (`?tele=1`):
    // si las recogiera el navegador o el móvil, que también preguntan por los
    // avisos, se las llevarían sin que nadie las viera.
    const q = req.query as { tele?: string; espera?: string };
    const tele = q.tele === '1';
    const sesion = sesionDe(req) ?? '';
    /*
     * `espera=1` (tele desde el 28/10/2026): si no hay nada, la consulta se sostiene hasta 8 s y contesta en cuanto
     * llega algo. Con la consulta cada 1,2 s, una tecla del mando del móvil tardaba hasta 1,2 s en notarse.
     */
    let avisos = recogerAvisos(sesion);
    if (tele && q.espera === '1') {
      const hasta = Date.now() + ESPERA_MAX_MS;
      let cerrada = false;
      // La respuesta, no la petición: en un GET la petición «se cierra» en cuanto se ha leído.
      reply.raw.on('close', () => { cerrada = true; });
      while (!cerrada && Date.now() < hasta && !avisos.mensaje && !avisos.parar && !hayParaLaTele(user.id) && !estadoLimite(user.id)?.agotado) {
        await new Promise((r) => setTimeout(r, 100));
        avisos = recogerAvisos(sesion);
      }
    }
    // Un perfil con el tiempo de hoy agotado: lo que esté viendo se para, en cualquier aparato.
    if (estadoLimite(user.id)?.agotado) {
      avisos.parar = true;
      avisos.mensaje = avisos.mensaje ?? MENSAJE_LIMITE;
    }
    return {
      buscar: tele ? recogerBusqueda(user.id) : null,
      reproducir: tele ? recogerReproduccion(user.id) : null,
      // `tecla` para las teles antiguas (una por consulta); `teclas`, todas, para las que esperan.
      ...(tele && q.espera === '1'
        ? (() => { const ts = recogerTeclas(user.id); return { tecla: ts[0] ?? null, teclas: ts }; })()
        : { tecla: tele ? recogerTecla(user.id) : null }),
      mensaje: avisos.mensaje,
      parar: avisos.parar,
    };
  });

  /** El móvil manda «ver esto en la tele». */
  app.post('/api/mando/reproducir', async (req, reply) => {
    const user = requireUser(req);
    const { fileId, itemId, episodeId, position } = (req.body ?? {}) as Partial<OrdenDeReproduccion>;
    if (!Number.isInteger(Number(fileId)) || !Number.isInteger(Number(itemId)) || !fileId || !itemId) return reply.code(400).send({ error: 'Falta el fichero' });
    if (episodeId && !Number.isInteger(Number(episodeId))) return reply.code(400).send({ error: 'Episodio no válido' });
    enviarReproduccion(user.id, {
      fileId: Number(fileId),
      itemId: Number(itemId),
      episodeId: episodeId ? Number(episodeId) : null,
      position: Math.max(0, Number(position ?? 0) || 0),
    });
    return { enviado: true };
  });

  /** El móvil manda una tecla del mando a la tele. */
  app.post('/api/mando/tecla', async (req, reply) => {
    const user = requireUser(req);
    const { tecla } = (req.body ?? {}) as { tecla?: TeclaMando };
    if (!tecla || !TECLAS.includes(tecla)) return reply.code(400).send({ error: 'Falta la tecla' });
    enviarTecla(user.id, tecla);
    return { enviado: tecla };
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
