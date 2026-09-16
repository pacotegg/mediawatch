import { readFileSync } from 'node:fs';
import { db } from '../db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS dialogue_files (
  file_id    INTEGER PRIMARY KEY REFERENCES media_files(id) ON DELETE CASCADE,
  track_id   TEXT NOT NULL,
  language   TEXT,
  cues       INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
);

-- remove_diacritics 2 so "senor" finds "señor" and "accion" finds "acción":
-- nobody types accents into a search box.
CREATE VIRTUAL TABLE IF NOT EXISTS dialogue USING fts5(
  text,
  file_id UNINDEXED,
  start_ms UNINDEXED,
  tokenize='unicode61 remove_diacritics 2'
);
`);

const TIMING = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->/;

function decode(buffer: Buffer): string {
  // UTF-16 con marca de orden: lo escupen algunos editores de Windows. Leído
  // como UTF-8 no da error, da texto con un NUL entre letra y letra, y el
  // fichero quedaba «pendiente» para siempre sin indexar nada.
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

export type Cue = { startMs: number; text: string };

export function parseSrt(path: string): Cue[] {
  let raw: string;
  try {
    raw = decode(readFileSync(path));
  } catch {
    return [];
  }

  const cues: Cue[] = [];
  for (const block of raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((l) => TIMING.test(l));
    if (timingIndex < 0) continue;

    const m = TIMING.exec(lines[timingIndex])!;
    const startMs = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);

    const text = lines
      .slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) cues.push({ startMs, text });
  }
  return cues;
}

const CANDIDATES = `
  SELECT s.file_id, s.id AS sub_id, s.language, s.external
  FROM sub_tracks s
  WHERE s.external IS NOT NULL
    AND s.forced = 0
    AND lower(s.external) LIKE '%.srt'
    AND (? = '' OR s.language = ?)
    AND s.file_id NOT IN (SELECT file_id FROM dialogue_files)
  GROUP BY s.file_id`;

export type IndexProgress = { done: number; total: number; cues: number };

/**
 * Indexes one subtitle per file so the library becomes searchable by line of
 * dialogue. Only external SRTs: pulling embedded tracks would mean running
 * ffmpeg thousands of times for the same result.
 */
export function indexDialogue(language: string, onProgress?: (p: IndexProgress) => void): IndexProgress {
  const rows = db.prepare(CANDIDATES).all(language, language) as {
    file_id: number;
    sub_id: number;
    language: string | null;
    external: string;
  }[];

  const insertCue = db.prepare('INSERT INTO dialogue (text, file_id, start_ms) VALUES (?,?,?)');
  const insertFile = db.prepare('INSERT OR REPLACE INTO dialogue_files (file_id, track_id, language, cues, indexed_at) VALUES (?,?,?,?,?)');
  const now = new Date().toISOString();

  let cues = 0;
  rows.forEach((row, index) => {
    const parsed = parseSrt(row.external);
    if (parsed.length === 0) return;

    db.exec('BEGIN');
    try {
      for (const cue of parsed) insertCue.run(cue.text, row.file_id, cue.startMs);
      insertFile.run(row.file_id, `external-${row.sub_id}`, row.language, parsed.length, now);
      db.exec('COMMIT');
      cues += parsed.length;
    } catch {
      db.exec('ROLLBACK');
    }

    if (index % 20 === 0) onProgress?.({ done: index + 1, total: rows.length, cues });
  });

  const result = { done: rows.length, total: rows.length, cues };
  onProgress?.(result);
  return result;
}

/**
 * Lo que queda por indexar para un idioma: los mismos candidatos que va a
 * recorrer `indexDialogue`, contados. Antes se restaba «ficheros indexados» de
 * «pistas .srt», y como un fichero suele tener dos o tres pistas salían mil y
 * pico pendientes cuando de verdad quedaban treinta.
 */
export function pendientesDeIndexar(language: string): number {
  const lang = language === 'todos' ? '' : language;
  return (db.prepare(`SELECT COUNT(*) AS n FROM (${CANDIDATES})`).get(lang, lang) as { n: number }).n;
}

/** Cómo va el indexado que esté en marcha, para que la interfaz lo pinte. */
export type EstadoIndexado = {
  enCurso: boolean;
  idioma: string;
  hechos: number;
  total: number;
  frases: number;
  empezadoEn: string | null;
  terminadoEn: string | null;
  error: string | null;
};

const estado: EstadoIndexado = {
  enCurso: false, idioma: '', hechos: 0, total: 0, frases: 0, empezadoEn: null, terminadoEn: null, error: null,
};

/**
 * Indexa sin bloquear el servidor: un fichero por vuelta del bucle de eventos.
 *
 * `indexDialogue` es síncrono y para mil ficheros tarda un minuto largo; metido
 * en un `queueMicrotask` el servidor dejaba de contestar mientras tanto, y la
 * página que consultaba el progreso se quedaba con los números viejos. Por
 * eso «parecía que el botón no hacía nada». Sigue corriendo aunque se cierre
 * la pestaña: vive en el proceso del servidor, no en el navegador.
 */
export async function indexarEnSegundoPlano(language: string): Promise<void> {
  if (estado.enCurso) return;
  const lang = language === 'todos' ? '' : language;
  const rows = db.prepare(CANDIDATES).all(lang, lang) as {
    file_id: number; sub_id: number; language: string | null; external: string;
  }[];

  Object.assign(estado, {
    enCurso: true, idioma: language, hechos: 0, total: rows.length, frases: 0,
    empezadoEn: new Date().toISOString(), terminadoEn: null, error: null,
  });

  const insertCue = db.prepare('INSERT INTO dialogue (text, file_id, start_ms) VALUES (?,?,?)');
  const insertFile = db.prepare('INSERT OR REPLACE INTO dialogue_files (file_id, track_id, language, cues, indexed_at) VALUES (?,?,?,?,?)');
  const now = new Date().toISOString();

  try {
    for (const row of rows) {
      let parsed: Cue[] = [];
      try { parsed = parseSrt(row.external); } catch { /* un .srt roto no para la pasada */ }
      if (parsed.length === 0) {
        // Se apunta con cero frases: si no, un .srt vacío o roto queda
        // «pendiente» para siempre y el contador nunca llega a cero.
        insertFile.run(row.file_id, `external-${row.sub_id}`, row.language, 0, now);
      } else {
        db.exec('BEGIN');
        try {
          for (const cue of parsed) insertCue.run(cue.text, row.file_id, cue.startMs);
          insertFile.run(row.file_id, `external-${row.sub_id}`, row.language, parsed.length, now);
          db.exec('COMMIT');
          estado.frases += parsed.length;
        } catch {
          db.exec('ROLLBACK');
        }
      }
      estado.hechos += 1;
      await new Promise<void>((r) => setImmediate(r));
    }
  } catch (err) {
    estado.error = (err as Error).message;
  } finally {
    estado.enCurso = false;
    estado.terminadoEn = new Date().toISOString();
  }
}

export function dialogueStats(language = 'spa') {
  const totales = db
    .prepare(`SELECT
        (SELECT COUNT(*) FROM dialogue_files) AS ficheros,
        (SELECT COALESCE(SUM(cues), 0) FROM dialogue_files) AS frases,
        (SELECT COUNT(DISTINCT file_id) FROM sub_tracks WHERE external IS NOT NULL AND forced = 0 AND lower(external) LIKE '%.srt') AS disponibles`)
    .get() as { ficheros: number; frases: number; disponibles: number };
  return { ...totales, pendientes: pendientesDeIndexar(language), indexado: { ...estado } };
}

export function clearDialogue() {
  db.exec('DELETE FROM dialogue; DELETE FROM dialogue_files;');
}

export type DialogueHit = {
  itemId: number;
  title: string;
  year: number | null;
  kind: string;
  fileId: number;
  episodeId: number | null;
  season: number | null;
  episode: number | null;
  startMs: number;
  snippet: string;
};

/**
 * Turns what someone types into a safe FTS5 expression. Raw input goes straight
 * into a query language where `-`, `*`, `:` and quotes are operators, so an
 * innocent search like "spider-man" would be a syntax error.
 *
 * Wrapping the whole thing in quotes searches the exact phrase; otherwise every
 * word has to appear in the same subtitle line.
 */
export function ftsQuery(input: string): string {
  const phrase = /^\s*".*"\s*$/.test(input);
  const tokens = input
    .replace(/["*():^~-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return '';
  return phrase ? `"${tokens.join(' ')}"` : tokens.map((t) => `"${t}"`).join(' ');
}

export function searchDialogue(query: string, limit = 40): DialogueHit[] {
  return db
    .prepare(`SELECT
        COALESCE(f.item_id, e.show_id) AS itemId,
        COALESCE(i.title, s.title)     AS title,
        COALESCE(i.year, s.year)       AS year,
        COALESCE(i.kind, s.kind)       AS kind,
        d.file_id                      AS fileId,
        f.episode_id                   AS episodeId,
        e.season, e.episode,
        d.start_ms                     AS startMs,
        snippet(dialogue, 0, '«', '»', '…', 12) AS snippet
      FROM dialogue d
      JOIN media_files f ON f.id = d.file_id
      LEFT JOIN items i    ON i.id = f.item_id
      LEFT JOIN episodes e ON e.id = f.episode_id
      LEFT JOIN items s    ON s.id = e.show_id
      WHERE dialogue MATCH ?
      ORDER BY rank
      LIMIT ?`)
    .all(query, limit) as DialogueHit[];
}
