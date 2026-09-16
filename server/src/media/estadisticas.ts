/**
 * Estadísticas del servidor: qué hay, qué se ve y qué está mal.
 *
 * Tres bloques, porque responden a tres preguntas distintas:
 *  - biblioteca: qué tengo y en qué formatos, para decidir qué recodificar.
 *  - actividad: qué se ha visto de verdad, sacado del historial.
 *  - salud: lo que está incompleto o roto, que es lo que nadie mira hasta que
 *    se sienta a ver algo y falta el capítulo.
 */
import { db } from '../db.ts';

const uno = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...(args as never[])) as T;
const varios = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).all(...(args as never[])) as T[];

export function biblioteca() {
  const totales = uno<{ titulos: number; peliculas: number; series: number }>(
    `SELECT COUNT(*) AS titulos,
            SUM(kind = 'movie') AS peliculas,
            SUM(kind = 'show')  AS series
       FROM items`,
  );

  const ficheros = uno<{ ficheros: number; bytes: number; segundos: number }>(
    `SELECT COUNT(*) AS ficheros, COALESCE(SUM(size),0) AS bytes, COALESCE(SUM(duration),0) AS segundos FROM media_files`,
  );

  const episodios = uno<{ n: number }>('SELECT COUNT(*) AS n FROM episodes').n;

  // Medido: 2,1 ms. Da el pego de consulta cara —un OR con subconsulta dentro
  // del JOIN—, pero con nueve bibliotecas SQLite la resuelve sin despeinarse.
  // Reescribirla en dos agregados con UNION la dejaba en 6,7 ms, peor.
  const porBiblioteca = varios<{ nombre: string; titulos: number; bytes: number }>(
    `SELECT l.name AS nombre, COUNT(DISTINCT i.id) AS titulos, COALESCE(SUM(f.size),0) AS bytes
       FROM libraries l
       LEFT JOIN items i ON i.library_id = l.id
       LEFT JOIN media_files f ON f.item_id = i.id OR f.episode_id IN (SELECT id FROM episodes WHERE show_id = i.id)
      GROUP BY l.id ORDER BY bytes DESC`,
  );

  const resolucion = varios<{ etiqueta: string; n: number; bytes: number }>(
    `SELECT CASE
              WHEN height >= 1900 THEN '4K'
              WHEN height >= 1000 THEN '1080p'
              WHEN height >=  700 THEN '720p'
              WHEN height IS NULL THEN 'Sin analizar'
              ELSE 'SD' END AS etiqueta,
            COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes
       FROM media_files GROUP BY etiqueta ORDER BY n DESC`,
  );

  const codec = varios<{ etiqueta: string; n: number; bytes: number }>(
    `SELECT COALESCE(UPPER(video_codec), 'Sin analizar') AS etiqueta, COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes
       FROM media_files GROUP BY etiqueta ORDER BY n DESC`,
  );

  const hdr = varios<{ etiqueta: string; n: number }>(
    `SELECT COALESCE(hdr, 'SDR') AS etiqueta, COUNT(*) AS n FROM media_files GROUP BY etiqueta ORDER BY n DESC`,
  );

  const audio = varios<{ etiqueta: string; n: number }>(
    `SELECT COALESCE(UPPER(codec), 'Desconocido') AS etiqueta, COUNT(*) AS n
       FROM audio_tracks GROUP BY etiqueta ORDER BY n DESC LIMIT 10`,
  );

  const idiomasAudio = varios<{ etiqueta: string; n: number }>(
    `SELECT COALESCE(language, 'sin marcar') AS etiqueta, COUNT(DISTINCT file_id) AS n
       FROM audio_tracks GROUP BY etiqueta ORDER BY n DESC LIMIT 8`,
  );

  const conSubtitulos = uno<{ n: number }>('SELECT COUNT(DISTINCT file_id) AS n FROM sub_tracks').n;

  return {
    titulos: totales.titulos,
    peliculas: totales.peliculas ?? 0,
    series: totales.series ?? 0,
    episodios,
    ficheros: ficheros.ficheros,
    bytes: ficheros.bytes,
    segundos: ficheros.segundos,
    porBiblioteca,
    resolucion,
    codec,
    hdr,
    audio,
    idiomasAudio,
    subtitulos: { con: conSubtitulos, sin: Math.max(0, ficheros.ficheros - conSubtitulos) },
  };
}

export function actividad(dias = 30) {
  const desde = new Date(Date.now() - dias * 86400_000).toISOString();

  const resumen = uno<{ sesiones: number; segundos: number; titulos: number }>(
    `SELECT COUNT(*) AS sesiones, COALESCE(SUM(seconds),0) AS segundos, COUNT(DISTINCT item_id) AS titulos
       FROM playbacks WHERE started_at >= ?`,
    desde,
  );

  const porDia = varios<{ dia: string; segundos: number; sesiones: number }>(
    `SELECT substr(started_at, 1, 10) AS dia, COALESCE(SUM(seconds),0) AS segundos, COUNT(*) AS sesiones
       FROM playbacks WHERE started_at >= ? GROUP BY dia ORDER BY dia`,
    desde,
  );

  const porUsuario = varios<{ nombre: string; segundos: number; sesiones: number }>(
    `SELECT u.name AS nombre, COALESCE(SUM(p.seconds),0) AS segundos, COUNT(*) AS sesiones
       FROM playbacks p JOIN users u ON u.id = p.user_id
      WHERE p.started_at >= ? GROUP BY u.id ORDER BY segundos DESC`,
    desde,
  );

  const porCliente = varios<{ nombre: string; segundos: number; sesiones: number }>(
    `SELECT COALESCE(cliente, 'Desconocido') AS nombre, COALESCE(SUM(seconds),0) AS segundos, COUNT(*) AS sesiones
       FROM playbacks WHERE started_at >= ? GROUP BY nombre ORDER BY segundos DESC`,
    desde,
  );

  const porModo = varios<{ nombre: string; sesiones: number }>(
    `SELECT COALESCE(modo, 'desconocido') AS nombre, COUNT(*) AS sesiones
       FROM playbacks WHERE started_at >= ? GROUP BY nombre ORDER BY sesiones DESC`,
    desde,
  );

  const masVistos = varios<{ itemId: number; titulo: string; segundos: number; sesiones: number }>(
    `SELECT i.id AS itemId, i.title AS titulo, COALESCE(SUM(p.seconds),0) AS segundos, COUNT(*) AS sesiones
       FROM playbacks p JOIN items i ON i.id = p.item_id
      WHERE p.started_at >= ? GROUP BY i.id ORDER BY segundos DESC LIMIT 10`,
    desde,
  );

  const reciente = varios<{ itemId: number; titulo: string; usuario: string; cuando: string; segundos: number; episodio: string | null }>(
    `SELECT i.id AS itemId, i.title AS titulo, u.name AS usuario, p.updated_at AS cuando, p.seconds AS segundos,
            CASE WHEN e.id IS NULL THEN NULL
                 ELSE 'T' || e.season || 'E' || e.episode END AS episodio
       FROM playbacks p
       JOIN items i ON i.id = p.item_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN episodes e ON e.id = p.episode_id
      ORDER BY p.updated_at DESC LIMIT 15`,
  );

  return { dias, ...resumen, porDia, porUsuario, porCliente, porModo, masVistos, reciente };
}

export function salud() {
  // Un título sin sinopsis ni portada es el que luego no se encuentra al buscar.
  const sinMetadatos = uno<{ n: number }>(
    'SELECT COUNT(*) AS n FROM items WHERE poster IS NULL OR plot IS NULL OR fanart IS NULL',
  ).n;

  const sinAnalizar = uno<{ n: number }>('SELECT COUNT(*) AS n FROM media_files WHERE probed IS NULL OR probed = 0 OR duration IS NULL').n;

  const sinSubtitulos = uno<{ n: number }>(
    'SELECT COUNT(*) AS n FROM media_files f WHERE NOT EXISTS (SELECT 1 FROM sub_tracks s WHERE s.file_id = f.id)',
  ).n;

  const sinFichero = varios<{ id: number; titulo: string; tipo: string }>(
    `SELECT i.id, i.title AS titulo, i.kind AS tipo FROM items i
      WHERE NOT EXISTS (SELECT 1 FROM media_files f WHERE f.item_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.show_id = i.id)
      ORDER BY i.title LIMIT 40`,
  );

  const episodiosSinFichero = uno<{ n: number }>(
    'SELECT COUNT(*) AS n FROM episodes e WHERE NOT EXISTS (SELECT 1 FROM media_files f WHERE f.episode_id = e.id)',
  ).n;

  // Mismo título y año dos veces suele ser una copia vieja que quedó suelta.
  const duplicados = varios<{ titulo: string; anio: number | null; n: number }>(
    `SELECT title AS titulo, year AS anio, COUNT(*) AS n
       FROM items GROUP BY search_title, year HAVING n > 1 ORDER BY n DESC, title LIMIT 25`,
  );

  return { sinMetadatos, sinAnalizar, sinSubtitulos, sinFichero, episodiosSinFichero, duplicados };
}
