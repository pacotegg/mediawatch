import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DATA_DIR } from '../config.ts';
import { backupBaseDeDatosEnWorker, optimizarBaseDeDatosEnWorker, tamanoBaseDeDatos } from '../db.ts';
import { limpiarCache as limpiarCacheImagenes } from '../media/images.ts';
import { limpiarHuerfanas as limpiarTrickplayHuerfano } from '../media/trickplay.ts';
import { requireUser } from './auth.ts';

/*
 * Tamaño total y número de ficheros de una carpeta, sin bajar a subcarpetas
 * raras. Async y cediendo el hilo cada 500 ficheros: la caché de imágenes ha
 * llegado a tener 63.613, un `statSync` por cada uno sin ceder es el mismo
 * fallo que el escaneo completo, y esto lo dispara cualquiera que abra
 * Ajustes → Mantenimiento.
 */
async function tamanoCarpeta(dir: string): Promise<{ bytes: number; ficheros: number }> {
  let bytes = 0;
  let ficheros = 0;
  let vistos = 0;
  const pila = [dir];
  while (pila.length) {
    const actual = pila.pop()!;
    let entradas: string[];
    try {
      entradas = readdirSync(actual);
    } catch {
      continue;
    }
    for (const nombre of entradas) {
      const ruta = join(actual, nombre);
      let st;
      try {
        st = statSync(ruta);
      } catch {
        continue;
      }
      if (st.isDirectory()) pila.push(ruta);
      else {
        bytes += st.size;
        ficheros++;
      }
      if (++vistos % 500 === 0) await new Promise((r) => setImmediate(r));
    }
  }
  return { bytes, ficheros };
}

/*
 * Mantenimiento al estilo Plex: vaciar caché, retirar huérfanos y optimizar
 * la base de datos, todo a la vista y a un clic desde Ajustes en vez de
 * quedarse creciendo en silencio para siempre.
 */
export default async function mantenimientoRoutes(app: FastifyInstance) {
  app.get('/api/mantenimiento/estado', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });

    const cache = await tamanoCarpeta(join(DATA_DIR, 'cache', 'images'));
    const trickplay = await tamanoCarpeta(join(DATA_DIR, 'trickplay'));
    const copias = (() => {
      try {
        return readdirSync(join(DATA_DIR, 'copias')).filter((f) => f.endsWith('.db')).sort();
      } catch {
        return [];
      }
    })();

    return {
      baseDeDatos: { bytes: tamanoBaseDeDatos() },
      cacheImagenes: cache,
      trickplay,
      copias: { total: copias.length, ultima: copias.at(-1) ?? null },
    };
  });

  app.post('/api/mantenimiento/limpiar', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });

    const cacheImagenes = await limpiarCacheImagenes();
    const trickplayHuerfano = await limpiarTrickplayHuerfano();
    return { cacheImagenes, trickplayHuerfano };
  });

  app.post('/api/mantenimiento/optimizar', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede optimizar la base de datos' });

    const antes = tamanoBaseDeDatos();
    await optimizarBaseDeDatosEnWorker();
    return { antes, despues: tamanoBaseDeDatos() };
  });

  app.post('/api/mantenimiento/copia', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede hacer copias de seguridad' });

    const ruta = await backupBaseDeDatosEnWorker();
    return { ruta };
  });
}
