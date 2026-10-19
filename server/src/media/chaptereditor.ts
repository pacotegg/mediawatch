import { config } from '../config.ts';
import type { Capitulo } from './probe.ts';
import { coincideTitulo, esTituloGenerico, tiempoASegundos } from './chapterdb.ts';
import zlib from 'node:zlib';

/**
 * Cookie que el programa ChapterEditor manda a su base de capítulos. Vive en `data/config.json`
 * (`chapterEditorClaveHex`, en hexadecimal), junto al usuario y la contraseña de esa base: no es nuestra y el
 * repositorio es público. Sin ella, esta fuente simplemente no se usa.
 */
function cookieDelCliente(): string {
  const hex = String((config as unknown as { chapterEditorClaveHex?: string }).chapterEditorClaveHex ?? '').trim();
  if (!/^[0-9a-f]+$/i.test(hex)) throw new Error('Falta chapterEditorClaveHex en config.json');
  return Buffer.from(hex, 'hex').toString('latin1');
}
const CE_ENDPOINT = 'https://www.chaptereditor.lima-city.de/index.php';

export type ResultadoChapterEditor = {
  mid: number;
  title: string;
  episode: string;
  durationStr: string;
  durationSec: number;
  chaptersCount: number;
  lang: string;
  fps: string;
  author: string;
};

let cachedSessionCookie: string | null = null;
let sessionExpiresAt = 0;

/**
 * Obtiene una cookie de sesión activa contra la Chapter-Database (hubblec4).
 * Renueva automáticamente si ha expirado o no existe.
 */
async function obtenerSesionChapterEditor(): Promise<string> {
  const ahora = Date.now();
  if (cachedSessionCookie && ahora < sessionExpiresAt) {
    return cachedSessionCookie;
  }

  const user = (config as any).chapterEditorUser ?? '';
  const pass = (config as any).chapterEditorPass ?? '';
  if (!user || !pass) {
    throw new Error('Credenciales de Chapter-Database no configuradas en config.json');
  }

  const res = await fetch(CE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieDelCliente(),
      'User-Agent': 'chapterEditor',
    },
    body: `task=login&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`Error HTTP al iniciar sesión en Chapter-Database: ${res.status}`);
  }

  const cookies = res.headers.getSetCookie();
  const phpSess = cookies.find((c) => c.startsWith('PHPSESSID='))?.split(';')[0];
  const token = cookies.find((c) => c.startsWith('token='))?.split(';')[0];

  if (!token) {
    throw new Error('No se recibió token de autenticación desde Chapter-Database.');
  }

  cachedSessionCookie = `${cookieDelCliente()}${phpSess ? `; ${phpSess}` : ''}; ${token}`;
  // Token es válido durante 24h, renovamos a las 20h
  sessionExpiresAt = ahora + 20 * 60 * 60 * 1000;
  return cachedSessionCookie;
}

/**
 * Busca títulos en la Chapter-Database comunitaria (Doom9 / hubblec4).
 */
export async function buscarEnChapterEditor(titulo: string, duracionSec?: number): Promise<ResultadoChapterEditor[]> {
  const sessionCookie = await obtenerSesionChapterEditor();

  const res = await fetch(CE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: sessionCookie,
      'User-Agent': 'chapterEditor',
    },
    body: `task=msearch&mtitle=${encodeURIComponent(titulo)}`,
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) return [];
  const text = await res.text();
  if (!text || text.trim() === '' || text.trim() === '[]') return [];

  let rawList: any[];
  try {
    rawList = JSON.parse(text);
  } catch {
    return [];
  }

  if (!Array.isArray(rawList)) return [];

  const resultados: ResultadoChapterEditor[] = [];
  for (const r of rawList) {
    // Formato fila: [mid, disctype, ?, title, episode, durationStr, ?, chaptersCount, lang, ?, ?, ?, fps, source_id, author]
    if (!Array.isArray(r) || r.length < 9) continue;
    const mid = Number(r[0]);
    const rTitle = String(r[3] || '').trim();
    const episode = String(r[4] || '').trim();
    const dStr = String(r[5] || '').trim();
    const chaps = Number(r[7]) || 0;
    const lang = String(r[8] || '').trim();
    const fps = String(r[12] || '').trim();
    const author = String(r[14] || '').trim();

    const dSec = tiempoASegundos(dStr);

    resultados.push({
      mid,
      title: rTitle,
      episode,
      durationStr: dStr,
      durationSec: dSec,
      chaptersCount: chaps,
      lang,
      fps,
      author,
    });
  }

  // Ordenar por coincidencia de duración si se provee
  if (duracionSec && duracionSec > 0) {
    resultados.sort((a, b) => {
      const diffA = Math.abs(a.durationSec - duracionSec);
      const diffB = Math.abs(b.durationSec - duracionSec);
      if (Math.abs(diffA - diffB) > 3) return diffA - diffB;
      return b.chaptersCount - a.chaptersCount;
    });
  }

  return resultados;
}

/**
 * Descarga el XML de capítulos Matroska comprimido de Chapter-Database y lo convierte a formato Capitulo[].
 */
export async function descargarCapitulosChapterEditor(mid: number, duracionTotal?: number): Promise<Capitulo[]> {
  const sessionCookie = await obtenerSesionChapterEditor();

  const res = await fetch(CE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: sessionCookie,
      'User-Agent': 'chapterEditor',
    },
    body: `task=downchapstags&mid=${mid}`,
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) return [];
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }

  if (!Array.isArray(json) || !json[0]) return [];

  let xml: string;
  try {
    xml = zlib.inflateSync(Buffer.from(json[0], 'base64')).toString('utf8');
  } catch {
    return [];
  }

  const atoms = xml.split('<ChapterAtom>');
  if (atoms.length <= 1) return [];

  const rawCaps: { title: string; start: number }[] = [];

  for (let i = 1; i < atoms.length; i++) {
    const chunk = atoms[i].split('</ChapterAtom>')[0];

    // Buscar nombres de capítulos en displays, priorizando español si está presente
    const displays = [...chunk.matchAll(/<ChapterDisplay>([\s\S]*?)<\/ChapterDisplay>/g)];
    let chosenTitle = '';
    for (const d of displays) {
      const t = d[1].match(/<ChapterString>(.*?)<\/ChapterString>/)?.[1]?.trim();
      const lang = d[1].match(/<ChapterLanguage>(.*?)<\/ChapterLanguage>/)?.[1]?.trim().toLowerCase();
      if (t) {
        if (!chosenTitle) chosenTitle = t;
        if (lang === 'spa' || lang === 'es') {
          chosenTitle = t;
          break;
        }
      }
    }

    if (!chosenTitle) {
      const fallback = chunk.match(/<ChapterString>(.*?)<\/ChapterString>/)?.[1]?.trim();
      chosenTitle = fallback || `Capítulo ${i}`;
    }

    const startMatch = chunk.match(/<ChapterTimeStart>(.*?)<\/ChapterTimeStart>/);
    if (!startMatch) continue;

    const start = tiempoASegundos(startMatch[1].trim());
    rawCaps.push({ title: chosenTitle, start });
  }

  if (rawCaps.length === 0) return [];

  // Ordenar por tiempo de inicio
  rawCaps.sort((a, b) => a.start - b.start);

  const capitulos: Capitulo[] = [];
  for (let i = 0; i < rawCaps.length; i++) {
    const start = rawCaps[i].start;
    const nextStart = i + 1 < rawCaps.length ? rawCaps[i + 1].start : (duracionTotal ?? start);
    const end = Math.max(start, nextStart);
    capitulos.push({
      start,
      end,
      title: rawCaps[i].title,
    });
  }

  return capitulos;
}
