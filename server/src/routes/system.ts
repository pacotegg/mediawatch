import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config, saveConfig, type LibraryConfig } from '../config.ts';
import { db } from '../db.ts';
import { requireUser } from './auth.ts';

const CARPETAS_IGNORADAS = new Set([
  '$recycle.bin',
  'system volume information',
  'recovery',
  'msocache',
  'node_modules',
  '.git',
  '.trickplay',
  'proc',
  'sys',
  'dev',
  'run',
]);

function unidadesDisponibles(): string[] {
  if (process.platform !== 'win32') {
    return existsSync('/media') ? ['/media'] : ['/'];
  }
  const letras = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const encontradas: string[] = [];
  for (const l of letras) {
    const raiz = `${l}:\\`;
    try {
      if (existsSync(raiz)) encontradas.push(raiz);
    } catch {}
  }
  return encontradas;
}

export default async function systemRoutes(app: FastifyInstance) {
  /**
   * Explorador seguro de carpetas para seleccionar bibliotecas desde la web.
   * Solo accesible por administradores.
   */
  app.get('/api/system/browse', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo administradores' });

    const dirQuery = (req.query as { dir?: string }).dir?.trim();
    if (!dirQuery) {
      const raices = unidadesDisponibles();
      return {
        current: '',
        parent: null,
        dirs: raices.map((r) => ({ name: r, path: r })),
      };
    }

    const resolved = resolve(dirQuery);
    if (!existsSync(resolved)) {
      return reply.code(400).send({ error: 'La ruta no existe' });
    }

    try {
      const st = statSync(resolved);
      if (!st.isDirectory()) {
        return reply.code(400).send({ error: 'La ruta no es una carpeta' });
      }

      const entradas = readdirSync(resolved, { withFileTypes: true });
      const dirs = entradas
        .filter((e) => {
          if (!e.isDirectory()) return false;
          const lower = e.name.toLowerCase();
          if (lower.startsWith('.') || CARPETAS_IGNORADAS.has(lower)) return false;
          return true;
        })
        .map((e) => ({
          name: e.name,
          path: join(resolved, e.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

      const parentDir = dirname(resolved);
      return {
        current: resolved,
        parent: parentDir !== resolved ? parentDir : null,
        dirs,
      };
    } catch (err) {
      return reply.code(500).send({ error: 'Error leyendo carpeta: ' + (err instanceof Error ? err.message : String(err)) });
    }
  });

  /**
   * Guarda y actualiza las bibliotecas en config.json y en la base de datos.
   */
  app.put('/api/system/libraries', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo administradores' });

    const body = req.body as { libraries?: LibraryConfig[] };
    if (!Array.isArray(body?.libraries)) {
      return reply.code(400).send({ error: 'Falta la lista de bibliotecas' });
    }

    const validadas: LibraryConfig[] = [];
    for (const lib of body.libraries) {
      const name = String(lib.name ?? '').trim();
      const path = String(lib.path ?? '').trim();
      const kind = lib.kind;
      if (!name || name.length > 60) {
        return reply.code(400).send({ error: 'Nombre de biblioteca inválido' });
      }
      if (kind !== 'movie' && kind !== 'show') {
        return reply.code(400).send({ error: 'El tipo debe ser movie o show' });
      }
      if (!path) {
        return reply.code(400).send({ error: 'Falta la ruta de la biblioteca' });
      }
      if (!existsSync(path)) {
        return reply.code(400).send({ error: `La ruta "${path}" no existe en el servidor` });
      }
      validadas.push({ name, path: resolve(path), kind });
    }

    saveConfig({ ...config, libraries: validadas });

    // Sincronizar en la tabla libraries de SQLite
    const upsertLib = db.prepare('INSERT INTO libraries (name, path, kind) VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name, kind=excluded.kind');
    for (const lib of validadas) {
      upsertLib.run(lib.name, lib.path, lib.kind);
    }

    return { ok: true, libraries: config.libraries };
  });
}
