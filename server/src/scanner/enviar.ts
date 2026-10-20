/*
 * «Enviar a la biblioteca»: llevar un titulo preparado en una carpeta de entrada (C:\Videos) a la biblioteca que se elija (E:\Peliculas).
 *
 * Entre discos no hay `rename`: es COPIA, y se comprueba antes de dar nada por hecho:
 *   1. se copia a `<biblioteca>/_enviando-<carpeta>` (el escaner no entra en carpetas que empiezan por `_`);
 *   2. comprobacion. Por defecto RAPIDA: cada fichero copiado pesa exactamente lo mismo que el original (lo que hace Windows al mover; un error de
 *      escritura lo da el propio sistema). Con `verificacion: 'completa'` ademas se calcula el SHA-256 del origen mientras se lee y se vuelve a leer
 *      TODA la copia para compararlo (lenta: un video grande tarda minutos);
 *   3. solo si todo coincide, la carpeta temporal pasa a su nombre definitivo y la base de datos se actualiza (el titulo conserva su id, sus
 *      miniaturas y su progreso, y pasa a la otra biblioteca);
 *   4. el original se QUITA de la entrada (es un traslado: si se envia es porque no se quiere alli); con `quitarOriginal: false` se aparta a
 *      `<entrada>/_enviados/<fecha>/` como copia de seguridad. Nunca se quita sin haber comprobado la copia.
 * Si algo falla antes del paso 3 se limpia la copia parcial (es nuestra) y el original queda donde estaba. En el mismo disco basta con renombrar.
 * Solo se envia a una de las bibliotecas configuradas y del mismo tipo; nunca pisa una carpeta que ya exista.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { hayAlguienViendo } from '../media/ocupado.ts';
import { escaneoEnCurso } from './scan.ts';
import { actualizarBase } from './organizar.ts';

export type FaseEnvio = 'preparando' | 'copiando' | 'verificando' | 'actualizando' | 'terminando';
export type ProgresoEnvio = { fase: FaseEnvio; bytesHechos: number; bytesTotal: number; archivo: string };
export type PlanEnvio = { itemId: number; origen: string; destino: string; bytes: number; libre: number | null; mismoDisco: boolean };
export class EnvioError extends Error {}

const VIDEO = /\.(mkv|mp4|avi|m4v|mov|wmv|mpg|mpeg|ts|webm)$/i;
const MARGEN_LIBRE = 1024 ** 3; // se deja 1 GB libre en el destino
const mismoSitio = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

type ItemEnvio = { id: number; kind: 'movie' | 'show'; folder: string; library_id: number; raiz: string };

function itemDe(itemId: number): ItemEnvio {
  const it = db.prepare('SELECT i.id, i.kind, i.folder, i.library_id, l.path AS raiz FROM items i JOIN libraries l ON l.id = i.library_id WHERE i.id = ?').get(itemId) as ItemEnvio | undefined;
  if (!it) throw new EnvioError('El título ya no existe');
  return it;
}

function ficheros(dir: string, rel = ''): { rel: string; size: number }[] {
  const out: { rel: string; size: number }[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) out.push(...ficheros(dir, r));
    else if (e.isFile()) out.push({ rel: r, size: statSync(join(dir, r)).size });
  }
  return out;
}

export function planEnvio(itemId: number, destinoRaiz: string): PlanEnvio {
  const it = itemDe(itemId);
  if (VIDEO.test(it.folder) || !existsSync(it.folder) || !statSync(it.folder).isDirectory()) {
    throw new EnvioError('Este título no tiene carpeta propia (es un vídeo suelto): organízalo primero');
  }
  const biblioteca = config.libraries.find((l) => mismoSitio(l.path, destinoRaiz));
  if (!biblioteca) throw new EnvioError('Ese destino no es una de las bibliotecas configuradas (Ajustes → Biblioteca → Añadir carpeta)');
  if (biblioteca.kind !== it.kind) throw new EnvioError(`La biblioteca «${biblioteca.name}» es de otro tipo (${biblioteca.kind === 'movie' ? 'películas' : 'series'})`);
  if (mismoSitio(biblioteca.path, it.raiz)) throw new EnvioError('El título ya está en esa biblioteca');
  if (!existsSync(biblioteca.path)) throw new EnvioError('La carpeta de destino no existe (¿el disco está desconectado?)');
  const destino = join(biblioteca.path, basename(it.folder));
  if (existsSync(destino)) throw new EnvioError(`Ya existe ${destino}: no se mezcla ni se pisa nada`);
  const bytes = ficheros(it.folder).reduce((s, f) => s + f.size, 0);
  const mismoDisco = parse(resolve(it.folder)).root.toLowerCase() === parse(resolve(destino)).root.toLowerCase();
  let libre: number | null = null;
  try { const s = statfsSync(biblioteca.path); libre = Number(s.bavail) * Number(s.bsize); } catch { /* sin dato: se intenta igualmente */ }
  if (!mismoDisco && libre != null && libre < bytes + MARGEN_LIBRE) throw new EnvioError(`No hay espacio en el destino: hacen falta ${(bytes / 1e9).toFixed(1)} GB y hay ${(libre / 1e9).toFixed(1)} GB libres`);
  return { itemId, origen: it.folder, destino, bytes, libre, mismoDisco };
}

async function copiarConHash(origen: string, destino: string, alBytes: (n: number) => void): Promise<string> {
  const h = createHash('sha256');
  const rs = createReadStream(origen, { highWaterMark: 4 * 1024 * 1024 });
  rs.on('data', (c) => { h.update(c); alBytes(c.length); });
  await pipeline(rs, createWriteStream(destino));
  return h.digest('hex');
}

async function hashDe(ruta: string, alBytes: (n: number) => void): Promise<string> {
  const h = createHash('sha256');
  for await (const c of createReadStream(ruta, { highWaterMark: 4 * 1024 * 1024 })) { h.update(c as Buffer); alBytes((c as Buffer).length); }
  return h.digest('hex');
}

function idBiblioteca(destinoRaiz: string): number {
  const b = config.libraries.find((l) => mismoSitio(l.path, destinoRaiz))!;
  return (db.prepare('INSERT INTO libraries (name, path, kind) VALUES (?,?,?) ON CONFLICT(path) DO UPDATE SET name = excluded.name, kind = excluded.kind RETURNING id').get(b.name, b.path, b.kind) as { id: number }).id;
}

export async function enviarTitulo(
  itemId: number, destinoRaiz: string, opciones: { quitarOriginal: boolean; forzarCopia?: boolean; verificacion?: 'rapida' | 'completa' },
  alProgresar: (p: ProgresoEnvio) => void = () => {},
): Promise<{ copiado: boolean; destino: string }> {
  if (hayAlguienViendo()) throw new EnvioError('Alguien está viendo algo: espera a que termine para mover ficheros de la biblioteca');
  if (escaneoEnCurso()) throw new EnvioError('Hay un escaneo de la biblioteca en curso: espera a que termine');
  const it = itemDe(itemId);
  const plan = planEnvio(itemId, destinoRaiz);
  const libId = idBiblioteca(destinoRaiz);
  const remap = (r: string | null) => (r != null && (r === it.folder || r.startsWith(it.folder + sep)) ? plan.destino + r.slice(it.folder.length) : r);
  const origenes = ficheros(it.folder).map((f) => join(it.folder, f.rel));
  const progreso = { fase: 'preparando' as FaseEnvio, bytesHechos: 0, bytesTotal: plan.bytes, archivo: '' };
  const avisar = (fase: FaseEnvio, archivo = '') => { progreso.fase = fase; progreso.archivo = archivo; alProgresar({ ...progreso }); };

  if (plan.mismoDisco && !opciones.forzarCopia) {
    avisar('actualizando');
    renameSync(it.folder, plan.destino);
    try { actualizarBase({ id: it.id, kind: it.kind, title: '', year: null, folder: it.folder }, remap, plan.destino, origenes, libId); }
    catch (e) { renameSync(plan.destino, it.folder); throw e; }
    return { copiado: false, destino: plan.destino };
  }

  const temporal = join(dirname(plan.destino), `_enviando-${basename(plan.destino)}`);
  if (existsSync(temporal)) throw new EnvioError(`Quedó una copia a medias en ${temporal}: revísala antes de reintentar`);
  const lista = ficheros(it.folder);
  const completa = opciones.verificacion === 'completa';
  const hashes = new Map<string, string>();
  try {
    avisar('copiando');
    mkdirSync(temporal);
    for (const f of lista) {
      mkdirSync(dirname(join(temporal, f.rel)), { recursive: true });
      if (completa) hashes.set(f.rel, await copiarConHash(join(it.folder, f.rel), join(temporal, f.rel), (n) => { progreso.bytesHechos += n; }));
      else {
        const rs = createReadStream(join(it.folder, f.rel), { highWaterMark: 4 * 1024 * 1024 });
        rs.on('data', (c) => { progreso.bytesHechos += c.length; });
        await pipeline(rs, createWriteStream(join(temporal, f.rel)));
      }
      avisar('copiando', f.rel);
    }
    progreso.bytesHechos = 0;
    avisar('verificando');
    for (const f of lista) {
      const copia = join(temporal, f.rel);
      if (statSync(copia).size !== f.size) throw new EnvioError(`La copia de ${f.rel} no tiene el mismo tamaño que el original`);
      if (completa && (await hashDe(copia, (n) => { progreso.bytesHechos += n; })) !== hashes.get(f.rel)) throw new EnvioError(`La copia de ${f.rel} no coincide con el original (SHA-256)`);
      avisar('verificando', f.rel);
    }
    avisar('actualizando');
    renameSync(temporal, plan.destino);
  } catch (e) {
    rmSync(temporal, { recursive: true, force: true }); // es la copia parcial que acabamos de crear nosotros
    throw e;
  }

  try {
    actualizarBase({ id: it.id, kind: it.kind, title: '', year: null, folder: it.folder }, remap, plan.destino, origenes, libId);
  } catch (e) {
    renameSync(plan.destino, temporal);
    rmSync(temporal, { recursive: true, force: true });
    throw e;
  }

  avisar('terminando');
  if (opciones.quitarOriginal) {
    rmSync(it.folder, { recursive: true });
  } else {
    const apartado = join(it.raiz, '_enviados', new Date().toISOString().slice(0, 10), relative(it.raiz, it.folder));
    mkdirSync(dirname(apartado), { recursive: true });
    renameSync(it.folder, existsSync(apartado) ? `${apartado}.${Date.now()}` : apartado);
  }
  return { copiado: true, destino: plan.destino };
}

/* ------------------------------------------------------------------ trabajo en segundo plano (varios titulos) */

export type ResultadoEnvio = { itemId: number; titulo: string; ok: boolean; error?: string; destino?: string; copiado?: boolean };
export const envio = {
  corriendo: false, hechos: 0, total: 0, actual: '', fase: 'preparando' as FaseEnvio, bytesHechos: 0, bytesTotal: 0, archivo: '',
  resultados: [] as ResultadoEnvio[], terminado: null as string | null,
};

export async function enviarLote(ids: number[], destinoRaiz: string, opciones: { quitarOriginal: boolean; verificacion?: 'rapida' | 'completa' }): Promise<void> {
  if (envio.corriendo) return;
  Object.assign(envio, { corriendo: true, hechos: 0, total: ids.length, actual: '', resultados: [] as ResultadoEnvio[], terminado: null });
  try {
    for (const id of ids) {
      const titulo = (db.prepare('SELECT title FROM items WHERE id = ?').get(id) as { title: string } | undefined)?.title ?? String(id);
      envio.actual = titulo;
      try {
        const r = await enviarTitulo(id, destinoRaiz, opciones, (p) => Object.assign(envio, { fase: p.fase, bytesHechos: p.bytesHechos, bytesTotal: p.bytesTotal, archivo: p.archivo }));
        envio.resultados.push({ itemId: id, titulo, ok: true, destino: r.destino, copiado: r.copiado });
      } catch (e) {
        envio.resultados.push({ itemId: id, titulo, ok: false, error: (e as Error).message });
      }
      envio.hechos++;
    }
  } finally {
    envio.corriendo = false;
    envio.terminado = new Date().toISOString();
  }
}
