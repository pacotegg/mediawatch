/**
 * Descarga y asigna automáticamente carátulas y fondos oficiales de sagas
 * desde TMDb para todas las colecciones de la biblioteca.
 *
 *   node src/cli/completar-sagas.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { descargar, imagenesDeSaga } from '../scanner/tmdb.ts';

const sagas = db
  .prepare(
    `SELECT DISTINCT collection AS name
     FROM items
     WHERE collection IS NOT NULL AND collection != ''
     ORDER BY collection`
  )
  .all() as { name: string }[];

console.log(`Buscando carátulas y fondos oficiales de sagas para ${sagas.length} colecciones…\n`);

let actualizadas = 0;
let sinImagenes = 0;
let errores = 0;

for (let i = 0; i < sagas.length; i++) {
  const { name } = sagas[i];
  process.stdout.write(`[${i + 1}/${sagas.length}] «${name}»… `);

  try {
    const res = await imagenesDeSaga(name);
    const poster = res.posters[0]?.url;
    const fanart = res.fanarts[0]?.url;

    if (!poster && !fanart) {
      console.log('sin imágenes en TMDb');
      sinImagenes++;
      continue;
    }

    const hash = createHash('sha1').update(name).digest('hex').slice(0, 12);
    const dir = join(DATA_DIR, 'artwork', 'sagas', hash);
    mkdirSync(dir, { recursive: true });

    let rutaPoster: string | null = null;
    let rutaFondo: string | null = null;

    if (poster) {
      rutaPoster = await descargar(poster, join(dir, 'poster.jpg'));
    }
    if (fanart) {
      rutaFondo = await descargar(fanart, join(dir, 'fanart.jpg'));
    }

    const ahora = new Date().toISOString();
    db.prepare(
      `INSERT INTO coleccion_imagen (coleccion, ruta, fondo, actualizado)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(coleccion) DO UPDATE SET
         ruta = CASE WHEN excluded.ruta IS NOT NULL THEN excluded.ruta ELSE coleccion_imagen.ruta END,
         fondo = CASE WHEN excluded.fondo IS NOT NULL THEN excluded.fondo ELSE coleccion_imagen.fondo END,
         actualizado = excluded.actualizado`
    ).run(name, rutaPoster ?? '', rutaFondo, ahora);

    console.log(`OK (poster: ${poster ? '✓' : '✗'}, fondo: ${fanart ? '✓' : '✗'})`);
    actualizadas++;
  } catch (err) {
    console.log(`error: ${(err as Error).message}`);
    errores++;
  }
}

console.log(`\nFinalizado: ${actualizadas} actualizadas, ${sinImagenes} sin imágenes, ${errores} errores.`);
