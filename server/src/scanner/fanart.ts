/**
 * fanart.tv: lo que TMDb no tiene.
 *
 * TMDb guarda carteles y fondos de sobra, pero los logotipos y las imágenes
 * apaisadas (la «landscape» de las filas) son cosa de fanart.tv: una comunidad
 * que las dibuja a mano, en varios idiomas y con votos. De ahí vienen los que
 * tinyMediaManager dejó en las carpetas, y de ahí se sacan los que faltan.
 *
 * Dos trabajos, en una sola pasada por la biblioteca:
 *
 * 1. **Rellenar** los papeles vacíos (logotipo, apaisada, fondo, cartel) con la
 *    mejor imagen que haya: primero en español, luego en inglés, luego sin
 *    idioma, y dentro de cada idioma por votos.
 * 2. **Sustituir** los logotipos y apaisadas que están en otro idioma. No se
 *    sabe en qué idioma está el fichero de la carpeta —no lo dice el nombre—
 *    así que se compara la imagen con las candidatas de fanart.tv y TMDb, a lo
 *    bruto: reducidas a 32×32 en escala de grises y por el canal alfa. Primero
 *    con las que están en español, inglés o sin idioma: si se parece a una de
 *    esas, está bien y no se toca. Solo si no está entre esas y sí se parece a
 *    una en otro idioma, se cambia por la mejor en español o inglés. Si no se
 *    parece a ninguna, se deja: peor que un logotipo en italiano es cargarse
 *    uno bueno. Y se compara con las previsualizaciones pequeñas, que para
 *    una firma de 32×32 sobran y pesan veinte veces menos.
 *
 * Nada de esto toca las carpetas de la biblioteca: las imágenes nuevas van a
 * `data/artwork/<id>/` y se marcan como fijadas para que el escáner no las
 * pise con el fichero viejo.
 *
 * Las series van por el id de TheTVDB, que es el que entiende fanart.tv; se
 * pide a TMDb una vez y se guarda en `items.tvdb_id`.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { descargar, logosDeTmdb, tmdbExternalIds, type Papel } from './tmdb.ts';
import { idDePeliculaTvdb, imagenesDeTvdb } from './tvdb.ts';

const API = 'https://webservice.fanart.tv/v3';
const ARTWORK_DIR = join(DATA_DIR, 'artwork');

export type PapelFanart = Papel;

type Candidata = { url: string; idioma: string; votos: number; vista?: string };

/** Qué listas de fanart.tv alimentan cada papel, por tipo de título. */
const LISTAS: Record<'movie' | 'show', Record<PapelFanart, string[]>> = {
  movie: {
    clearlogo: ['hdmovielogo', 'movielogo'],
    landscape: ['moviethumb'],
    fanart: ['moviebackground'],
    poster: ['movieposter'],
    discart: ['moviedisc'],
  },
  show: {
    clearlogo: ['hdtvlogo', 'clearlogo'],
    landscape: ['tvthumb'],
    fanart: ['showbackground'],
    poster: ['tvposter'],
    // Las series no tienen disco en fanart.tv.
    discart: [],
  },
};

const FICHERO: Record<PapelFanart, string> = {
  poster: 'poster.jpg',
  fanart: 'fanart.jpg',
  clearlogo: 'logo.png',
  landscape: 'landscape.jpg',
  discart: 'disc.png',
};

/** Los papeles que llevan texto y por tanto tienen idioma. */
const CON_TEXTO: PapelFanart[] = ['clearlogo', 'landscape'];

export type EstadoFanart = {
  enCurso: boolean;
  hechos: number;
  total: number;
  rellenados: Record<PapelFanart, number>;
  sustituidos: Record<PapelFanart, number>;
  sinFanart: number;
  sinId: number;
  reemplazar: boolean;
  empezadoEn: string | null;
  terminadoEn: string | null;
  error: string | null;
  /** Lo último que se hizo, para la barra. */
  ultimo: string;
};

const vacio = (): Record<PapelFanart, number> => ({ poster: 0, fanart: 0, clearlogo: 0, landscape: 0, discart: 0 });

const estado: EstadoFanart = {
  enCurso: false, hechos: 0, total: 0, rellenados: vacio(), sustituidos: vacio(),
  sinFanart: 0, sinId: 0, reemplazar: false, empezadoEn: null, terminadoEn: null, error: null, ultimo: '',
};

let parar = false;

export function estadoFanart(): EstadoFanart {
  return { ...estado, rellenados: { ...estado.rellenados }, sustituidos: { ...estado.sustituidos } };
}

export function pararFanart() {
  parar = true;
}

/* ------------------------------------------------------------ fanart.tv */

async function fanart(path: string): Promise<any | null> {
  if (!config.fanartApiKey) throw new Error('Falta la clave de fanart.tv en config.json (fanartApiKey)');
  for (let intento = 0; intento < 3; intento++) {
    const res = await fetch(`${API}${path}?api_key=${config.fanartApiKey}`, { headers: { accept: 'application/json' } });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2_000 * (intento + 1)));
      continue;
    }
    if (res.status === 401) throw new Error('La clave de fanart.tv no es válida');
    if (!res.ok) throw new Error(`fanart.tv respondió ${res.status}`);
    return await res.json();
  }
  return null;
}

/** Primero el idioma de casa, luego inglés, luego sin idioma, luego el resto; y por votos. */
function rango(idioma: string): number {
  const casa = config.tmdbLanguage.slice(0, 2);
  if (idioma === casa) return 0;
  if (idioma === 'en') return 1;
  if (!idioma || idioma === '00') return 2;
  return 3;
}

function candidatas(datos: any, kind: 'movie' | 'show', papel: PapelFanart): Candidata[] {
  const lista: Candidata[] = [];
  if (!datos) return lista;
  for (const clave of LISTAS[kind][papel]) {
    for (const x of datos?.[clave] ?? []) {
      // Las de temporada ('season') no valen como imagen de la serie.
      if (x.season && x.season !== 'all') continue;
      lista.push({
        url: x.url,
        // fanart.tv sirve una previsualización cambiando /fanart/ por /preview/.
        vista: String(x.url).replace('/fanart/', '/preview/'),
        idioma: x.lang === '00' ? '' : (x.lang ?? ''),
        // En los discos, el Blu-ray antes que el DVD, por encima de los votos.
        votos: Number(x.likes ?? 0) + (papel === 'discart' && x.disc_type === 'bluray' ? 1_000 : 0),
      });
    }
  }
  return lista.sort((a, b) => rango(a.idioma) - rango(b.idioma) || b.votos - a.votos);
}

/* --------------------------------------------------- parecido de imágenes */

/**
 * Firma de una imagen: 32×32 en gris más 32×32 del canal alfa, 2048 bytes.
 * Con eso dos logotipos iguales dan distancia ~0 aunque uno esté reescalado o
 * guardado con otro compresor, y dos distintos dan mucho más.
 */
function firma(ruta: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const proc = spawn(
      config.ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-i', ruta,
        '-filter_complex', '[0:v]format=rgba,split=2[a][b];[a]scale=32:32:flags=area,format=gray[g];[b]alphaextract,scale=32:32:flags=area,format=gray[al];[g][al]vstack',
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const trozos: Buffer[] = [];
    let terminado = false;
    // Una imagen corrupta o un origen que se cuelga (fanart.tv/TVDB lentos)
    // dejaba este proceso sin cerrar nunca: nadie escuchaba 'close' porque
    // ffmpeg tampoco recibía EOF, y completarConFanart() se quedaba parado en
    // ese título para siempre, sin avisar.
    const limite = setTimeout(() => { terminado = true; proc.kill('SIGKILL'); resolve(null); }, 15_000);
    proc.stdout.on('data', (d) => trozos.push(d));
    proc.on('error', () => { if (!terminado) { terminado = true; clearTimeout(limite); resolve(null); } });
    proc.on('close', () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(limite);
      const b = Buffer.concat(trozos);
      resolve(b.length === 2048 ? b : null);
    });
  });
}

function distancia(a: Buffer, b: Buffer): number {
  let suma = 0;
  for (let i = 0; i < a.length; i++) suma += Math.abs(a[i] - b[i]);
  return suma / a.length; // 0..255
}

/** Por debajo de esto, son la misma imagen. Medido: iguales 0–1 (reescalada 0,5), distintas 28–30. */
const UMBRAL = 12;

/* ---------------------------------------------------------------- pasada */

type Fila = {
  id: number; kind: 'movie' | 'show'; title: string; tmdb_id: number | null; tvdb_id: number | null; imdb_id: string | null;
  arte_revisado: string | null;
  poster: string | null; fanart: string | null; clearlogo: string | null; landscape: string | null; discart: string | null; arte_fijado: string | null;
};

async function idDeFanart(f: Fila): Promise<string | null> {
  if (f.kind === 'movie') return f.tmdb_id ? String(f.tmdb_id) : null;
  if (f.tvdb_id) return String(f.tvdb_id);
  if (!f.tmdb_id) return null;
  try {
    const ext = await tmdbExternalIds(f.tmdb_id, 'show');
    if (ext?.tvdb_id) {
      db.prepare('UPDATE items SET tvdb_id = ? WHERE id = ?').run(ext.tvdb_id, f.id);
      return String(ext.tvdb_id);
    }
  } catch { /* sin TVDB no hay fanart.tv para esta serie */ }
  return null;
}

async function poner(f: Fila, papel: PapelFanart, url: string) {
  const dir = join(ARTWORK_DIR, String(f.id));
  mkdirSync(dir, { recursive: true });
  const destino = await descargar(url, join(dir, FICHERO[papel]));
  const papeles = new Set((f.arte_fijado ?? '').split(',').filter(Boolean));
  papeles.add(papel);
  f.arte_fijado = [...papeles].join(',');
  db.prepare(`UPDATE items SET ${papel} = ?, arte_fijado = ? WHERE id = ?`).run(destino, f.arte_fijado, f.id);
  (f as any)[papel] = destino;
}

/**
 * Lo de TVDB para este título, por papeles, ya en el formato de aquí. Series
 * por su id (que ya tenemos para fanart.tv); películas buscándolas por IMDb.
 * Si no hay clave o no hay nada, listas vacías y se sigue.
 */
async function deTvdb(f: Fila): Promise<Partial<Record<PapelFanart, Candidata[]>>> {
  if (!config.tvdbApiKey) return {};
  try {
    let id: number | null = null;
    if (f.kind === 'show') id = f.tvdb_id;
    else if (f.imdb_id) id = await idDePeliculaTvdb(f.imdb_id);
    if (!id) return {};
    const r = await imagenesDeTvdb(f.kind, id);
    if (!r) return {};
    const a = (l: { url: string; vista: string; idioma: string; votos: number }[]): Candidata[] =>
      l.map((x) => ({ url: x.url, vista: x.vista, idioma: x.idioma, votos: x.votos }));
    return { clearlogo: a(r.clearlogo), fanart: a(r.fanart), poster: a(r.poster) };
  } catch {
    return {};
  }
}

async function procesar(f: Fila, reemplazar: boolean, tmp: string) {
  const id = await idDeFanart(f);
  if (!id) { estado.sinId++; return; }
  const datos = await fanart(`/${f.kind === 'movie' ? 'movies' : 'tv'}/${id}`);
  if (!datos) estado.sinFanart++;
  const extra = await deTvdb(f);

  const fijados = new Set((f.arte_fijado ?? '').split(',').filter(Boolean));

  for (const papel of ['clearlogo', 'landscape', 'fanart', 'poster', 'discart'] as PapelFanart[]) {
    // fanart.tv y TVDB juntos, con el mismo orden: español, inglés, sin
    // idioma, el resto; y por votos. fanart.tv va primero a igualdad porque
    // sus logotipos suelen ser mejores.
    const lista = [...candidatas(datos, f.kind, papel), ...(extra[papel] ?? [])]
      .sort((a, b) => rango(a.idioma) - rango(b.idioma) || b.votos - a.votos);
    if (lista.length === 0) continue;
    const actual = f[papel];

    // 1. Falta: la mejor que haya.
    if (!actual || !existsSync(actual)) {
      await poner(f, papel, lista[0].url);
      estado.rellenados[papel]++;
      estado.ultimo = `${f.title}: ${papel} nuevo`;
      continue;
    }

    // 2. Está pero en otro idioma: solo lo que lleva texto, solo si no lo eligió
    //    alguien a mano, y solo si hay una en español o inglés con la que cambiarlo.
    if (!reemplazar || !CON_TEXTO.includes(papel) || fijados.has(papel)) continue;
    const mejor = lista[0];
    if (rango(mejor.idioma) > 1) continue;

    const todas = [...lista];
    // Los logotipos locales pueden venir de TMDb (tinyMediaManager también
    // los baja de ahí): sus versiones cuentan igual, en cualquier idioma.
    if (papel === 'clearlogo' && f.tmdb_id) {
      try {
        for (const l of await logosDeTmdb(f.tmdb_id, f.kind)) todas.push({ url: l.url, vista: l.vista, idioma: l.idioma, votos: 0 });
      } catch { /* sin TMDb, con lo de fanart.tv basta */ }
    }
    const propias = todas.filter((c) => rango(c.idioma) <= 2);
    const ajenas = todas.filter((c) => rango(c.idioma) === 3);
    if (ajenas.length === 0) continue;

    const mia = await firma(actual);
    if (!mia) continue;
    const seParece = async (c: Candidata) => {
      const fuente = c.vista ?? c.url;
      const bajada = join(tmp, 'candidata' + (fuente.endsWith('.png') ? '.png' : '.jpg'));
      try {
        await descargar(fuente, bajada);
        const suya = await firma(bajada);
        return Boolean(suya && distancia(mia, suya) < UMBRAL);
      } catch {
        return false; // una candidata que no baja no decide nada
      }
    };
    // Si es una de las buenas, se acabó: no se toca.
    let esPropia = false;
    for (const c of propias) { if (await seParece(c)) { esPropia = true; break; } }
    if (esPropia) continue;
    let esAjena = false;
    for (const c of ajenas) { if (await seParece(c)) { esAjena = true; break; } }
    if (esAjena) {
      await poner(f, papel, mejor.url);
      estado.sustituidos[papel]++;
      estado.ultimo = `${f.title}: ${papel} sustituido por ${mejor.idioma || 'sin idioma'}`;
    }
  }
}

/**
 * La pasada entera, en segundo plano. Un título por vuelta del bucle y una
 * pausa corta entre peticiones: fanart.tv es de una comunidad, no de Google.
 */
export async function completarConFanart(reemplazar: boolean, forzar = false): Promise<void> {
  if (estado.enCurso) return;
  parar = false;
  // Lo revisado hace menos de un mes se salta, salvo que se fuerce: la
  // comparación de idiomas baja previsualizaciones y no cambia de un día a otro.
  const reciente = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const filas = db
    .prepare(`SELECT id, kind, title, tmdb_id, tvdb_id, imdb_id, poster, fanart, clearlogo, landscape, discart, arte_fijado, arte_revisado
              FROM items ORDER BY kind, title`)
    .all() as Fila[];

  Object.assign(estado, {
    enCurso: true, hechos: 0, total: filas.length, rellenados: vacio(), sustituidos: vacio(),
    sinFanart: 0, sinId: 0, reemplazar, empezadoEn: new Date().toISOString(), terminadoEn: null, error: null, ultimo: '',
  });
  const tmp = join(ARTWORK_DIR, '_tmp');
  mkdirSync(tmp, { recursive: true });

  try {
    for (const f of filas) {
      if (parar) break;
      try {
        const yaVisto = !forzar && f.arte_revisado != null && f.arte_revisado > reciente;
        await procesar(f, reemplazar && !yaVisto, tmp);
        db.prepare('UPDATE items SET arte_revisado = ? WHERE id = ?').run(new Date().toISOString(), f.id);
      } catch (err) {
        // Un título que falla no para la pasada; se apunta y se sigue.
        estado.ultimo = `${f.title}: ${(err as Error).message}`;
        if (/clave/i.test((err as Error).message)) throw err;
      }
      estado.hechos++;
      await new Promise((r) => setTimeout(r, 350));
    }
  } catch (err) {
    estado.error = (err as Error).message;
  } finally {
    // Un único fichero reutilizado (candidata.jpg/png) que antes se dejaba en
    // disco al terminar: basura permanente, y si el proceso moría a mitad de
    // una descarga, ese resto parcial podía confundir la siguiente pasada.
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ya no está, no importa */ }
    estado.enCurso = false;
    estado.terminadoEn = new Date().toISOString();
  }
}

/** Para el selector de imágenes: lo que fanart.tv tiene de un título, por papeles. */
export async function imagenesDeFanart(kind: 'movie' | 'show', tmdbId: number) {
  let id: string | null = String(tmdbId);
  if (kind === 'show') {
    const fila = db.prepare('SELECT tvdb_id FROM items WHERE tmdb_id = ? AND kind = ?').get(tmdbId, 'show') as { tvdb_id: number | null } | undefined;
    id = fila?.tvdb_id ? String(fila.tvdb_id) : null;
    if (!id) {
      try { id = String((await tmdbExternalIds(tmdbId, 'show'))?.tvdb_id ?? '') || null; } catch { id = null; }
    }
  }
  if (!id) return null;
  const datos = await fanart(`/${kind === 'movie' ? 'movies' : 'tv'}/${id}`);
  if (!datos) return null;
  const aVista = (c: Candidata) => ({
    url: c.url,
    vista: c.vista ?? c.url,
    ancho: 0,
    alto: 0,
    idioma: c.idioma,
    voto: c.votos,
  });
  return {
    poster: candidatas(datos, kind, 'poster').map(aVista),
    fanart: candidatas(datos, kind, 'fanart').map(aVista),
    clearlogo: candidatas(datos, kind, 'clearlogo').map(aVista),
    landscape: candidatas(datos, kind, 'landscape').map(aVista),
    discart: candidatas(datos, kind, 'discart').map(aVista),
  };
}

/** Tamaño en disco de una imagen, para el informe; cero si no está. */
export function tamano(ruta: string | null): number {
  try { return ruta ? statSync(ruta).size : 0; } catch { return 0; }
}
