import { existsSync, mkdirSync, createWriteStream, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR, MODO_PORTABLE } from '../config.ts';
import { db } from '../db.ts';

const THEMES_DIR = join(DATA_DIR, 'themes');
mkdirSync(THEMES_DIR, { recursive: true });

export function rutaTema(itemId: number, folder?: string | null): string | null {
  const dataM4a = join(THEMES_DIR, `${itemId}.m4a`);
  if (existsSync(dataM4a)) return dataM4a;
  const dataPath = join(THEMES_DIR, `${itemId}.mp3`);
  if (existsSync(dataPath)) return dataPath;
  if (folder) {
    const folderM4a = join(folder, 'theme.m4a');
    if (existsSync(folderM4a)) return folderM4a;
    const folderPath = join(folder, 'theme.mp3');
    if (existsSync(folderPath)) return folderPath;
  }
  return null;
}

export function tieneTema(itemId: number, folder?: string | null): boolean {
  return rutaTema(itemId, folder) !== null;
}

/**
 * Descarga el tema musical de un título (Plex CDN para series con TVDB ID o
 * ThemerrDB/YouTube para series y películas con TMDB ID) y lo almacena
 * en data/themes/<id>.mp3 (nunca toca E:\).
 */
export async function descargarTema(
  itemId: number,
  tvdbId?: number | null,
  tmdbId?: number | null,
  kind?: string | null,
  folder?: string | null,
): Promise<boolean> {
  if (tieneTema(itemId, folder)) return true;
  // MediaWatch Server: sin yt-dlp empaquetado y con fuentes de terceros (Plex, YouTube), no se descargan temas.
  if (MODO_PORTABLE) return false;
  // Se llama al abrir la ficha de cualquier título sin sintonía, y un fallo no se recordaba: cada apertura repetía
  // las consultas y lanzaba otro yt-dlp (hasta 3 min). Ahora, uno a la vez por título y un intento al día.
  if (enCurso.has(itemId)) return false;
  const ultimo = ultimoIntento.get(itemId);
  if (ultimo !== undefined && Date.now() - ultimo < ESPERA_REINTENTO_MS) return false;
  enCurso.add(itemId);
  ultimoIntento.set(itemId, Date.now());
  try {
    return await intentarDescargar(itemId, tvdbId, tmdbId, kind);
  } finally {
    enCurso.delete(itemId);
  }
}

const enCurso = new Set<number>();
const ultimoIntento = new Map<number, number>();
const ESPERA_REINTENTO_MS = 24 * 60 * 60_000;

async function intentarDescargar(itemId: number, tvdbId?: number | null, tmdbId?: number | null, kind?: string | null): Promise<boolean> {

  const targetMp3 = join(THEMES_DIR, `${itemId}.mp3`);

  // Fuente 1: Plex TV Themes CDN (oficial, rápido y en directo por HTTP)
  if (kind === 'show' && tvdbId) {
    try {
      const url = `http://tvthemes.plexapp.com/${tvdbId}.mp3`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok && res.body) {
        await pipeline(res.body as any, createWriteStream(targetMp3));
        console.log(`[tema] Descargado tema de serie #${itemId} (TVDB ${tvdbId}) desde Plex CDN`);
        return true;
      }
    } catch (err: any) {
      console.warn(`[tema] Error consultando Plex CDN para #${itemId}:`, err.message);
      // Un corte a mitad dejaba un mp3 parcial que `tieneTema` daba por bueno para siempre.
      rmSync(targetMp3, { force: true });
    }
  }

  // Fuente 2: ThemerrDB (LizardByte) para películas y series
  if (tmdbId) {
    try {
      const tipo = kind === 'movie' ? 'movies' : 'tv_shows';
      const apiUrl = `https://raw.githubusercontent.com/LizardByte/ThemerrDB/database/${tipo}/themoviedb/${tmdbId}.json`;
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const data = (await res.json()) as { youtube_theme_url?: string };
        if (data.youtube_theme_url) {
          const ok = await descargarAudioYoutube(data.youtube_theme_url, targetMp3);
          if (ok) {
            console.log(`[tema] Descargado tema #${itemId} (TMDB ${tmdbId}) vía ThemerrDB/YouTube`);
            return true;
          }
          // yt-dlp muerto por el tope o fallido: sin restos que parezcan un tema.
          rmSync(targetMp3, { force: true });
        }
      }
    } catch (err: any) {
      console.warn(`[tema] Error consultando ThemerrDB para #${itemId}:`, err.message);
    }
  }

  return false;
}

function descargarAudioYoutube(url: string, destinoMp3: string): Promise<boolean> {
  return new Promise((resolve) => {
    // yt-dlp extrayendo los primeros 35 s de audio a MP3. Calidad VBR 4 (~165 kbps): con la 0 (~245 kbps)
    // ocupaban un 38 % más para una música de fondo, con el mismo volumen (medido sobre las 917 de data/themes).
    const proc = spawn('yt-dlp', [
      '-x',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '4',
      '--download-sections',
      '*0-35',
      '-o',
      destinoMp3.replace(/\.mp3$/, '.%(ext)s'),
      '--no-playlist',
      '--no-warnings',
      url,
    ], { windowsHide: true, timeout: 3 * 60_000 });

    proc.on('error', (err) => {
      console.warn('[tema] Error ejecutando yt-dlp:', err.message);
      resolve(false);
    });

    proc.on('close', (code) => {
      resolve(code === 0 && existsSync(destinoMp3));
    });
  });
}

/** Descarga en lote los temas que falten en toda la biblioteca (series primero, luego películas). */
export async function descargarTodosLosTemas(
  onProgreso?: (actual: number, total: number, titulo: string) => void,
): Promise<{ total: number; descargados: number; yaEstaban: number; fallidos: number }> {
  type FilaItem = { id: number; title: string; folder: string; kind: string; tvdb_id: number | null; tmdb_id: number | null };
  const items = db
    .prepare("SELECT id, title, folder, kind, tvdb_id, tmdb_id FROM items ORDER BY (CASE WHEN kind = 'show' THEN 0 ELSE 1 END), id ASC")
    .all() as FilaItem[];

  let descargados = 0;
  let yaEstaban = 0;
  let fallidos = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgreso?.(i + 1, items.length, item.title);

    if (tieneTema(item.id, item.folder)) {
      yaEstaban++;
      continue;
    }

    const exito = await descargarTema(item.id, item.tvdb_id, item.tmdb_id, item.kind, item.folder);
    if (exito) descargados++;
    else fallidos++;

    // Pausa breve entre peticiones para ser respetuosos con las APIs externas
    await new Promise((r) => setTimeout(r, 120));
  }

  return { total: items.length, descargados, yaEstaban, fallidos };
}
