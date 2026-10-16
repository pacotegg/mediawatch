import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../config.ts';
import { join } from 'node:path';

const db = new DatabaseSync(join(DATA_DIR, 'tvwatch.db'));

type Segmento = {
  start_sec?: number;
  end_sec?: number;
  start_ms?: number;
  end_ms?: number;
};

type IntroDBResponse = {
  intro?: Segmento | null;
  outro?: Segmento | null;
  recap?: Segmento | null;
  post_credits?: Segmento | null;
};

async function consultarIntroDB(imdbId: string, season?: number, episode?: number, isMovie = false): Promise<IntroDBResponse | null> {
  const url = isMovie
    ? `https://api.introdb.app/segments?imdb_id=${imdbId}&is_movie=true`
    : `https://api.introdb.app/segments?imdb_id=${imdbId}&season=${season}&episode=${episode}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MediaWatch/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 200) {
      return (await res.json()) as IntroDBResponse;
    }
  } catch {
    // Si IntroDB falla, intentamos SkipDB
  }

  // Fallback SkipDB para episodios de series
  if (!isMovie && season !== undefined && episode !== undefined) {
    try {
      const skipUrl = `https://api.skipdb.tv/api/segments?imdb_id=${imdbId}&season=${season}&episode=${episode}`;
      const res = await fetch(skipUrl, {
        headers: { 'User-Agent': 'MediaWatch/1.0' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.status === 200) {
        const data = (await res.json()) as { segments?: { intro?: Segmento | null; outro?: Segmento | null; recap?: Segmento | null } };
        if (data.segments) {
          return {
            intro: data.segments.intro,
            outro: data.segments.outro,
            recap: data.segments.recap,
          };
        }
      }
    } catch {
      // Ignorar fallback si falla
    }
  }

  return null;
}

function normalizarSegundos(seg?: Segmento | null): { start_s: number; end_s: number } | null {
  if (!seg) return null;
  let start = 0;
  let end = 0;
  if (typeof seg.start_sec === 'number' && typeof seg.end_sec === 'number') {
    start = seg.start_sec;
    end = seg.end_sec;
  } else if (typeof seg.start_ms === 'number' && typeof seg.end_ms === 'number') {
    start = Math.round((seg.start_ms / 1000) * 10) / 10;
    end = Math.round((seg.end_ms / 1000) * 10) / 10;
  } else {
    return null;
  }
  if (end > start && start >= 0) {
    return { start_s: Math.round(start * 10) / 10, end_s: Math.round(end * 10) / 10 };
  }
  return null;
}

async function sincronizarSeries(aplicar: boolean, forzarTodos = false) {
  console.log('\n=== SINCRONIZANDO TODAS LAS SERIES (IntroDB + SkipDB) ===');
  const rows = db.prepare(`
    SELECT e.id as episode_id, e.season, e.episode, s.title as serie, s.imdb_id, f.duration,
           (SELECT start_s FROM skip_ranges WHERE episode_id = e.id AND kind = 'credits') as cred_existente,
           (SELECT confidence FROM skip_ranges WHERE episode_id = e.id AND kind = 'credits') as cred_conf,
           (SELECT start_s FROM skip_ranges WHERE episode_id = e.id AND kind = 'intro') as intro_existente,
           (SELECT confidence FROM skip_ranges WHERE episode_id = e.id AND kind = 'intro') as intro_conf
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
    cred_existente: number | null;
    cred_conf: number | null;
    intro_existente: number | null;
    intro_conf: number | null;
  }[];

  console.log(`Total episodios con IMDb a revisar: ${rows.length}`);

  const insertStmt = db.prepare(`
    INSERT INTO skip_ranges (episode_id, kind, start_s, end_s, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(episode_id, kind) DO UPDATE SET
      start_s = excluded.start_s,
      end_s = excluded.end_s,
      confidence = excluded.confidence,
      created_at = excluded.created_at
  `);

  let consultados = 0;
  let creditosNuevos = 0;
  let creditosActualizados = 0;
  let introsNuevas = 0;
  let introsActualizadas = 0;
  let serieActual = '';
  const now = new Date().toISOString();

  for (const r of rows) {
    const necesitaCred = forzarTodos || r.cred_existente === null || (r.cred_conf ?? 0) < 85;
    const necesitaIntro = forzarTodos || r.intro_existente === null || (r.intro_conf ?? 0) < 85;

    // Si ya tiene intro y créditos verificados en BD (confianza 85), saltar para ahorrar llamadas
    if (!necesitaCred && !necesitaIntro) continue;

    if (r.serie !== serieActual) {
      serieActual = r.serie;
      console.log(`\nRevisando «${r.serie}» (${r.imdb_id})...`);
    }

    consultados++;
    const data = await consultarIntroDB(r.imdb_id, r.season, r.episode, false);
    if (!data) {
      await new Promise((res) => setTimeout(res, 80));
      continue;
    }

    // Créditos (outro)
    if (necesitaCred && data.outro) {
      const seg = normalizarSegundos(data.outro);
      if (seg && seg.start_s < r.duration) {
        const fin = Math.min(seg.end_s, r.duration);
        const eraNuevo = r.cred_existente === null;
        if (eraNuevo) {
          creditosNuevos++;
          console.log(`  [CRÉDITOS NUEVO] S${r.season}E${r.episode}: ${seg.start_s}s - ${fin}s`);
        } else {
          creditosActualizados++;
          console.log(`  [CRÉDITOS ACTUALIZADO] S${r.season}E${r.episode}: ${seg.start_s}s - ${fin}s (antes: ${r.cred_existente}s, conf: ${r.cred_conf} -> 85)`);
        }
        if (aplicar) {
          insertStmt.run(r.episode_id, 'credits', seg.start_s, fin, 85, now);
        }
      }
    }

    // Cabecera (intro)
    if (necesitaIntro && data.intro) {
      const seg = normalizarSegundos(data.intro);
      if (seg && seg.end_s < r.duration * 0.5) {
        const eraNuevo = r.intro_existente === null;
        if (eraNuevo) {
          introsNuevas++;
          console.log(`  [INTRO NUEVA]    S${r.season}E${r.episode}: ${seg.start_s}s - ${seg.end_s}s`);
        } else {
          introsActualizadas++;
          console.log(`  [INTRO ACTUALIZADA] S${r.season}E${r.episode}: ${seg.start_s}s - ${seg.end_s}s (antes: ${r.intro_existente}s)`);
        }
        if (aplicar) {
          insertStmt.run(r.episode_id, 'intro', seg.start_s, seg.end_s, 85, now);
        }
      }
    }

    await new Promise((res) => setTimeout(res, 90));
  }

  console.log(`\nResumen series: ${consultados} consultas realizadas.`);
  console.log(`Créditos: ${creditosNuevos} nuevos, ${creditosActualizados} actualizados.`);
  console.log(`Intros: ${introsNuevas} nuevas, ${introsActualizadas} actualizadas.`);
}

async function sincronizarPeliculas(aplicar: boolean) {
  console.log('\n=== SINCRONIZANDO PELÍCULAS (IntroDB) ===');
  const rows = db.prepare(`
    SELECT i.id as item_id, i.title, i.imdb_id, f.duration,
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
    creditos_guardados: string | null;
  }[];

  console.log(`Total películas con IMDb: ${rows.length}`);

  const insertPeliStmt = db.prepare(`
    INSERT INTO pelicula_creditos (item_id, rangos, escenas, metodo, created_at)
    VALUES (?, ?, ?, 'introdb', ?)
    ON CONFLICT(item_id) DO UPDATE SET
      rangos = excluded.rangos,
      escenas = excluded.escenas,
      metodo = excluded.metodo,
      created_at = excluded.created_at
  `);

  let consultadas = 0;
  let creditosNuevos = 0;
  let escenasNuevas = 0;
  const now = new Date().toISOString();

  for (const p of rows) {
    // Si ya tiene créditos no vacíos detectados previamente, saltar
    if (p.creditos_guardados && p.creditos_guardados !== '[]') continue;

    consultadas++;
    const data = await consultarIntroDB(p.imdb_id, undefined, undefined, true);
    if (!data) {
      await new Promise((res) => setTimeout(res, 80));
      continue;
    }

    let rangos: { start_s: number; end_s: number }[] = [];
    let escenas: { start_s: number; end_s: number }[] = [];

    if (data.outro) {
      const seg = normalizarSegundos(data.outro);
      if (seg && seg.start_s < p.duration) {
        rangos = [{ start_s: seg.start_s, end_s: Math.min(seg.end_s, p.duration) }];
      }
    }

    if (data.post_credits) {
      const postSeg = normalizarSegundos(data.post_credits);
      if (postSeg && postSeg.start_s < p.duration) {
        escenas = [{ start_s: postSeg.start_s, end_s: Math.min(postSeg.end_s, p.duration) }];
      }
    }

    if (rangos.length > 0) {
      creditosNuevos++;
      if (escenas.length > 0) escenasNuevas++;
      console.log(`  [PELÍCULA] «${p.title}»: Créditos ${rangos[0].start_s}s - ${rangos[0].end_s}s${escenas.length ? ` (+ Post-créditos ${escenas[0].start_s}s)` : ''}`);
      if (aplicar) {
        insertPeliStmt.run(p.item_id, JSON.stringify(rangos), JSON.stringify(escenas), now);
      }
    }

    await new Promise((res) => setTimeout(res, 100));
  }

  console.log(`\nResumen películas: ${consultadas} consultas, ${creditosNuevos} créditos encontrados (${escenasNuevas} con post-créditos).`);
}

async function afinarSeriesCreditos(aplicar: boolean) {
  console.log('\n=== AFINANDO CRÉDITOS DE SERIES (Baja confianza o duración recortada) ===');
  const rows = db.prepare(`
    SELECT e.id as episode_id, e.season, e.episode, s.title as serie, s.imdb_id, f.duration,
           r.start_s, r.end_s, (r.end_s - r.start_s) as dur_cred, r.confidence
    FROM skip_ranges r
    JOIN episodes e ON e.id = r.episode_id
    JOIN items s ON s.id = e.show_id
    JOIN media_files f ON f.episode_id = e.id
    WHERE r.kind = 'credits'
      AND s.imdb_id IS NOT NULL AND s.imdb_id != ''
      AND (r.confidence <= 2 OR (r.end_s - r.start_s) < 20)
    ORDER BY s.title, e.season, e.episode
  `).all() as {
    episode_id: number;
    season: number;
    episode: number;
    serie: string;
    imdb_id: string;
    duration: number;
    start_s: number;
    end_s: number;
    dur_cred: number;
    confidence: number;
  }[];

  console.log(`Episodios candidatos a afinar: ${rows.length}`);
  const updateStmt = db.prepare(`
    UPDATE skip_ranges
    SET start_s = ?, end_s = ?, confidence = 85, created_at = ?
    WHERE episode_id = ? AND kind = 'credits'
  `);

  let afinados = 0;
  const now = new Date().toISOString();

  for (const r of rows) {
    const data = await consultarIntroDB(r.imdb_id, r.season, r.episode, false);
    if (data && data.outro) {
      const seg = normalizarSegundos(data.outro);
      if (seg && seg.start_s < r.duration) {
        const fin = Math.min(seg.end_s, r.duration);
        const nuevaDur = fin - seg.start_s;
        if (nuevaDur > r.dur_cred && nuevaDur >= 20) {
          afinados++;
          console.log(`  [AFINADO] «${r.serie}» S${r.season}E${r.episode}: de ${Math.round(r.dur_cred)}s (conf: ${r.confidence}) -> a ${Math.round(nuevaDur)}s (${seg.start_s}s - ${fin}s)`);
          if (aplicar) {
            updateStmt.run(seg.start_s, fin, now, r.episode_id);
          }
        }
      }
    }
    await new Promise((res) => setTimeout(res, 90));
  }
  console.log(`\nResumen afinado: ${afinados} créditos de series mejorados con rango completo de IntroDB.`);
}

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const forzar = process.argv.includes('--forzar');
  const soloPeliculas = process.argv.includes('peliculas');
  const soloSeries = process.argv.includes('series');
  const afinar = process.argv.includes('afinar');

  console.log(`[MediaWatch IntroDB Sync] Iniciando (modo: ${aplicar ? 'GUARDAR EN BD (--aplicar)' : 'DRY-RUN DE PRUEBA'}${forzar ? ', FORZAR TODOS' : ''})`);

  if (afinar) {
    await afinarSeriesCreditos(aplicar);
    return;
  }

  if (!soloPeliculas) {
    await sincronizarSeries(aplicar, forzar);
  }

  if (!soloSeries) {
    await sincronizarPeliculas(aplicar);
  }

  console.log('\n--- SINCRONIZACIÓN FINALIZADA ---');
  if (!aplicar) {
    console.log('Modo prueba finalizado. Para aplicar y guardar los resultados ejecuta con --aplicar');
  }
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
