/**
 * Renumerar episodios de una serie.
 *
 * El problema clásico del anime: en disco los ficheros van del 1 al 243 de
 * corrido, pero la serie está partida en temporadas, así que la ficha muestra
 * «temporada 1, episodio 187» y nada cuadra con lo que dice cualquier guía.
 *
 * Aquí no se toca nada sin enseñarlo antes: se calcula el reparto, se devuelve
 * el antes y el después de cada episodio, y solo se escribe cuando se confirma.
 */
import { db } from '../db.ts';
import { temporadasDeSerie } from './tmdb.ts';

export type Temporada = { temporada: number; episodios: number; primero: number; ultimo: number };

export type EstadoNumeracion = {
  showId: number;
  titulo: string;
  tmdbId: string | null;
  total: number;
  temporadas: Temporada[];
  tipo: 'absoluta' | 'hueco' | null;
  sospechoso: boolean;
  motivo: string | null;
  renumerado: boolean;
};

export type CambioEpisodio = {
  episodeId: number;
  titulo: string | null;
  antes: string;
  despues: string;
  cambia: boolean;
};

export type PlanNumeracion = {
  showId: number;
  origen: string;
  reparto: { temporada: number; episodios: number }[];
  cambios: CambioEpisodio[];
  mueve: number;
  sobran: number;
  aviso: string | null;
};

const etiqueta = (temporada: number, episodio: number) =>
  'S' + String(temporada).padStart(2, '0') + 'E' + String(episodio).padStart(2, '0');

function episodiosDe(showId: number) {
  return db
    .prepare('SELECT id, season, episode, title, absolute FROM episodes WHERE show_id = ? ORDER BY season, episode')
    .all(showId) as { id: number; season: number; episode: number; title: string | null; absolute: number | null }[];
}

export function estado(showId: number): EstadoNumeracion {
  const serie = db.prepare('SELECT id, title, tmdb_id FROM items WHERE id = ?').get(showId) as any;
  if (!serie) throw new Error('Serie no encontrada');

  const filas = db
    .prepare(
      `SELECT season AS temporada, COUNT(*) AS episodios, MIN(episode) AS primero, MAX(episode) AS ultimo
         FROM episodes WHERE show_id = ? GROUP BY season ORDER BY season`,
    )
    .all(showId) as Temporada[];

  const total = filas.reduce((n, t) => n + t.episodios, 0);
  // «Renumerado» no es haber guardado el absoluto alguna vez, sino que la
  // numeración de ahora difiera de la que traía el disco; si no, tras deshacer
  // se seguiría ofreciendo deshacer.
  const renumerado =
    (db
      .prepare('SELECT COUNT(*) AS n FROM episodes WHERE show_id = ? AND absolute IS NOT NULL AND (season <> 1 OR episode <> absolute)')
      .get(showId) as any).n > 0;

  // Una sola temporada con muchos episodios casi siempre significa numeración
  // absoluta sin repartir; también canta que falten números por el medio.
  let motivo: string | null = null;
  let tipo: 'absoluta' | 'hueco' | null = null;
  const normales = filas.filter((t) => t.temporada > 0);

  if (normales.length === 1 && normales[0].episodios > 30) {
    tipo = 'absoluta';
    motivo = `Los ${normales[0].episodios} episodios están todos en la temporada ${normales[0].temporada}, sin repartir`;
  } else {
    // Que falten números por el medio no es un fallo de numeración sino un
    // fichero que no está; se avisa igual, pero no se ofrece renumerar.
    const conHueco = normales.find((t) => t.ultimo - t.primero + 1 !== t.episodios);
    if (conHueco) {
      const faltan = conHueco.ultimo - conHueco.primero + 1 - conHueco.episodios;
      tipo = 'hueco';
      motivo = `Faltan ${faltan} episodio${faltan === 1 ? '' : 's'} en la temporada ${conHueco.temporada} (va del ${conHueco.primero} al ${conHueco.ultimo} y solo hay ${conHueco.episodios})`;
    }
  }

  return { showId, titulo: serie.title, tmdbId: serie.tmdb_id ?? null, total, temporadas: filas, tipo, sospechoso: motivo != null, motivo, renumerado };
}

function construirPlan(showId: number, reparto: { temporada: number; episodios: number }[], origen: string): PlanNumeracion {
  const episodios = episodiosDe(showId);

  // El orden actual manda: el episodio absoluto n es el n-ésimo de la lista,
  // ordenada por temporada y número. Si ya se renumeró antes, vale el absoluto
  // guardado, que es el que vino del disco.
  const ordenados = episodios.slice().sort((a, b) => (a.absolute ?? 0) - (b.absolute ?? 0) || a.season - b.season || a.episode - b.episode);

  const cambios: CambioEpisodio[] = [];
  let indice = 0;
  for (const bloque of reparto) {
    for (let n = 1; n <= bloque.episodios; n++) {
      const ep = ordenados[indice];
      if (!ep) break;
      const antes = etiqueta(ep.season, ep.episode);
      const despues = etiqueta(bloque.temporada, n);
      cambios.push({ episodeId: ep.id, titulo: ep.title, antes, despues, cambia: antes !== despues });
      indice++;
    }
  }

  const sobran = ordenados.length - indice;
  const mueve = cambios.filter((c) => c.cambia).length;
  const cabenDeMas = reparto.reduce((n, b) => n + b.episodios, 0) - ordenados.length;

  let aviso: string | null = null;
  if (sobran > 0) aviso = `Sobran ${sobran} episodios: el reparto solo cubre ${indice} y en disco hay ${ordenados.length}. Se quedarán como están.`;
  else if (cabenDeMas > 0) aviso = `Faltan ${cabenDeMas} episodios para completar el reparto; los que hay se colocan en orden.`;

  return { showId, origen, reparto, cambios, mueve, sobran, aviso };
}

/** Reparte la numeración absoluta usando las temporadas que declara TMDb. */
export async function planDesdeTmdb(showId: number): Promise<PlanNumeracion> {
  const serie = db.prepare('SELECT id, title, tmdb_id FROM items WHERE id = ?').get(showId) as any;
  if (!serie) throw new Error('Serie no encontrada');
  if (!serie.tmdb_id) throw new Error('Esta serie no tiene id de TMDb; identifícala primero desde su ficha');

  const temporadas = await temporadasDeSerie(Number(serie.tmdb_id));
  if (temporadas.length === 0) throw new Error('TMDb no devuelve temporadas para esta serie');

  return construirPlan(showId, temporadas.map((t) => ({ temporada: t.temporada, episodios: t.episodios })), `TMDb ${serie.tmdb_id}`);
}

/** Reparto escrito a mano: [12, 13, 13] son tres temporadas de 12, 13 y 13. */
export function planManual(showId: number, tamanos: number[]): PlanNumeracion {
  if (tamanos.length === 0 || tamanos.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error('El reparto tiene que ser una lista de números enteros positivos');
  }
  return construirPlan(showId, tamanos.map((episodios, i) => ({ temporada: i + 1, episodios })), 'reparto manual');
}

/** Corrige un desfase dentro de una temporada («van todos uno por delante»). */
export function planDesplazamiento(showId: number, temporada: number, desde: number, delta: number): PlanNumeracion {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('El desplazamiento tiene que ser distinto de cero');

  const episodios = episodiosDe(showId).filter((e) => e.season === temporada && e.episode >= desde);
  if (episodios.length === 0) throw new Error('No hay episodios que desplazar con esos valores');
  if (episodios.some((e) => e.episode + delta < 1)) throw new Error('El desplazamiento dejaría episodios con número menor que 1');

  const cambios: CambioEpisodio[] = episodios.map((ep) => ({
    episodeId: ep.id,
    titulo: ep.title,
    antes: etiqueta(ep.season, ep.episode),
    despues: etiqueta(ep.season, ep.episode + delta),
    cambia: true,
  }));

  return {
    showId,
    origen: `desplazar ${delta > 0 ? '+' : ''}${delta} desde ${etiqueta(temporada, desde)}`,
    reparto: [],
    cambios,
    mueve: cambios.length,
    sobran: 0,
    aviso: null,
  };
}

/** Deshace una renumeración: devuelve cada episodio al número que traía del disco. */
export function planDeshacer(showId: number): PlanNumeracion {
  const episodios = episodiosDe(showId).filter((e) => e.absolute != null);
  if (episodios.length === 0) throw new Error('Esta serie no se ha renumerado, no hay nada que deshacer');

  const cambios: CambioEpisodio[] = episodios.map((ep) => ({
    episodeId: ep.id,
    titulo: ep.title,
    antes: etiqueta(ep.season, ep.episode),
    despues: etiqueta(1, ep.absolute as number),
    cambia: ep.season !== 1 || ep.episode !== ep.absolute,
  }));

  return { showId, origen: 'volver a la numeración del disco', reparto: [], cambios, mueve: cambios.filter((c) => c.cambia).length, sobran: 0, aviso: null };
}

const LEER = /^S(\d+)E(\d+)$/;

/**
 * Escribe el plan. En dos pasadas porque `UNIQUE(show_id, season, episode)`
 * salta en cuanto dos episodios se cruzan a mitad de camino: primero se apartan
 * todos a temporadas negativas, que nadie usa, y después se colocan.
 */
export function aplicar(plan: PlanNumeracion) {
  const mover = plan.cambios.filter((c) => c.cambia);
  if (mover.length === 0) return { movidos: 0 };

  const guardarAbsoluto = db.prepare('UPDATE episodes SET absolute = episode WHERE show_id = ? AND absolute IS NULL');
  const apartar = db.prepare('UPDATE episodes SET season = -1000 - season WHERE show_id = ?');
  const colocar = db.prepare('UPDATE episodes SET season = ?, episode = ? WHERE id = ?');
  const devolver = db.prepare('UPDATE episodes SET season = -1000 - season WHERE show_id = ? AND season < -999');

  db.exec('BEGIN');
  try {
    // Solo tiene sentido conservar el absoluto si la serie venía sin repartir.
    const temporadas = (db.prepare('SELECT COUNT(DISTINCT season) AS n FROM episodes WHERE show_id = ?').get(plan.showId) as any).n;
    if (temporadas === 1) guardarAbsoluto.run(plan.showId);

    apartar.run(plan.showId);
    for (const cambio of mover) {
      const m = LEER.exec(cambio.despues);
      if (!m) throw new Error(`Destino ilegible: ${cambio.despues}`);
      colocar.run(Number(m[1]), Number(m[2]), cambio.episodeId);
    }
    devolver.run(plan.showId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { movidos: mover.length };
}

/** Series que probablemente necesiten repaso, para ofrecerlo sin que haya que buscarlas. */
export function seriesSospechosas(limite = 50) {
  const shows = db.prepare("SELECT id FROM items WHERE kind = 'show'").all() as { id: number }[];
  return shows
    .map((s) => estado(s.id))
    .filter((e) => e.sospechoso)
    .sort((a, b) => b.total - a.total)
    .slice(0, limite);
}
