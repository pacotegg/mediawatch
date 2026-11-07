import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../config.ts';
import { join } from 'node:path';
import { sincronizarEpisodioSeguro, sincronizarPeliculaSegura } from '../media/sync-introdb.ts';

const db = new DatabaseSync(join(DATA_DIR, 'tvwatch.db'));

async function sincronizarSeries(aplicar: boolean, forzarTodos = false) {
  console.log('\n=== SINCRONIZANDO SERIES (IntroDB + SkipDB con validación estricta) ===');
  const rows = db.prepare(`
    SELECT e.id as episode_id, e.season, e.episode, s.title as serie, s.imdb_id, f.duration, f.id as file_id,
           (SELECT count(*) FROM skip_ranges WHERE episode_id = e.id AND kind = 'intro') as tiene_intro,
           (SELECT count(*) FROM skip_ranges WHERE episode_id = e.id AND kind = 'credits') as tiene_creditos
    FROM episodes e
    JOIN items s ON s.id = e.show_id
    JOIN media_files f ON f.episode_id = e.id
    WHERE s.kind = 'show' AND s.imdb_id IS NOT NULL AND s.imdb_id != '' AND e.season > 0
    ORDER BY s.title, e.season, e.episode
  `).all() as {
    episode_id: number;
    season: number;
    episode: number;
    serie: string;
    imdb_id: string;
    duration: number;
    file_id: number;
    tiene_intro: number;
    tiene_creditos: number;
  }[];

  const pendientes = forzarTodos ? rows : rows.filter((r) => r.tiene_intro === 0 || r.tiene_creditos === 0);
  console.log(`Total episodios a consultar: ${pendientes.length} (de ${rows.length} con IMDb)`);

  let consultados = 0;
  let exitosos = 0;
  let descartados = 0;
  let serieActual = '';

  for (const r of pendientes) {
    if (r.serie !== serieActual) {
      serieActual = r.serie;
      console.log(`\nRevisando «${r.serie}» (${r.imdb_id})...`);
    }

    consultados++;
    try {
      const res = await sincronizarEpisodioSeguro(r.episode_id, r.imdb_id, r.season, r.episode, r.duration, r.file_id);
      if (res.intro || res.credits) {
        exitosos++;
        console.log(`  ✓ S${r.season}E${r.episode}: ${res.intro ? '[Intro] ' : ''}${res.credits ? '[Créditos]' : ''} validados`);
      } else {
        descartados++;
      }
    } catch (err) {
      console.error(`  ✗ S${r.season}E${r.episode}: error ${(err as Error).message}`);
    }

    await new Promise((res) => setTimeout(res, 85));
  }

  console.log(`\nResumen series: ${consultados} consultados, ${exitosos} con tramos validados y guardados.`);
}

async function sincronizarPeliculas(aplicar: boolean, forzarTodos = false) {
  console.log('\n=== SINCRONIZANDO PELÍCULAS (IntroDB con validación estricta) ===');
  const rows = db.prepare(`
    SELECT i.id as item_id, i.title, i.imdb_id, f.duration, f.id as file_id,
           (SELECT rangos FROM pelicula_creditos WHERE item_id = i.id) as creditos_guardados
    FROM items i
    JOIN media_files f ON f.item_id = i.id
    WHERE i.kind = 'movie' AND i.imdb_id IS NOT NULL AND i.imdb_id != ''
    ORDER BY i.title
  `).all() as {
    item_id: number;
    title: string;
    imdb_id: string;
    duration: number;
    file_id: number;
    creditos_guardados: string | null;
  }[];

  const pendientes = forzarTodos
    ? rows
    : rows.filter((p) => !p.creditos_guardados || p.creditos_guardados === '[]');

  console.log(`Total películas a consultar: ${pendientes.length} (de ${rows.length} con IMDb)`);

  let consultadas = 0;
  let exitosas = 0;

  for (const p of pendientes) {
    consultadas++;
    try {
      const res = await sincronizarPeliculaSegura(p.item_id, p.imdb_id, p.duration, p.file_id);
      if (res.credits) {
        exitosas++;
        console.log(`  ✓ «${p.title}»: Créditos validados${res.postCredits ? ' (+ Post-créditos)' : ''}`);
      }
    } catch (err) {
      console.error(`  ✗ «${p.title}»: error ${(err as Error).message}`);
    }

    await new Promise((res) => setTimeout(res, 90));
  }

  console.log(`\nResumen películas: ${consultadas} consultadas, ${exitosas} con créditos validados y guardados.`);
}

async function main() {
  const forzar = process.argv.includes('--forzar');
  const soloPeliculas = process.argv.includes('peliculas');
  const soloSeries = process.argv.includes('series');

  console.log(`[MediaWatch IntroDB Sync] Iniciando sincronización comunitaria validada (forzar: ${forzar ? 'SÍ' : 'NO'})`);

  if (!soloPeliculas) {
    await sincronizarSeries(true, forzar);
  }

  if (!soloSeries) {
    await sincronizarPeliculas(true, forzar);
  }

  console.log('\n=== SINCRONIZACIÓN COMPLETADA CON ÉXITO ===');
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
