/**
 * Pasa a WebP las imagenes JPG/PNG que aparecen en las carpetas de la biblioteca.
 *
 * tinyMediaManager (y cualquier otro que escriba junto al video) sigue bajando JPG y PNG: sin esto cada titulo nuevo vuelve a traer 3-5 MB de imagenes que
 * el servidor ya reduce en su cache. Medido el 20/10/2026 sobre E:: 237 JPG/PNG sueltos pasaban de 751 MB a ~200 MB (-83 %).
 *
 * Por cada imagen:
 *   1. ffmpeg (libwebp, calidad 82 en JPG y 90 en PNG) a '<nombre>.webp.parte' junto al original;
 *   2. se comprueba que se decodifica, que mide LO MISMO y que pesa MENOS;
 *   3. se renombra a '<nombre>.webp' (con la fecha del original) y se actualizan las rutas de la base (items, episodes, coleccion_imagen);
 *   4. SOLO ENTONCES el original se retira a '<raiz>/_retirados/<fecha>/...' (modo 'retirar', reversible) o se borra (modo 'borrar').
 * Si ya existe un .webp con ese nombre, o la imagen esta vacia, no se toca nada.
 *
 * Es escritura en E:, asi que NO corre sola: solo si `imagenesAWebp` esta puesto en config.json ('retirar' o 'borrar') y nadie esta viendo nada.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { dirname, join, parse, relative } from 'node:path';
import { config } from '../config.ts';
import { db } from '../db.ts';
import { hayAlguienViendo } from './ocupado.ts';

export type ModoOriginal = 'retirar' | 'borrar';
export type Herramientas = { ffmpeg: string; ffprobe: string };
export type ResultadoImagen =
  | { estado: 'convertida'; nuevo: string; antes: number; despues: number; retirado?: string }
  | { estado: 'saltada'; motivo: string }
  | { estado: 'error'; motivo: string };
export type Resumen = { convertidas: number; saltadas: number; errores: number; ahorroBytes: number; interrumpido?: string };

const ES_IMAGEN = /\.(jpe?g|png)$/i;
const COLUMNAS: [string, string][] = [
  ['items', 'poster'], ['items', 'fanart'], ['items', 'clearlogo'], ['items', 'landscape'], ['items', 'discart'],
  ['episodes', 'thumb'], ['people', 'thumb'], ['coleccion_imagen', 'ruta'],
];

function ejecutar(cmd: string, args: string[], timeout: number): Promise<{ codigo: number | null; salida: string }> {
  return new Promise((resolve) => {
    let salida = '';
    const p = spawn(cmd, args, { windowsHide: true, timeout });
    p.stdout.on('data', (d) => { salida += d; });
    p.on('close', (codigo) => resolve({ codigo, salida }));
    p.on('error', () => resolve({ codigo: -1, salida }));
  });
}

async function dimensiones(ffprobe: string, ruta: string): Promise<string | null> {
  const r = await ejecutar(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ruta], 30_000);
  return r.codigo === 0 && r.salida.trim() ? r.salida.trim() : null;
}

/** Recorre una carpeta (hasta 3 niveles) y devuelve los JPG/PNG. No entra en `_retirados` ni en carpetas ocultas. */
export function candidatas(carpeta: string, profundidad = 0): string[] {
  if (profundidad > 3 || !existsSync(carpeta)) return [];
  const out: string[] = [];
  let entradas;
  try { entradas = readdirSync(carpeta, { withFileTypes: true }); } catch { return out; }
  for (const e of entradas) {
    const ruta = join(carpeta, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && e.name !== '_retirados') out.push(...candidatas(ruta, profundidad + 1));
    } else if (e.isFile() && ES_IMAGEN.test(e.name)) out.push(ruta);
  }
  return out;
}

export async function convertirImagen(ruta: string, h: Herramientas, modo: ModoOriginal, raizRetirados = parse(ruta).root): Promise<ResultadoImagen> {
  let st;
  try { st = statSync(ruta); } catch { return { estado: 'saltada', motivo: 'ya no existe' }; }
  if (st.size === 0) return { estado: 'saltada', motivo: 'vacia' };
  const nuevo = join(dirname(ruta), parse(ruta).name + '.webp');
  if (existsSync(nuevo)) return { estado: 'saltada', motivo: 'ya existe un .webp con ese nombre' };
  const parte = nuevo + '.parte';
  const png = /\.png$/i.test(ruta);
  const r = await ejecutar(h.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', ruta, '-frames:v', '1', '-c:v', 'libwebp', '-q:v', png ? '90' : '82',
    '-compression_level', '4', '-f', 'webp', parte], 60_000);
  const limpiar = () => { try { unlinkSync(parte); } catch { /* puede no existir */ } };
  if (r.codigo !== 0 || !existsSync(parte) || statSync(parte).size === 0) { limpiar(); return { estado: 'error', motivo: 'ffmpeg no pudo convertirla' }; }
  const [a, b] = await Promise.all([dimensiones(h.ffprobe, ruta), dimensiones(h.ffprobe, parte)]);
  if (!a || !b || a !== b) { limpiar(); return { estado: 'error', motivo: `medidas distintas (${a} / ${b})` }; }
  const despues = statSync(parte).size;
  if (despues >= st.size) { limpiar(); return { estado: 'saltada', motivo: `no ahorra (${st.size} -> ${despues})` }; }
  renameSync(parte, nuevo);
  utimesSync(nuevo, st.atime, st.mtime);
  // La base primero: si fallase algo despues, las rutas ya apuntan a un fichero que existe.
  db.exec('BEGIN');
  try {
    for (const [t, c] of COLUMNAS) db.prepare(`UPDATE "${t}" SET "${c}" = ? WHERE "${c}" = ?`).run(nuevo, ruta);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { estado: 'error', motivo: 'no se pudo actualizar la base: ' + (e as Error).message };
  }
  if (modo === 'borrar') {
    unlinkSync(ruta);
    return { estado: 'convertida', nuevo, antes: st.size, despues };
  }
  const retirado = join(raizRetirados, '_retirados', new Date().toISOString().slice(0, 10), relative(raizRetirados, ruta));
  mkdirSync(dirname(retirado), { recursive: true });
  renameSync(ruta, retirado);
  return { estado: 'convertida', nuevo, antes: st.size, despues, retirado };
}

const cede = () => new Promise<void>((r) => setImmediate(r));

/** Convierte todo lo que haya en las carpetas dadas. Se para si alguien se pone a ver algo. */
export async function comprimirCarpetas(carpetas: string[], modo: ModoOriginal, h: Herramientas = { ffmpeg: config.ffmpeg, ffprobe: config.ffprobe }): Promise<Resumen> {
  const res: Resumen = { convertidas: 0, saltadas: 0, errores: 0, ahorroBytes: 0 };
  for (const carpeta of carpetas) {
    for (const ruta of candidatas(carpeta)) {
      if (hayAlguienViendo()) { res.interrumpido = 'alguien esta viendo algo'; return res; }
      const r = await convertirImagen(ruta, h, modo, carpeta);
      if (r.estado === 'convertida') { res.convertidas++; res.ahorroBytes += r.antes - r.despues; }
      else if (r.estado === 'saltada') res.saltadas++;
      else { res.errores++; console.error(`[imagenes-webp] ${ruta}: ${r.motivo}`); }
      await cede();
    }
  }
  return res;
}

/** Lo que llama el escaneo automatico: solo si `imagenesAWebp` esta puesto en config.json. */
export async function comprimirImagenesDeLaBiblioteca(): Promise<Resumen | null> {
  const modo = (config as unknown as { imagenesAWebp?: string }).imagenesAWebp;
  if (modo !== 'retirar' && modo !== 'borrar') return null;
  return comprimirCarpetas(config.libraries.map((l) => l.path), modo);
}
