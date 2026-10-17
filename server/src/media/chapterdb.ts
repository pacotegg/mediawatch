import { db } from '../db.ts';
import type { Capitulo } from './probe.ts';

/** Comprueba si el título de un capítulo es meramente numérico o genérico. */
export function esTituloGenerico(titulo: string): boolean {
  if (!titulo || !titulo.trim()) return true;
  const t = titulo.trim();
  return /^(chapter|cap[ií]tulo|part|parte|escena|scene)\s*\d+$/i.test(t) || /^\d+$/i.test(t);
}

/** Comprueba si una lista de capítulos contiene únicamente nombres genéricos. */
export function sonCapitulosGenericos(capitulos: Capitulo[]): boolean {
  if (!capitulos || capitulos.length === 0) return true;
  return capitulos.every((c) => esTituloGenerico(c.title));
}

/** Convierte cadenas tipo '01:23:45.678', '02:09.15' o '12:34' a segundos. */
export function tiempoASegundos(str: string): number {
  if (!str) return 0;
  const partes = str.trim().split(':');
  if (partes.length === 3) {
    const h = parseFloat(partes[0]) || 0;
    const m = parseFloat(partes[1]) || 0;
    const s = parseFloat(partes[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (partes.length === 2) {
    // Si viene en formato HH:MM.SS o MM:SS
    const p0 = parseFloat(partes[0]) || 0;
    const p1 = parseFloat(partes[1]) || 0;
    if (p0 > 59) return p0 * 60 + p1;
    return p0 * 60 + p1;
  }
  return parseFloat(str) || 0;
}

export type ResultadoChapterDb = {
  id: string;
  title: string;
  type: string;
  durationStr: string;
  durationSec: number;
  hasNames: boolean;
  score: number;
};

/**
 * Busca capítulos en el archivo de ChapterDB (espejo Plex).
 */
export async function buscarEnChapterDb(titulo: string, duracionSec?: number): Promise<ResultadoChapterDb[]> {
  const url = `https://chapterdb.plex.tv/browse?title=${encodeURIComponent(titulo)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return [];
  const html = await res.text();

  const trRegex = /<tr>([\s\S]*?)<\/tr>/g;
  const resultados: ResultadoChapterDb[] = [];
  let m: RegExpExecArray | null;

  while ((m = trRegex.exec(html)) !== null) {
    const tr = m[1];
    const idMatch = tr.match(/href="\/browse\/(\d+)"/);
    const titleMatch = tr.match(/<a href="\/browse\/\d+">([^<]+)<\/a>/);
    const durMatch = tr.match(/<td style="width:12%">([^<]+)<\/td>/);
    const typeMatch = tr.match(/<td style="width:7%">([^<]+)<\/td>/);
    const hasNames = tr.includes('Names detected');
    const scoreMatch = tr.match(/<span class="ui small label [^"]*"[^>]*>(\d+)<\/span>/);

    if (idMatch && titleMatch) {
      const dStr = durMatch ? durMatch[1].trim() : '';
      const dSec = tiempoASegundos(dStr);
      resultados.push({
        id: idMatch[1],
        title: titleMatch[1].trim(),
        type: typeMatch ? typeMatch[1].trim() : '',
        durationStr: dStr,
        durationSec: dSec,
        hasNames,
        score: scoreMatch ? parseInt(scoreMatch[1], 10) : 0,
      });
    }
  }

  // Ordenar resultados: con nombres reales primero, luego coincidencia de duración más cercana
  if (duracionSec && duracionSec > 0) {
    resultados.sort((a, b) => {
      if (a.hasNames !== b.hasNames) return a.hasNames ? -1 : 1;
      const diffA = Math.abs(a.durationSec - duracionSec);
      const diffB = Math.abs(b.durationSec - duracionSec);
      if (Math.abs(diffA - diffB) > 3) return diffA - diffB;
      return b.score - a.score;
    });
  } else {
    resultados.sort((a, b) => {
      if (a.hasNames !== b.hasNames) return a.hasNames ? -1 : 1;
      return b.score - a.score;
    });
  }

  return resultados;
}

/**
 * Descarga y parsea el esquema de capítulos de ChapterDB (en formato OGG .txt).
 */
export async function descargarCapitulosChapterDb(chapterSetId: string, duracionTotal?: number): Promise<Capitulo[]> {
  const url = `https://chapterdb.plex.tv/browse/${chapterSetId}.txt`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return [];
  const txt = await res.text();

  const tiempos = new Map<number, number>();
  const nombres = new Map<number, string>();

  const lineas = txt.split(/\r?\n/);
  for (const l of lineas) {
    const trimmed = l.trim();
    if (!trimmed) continue;
    const mTime = trimmed.match(/^CHAPTER(\d+)=(.*)$/i);
    if (mTime) {
      const idx = parseInt(mTime[1], 10);
      tiempos.set(idx, tiempoASegundos(mTime[2]));
      continue;
    }
    const mName = trimmed.match(/^CHAPTER(\d+)NAME=(.*)$/i);
    if (mName) {
      const idx = parseInt(mName[1], 10);
      nombres.set(idx, mName[2].trim());
    }
  }

  const indices = Array.from(tiempos.keys()).sort((a, b) => a - b);
  const capitulos: Capitulo[] = [];

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const start = tiempos.get(idx) ?? 0;
    const nextStart = i + 1 < indices.length ? tiempos.get(indices[i + 1]) ?? 0 : (duracionTotal ?? start);
    const end = Math.max(start, nextStart);
    const title = nombres.get(idx) || `Capítulo ${idx}`;
    capitulos.push({ start, end, title });
  }

  return capitulos;
}

/**
 * Técnica mkv-chapter-helper: Si el archivo ya tiene capítulos con marcas de tiempo exactas
 * pero con nombres genéricos, transfiere los nombres de escena remotos a las marcas locales.
 */
export function fusionarNombresConTiemposLocales(locales: Capitulo[], remotos: Capitulo[]): Capitulo[] {
  if (!locales.length) return remotos;
  if (!remotos.length) return locales;

  // Si coinciden en número exacto, asignar uno a uno
  if (locales.length === remotos.length) {
    return locales.map((loc, i) => ({
      start: loc.start,
      end: loc.end,
      title: remotos[i].title && !esTituloGenerico(remotos[i].title) ? remotos[i].title : loc.title,
    }));
  }

  // Si difieren ligeramente (p. ej. capítulo 0 inicial o créditos extra), casar por cercanía
  return locales.map((loc) => {
    let mejorRemoto = remotos[0];
    let menorDiff = Math.abs(remotos[0].start - loc.start);
    for (const r of remotos) {
      const diff = Math.abs(r.start - loc.start);
      if (diff < menorDiff) {
        menorDiff = diff;
        mejorRemoto = r;
      }
    }
    // Si la marca remota está a menos de 45 segundos, adoptar su nombre
    const nuevoTitulo = menorDiff <= 45 && !esTituloGenerico(mejorRemoto.title) ? mejorRemoto.title : loc.title;
    return {
      start: loc.start,
      end: loc.end,
      title: nuevoTitulo,
    };
  });
}

/**
 * Consulta los capítulos almacenados en la base de datos para un título.
 */
export function obtenerCapitulosBd(itemId: number): Capitulo[] {
  return db
    .prepare('SELECT start_s as start, end_s as end, title FROM item_chapters WHERE item_id = ? ORDER BY idx ASC')
    .all(itemId) as Capitulo[];
}

/**
 * Guarda o reemplaza los capítulos de un título en la base de datos local sin tocar el disco.
 */
export function guardarCapitulosBd(itemId: number, capitulos: Capitulo[], source: string): void {
  const ahora = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM item_chapters WHERE item_id = ?').run(itemId);
    const ins = db.prepare(
      'INSERT INTO item_chapters (item_id, idx, start_s, end_s, title, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < capitulos.length; i++) {
      const c = capitulos[i];
      ins.run(itemId, i, c.start, c.end, c.title, source, ahora);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
