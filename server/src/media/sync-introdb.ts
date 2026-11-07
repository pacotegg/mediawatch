import { db } from '../db.ts';
import { esperarSiHayAlguienViendo, hayAlguienViendo } from './ocupado.ts';

export type Segmento = {
  start_sec?: number;
  end_sec?: number;
  start_ms?: number;
  end_ms?: number;
};

export type IntroDBResponse = {
  intro?: Segmento | null;
  outro?: Segmento | null;
  recap?: Segmento | null;
  post_credits?: Segmento | null;
};

export type ValidacionResultado = {
  valido: boolean;
  motivo?: string;
  start_s: number;
  end_s: number;
};

/**
 * Consulta SkipDB e IntroDB de forma óptima:
 * En series, SkipDB responde en ~150ms de media; si no tiene segmento o es película, consulta IntroDB.
 */
export async function consultarIntroDB(
  imdbId: string,
  season?: number,
  episode?: number,
  isMovie = false,
): Promise<IntroDBResponse | null> {
  // 1. Para series: probar SkipDB primero (latencia ultrabaja ~150ms)
  if (!isMovie && season !== undefined && episode !== undefined) {
    try {
      const skipUrl = `https://api.skipdb.tv/api/segments?imdb_id=${encodeURIComponent(imdbId)}&season=${season}&episode=${episode}`;
      const res = await fetch(skipUrl, {
        headers: { 'User-Agent': 'MediaWatch/1.0' },
        signal: AbortSignal.timeout(2500),
      });
      if (res.status === 200) {
        const data = (await res.json()) as {
          segments?: { intro?: Segmento | null; outro?: Segmento | null; recap?: Segmento | null };
        };
        if (data.segments && (data.segments.intro || data.segments.outro || data.segments.recap)) {
          return {
            intro: data.segments.intro,
            outro: data.segments.outro,
            recap: data.segments.recap,
          };
        }
      }
    } catch {
      // Si SkipDB falla o da timeout, continuamos con IntroDB
    }
  }

  // 2. IntroDB (películas o fallback de series)
  const url = isMovie
    ? `https://api.introdb.app/segments?imdb_id=${encodeURIComponent(imdbId)}&is_movie=true`
    : `https://api.introdb.app/segments?imdb_id=${encodeURIComponent(imdbId)}&season=${season}&episode=${episode}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MediaWatch/1.0' },
      signal: AbortSignal.timeout(2500),
    });
    if (res.status === 200) {
      return (await res.json()) as IntroDBResponse;
    }
  } catch {
    // Si IntroDB falla o da timeout
  }

  return null;
}

export function normalizarSegundos(seg?: Segmento | null): { start_s: number; end_s: number } | null {
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

/**
 * Valida un rango temporal contra las características reales de nuestro fichero:
 * 1. Plausibilidad de duración y límites temporales.
 * 2. Guarda de subtítulos y diálogos: los créditos NO pueden pisar escenas con diálogo continuo.
 */
export function validarRangoContraFichero(
  fileId: number,
  duracion: number,
  tipo: 'intro' | 'credits',
  rango: { start_s: number; end_s: number },
): ValidacionResultado {
  let { start_s, end_s } = rango;

  if (tipo === 'credits') {
    // Los créditos deben estar en la segunda mitad del metraje
    if (start_s < duracion * 0.45 || start_s >= duracion - 5) {
      return { valido: false, motivo: 'inicio_fuera_de_rango', start_s, end_s };
    }

    const duracionCreditos = end_s - start_s;
    if (duracionCreditos < 15 || duracionCreditos > 900) {
      return { valido: false, motivo: 'duracion_inverosimil', start_s, end_s };
    }

    // El fin de los créditos no puede sobrepasar la duración del fichero
    if (end_s > duracion) {
      end_s = duracion;
    }

    // Guarda de diálogos: ¿hay subtítulos indexados para este archivo?
    try {
      const frasesPosteriores = db
        .prepare('SELECT count(*) as c FROM dialogue WHERE file_id = ? AND start_ms > ?')
        .get(fileId, (start_s + 15) * 1000) as { c: number } | undefined;

      // Si hay más de 2 frases de diálogo 15 segundos después de que supuestamente empiezan
      // los créditos, es un corte diferente o el metraje sigue en curso: se descarta.
      if (frasesPosteriores && frasesPosteriores.c > 2) {
        return { valido: false, motivo: 'dialogos_posteriores_detectados', start_s, end_s };
      }

      // Además, si tenemos el último diálogo, los créditos no deben empezar antes del último diálogo
      const ultFrase = db
        .prepare('SELECT max(start_ms) as ult_ms FROM dialogue WHERE file_id = ?')
        .get(fileId) as { ult_ms: number | null } | undefined;

      if (ultFrase?.ult_ms) {
        const ultDialogoS = ultFrase.ult_ms / 1000;
        // Si el timestamp propone créditos más de 4s antes del último diálogo, ajustamos o descartamos
        if (start_s < ultDialogoS - 4) {
          // Si está a poca distancia (menos de 30s), lo ajustamos justo tras el último diálogo
          if (ultDialogoS - start_s < 30 && ultDialogoS < duracion - 10) {
            start_s = Math.round((ultDialogoS + 1) * 10) / 10;
          } else {
            return { valido: false, motivo: 'pisa_ultimo_dialogo', start_s, end_s };
          }
        }
      }
    } catch {
      // Si la tabla dialogue no existe o falla la consulta, nos basamos en los límites temporales
    }

    return { valido: true, start_s, end_s };
  }

  if (tipo === 'intro') {
    // La cabecera debe estar en la primera mitad del archivo y durar entre 8s y 180s
    if (end_s > duracion * 0.5 || start_s < 0 || end_s <= start_s) {
      return { valido: false, motivo: 'intro_fuera_de_primera_mitad', start_s, end_s };
    }

    const duracionIntro = end_s - start_s;
    if (duracionIntro < 8 || duracionIntro > 180) {
      return { valido: false, motivo: 'duracion_intro_inverosimil', start_s, end_s };
    }

    return { valido: true, start_s, end_s };
  }

  return { valido: false, motivo: 'tipo_desconocido', start_s, end_s };
}

export type JobIntroDB = {
  running: boolean;
  total: number;
  hechos: number;
  encontrados: number;
  descartados: number;
  actual: string;
  parando: boolean;
  esperando: boolean;
  error: string | null;
  finishedAt: string | null;
};

export const jobIntroDB: JobIntroDB = {
  running: false,
  total: 0,
  hechos: 0,
  encontrados: 0,
  descartados: 0,
  actual: '',
  parando: false,
  esperando: false,
  error: null,
  finishedAt: null,
};

export function pararIntroDB(): boolean {
  if (!jobIntroDB.running) return false;
  jobIntroDB.parando = true;
  return true;
}

/**
 * Sincroniza un episodio concreto con IntroDB/SkipDB validando contra el fichero.
 */
export async function sincronizarEpisodioSeguro(
  episodeId: number,
  imdbId: string,
  season: number,
  episode: number,
  duration: number,
  fileId: number,
): Promise<{ intro: boolean; credits: boolean }> {
  const data = await consultarIntroDB(imdbId, season, episode, false);
  if (!data) return { intro: false, credits: false };

  const insertStmt = db.prepare(`
    INSERT INTO skip_ranges (episode_id, kind, start_s, end_s, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(episode_id, kind) DO UPDATE SET
      start_s = excluded.start_s,
      end_s = excluded.end_s,
      confidence = excluded.confidence,
      created_at = excluded.created_at
    WHERE skip_ranges.confidence < 100
  `);

  let introGuardada = false;
  let creditosGuardados = false;
  const now = new Date().toISOString();

  // Créditos
  if (data.outro) {
    const norm = normalizarSegundos(data.outro);
    if (norm) {
      const val = validarRangoContraFichero(fileId, duration, 'credits', norm);
      if (val.valido) {
        insertStmt.run(episodeId, 'credits', val.start_s, val.end_s, 85, now);
        creditosGuardados = true;
      }
    }
  }

  // Cabecera
  if (data.intro) {
    const norm = normalizarSegundos(data.intro);
    if (norm) {
      const val = validarRangoContraFichero(fileId, duration, 'intro', norm);
      if (val.valido) {
        insertStmt.run(episodeId, 'intro', val.start_s, val.end_s, 85, now);
        introGuardada = true;
      }
    }
  }

  return { intro: introGuardada, credits: creditosGuardados };
}

/**
 * Sincroniza una película concreta con IntroDB validando contra el fichero.
 */
export async function sincronizarPeliculaSegura(
  itemId: number,
  imdbId: string,
  duration: number,
  fileId: number,
): Promise<{ credits: boolean; postCredits: boolean }> {
  const data = await consultarIntroDB(imdbId, undefined, undefined, true);
  if (!data) return { credits: false, postCredits: false };

  let rangos: { start_s: number; end_s: number }[] = [];
  let escenas: { start_s: number; end_s: number }[] = [];

  if (data.outro) {
    const norm = normalizarSegundos(data.outro);
    if (norm) {
      const val = validarRangoContraFichero(fileId, duration, 'credits', norm);
      if (val.valido) {
        rangos = [{ start_s: val.start_s, end_s: val.end_s }];
      }
    }
  }

  if (data.post_credits) {
    const postNorm = normalizarSegundos(data.post_credits);
    if (postNorm && postNorm.start_s < duration) {
      escenas = [{ start_s: postNorm.start_s, end_s: Math.min(postNorm.end_s, duration) }];
    }
  }

  if (rangos.length > 0) {
    const insertPeliStmt = db.prepare(`
      INSERT INTO pelicula_creditos (item_id, rangos, escenas, metodo, created_at)
      VALUES (?, ?, ?, 'introdb', ?)
      ON CONFLICT(item_id) DO UPDATE SET
        rangos = excluded.rangos,
        escenas = excluded.escenas,
        metodo = excluded.metodo,
        created_at = excluded.created_at
      WHERE pelicula_creditos.metodo != 'manual'
    `);
    insertPeliStmt.run(itemId, JSON.stringify(rangos), JSON.stringify(escenas), new Date().toISOString());
    return { credits: true, postCredits: escenas.length > 0 };
  }

  return { credits: false, postCredits: false };
}

/**
 * Sincroniza en segundo plano toda la biblioteca que carece de tramos de salto.
 * Respeta «hayAlguienViendo» para no saturar disco mientras se reproduce.
 */
export function sincronizarBibliotecaIntroDB(soloNuevos = true) {
  if (jobIntroDB.running) throw new Error('Ya hay una sincronización con IntroDB en curso');

  const episodios = db.prepare(`
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

  const peliculas = db.prepare(`
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

  const listaEpisodios = soloNuevos ? episodios.filter((e) => e.tiene_intro === 0 || e.tiene_creditos === 0) : episodios;
  const listaPeliculas = soloNuevos
    ? peliculas.filter((p) => !p.creditos_guardados || p.creditos_guardados === '[]')
    : peliculas;

  const total = listaEpisodios.length + listaPeliculas.length;

  Object.assign(jobIntroDB, {
    running: true,
    total,
    hechos: 0,
    encontrados: 0,
    descartados: 0,
    actual: '',
    parando: false,
    esperando: false,
    error: null,
    finishedAt: null,
  });

  queueMicrotask(async () => {
    try {
      // 1. Episodios
      for (const ep of listaEpisodios) {
        if (jobIntroDB.parando) break;
        jobIntroDB.actual = `${ep.serie} S${ep.season}E${ep.episode}`;

        const res = await sincronizarEpisodioSeguro(
          ep.episode_id,
          ep.imdb_id,
          ep.season,
          ep.episode,
          ep.duration,
          ep.file_id,
        );

        if (res.intro || res.credits) {
          jobIntroDB.encontrados++;
        } else {
          jobIntroDB.descartados++;
        }
        jobIntroDB.hechos++;
        await new Promise((r) => setTimeout(r, 90));
      }

      // 2. Películas
      for (const peli of listaPeliculas) {
        if (jobIntroDB.parando) break;
        jobIntroDB.actual = peli.title;

        const res = await sincronizarPeliculaSegura(peli.item_id, peli.imdb_id, peli.duration, peli.file_id);
        if (res.credits) {
          jobIntroDB.encontrados++;
        } else {
          jobIntroDB.descartados++;
        }
        jobIntroDB.hechos++;
        await new Promise((r) => setTimeout(r, 90));
      }
    } catch (err) {
      jobIntroDB.error = (err as Error).message;
    } finally {
      jobIntroDB.running = false;
      jobIntroDB.parando = false;
      jobIntroDB.esperando = false;
      jobIntroDB.finishedAt = new Date().toISOString();
      console.log(`[introdb] sincronización terminada: ${jobIntroDB.hechos}/${jobIntroDB.total} procesados, ${jobIntroDB.encontrados} rangos guardados.`);
    }
  });
}
