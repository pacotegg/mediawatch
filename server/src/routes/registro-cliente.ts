/**
 * Registro de errores de los clientes (app de Android, tele, web).
 *
 * El 08/10/2026 un betatester se quedó con el esqueleto de la portada y del
 * servidor no había nada que mirar: la petición nunca llegaba, o la app se
 * caía antes de poder decir por qué. Ahora cada cliente guarda su propio
 * registro y lo manda aquí en cuanto puede.
 *
 * Decisiones:
 * - **Exige sesión.** Una ruta abierta que escribe en disco es una forma de
 *   llenártelo. El usuario sale de la sesión y no de lo que diga el cliente.
 * - **Un fichero por usuario, plataforma, aparato y día**:
 *   `data/clientes/<id>-<nombre>/<plataforma>-<aparato>-<AAAA-MM-DD>.log`.
 * - Nada de lo que llega se escribe tal cual: se quitan saltos de línea y
 *   caracteres de control (si no, un cliente podría falsificar líneas) y se
 *   acota todo. No se espera ni se guarda ningún token.
 */
import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DATA_DIR } from '../config.ts';
import { requireUser } from './auth.ts';

const DIR = join(DATA_DIR, 'clientes');
const PLATAFORMAS = new Set(['android', 'tele', 'web']);

const MAX_CUERPO = 64 * 1024;
const MAX_LINEAS = 200;
const MAX_LINEA = 1000;
const MAX_FICHERO = 1024 * 1024;
const MAX_USUARIO = 20 * 1024 * 1024;
const DIAS = 14;

/** Peticiones por sesión y minuto. Un cliente sano manda una cada pocos segundos como mucho. */
const MAX_POR_MINUTO = 20;
const ventanas = new Map<number, { desde: number; n: number }>();

function limpiar(texto: unknown, largo: number): string {
  return String(texto ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .trim()
    .slice(0, largo);
}

function segmento(texto: string, largo: number): string {
  return texto.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, largo);
}

/** Retira lo viejo y, si el usuario se pasa de tamaño, lo más antiguo. */
function podar(carpeta: string) {
  const ahora = Date.now();
  let ficheros: { ruta: string; mtime: number; size: number }[] = [];
  try {
    ficheros = readdirSync(carpeta)
      .filter((f) => f.endsWith('.log'))
      .map((f) => {
        const ruta = join(carpeta, f);
        const s = statSync(ruta);
        return { ruta, mtime: s.mtimeMs, size: s.size };
      });
  } catch {
    return;
  }
  for (const f of ficheros) {
    if (ahora - f.mtime > DIAS * 86_400_000) {
      try { unlinkSync(f.ruta); } catch { /* ya no estaba */ }
    }
  }
  ficheros = ficheros.filter((f) => ahora - f.mtime <= DIAS * 86_400_000).sort((a, b) => a.mtime - b.mtime);
  let total = ficheros.reduce((s, f) => s + f.size, 0);
  while (total > MAX_USUARIO && ficheros.length > 1) {
    const viejo = ficheros.shift()!;
    try { unlinkSync(viejo.ruta); } catch { /* ya no estaba */ }
    total -= viejo.size;
  }
}

export default async function registroClienteRoutes(app: FastifyInstance) {
  app.post('/api/cliente/log', { bodyLimit: MAX_CUERPO }, async (req, reply) => {
    const yo = requireUser(req);

    const ahora = Date.now();
    const v = ventanas.get(yo.id);
    if (!v || ahora - v.desde > 60_000) {
      ventanas.set(yo.id, { desde: ahora, n: 1 });
    } else if (++v.n > MAX_POR_MINUTO) {
      return reply.code(429).send({ error: 'Demasiados envíos' });
    }

    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    const plataformaPedida = limpiar(cuerpo.plataforma, 12).toLowerCase();
    const plataforma = PLATAFORMAS.has(plataformaPedida) ? plataformaPedida : 'otra';
    const aparato = segmento(limpiar(cuerpo.aparato, 16).toLowerCase(), 16) || 'sin-id';
    const version = limpiar(cuerpo.version, 20);
    const dispositivo = limpiar(cuerpo.dispositivo, 80);
    const lineas = Array.isArray(cuerpo.lineas) ? cuerpo.lineas.slice(0, MAX_LINEAS) : [];
    if (lineas.length === 0) return { ok: true, guardadas: 0 };

    const carpeta = join(DIR, `${yo.id}-${segmento(yo.name, 40)}`);
    const dia = new Date(ahora).toISOString().slice(0, 10);
    const fichero = join(carpeta, `${plataforma}-${aparato}-${dia}.log`);

    try {
      mkdirSync(carpeta, { recursive: true });
      let actual = 0;
      try { actual = statSync(fichero).size; } catch { /* aún no existe */ }
      if (actual >= MAX_FICHERO) return { ok: true, guardadas: 0, truncado: true };

      const salida = [`# ${new Date(ahora).toISOString()} recibido · ${plataforma} ${version} · ${dispositivo}`];
      for (const l of lineas) salida.push(limpiar(l, MAX_LINEA));
      appendFileSync(fichero, salida.join('\n') + '\n', 'utf8');
      podar(carpeta);
    } catch (err) {
      console.error('[cliente-log] no se pudo guardar:', (err as Error).message);
      return reply.code(500).send({ error: 'No se pudo guardar' });
    }
    return { ok: true, guardadas: lineas.length };
  });
}
