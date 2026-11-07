/**
 * Extras de un titulo: featurettes, tomas falsas, «cómo se hizo», escenas
 * eliminadas. Viven en subcarpetas de la pelicula o la serie -«Featurettes»,
 * «Behind the scenes», «Other», «Extras»- que el escaner salta a proposito,
 * porque no son la pelicula. Contados el 29/09/2026: 1.111 ficheros repartidos
 * por 126 titulos, que hasta ahora no se veian por ningun sitio.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';

const run = promisify(execFile);

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.webm', '.ts', '.m2ts']);

/** Carpetas donde tinyMediaManager y Plex dejan los extras. */
const CARPETAS: Record<string, string> = {
  'featurettes': 'Featurette',
  'featurette': 'Featurette',
  'behind the scenes': 'Cómo se hizo',
  'behindthescenes': 'Cómo se hizo',
  'deleted scenes': 'Escenas eliminadas',
  'deleted scene': 'Escenas eliminadas',
  'deleted': 'Escenas eliminadas',
  'interviews': 'Entrevistas',
  'interview': 'Entrevistas',
  'scenes': 'Escenas',
  'scene': 'Escenas',
  'shorts': 'Cortos',
  'short': 'Cortos',
  'trailers': 'Tráilers',
  'trailer': 'Tráilers',
  'extras': 'Extra',
  'extra': 'Extra',
  'other': 'Extra',
  'others': 'Extra',
};

/** Y los mismos, puestos como sufijo del nombre junto a la pelicula. */
const SUFIJOS: [string, string][] = [
  ['-featurette', 'Featurette'],
  ['-behindthescenes', 'Cómo se hizo'],
  ['-deleted', 'Escenas eliminadas'],
  ['-interview', 'Entrevistas'],
  ['-scene', 'Escenas'],
  ['-short', 'Cortos'],
  ['-clip', 'Extra'],
  ['-trailer', 'Tráiler'],
  ['-other', 'Extra'],
];

export type Extra = {
  id: number;
  titulo: string;
  tipo: string;
  duration: number | null;
  size: number | null;
  /** «Temporada 3» cuando los extras vienen repartidos por temporada. */
  grupo: string | null;
};

const upsert = db.prepare(`
  INSERT INTO extras (item_id, path, titulo, tipo, size, duration, grupo, scanned_at)
  VALUES (?,?,?,?,?,?,?,?)
  ON CONFLICT(path) DO UPDATE SET
    item_id=excluded.item_id,
    titulo=CASE WHEN extras.titulo_manual = 1 THEN extras.titulo ELSE excluded.titulo END,
    tipo=CASE WHEN extras.titulo_manual = 1 THEN extras.tipo ELSE excluded.tipo END,
    size=excluded.size, grupo=excluded.grupo, scanned_at=excluded.scanned_at
  RETURNING id`);

/** «Season 3» -> «Temporada 3»; lo demas se deja como este en el disco. */
const nombreGrupo = (n: string | null) =>
  n ? n.replace(/^season\s*/i, 'Temporada ').replace(/^specials?$/i, 'Especiales') : null;

/**
 * El nombre de fichero, presentable: sin extension, sin el sufijo que marca el
 * tipo y sin el titulo de la pelicula delante, que ya se sabe cual es.
 */
function tituloDe(archivo: string, tituloItem: string): string {
  let n = basename(archivo, extname(archivo));
  for (const [suf] of SUFIJOS) {
    if (n.toLowerCase().endsWith(suf)) n = n.slice(0, -suf.length);
  }
  const sinTitulo = n.replace(new RegExp(`^${tituloItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–]?\\s*`, 'i'), '');
  return (sinTitulo.trim() || n.trim()).replace(/[._]+/g, ' ').trim();
}

/** Títulos que no dicen qué es el extra: números solos (00579), track01, o nombres vacíos de sentido. */
export function esTituloGenerico(titulo: string): boolean {
  const t = titulo.trim();
  if (!t) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^(?:track|title|extra|clip|part|scene|video|ch|cap[íi]tulo)[\s_-]?\d*$/i.test(t)) return true;
  if (/^(?:extra|extras|bonus|clip|clips|scene|scenes|featurette|featurettes|behind the scenes|making of)$/i.test(t)) return true;
  return false;
}

const REGLAS_NOMBRE: [RegExp, string][] = [
  [/\b(deleted|eliminad|escena.*eliminada|alternate.*scene|alternate.*ending)\b/i, 'Escenas eliminadas'],
  [/\b(interview|entrevista|discussion|conversation|q&a)\b/i, 'Entrevistas'],
  [/\b(behind.*the.*scenes|making.*of|c[oó]mo.*se.*hizo|detr[aá]s.*de|diario.*rodaje)\b/i, 'Cómo se hizo'],
  [/\b(featurette|visual.*effects|vfx|special.*effects|soundtrack|score|bso|costume|animatronic)\b/i, 'Featurette'],
  [/\b(trailer|teaser|promo|spot)\b/i, 'Tráilers'],
  [/\b(blooper|gag.*reel|tomas.*falsas|outtake)\b/i, 'Tomas falsas'],
  [/\b(short|corto|cortometraje)\b/i, 'Cortos'],
  [/\b(documentary|documental)\b/i, 'Documental'],
];

function tipoDe(dir: string, archivo: string): string | null {
  const n = basename(archivo, extname(archivo)).toLowerCase();
  const porRegla = REGLAS_NOMBRE.find(([rx]) => rx.test(n))?.[1];
  if (porRegla) return porRegla;

  const carpeta = CARPETAS[basename(dir).toLowerCase()];
  if (carpeta && carpeta !== 'Extra') return carpeta;

  const porSufijo = SUFIJOS.find(([suf]) => n.endsWith(suf))?.[1];
  if (porSufijo) return porSufijo;

  return carpeta ?? null;
}

function listar(dir: string): { path: string; isDir: boolean; name: string }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name, path: join(dir, e.name), isDir: e.isDirectory(),
    }));
  } catch {
    return [];
  }
}

/**
 * Registra los extras de un titulo y devuelve cuantos hay. Se le pasa la
 * carpeta porque el item ya la tiene guardada, y asi sirve igual para una
 * pelicula que para una serie.
 */
export function indexarExtras(itemId: number, carpeta: string, tituloItem: string, now: string): number {
  if (!existsSync(carpeta)) return 0;
  const encontrados: string[] = [];

  /*
   * `heredado` es el tipo de la carpeta de extras en la que ya estamos. Dentro
   * de una puede haber otra division por temporadas -«Featurettes/Season 3» en
   * Breaking Bad-, y bajando un solo nivel se perdian 185 ficheros de los 1.111
   * contados el 29/09/2026. Con el tipo heredado a null no se baja: asi no se
   * recorre la serie entera buscando extras donde no los hay.
   */
  const mirar = (dir: string, heredado: string | null, grupo: string | null, hondura = 0) => {
    for (const e of listar(dir)) {
      if (e.isDir) {
        // Al bajar, la subcarpeta es el grupo: «Featurettes/Season 3».
        if (heredado && hondura < 3) mirar(e.path, heredado, grupo ?? e.name, hondura + 1);
        continue;
      }
      if (!VIDEO_EXT.has(extname(e.name).toLowerCase())) continue;
      const tipo = tipoDe(dir, e.name) ?? (heredado && heredado !== 'Extra' ? heredado : null) ?? heredado;
      if (!tipo) continue;
      let size: number | null = null;
      try {
        size = statSync(e.path).size;
      } catch {
        continue;
      }
      upsert.get(itemId, e.path, tituloDe(e.name, tituloItem), tipo, size, null, nombreGrupo(grupo), now);
      encontrados.push(e.path);
    }
  };

  // Los sufijos van junto a la pelicula; las carpetas, dentro.
  mirar(carpeta, null, null);
  for (const sub of listar(carpeta)) {
    if (!sub.isDir) continue;
    const tipo = CARPETAS[sub.name.toLowerCase()];
    if (tipo) {
      mirar(sub.path, tipo, null);
      continue;
    }
    /*
     * Y al reves: la carpeta de extras DENTRO de la de temporada, como
     * «Breaking Bad/Season 1/Featurettes». Las dos formas conviven en la misma
     * serie, asi que hay que mirar las dos.
     */
    for (const nieto of listar(sub.path)) {
      const tipoNieto = CARPETAS[nieto.name.toLowerCase()];
      // Aqui el grupo es la temporada que los contiene, no la carpeta de extras.
      if (nieto.isDir && tipoNieto) mirar(nieto.path, tipoNieto, sub.name);
    }
  }

  // Un extra borrado del disco no puede quedarse en la ficha.
  const vivos = new Set(encontrados.map((p) => p.toLowerCase()));
  for (const fila of db.prepare('SELECT id, path FROM extras WHERE item_id = ?').all(itemId) as { id: number; path: string }[]) {
    if (!vivos.has(fila.path.toLowerCase())) db.prepare('DELETE FROM extras WHERE id = ?').run(fila.id);
  }
  return encontrados.length;
}

export function extrasDe(itemId: number): Extra[] {
  return db
    .prepare('SELECT id, titulo, tipo, duration, size, grupo FROM extras WHERE item_id = ? ORDER BY tipo, grupo, titulo')
    .all(itemId) as Extra[];
}

export function extraPorId(id: number): { id: number; item_id: number; path: string; titulo: string } | undefined {
  return db.prepare('SELECT id, item_id, path, titulo FROM extras WHERE id = ?').get(id) as
    | { id: number; item_id: number; path: string; titulo: string }
    | undefined;
}

const CARPETA_MINIATURAS = join(DATA_DIR, 'extras-thumbs');

/**
 * Un fotograma del extra, cacheado. Se saca al 10 % de su duracion y no al
 * principio, que en estos suele ser negro o una claqueta.
 */
export async function miniatura(id: number): Promise<string | null> {
  const extra = extraPorId(id);
  if (!extra || !existsSync(extra.path)) return null;
  mkdirSync(CARPETA_MINIATURAS, { recursive: true });
  const destino = join(CARPETA_MINIATURAS, `${id}.jpg`);
  if (existsSync(destino)) return destino;

  const fila = db.prepare('SELECT duration FROM extras WHERE id = ?').get(id) as { duration: number | null };
  let segundos = fila?.duration ? fila.duration * 0.1 : 0;
  if (!segundos) {
    try {
      const { stdout } = await run(config.ffprobe, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', extra.path,
      ], { windowsHide: true, timeout: 60_000 });
      const d = Number(stdout.trim());
      if (d > 0) {
        db.prepare('UPDATE extras SET duration = ? WHERE id = ?').run(d, id);
        segundos = d * 0.1;
      }
    } catch {
      segundos = 5;
    }
  }

  try {
    await run(config.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-ss', String(Math.max(1, Math.round(segundos))),
      '-i', extra.path,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', '-y', destino,
    ], { windowsHide: true, timeout: 60_000 });
  } catch {
    return null;
  }
  return existsSync(destino) ? destino : null;
}

export function actualizarExtra(id: number, cambios: { tipo?: string; titulo?: string }): boolean {
  const sets: string[] = ['titulo_manual = 1'];
  const vals: any[] = [];
  if (cambios.tipo) {
    sets.push('tipo = ?');
    vals.push(cambios.tipo);
  }
  if (cambios.titulo) {
    sets.push('titulo = ?');
    vals.push(cambios.titulo);
  }
  vals.push(id);
  const res = db.prepare(`UPDATE extras SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return res.changes > 0;
}

export function actualizarTipoExtra(id: number, nuevoTipo: string): boolean {
  return actualizarExtra(id, { tipo: nuevoTipo });
}

export type ExtraCandidato = {
  titulo: string;
  duracionSegundos: number;
  tipo?: string;
  fuente: string;
};

/** Consulta DVDCompare para obtener las pistas de extras y duraciones oficiales del disco. */
export async function buscarExtrasDvdCompare(tituloItem: string, anoItem?: number | null): Promise<ExtraCandidato[]> {
  try {
    const url = `https://www.dvdcompare.net/comparisons/search.php?param=${encodeURIComponent(tituloItem.trim())}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const html = await res.text();
    const filmMatches = [...html.matchAll(/<a\s+href="film\.php\?fid=(\d+)"[^>]*>([^<]+)<\/a>/gi)];
    if (filmMatches.length === 0) return [];

    let elegido = filmMatches[0];
    if (anoItem) {
      const conAno = filmMatches.filter((m) => m[2].includes(String(anoItem)));
      if (conAno.length > 0) {
        elegido = conAno.find((m) => /blu-ray\s*4k/i.test(m[2])) || conAno.find((m) => /blu-ray/i.test(m[2])) || conAno[0];
      }
    } else {
      elegido = filmMatches.find((m) => /blu-ray\s*4k/i.test(m[2])) || filmMatches.find((m) => /blu-ray/i.test(m[2])) || filmMatches[0];
    }

    const fid = elegido[1];
    const filmRes = await fetch(`https://www.dvdcompare.net/comparisons/film.php?fid=${fid}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!filmRes.ok) return [];
    const filmHtml = await filmRes.text();

    const extrasBlocks = [...filmHtml.matchAll(/<div class="label">Extras:<\/div>\s*<div class="description">([\s\S]*?)<\/div>/gi)];
    if (extrasBlocks.length === 0) return [];

    const candidatos: ExtraCandidato[] = [];
    const vistos = new Set<string>();

    for (const b of extrasBlocks) {
      const lines = b[1].split(/<br\s*\/?>/i);
      for (let l of lines) {
        l = l.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').trim();
        if (!l || l.startsWith('* The Film') || l.startsWith('Audio commentary')) continue;

        const m = l.match(/^(?:-\s*)?["“]?([^"”\(\)]+?)["”]?\s*(?:featurettes?|documentary)?\s*(?:\([^)]*\)\s*)*\(([0-9]+:[0-9]{2}(?::[0-9]{2})?)\)/i);
        if (m) {
          const tit = m[1].trim();
          const timeStr = m[2];
          const parts = timeStr.split(':').map(Number);
          let secs = 0;
          if (parts.length === 2) secs = parts[0] * 60 + parts[1];
          else if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
          if (secs > 0 && !vistos.has(`${tit}-${secs}`)) {
            vistos.add(`${tit}-${secs}`);
            let tipo = 'Extra';
            if (/behind|making|c[oó]mo.*se.*hizo/i.test(l)) tipo = 'Cómo se hizo';
            else if (/deleted|eliminad/i.test(l)) tipo = 'Escenas eliminadas';
            else if (/interview|entrevista/i.test(l)) tipo = 'Entrevistas';
            else if (/featurette|effects|soundtrack/i.test(l)) tipo = 'Featurette';
            else if (/trailer|teaser|spot/i.test(l)) tipo = 'Tráilers';
            else if (/short|corto/i.test(l)) tipo = 'Cortos';
            candidatos.push({ titulo: tit, duracionSegundos: secs, tipo, fuente: 'DVDCompare' });
          }
        }
      }
      if (candidatos.length > 0) break;
    }

    return candidatos;
  } catch {
    return [];
  }
}

const cacheDuracionesYoutube = new Map<string, number>();

async function obtenerDuracionYoutube(key: string): Promise<number | null> {
  if (cacheDuracionesYoutube.has(key)) return cacheDuracionesYoutube.get(key)!;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${key}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(2500),
    });
    const text = await res.text();
    const m = text.match(/"approxDurationMs":"(\d+)"/);
    if (m) {
      const s = Math.round(Number(m[1]) / 1000);
      cacheDuracionesYoutube.set(key, s);
      return s;
    }
  } catch {}
  return null;
}

/** Busca vídeos promocionales / piezas oficiales en TMDb (YouTube). */
export async function buscarVideosTmdb(tmdbId: string | number, kind: string): Promise<ExtraCandidato[]> {
  if (!config.tmdbApiKey || !tmdbId) return [];
  try {
    const ruta = kind === 'show' ? `/tv/${tmdbId}/videos` : `/movie/${tmdbId}/videos`;
    const res = await fetch(`https://api.themoviedb.org/3${ruta}?api_key=${config.tmdbApiKey}&include_video_language=es,en,null`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { results?: any[] };
    const videos = (j.results || []).filter((v) => v.site === 'YouTube' && v.type !== 'Trailer' && v.type !== 'Teaser');
    if (videos.length === 0) return [];

    const promesas = videos.slice(0, 8).map(async (v) => {
      const dur = await obtenerDuracionYoutube(v.key);
      if (!dur || dur <= 0) return null;
      let tipo = 'Extra';
      if (v.type === 'Behind the Scenes') tipo = 'Cómo se hizo';
      else if (v.type === 'Featurette') tipo = 'Featurette';
      else if (v.type === 'Bloopers') tipo = 'Tomas falsas';
      else if (v.type === 'Clip') tipo = 'Clip';
      return {
        titulo: v.name,
        duracionSegundos: dur,
        tipo,
        fuente: 'TMDb Videos',
      };
    });

    const resueltos = await Promise.all(promesas);
    const candidatos: ExtraCandidato[] = [];
    for (const r of resueltos) {
      if (r) candidatos.push(r);
    }
    return candidatos;
  } catch {
    return [];
  }
}

/** Para series: busca en la Temporada 0 (Especiales) de TMDb. */
export async function buscarEspecialesTmdb(tmdbId: string | number): Promise<ExtraCandidato[]> {
  if (!config.tmdbApiKey || !tmdbId) return [];
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/0?api_key=${config.tmdbApiKey}&language=en-US`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { episodes?: any[] };
    const candidatos: ExtraCandidato[] = [];
    for (const ep of j.episodes || []) {
      if (ep.runtime && ep.runtime > 0) {
        let tipo = 'Especial';
        const n = (ep.name || '').toLowerCase();
        if (n.includes('behind the scenes') || n.includes('making of') || n.includes('cómo se hizo') || n.includes('bts')) {
          tipo = 'Cómo se hizo';
        } else if (n.includes('deleted scene') || n.includes('eliminada')) {
          tipo = 'Escenas eliminadas';
        } else if (n.includes('interview') || n.includes('entrevista')) {
          tipo = 'Entrevistas';
        } else if (n.includes('gag reel') || n.includes('outtake') || n.includes('tomas falsas')) {
          tipo = 'Tomas falsas';
        }
        candidatos.push({
          titulo: ep.name,
          duracionSegundos: ep.runtime * 60,
          tipo,
          fuente: 'TMDb Temporada 0',
        });
      }
    }
    return candidatos;
  } catch {
    return [];
  }
}

/** Lee título de etiqueta de contenedor/stream y duración con ffprobe. */
export async function leerMetadatosInternos(ruta: string): Promise<{ titulo?: string; duracion?: number } | null> {
  try {
    const { stdout } = await run(config.ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration:format_tags=title,TITLE:stream_tags=title,TITLE',
      '-of', 'json',
      ruta,
    ], { windowsHide: true, timeout: 30_000 });
    const j = JSON.parse(stdout);
    const duracion = Number(j.format?.duration);
    let tituloInterno: string | undefined = j.format?.tags?.title || j.format?.tags?.TITLE;
    if (!tituloInterno && Array.isArray(j.streams)) {
      for (const s of j.streams) {
        if (s.codec_type !== 'video') continue;
        const t = s.tags?.title || s.tags?.TITLE;
        if (t && typeof t === 'string' && !esTituloGenerico(t)) {
          tituloInterno = t;
          break;
        }
      }
    }
    const res: { titulo?: string; duracion?: number } = {};
    if (duracion > 0) res.duracion = duracion;
    const esPistaAudioOSub = /^(?:stereo|mono|[0-9]\.[0-9]|surround|english|spanish|castellano|español|ocr|sdh|forced|subt[íi]tulos?)$/i;
    if (tituloInterno && typeof tituloInterno === 'string' && !esTituloGenerico(tituloInterno) && !esPistaAudioOSub.test(tituloInterno.trim())) {
      res.titulo = tituloInterno.trim();
    }
    return res;
  } catch {
    return null;
  }
}

/** Identifica los extras de un título que tengan nombre numérico/genérico y no hayan sido fijados a mano. */
export async function identificarExtrasDeItem(itemId: number): Promise<{
  identificados: number;
  total: number;
  detalles: Array<{ id: number; path: string; tituloViejo: string; tituloNuevo: string; duracion: number; fuente: string }>;
}> {
  const item = db.prepare('SELECT id, title, original_title, year, folder, kind, tmdb_id FROM items WHERE id = ?').get(itemId) as
    | { id: number; title: string; original_title: string | null; year: number | null; folder: string; kind: string; tmdb_id: string | null }
    | undefined;
  if (!item) return { identificados: 0, total: 0, detalles: [] };

  const pendientes = (db.prepare('SELECT id, path, titulo, duration FROM extras WHERE item_id = ? AND titulo_manual = 0').all(itemId) as Array<{
    id: number;
    path: string;
    titulo: string;
    duration: number | null;
  }>).filter((ex) => esTituloGenerico(ex.titulo));

  if (pendientes.length === 0) return { identificados: 0, total: 0, detalles: [] };

  let candidatosDvd: ExtraCandidato[] = [];
  if (item.original_title) {
    candidatosDvd = await buscarExtrasDvdCompare(item.original_title, item.year);
  }
  if (candidatosDvd.length === 0 && item.title) {
    candidatosDvd = await buscarExtrasDvdCompare(item.title, item.year);
  }

  let candidatosEspeciales: ExtraCandidato[] | null = null;
  let candidatosTmdbVideos: ExtraCandidato[] | null = null;

  const detalles: Array<{ id: number; path: string; tituloViejo: string; tituloNuevo: string; duracion: number; fuente: string }> = [];
  let identificados = 0;
  const usados = new Set<string>();

  for (const ex of pendientes) {
    let duracionReal = ex.duration;
    let tituloNuevo: string | null = null;
    let tipoNuevo: string | null = null;
    let fuente = '';

    const meta = await leerMetadatosInternos(ex.path);
    if (meta?.duracion && (!duracionReal || duracionReal <= 0)) {
      duracionReal = meta.duracion;
      db.prepare('UPDATE extras SET duration = ? WHERE id = ?').run(duracionReal, ex.id);
    }

    // 1. DVDCompare por duración
    if (duracionReal && duracionReal > 0 && candidatosDvd.length > 0) {
      let mejorMatch: ExtraCandidato | null = null;
      let menorDif = 4.0;

      for (const cand of candidatosDvd) {
        if (usados.has(cand.titulo)) continue;
        const dif = Math.abs(duracionReal - cand.duracionSegundos);
        if (dif <= menorDif) {
          menorDif = dif;
          mejorMatch = cand;
        }
      }

      if (mejorMatch) {
        tituloNuevo = mejorMatch.titulo;
        tipoNuevo = mejorMatch.tipo ?? null;
        fuente = 'DVDCompare';
        usados.add(mejorMatch.titulo);
      }
    }

    // 2. TMDb Videos oficiales por duración de YouTube (carga perezosa)
    if (!tituloNuevo && duracionReal && duracionReal > 0 && item.tmdb_id) {
      if (!candidatosTmdbVideos) {
        candidatosTmdbVideos = await buscarVideosTmdb(item.tmdb_id, item.kind);
      }
      let mejorMatch: ExtraCandidato | null = null;
      let menorDif = 4.0;

      for (const cand of candidatosTmdbVideos) {
        if (usados.has(cand.titulo)) continue;
        const dif = Math.abs(duracionReal - cand.duracionSegundos);
        if (dif <= menorDif) {
          menorDif = dif;
          mejorMatch = cand;
        }
      }

      if (mejorMatch) {
        tituloNuevo = mejorMatch.titulo;
        tipoNuevo = mejorMatch.tipo ?? null;
        fuente = 'TMDb Videos';
        usados.add(mejorMatch.titulo);
      }
    }

    // 3. Temporada 0 (Especiales TMDb para series, carga perezosa)
    if (!tituloNuevo && duracionReal && duracionReal > 0 && item.kind === 'show' && item.tmdb_id) {
      if (!candidatosEspeciales) {
        candidatosEspeciales = await buscarEspecialesTmdb(item.tmdb_id);
      }
      let mejorMatch: ExtraCandidato | null = null;
      let menorDif = 60.0;

      for (const cand of candidatosEspeciales) {
        if (usados.has(cand.titulo)) continue;
        const dif = Math.abs(duracionReal - cand.duracionSegundos);
        const tCand = cand.titulo.toLowerCase();
        const tEx = ex.titulo.toLowerCase();
        const coincidePalabra = (tEx.includes('behind') && tCand.includes('behind')) ||
          (tEx.includes('deleted') && tCand.includes('deleted')) ||
          (tEx.includes('making') && tCand.includes('making')) ||
          (tEx.includes('interview') && tCand.includes('interview')) ||
          (tEx.includes('gag') && tCand.includes('gag'));

        if ((coincidePalabra && dif <= 60.0) || dif <= 25.0) {
          if (dif < menorDif) {
            menorDif = dif;
            mejorMatch = cand;
          }
        }
      }

      if (mejorMatch) {
        tituloNuevo = mejorMatch.titulo;
        tipoNuevo = mejorMatch.tipo ?? null;
        fuente = 'TMDb Temporada 0';
        usados.add(mejorMatch.titulo);
      }
    }

    // 4. Título interno del contenedor si las fuentes online no emparejaron
    if (!tituloNuevo && meta?.titulo && !esTituloGenerico(meta.titulo)) {
      const tNorm = meta.titulo.trim().toLowerCase();
      const pNorm = item.title.trim().toLowerCase();
      const origNorm = item.original_title ? item.original_title.trim().toLowerCase() : '';
      const esDisco = /disc\s*\d+|vol(?:ume)?\s*\d+|temporada|season/i.test(tNorm);
      const esSoloPelicula = esDisco || tNorm === pNorm || (origNorm && tNorm === origNorm) ||
        pNorm.includes(tNorm) || tNorm.includes(pNorm) || (origNorm && (origNorm.includes(tNorm) || tNorm.includes(origNorm))) ||
        (tNorm.startsWith(pNorm) && /^(?:\s*\(remastered\)|\s*\(4k\)|\s*\(uhd\))?$/i.test(tNorm.slice(pNorm.length))) ||
        (origNorm && tNorm.startsWith(origNorm) && /^(?:\s*\(remastered\)|\s*\(4k\)|\s*\(uhd\))?$/i.test(tNorm.slice(origNorm.length)));
      if (!esSoloPelicula) {
        tituloNuevo = meta.titulo;
        fuente = 'Metadatos contenedor';
      }
    }

    if (tituloNuevo) {
      const sets = ['titulo = ?', 'titulo_manual = 1'];
      const vals: any[] = [tituloNuevo];
      if (tipoNuevo) {
        sets.push('tipo = ?');
        vals.push(tipoNuevo);
      }
      vals.push(ex.id);
      db.prepare(`UPDATE extras SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      identificados++;
      detalles.push({
        id: ex.id,
        path: ex.path,
        tituloViejo: ex.titulo,
        tituloNuevo,
        duracion: duracionReal ?? 0,
        fuente,
      });
    }
  }

  return { identificados, total: pendientes.length, detalles };
}

/** Pasada general por toda la biblioteca para extras genéricos sin identificar. */
export async function identificarExtrasBiblioteca(): Promise<{
  totalGenericos: number;
  identificados: number;
  itemsProcesados: number;
  detalles: any[];
}> {
  const todos = db.prepare('SELECT id, item_id, path, titulo, duration FROM extras WHERE titulo_manual = 0').all() as Array<{
    id: number;
    item_id: number;
    path: string;
    titulo: string;
    duration: number | null;
  }>;

  const genericos = todos.filter((e) => esTituloGenerico(e.titulo));
  if (genericos.length === 0) {
    return { totalGenericos: 0, identificados: 0, itemsProcesados: 0, detalles: [] };
  }

  const mapaItems = new Map<number, typeof genericos>();
  for (const g of genericos) {
    const l = mapaItems.get(g.item_id) || [];
    l.push(g);
    mapaItems.set(g.item_id, l);
  }

  let totalIdentificados = 0;
  const todosDetalles: any[] = [];

  for (const [itemId] of mapaItems) {
    const res = await identificarExtrasDeItem(itemId);
    totalIdentificados += res.identificados;
    todosDetalles.push(...res.detalles);
  }

  return {
    totalGenericos: genericos.length,
    identificados: totalIdentificados,
    itemsProcesados: mapaItems.size,
    detalles: todosDetalles,
  };
}

export async function extrasTmdb(itemId: number) {
  const item = db.prepare('SELECT tmdb_id, kind FROM items WHERE id = ?').get(itemId) as { tmdb_id: string | null; kind: string } | undefined;
  if (!item?.tmdb_id || !/^\d+$/.test(item.tmdb_id) || !config.tmdbApiKey) return [];
  const ruta = item.kind === 'show' ? `/tv/${item.tmdb_id}` : `/movie/${item.tmdb_id}`;
  try {
    const res = await fetch(`https://api.themoviedb.org/3${ruta}/videos?api_key=${config.tmdbApiKey}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { results?: any[] };
    return (j.results || [])
      .filter((v) => v.site === 'YouTube' && v.type !== 'Trailer')
      .map((v) => ({
        key: v.key,
        name: v.name,
        type: v.type,
        site: v.site,
        size: v.size,
        official: Boolean(v.official),
      }));
  } catch {
    return [];
  }
}

export async function descargarExtraTmdb(itemId: number, youtubeKey: string, titulo: string, tipo: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  const item = db.prepare('SELECT id, title, folder FROM items WHERE id = ?').get(itemId) as { id: number; title: string; folder: string } | undefined;
  if (!item || !item.folder) return { ok: false, error: 'Título no encontrado o sin carpeta en biblioteca' };

  if (!/^[a-zA-Z0-9_-]{11}$/.test(youtubeKey)) {
    return { ok: false, error: 'ID de YouTube no válido' };
  }

  let subcarpeta = 'Extras';
  const tNorm = tipo.toLowerCase();
  if (tNorm.includes('behind') || tNorm.includes('cómo se hizo')) subcarpeta = 'Behind the scenes';
  else if (tNorm.includes('featurette')) subcarpeta = 'Featurettes';
  else if (tNorm.includes('deleted') || tNorm.includes('eliminad')) subcarpeta = 'Deleted scenes';
  else if (tNorm.includes('interview') || tNorm.includes('entrevista')) subcarpeta = 'Interviews';
  else if (tNorm.includes('short') || tNorm.includes('corto')) subcarpeta = 'Shorts';

  const destinoDir = join(item.folder, subcarpeta);
  if (!destinoDir.startsWith(item.folder)) return { ok: false, error: 'Ruta de destino inválida' };
  mkdirSync(destinoDir, { recursive: true });

  const cleanNombre = (titulo || 'Extra').replace(/[/\\?%*:|"<>]/g, '_').replace(/^\.+/, '').trim().slice(0, 100) || 'Extra';
  const destinoArchivo = join(destinoDir, `${cleanNombre}.mp4`);

  try {
    await run('yt-dlp', [
      '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '-o', destinoArchivo,
      `https://www.youtube.com/watch?v=${youtubeKey}`,
    ], { windowsHide: true, timeout: 300_000 });

    if (existsSync(destinoArchivo)) {
      indexarExtras(itemId, item.folder, item.title, new Date().toISOString());
      return { ok: true, path: destinoArchivo };
    }
    return { ok: false, error: 'No se generó el fichero de salida' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

