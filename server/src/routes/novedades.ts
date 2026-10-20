/**
 * «Novedades desde tu última visita»: los títulos que han llegado (o series con episodios nuevos, que
 * actualizan su `added_at`) desde la última vez que el perfil las vio. Cada perfil lleva su marca; la
 * primera vez solo se pone la marca, para no anunciar la biblioteca entera como nueva. Respeta el control
 * parental: un perfil infantil solo ve lo que puede ver.
 */
import type { FastifyInstance } from 'fastify';
import { db } from '../db.ts';
import { requireUser } from './auth.ts';
import { clausulaRating } from './library.ts';

// `items.added_at` va en hora local y sin zona (`2026-10-13T10:36:54`): la marca, en el mismo formato.
export const ahoraLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

export default async function novedadesRoutes(app: FastifyInstance) {
  app.get('/api/novedades', async (req) => {
    const user = requireUser(req);
    const fila = db.prepare('SELECT novedades_vistas AS m FROM users WHERE id = ?').get(user.id) as { m: string | null } | undefined;
    if (!fila?.m) {
      db.prepare('UPDATE users SET novedades_vistas = ? WHERE id = ?').run(ahoraLocal(), user.id);
      return { desde: null, total: 0, items: [] };
    }
    const cr = clausulaRating(user);
    const y = cr.sql ? `AND ${cr.sql}` : '';
    // Los monólogos (cortes de El Club de la Comedia, cientos y de golpe) no son «novedades»: tapaban las películas y series nuevas.
    const sinMonologos = "AND i.library_id NOT IN (SELECT id FROM libraries WHERE name = 'Monólogos')";
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE i.added_at > ? ${sinMonologos} ${y}`).get(fila.m, ...cr.params) as { n: number }).n;
    const items = db
      .prepare(`SELECT i.id, i.title, i.kind, i.year, i.added_at FROM items i WHERE i.added_at > ? ${sinMonologos} ${y} ORDER BY i.added_at DESC LIMIT 12`)
      .all(fila.m, ...cr.params);
    return { desde: fila.m, total, items };
  });

  app.post('/api/novedades/vistas', async (req) => {
    const user = requireUser(req);
    db.prepare('UPDATE users SET novedades_vistas = ? WHERE id = ?').run(ahoraLocal(), user.id);
    return { ok: true };
  });
}
