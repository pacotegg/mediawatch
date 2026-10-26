/**
 * Enriquecedor avanzado de fotos de actores y cineastas.
 *
 * Busca fotos oficiales y recientes fuera y dentro de TMDb:
 * 1. TMDb: perfiles alternativos en `/person/{id}/images` y búsqueda de personas huérfanas.
 * 2. Wikipedia REST API (español e inglés): fotos de infobox procedentes de eventos y festivales de cine recientes.
 * 3. Wikidata & Wikimedia Commons: consulta de entidades relacionadas con cine/tv/artes y propiedad P18 (imagen).
 *
 * Las fotos se descargan a `data/artwork/personas/{id}.jpg` y se actualiza `people.thumb`.
 */
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db, normalize } from '../db.ts';
import { descargar } from './tmdb.ts';

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGES = 'https://image.tmdb.org/t/p/w400';
const DIR_PERSONAS = join(DATA_DIR, 'artwork', 'personas');
const USER_AGENT = 'MediaWatch/1.0 (https://github.com/pacotegg/mediawatch; bot)';

export type EstadoEnriquecerActores = {
  enCurso: boolean;
  total: number;
  procesados: number;
  fotosNuevas: number;
  fotosTmdb: number;
  fotosWikipedia: number;
  fotosWikidata: number;
  sinFoto: number;
  errores: number;
  ultimo: string;
};

const estado: EstadoEnriquecerActores = {
  enCurso: false,
  total: 0,
  procesados: 0,
  fotosNuevas: 0,
  fotosTmdb: 0,
  fotosWikipedia: 0,
  fotosWikidata: 0,
  sinFoto: 0,
  errores: 0,
  ultimo: '',
};

export const estadoEnriquecerActores = (): EstadoEnriquecerActores => ({ ...estado });

/** Comprueba si una descripción encaja con alguien del mundo audiovisual/artístico */
function esProfesionAudiovisual(desc: string): boolean {
  if (!desc) return false;
  const d = desc.toLowerCase();
  return (
    d.includes('actor') ||
    d.includes('actriz') ||
    d.includes('actress') ||
    d.includes('director') ||
    d.includes('directora') ||
    d.includes('cineasta') ||
    d.includes('filmmaker') ||
    d.includes('filmmaking') ||
    d.includes('producer') ||
    d.includes('productor') ||
    d.includes('productora') ||
    d.includes('writer') ||
    d.includes('guionista') ||
    d.includes('screenwriter') ||
    d.includes('comedian') ||
    d.includes('comediante') ||
    d.includes('animator') ||
    d.includes('animador') ||
    d.includes('voice') ||
    d.includes('doblaje') ||
    d.includes('cantante') ||
    d.includes('singer') ||
    d.includes('musician') ||
    d.includes('músico') ||
    d.includes('presentador') ||
    d.includes('presentadora') ||
    d.includes('host') ||
    d.includes('artist') ||
    d.includes('artista') ||
    d.includes('película') ||
    d.includes('film') ||
    d.includes('television') ||
    d.includes('televisión')
  );
}

/*
 * Las fotos buscadas por NOMBRE se equivocaban de persona: el 26/10/2026, de 71 de Wikipedia 28 eran de otro (el productor
 * Sam Phillips para el actor del mismo nombre) o de una película (el cartel de Platoon o de Tiburón como foto de un actor).
 * Una ficha de Wikidata solo vale si es una persona y sus ids de TMDb/IMDb no contradicen a los nuestros.
 */
export type FichaWikidata = { humano: boolean; tmdb: string[]; imdb: string[] };
export type VeredictoFicha = 'confirmada' | 'contradice' | 'no-persona' | 'sin-ids';

export function juzgarFichaWikidata(f: FichaWikidata, tmdbId: number | null, imdbId: string | null): VeredictoFicha {
  if (!f.humano) return 'no-persona';
  if ((tmdbId && f.tmdb.includes(String(tmdbId))) || (imdbId && f.imdb.includes(imdbId))) return 'confirmada';
  if ((tmdbId && f.tmdb.length > 0) || (imdbId && f.imdb.length > 0)) return 'contradice';
  return 'sin-ids';
}

/** Mismo nombre sin tildes, mayúsculas ni paréntesis de desambiguación («Richard Alexander (actor)»). */
export function mismoNombre(a: string, b: string): boolean {
  const limpia = (x: string) => normalize(x.replace(/\s*\([^)]*\)\s*/g, ' ')).replace(/\s+/g, ' ').trim();
  return limpia(a) === limpia(b);
}

function fichaDeClaims(claims: any): FichaWikidata {
  const val = (pr: string): any[] => (claims?.[pr] ?? []).map((x: any) => x?.mainsnak?.datavalue?.value).filter((v: unknown) => v !== undefined && v !== null);
  return { humano: val('P31').some((v) => v?.id === 'Q5'), tmdb: val('P4985').map(String), imdb: val('P345').map(String) };
}

/** Sin ids en la ficha, solo se acepta si el nombre coincide exactamente (queda el riesgo de un homónimo del mismo oficio). */
function aceptable(v: VeredictoFicha, tituloFicha: string, nombre: string): boolean {
  return v === 'confirmada' || (v === 'sin-ids' && mismoNombre(tituloFicha, nombre));
}

/** 1. Buscar fotos en TMDb (imágenes alternativas de la persona o búsqueda de huérfanos) */
async function salenEnNuestraBiblioteca(tmdbPersonaId: number, titulosNuestros: Set<string>): Promise<boolean> {
  if (titulosNuestros.size === 0) return false;
  const res = await fetch(`${TMDB_API}/person/${tmdbPersonaId}/combined_credits?api_key=${config.tmdbApiKey}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) return false;
  const d = (await res.json()) as { cast?: Array<{ media_type: string; id: number }>; crew?: Array<{ media_type: string; id: number }> };
  return [...(d.cast ?? []), ...(d.crew ?? [])].some((c) => titulosNuestros.has(`${c.media_type}:${c.id}`));
}

async function buscarFotoEnTmdb(tmdbId: number | null, nombre: string, titulosNuestros: Set<string>): Promise<{ url: string; tmdbId: number } | null> {
  if (!config.tmdbApiKey) return null;

  try {
    // Si ya tiene tmdbId, consultar /person/{id}/images por si hay fotos en profiles
    if (tmdbId) {
      const res = await fetch(`${TMDB_API}/person/${tmdbId}/images?api_key=${config.tmdbApiKey}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(6_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { profiles?: Array<{ file_path: string; vote_average?: number; width?: number }> };
        if (data.profiles && data.profiles.length > 0) {
          // Ordenar por vote_average descendente
          const mejores = [...data.profiles].sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
          if (mejores[0]?.file_path) {
            return { url: `${TMDB_IMAGES}${mejores[0].file_path}`, tmdbId };
          }
        }
      }
    } else {
      // Si no tiene tmdbId, buscar en /search/person
      const res = await fetch(`${TMDB_API}/search/person?api_key=${config.tmdbApiKey}&language=${config.tmdbLanguage}&query=${encodeURIComponent(nombre)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(6_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: Array<{ id: number; name: string; profile_path?: string | null; popularity?: number }> };
        const normTarget = normalize(nombre);
        for (const p of data.results || []) {
          // El primer homónimo con foto no vale: tiene que salir en el reparto de algún título de la biblioteca.
          if (normalize(p.name) === normTarget && p.profile_path && (await salenEnNuestraBiblioteca(p.id, titulosNuestros))) {
            return { url: `${TMDB_IMAGES}${p.profile_path}`, tmdbId: p.id };
          }
        }
      }
    }
  } catch {
    // TMDb timeout o fallo transitorio
  }

  return null;
}

/** 2. Buscar fotos en Wikipedia REST API (español e inglés) */
async function buscarFotoEnWikipedia(nombre: string, valida: (q: string | undefined, titulo: string) => Promise<boolean>): Promise<{ url: string; titulo: string; lang: string } | null> {
  const variantes = [
    nombre.replace(/ /g, '_'),
    `${nombre.replace(/ /g, '_')}_(actor)`,
    `${nombre.replace(/ /g, '_')}_(actriz)`,
    `${nombre.replace(/ /g, '_')}_(director)`,
  ];

  for (const lang of ['es', 'en']) {
    for (const slug of variantes) {
      try {
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(6_000),
        });
        if (!res.ok) continue;

        const data = (await res.json()) as {
          type?: string;
          title?: string;
          description?: string;
          wikibase_item?: string;
          thumbnail?: { source: string };
          originalimage?: { source: string };
        };

        if (data.type === 'disambiguation') continue;

        const desc = data.description || '';
        // Si no tiene profesión identificable en la descripción y no usamos sufijo explícito, omitir
        const esSufijoExplicito = slug.includes('(');
        if (!esSufijoExplicito && desc && !esProfesionAudiovisual(desc)) {
          continue;
        }

        if (data.thumbnail?.source) {
          if (!(await valida(data.wikibase_item, data.title || nombre))) continue;
          const imgUrl = data.originalimage?.source || data.thumbnail.source;
          return { url: imgUrl, titulo: data.title || nombre, lang };
        }
      } catch {
        // Ignorar fallos de red en Wikipedia
      }
    }
  }
  return null;
}

/*
 * Wikidata limita las peticiones: con 3 trabajadores a la vez respondía «You are making too many requests» (texto, no
 * JSON) y el error se tragaba en silencio, así que la pasada del 18/10/2026 dio 0 fotos de Wikidata en 25.000 personas.
 * Un turno de 1,1 s entre peticiones, compartido por todos los trabajadores.
 */
let siguienteTurnoWikidata = 0;
async function turnoWikidata(): Promise<void> {
  const ahora = Date.now();
  const mio = Math.max(ahora, siguienteTurnoWikidata);
  siguienteTurnoWikidata = mio + 1100;
  if (mio > ahora) await new Promise((r) => setTimeout(r, mio - ahora));
}

async function jsonDeWikidata(url: string): Promise<any | null> {
  await turnoWikidata();
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

/*
 * 3a. Wikidata por id EXACTO (TMDb P4985, si no IMDb P345): la búsqueda por nombre casi nunca acierta con actores poco
 * conocidos. Medido el 26/10/2026 con 30 del reparto principal sin foto: 8 en Wikidata, 3 con imagen.
 */
async function buscarFotoEnWikidataPorId(tmdbId: number | null, imdbId: string | null): Promise<{ url: string; id: string } | null> {
  try {
    for (const [prop, valor] of [['P4985', tmdbId], ['P345', imdbId]] as const) {
      if (!valor) continue;
      const s = await jsonDeWikidata(`https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srsearch=${encodeURIComponent(`haswbstatement:${prop}=${valor}`)}`);
      const q = s?.query?.search?.[0]?.title as string | undefined;
      if (!q) continue;
      const e = await jsonDeWikidata(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=claims&format=json`);
      const p18 = e?.entities?.[q]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (p18 && typeof p18 === 'string') return { url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p18)}?width=600`, id: q };
      return null;
    }
  } catch {
    // Wikidata caída o lenta: se sigue con las demás fuentes
  }
  return null;
}

/** 3b. Buscar fotos en Wikidata JSON (búsqueda de entidad + claim P18 imagen) */
async function buscarFotoEnWikidata(nombre: string, tmdbId: number | null, imdbId: string | null): Promise<{ url: string; id: string } | null> {
  try {
    await turnoWikidata();
    const qUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(nombre)}&language=es&format=json&type=item&limit=3`;
    const res = await fetch(qUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { search?: Array<{ id: string; label?: string; description?: string }> };
    for (const item of data.search || []) {
      const desc = item.description || '';
      if (esProfesionAudiovisual(desc)) {
        // Consultar claims para la entidad
        const cUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${item.id}&props=claims&format=json`;
        await turnoWikidata();
        const cRes = await fetch(cUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(6_000),
        });
        if (!cRes.ok) continue;

        const cData = (await cRes.json()) as any;
        const claims = cData.entities?.[item.id]?.claims;
        const p18 = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (p18 && typeof p18 === 'string') {
          if (!aceptable(juzgarFichaWikidata(fichaDeClaims(claims), tmdbId, imdbId), item.label || '', nombre)) continue;
          const imgUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p18)}?width=600`;
          return { url: imgUrl, id: item.id };
        }
      }
    }
  } catch {
    // Ignorar fallo en Wikidata
  }
  return null;
}

export type OpcionesEnriquecer = {
  limite?: number;
  soloPrincipales?: boolean;
  concurrencia?: number;
  alAvanzar?: (e: EstadoEnriquecerActores) => void;
};

/**
 * Recorre las personas sin foto en la biblioteca y las enriquece desde TMDb, Wikipedia y Wikidata.
 */
export async function enriquecerFotosActores(opciones: OpcionesEnriquecer = {}): Promise<EstadoEnriquecerActores> {
  if (estado.enCurso) return estadoEnriquecerActores();

  const soloPrincipales = opciones.soloPrincipales !== false;
  const limite = opciones.limite || 15_000;
  const concurrencia = Math.max(1, Math.min(6, opciones.concurrencia || 3));

  mkdirSync(DIR_PERSONAS, { recursive: true });

  // Seleccionar personas sin foto (p.thumb IS NULL y sin archivo local preexistente)
  const sql = soloPrincipales
    ? `
      SELECT p.id, p.name, pd.tmdb_id, pd.imdb_id, pd.profile, COUNT(ip.item_id) as apariciones, MIN(ip.ord) as orden_min
      FROM people p
      LEFT JOIN people_details pd ON pd.person_id = p.id
      JOIN item_people ip ON ip.person_id = p.id
      WHERE p.thumb IS NULL
      GROUP BY p.id
      ORDER BY (CASE WHEN MIN(ip.ord) IS NOT NULL AND MIN(ip.ord) <= 15 THEN 0 ELSE 1 END), apariciones DESC, p.id DESC
      LIMIT ?
    `
    : `
      SELECT p.id, p.name, pd.tmdb_id, pd.imdb_id, pd.profile, COUNT(ip.item_id) as apariciones, MIN(ip.ord) as orden_min
      FROM people p
      LEFT JOIN people_details pd ON pd.person_id = p.id
      JOIN item_people ip ON ip.person_id = p.id
      WHERE p.thumb IS NULL
      GROUP BY p.id
      ORDER BY apariciones DESC, p.id DESC
      LIMIT ?
    `;

  const candidatas = db.prepare(sql).all(limite) as Array<{
    id: number;
    name: string;
    tmdb_id: number | null;
    imdb_id: string | null;
    profile: string | null;
    apariciones: number;
    orden_min: number | null;
  }>;

  Object.assign(estado, {
    enCurso: true,
    total: candidatas.length,
    procesados: 0,
    fotosNuevas: 0,
    fotosTmdb: 0,
    fotosWikipedia: 0,
    fotosWikidata: 0,
    sinFoto: 0,
    errores: 0,
    ultimo: '',
  });

  const ponerFoto = db.prepare('UPDATE people SET thumb = ? WHERE id = ?');
  const titulosDe = db.prepare('SELECT DISTINCT i.kind, i.tmdb_id FROM item_people ip JOIN items i ON i.id = ip.item_id WHERE ip.person_id = ? AND i.tmdb_id IS NOT NULL');
  const titulosNuestros = (personaId: number) =>
    new Set((titulosDe.all(personaId) as Array<{ kind: string; tmdb_id: number | string }>).map((t) => `${t.kind === 'show' ? 'tv' : 'movie'}:${t.tmdb_id}`));
  const apuntarDetalle = db.prepare(`
    INSERT INTO people_details (person_id, tmdb_id, profile, fetched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(person_id) DO UPDATE SET
      tmdb_id = COALESCE(people_details.tmdb_id, excluded.tmdb_id),
      profile = COALESCE(excluded.profile, people_details.profile),
      fetched_at = excluded.fetched_at
  `);

  let indice = 0;

  function convertirAWebp(input: string, output: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(config.ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', input,
        '-c:v', 'libwebp',
        '-q:v', '82',
        output,
      ], { windowsHide: true, stdio: 'ignore', timeout: 30_000 });

      proc.on('close', (code) => {
        if (code === 0 && existsSync(output) && statSync(output).size > 0) {
          resolve(true);
        } else {
          try { if (existsSync(output)) unlinkSync(output); } catch {}
          resolve(false);
        }
      });
      proc.on('error', () => {
        try { if (existsSync(output)) unlinkSync(output); } catch {}
        resolve(false);
      });
    });
  }

  async function trabajador(): Promise<void> {
    while (indice < candidatas.length && estado.enCurso) {
      const persona = candidatas[indice++];
      if (!persona) break;

      const archivoDestino = join(DIR_PERSONAS, `${persona.id}.webp`);

      // Si el archivo ya existía físicamente en disco, sólo registrarlo
      if (existsSync(archivoDestino)) {
        ponerFoto.run(archivoDestino, persona.id);
        estado.fotosNuevas++;
        estado.procesados++;
        continue;
      }

      let fotoUrl: string | null = null;
      let fuente: 'tmdb' | 'wikipedia' | 'wikidata' | '' = '';
      let nuevoTmdbId: number | null = persona.tmdb_id;

      try {
        // 1. Probar en TMDb (imágenes adicionales o búsqueda de nombre)
        const resTmdb = await buscarFotoEnTmdb(persona.tmdb_id, persona.name, titulosNuestros(persona.id));
        if (resTmdb) {
          fotoUrl = resTmdb.url;
          fuente = 'tmdb';
          nuevoTmdbId = resTmdb.tmdbId;
        }

        // 2. Wikidata por id exacto, antes que nada por nombre
        if (!fotoUrl) {
          const resId = await buscarFotoEnWikidataPorId(nuevoTmdbId, persona.imdb_id);
          if (resId) {
            fotoUrl = resId.url;
            fuente = 'wikidata';
          }
        }

        // 3. Si no, buscar en Wikipedia
        if (!fotoUrl) {
          const resWiki = await buscarFotoEnWikipedia(persona.name, async (q, titulo) => {
            if (!q) return false; // sin ficha de Wikidata no hay nada con qué comprobar que es la misma persona
            const e = await jsonDeWikidata(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${q}&props=claims&format=json`);
            const v = juzgarFichaWikidata(fichaDeClaims(e?.entities?.[q]?.claims), nuevoTmdbId, persona.imdb_id);
            return aceptable(v, titulo, persona.name);
          });
          if (resWiki) {
            fotoUrl = resWiki.url;
            fuente = 'wikipedia';
          }
        }

        // 3. Si no hay en Wikipedia, buscar en Wikidata
        if (!fotoUrl) {
          const resWd = await buscarFotoEnWikidata(persona.name, nuevoTmdbId, persona.imdb_id);
          if (resWd) {
            fotoUrl = resWd.url;
            fuente = 'wikidata';
          }
        }

        // Si se encontró foto, descargarla y fijarla
        if (fotoUrl) {
          const destTmp = join(DIR_PERSONAS, `${persona.id}.tmp`);
          try {
            await descargar(fotoUrl, destTmp);
            const ok = await convertirAWebp(destTmp, archivoDestino);
            try { unlinkSync(destTmp); } catch {}

            if (ok) {
              ponerFoto.run(archivoDestino, persona.id);
              apuntarDetalle.run(persona.id, nuevoTmdbId, fotoUrl, new Date().toISOString());

              estado.fotosNuevas++;
              if (fuente === 'tmdb') estado.fotosTmdb++;
              else if (fuente === 'wikipedia') estado.fotosWikipedia++;
              else if (fuente === 'wikidata') estado.fotosWikidata++;

              estado.ultimo = `+ ${persona.name} (${fuente})`;
            } else {
              estado.errores++;
              estado.ultimo = `x Fallo al convertir a webp: ${persona.name}`;
            }
          } catch {
            try { unlinkSync(destTmp); } catch {}
            estado.errores++;
            estado.ultimo = `x Fallo al descargar: ${persona.name}`;
          }
        } else {
          estado.sinFoto++;
          estado.ultimo = `- Sin foto: ${persona.name}`;
        }
      } catch (err) {
        estado.errores++;
        estado.ultimo = `! Error en ${persona.name}: ${(err as Error).message}`;
      }

      estado.procesados++;
      if (opciones.alAvanzar) {
        opciones.alAvanzar(estado);
      }

      // Pequeña pausa entre peticiones para respetar a los servidores
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  try {
    const trabajadores = Array.from({ length: concurrencia }, () => trabajador());
    await Promise.all(trabajadores);
  } finally {
    estado.enCurso = false;
  }

  return estadoEnriquecerActores();
}
