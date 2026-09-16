/**
 * Detector de copias malas.
 *
 * Ninguna app de vídeo te dice que tu fichero es malo: Plex reproduce igual un
 * remux de Blu-ray que un reescalado de 2 GB con el cartel de «4K». Aquí sí se
 * puede decir, porque el bitrate, la resolución y el códec ya están en la base
 * de datos: es una cuenta, no un análisis.
 *
 * La regla es el **bitrate por píxel y fotograma**, no el bitrate a secas. Un
 * 1080p a 4 Mbps está bien; un 2160p a esos mismos 4 Mbps es un reescalado con
 * el detalle ya perdido, y ambos «pesan» lo mismo por segundo. Dividir entre el
 * número de píxeles pone a las dos resoluciones en la misma vara de medir.
 *
 * Los umbrales salen de lo que consume cada códec para verse bien; se comparan
 * contra HEVC y se ajustan para los demás, porque un H.264 necesita alrededor
 * del doble de bitrate que un HEVC para la misma calidad.
 */
import { db } from '../db.ts';

/** Bits por píxel y fotograma por debajo de los cuales la imagen se rompe. */
const MALO = 0.028;
const JUSTO = 0.045;

/*
 * Cuánto bitrate necesita cada códec respecto a HEVC para verse igual. Un
 * MPEG-4 antiguo necesita más del doble; AV1 se apaña con menos.
 */
const EXIGENCIA: Record<string, number> = {
  hevc: 1, h265: 1, av1: 0.8, vp9: 1.1,
  h264: 1.9, avc: 1.9,
  mpeg4: 3.2, xvid: 3.2, divx: 3.2, msmpeg4v3: 3.2,
  mpeg2video: 4.5, vc1: 2.2, wmv3: 3,
};

export type Veredicto = 'malo' | 'justo' | 'bien' | 'datos';

export type Analisis = {
  fileId: number;
  itemId: number | null;
  titulo: string;
  episodio: string | null;
  ruta: string;
  bytes: number;
  duracion: number;
  ancho: number;
  alto: number;
  codec: string;
  /** Mbps reales del fichero, vídeo y audio juntos. */
  bitrate: number;
  /** Bits por píxel y fotograma, ya normalizado por códec. */
  bpp: number;
  veredicto: Veredicto;
  motivo: string;
};

const etiquetaResolucion = (alto: number) =>
  alto >= 1900 ? '4K' : alto >= 1000 ? '1080p' : alto >= 700 ? '720p' : 'SD';

/**
 * Analiza la biblioteca entera. No toca nada: solo mira lo que ya está medido.
 * Se salta lo que no tiene datos suficientes en vez de inventarse un veredicto.
 */
export function analizar(limite = 200): {
  total: number;
  malos: number;
  justos: number;
  datosRotos: Analisis[];
  peores: Analisis[];
} {
  const filas = db
    .prepare(
      `SELECT f.id AS fileId, f.item_id AS itemId, f.path, f.size, f.duration, f.width, f.height, f.video_codec,
              COALESCE(i.title, s.title) AS titulo, e.season, e.episode
         FROM media_files f
         LEFT JOIN items i ON i.id = f.item_id
         LEFT JOIN episodes e ON e.id = f.episode_id
         LEFT JOIN items s ON s.id = e.show_id
        WHERE f.duration > 60 AND f.size > 0 AND f.width > 0 AND f.height > 0`,
    )
    .all() as any[];

  const analizados: Analisis[] = [];

  for (const f of filas) {
    // 24 fps de referencia: no está en la base de datos y usar el real cambiaría
    // el umbral de sitio sin decir nada nuevo sobre la calidad.
    const fps = 24;
    const bitrate = (f.size * 8) / f.duration;
    const bppCrudo = bitrate / (f.width * f.height * fps);
    const codec = String(f.video_codec ?? '').toLowerCase();
    const exigencia = EXIGENCIA[codec] ?? 1.5;
    const bpp = bppCrudo / exigencia;

    let veredicto: Veredicto = 'bien';
    let motivo = '';

    /*
     * Antes de juzgar la calidad hay que fiarse del dato. Aparecieron ficheros
     * con duración 4.294.967 s —1.193 horas, que es 2^32/1000: un desbordamiento
     * de 32 bits al sondearlos—, y salían como «la peor copia de la biblioteca»
     * cuando en realidad son 10 GB perfectamente sanos. Decir «tu copia es
     * mala» cuando lo que falla es la medición es peor que no decir nada.
     */
    if (f.duration > 21600 || f.duration < 60) {
      veredicto = 'datos';
      motivo = `Duración imposible (${Math.round(f.duration)} s): hay que volver a sondear el fichero`;
    } else if (bpp < MALO) {
      veredicto = 'malo';
      motivo = `${etiquetaResolucion(f.height)} a ${(bitrate / 1e6).toFixed(1)} Mbps: muy poco para ese tamaño de imagen`;
    } else if (bpp < JUSTO) {
      veredicto = 'justo';
      motivo = `${etiquetaResolucion(f.height)} a ${(bitrate / 1e6).toFixed(1)} Mbps: se sostiene, pero sin margen`;
    }

    if (veredicto === 'bien') continue;

    analizados.push({
      fileId: f.fileId,
      itemId: f.itemId ?? null,
      titulo: f.titulo ?? '(sin título)',
      episodio: f.season != null ? `T${f.season}E${String(f.episode).padStart(2, '0')}` : null,
      ruta: f.path,
      bytes: f.size,
      duracion: f.duration,
      ancho: f.width,
      alto: f.height,
      codec: codec.toUpperCase(),
      bitrate: Number((bitrate / 1e6).toFixed(2)),
      bpp: Number(bpp.toFixed(4)),
      veredicto,
      motivo,
    });
  }

  analizados.sort((a, b) => a.bpp - b.bpp);

  return {
    total: filas.length,
    malos: analizados.filter((a) => a.veredicto === 'malo').length,
    justos: analizados.filter((a) => a.veredicto === 'justo').length,
    datosRotos: analizados.filter((a) => a.veredicto === 'datos'),
    peores: analizados.filter((a) => a.veredicto !== 'datos').slice(0, limite),
  };
}

/**
 * Títulos con más de una copia. Es donde más fácil está ganar espacio: si una
 * es claramente peor, sobra.
 */
export function copiasRepetidas(limite = 40) {
  const grupos = db
    .prepare(
      `SELECT i.id AS itemId, i.title AS titulo, COUNT(f.id) AS copias, SUM(f.size) AS bytes
         FROM items i JOIN media_files f ON f.item_id = i.id
        GROUP BY i.id HAVING copias > 1
        ORDER BY bytes DESC LIMIT ?`,
    )
    .all(limite) as any[];

  return grupos.map((g) => ({
    ...g,
    ficheros: db
      .prepare('SELECT id, path, size, width, height, video_codec, duration FROM media_files WHERE item_id = ? ORDER BY size DESC')
      .all(g.itemId),
  }));
}
