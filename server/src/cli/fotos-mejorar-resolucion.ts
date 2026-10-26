/**
 * Sustituye las fotos de actores que vinieron de TMDb (300 px) por su versión `h632` (632 px de alto), en WebP como todo lo demás.
 * Medido el 26/10/2026 con 40 personas: 18 -> 31 KB de media y 300 -> 421 px de ancho (+0,45 GB en las 37.396).
 *
 *   node src/cli/fotos-mejorar-resolucion.ts [--limite 20] [--simular]
 *
 * Por cada foto: baja la nueva, la convierte, comprueba que de verdad tiene más píxeles, copia la ACTUAL a
 * data/artwork/personas-previo/ y solo entonces la sustituye. Reanudable (data/fotos-hd.jsonl) y sin tocar nada fuera de data/.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { descargar } from '../scanner/tmdb.ts';

const args = process.argv.slice(2);
const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const limite = Number(valor('--limite') ?? Infinity);
const simular = args.includes('--simular');
const PREVIO = join(DATA_DIR, 'artwork', 'personas-previo');
const REGISTRO = join(DATA_DIR, 'fotos-hd.jsonl');
const DIR = join(DATA_DIR, 'artwork', 'personas');

const hechas = new Set<number>();
if (existsSync(REGISTRO)) for (const l of readFileSync(REGISTRO, 'utf8').split('\n')) { try { const o = JSON.parse(l); if (o.persona) hechas.add(o.persona); } catch { /* línea a medias */ } }
// Las traídas de Plex ya son lo mejor que hay (su profile puede ser un TMDb viejo sin foto): no se tocan.
const dePlex = new Set<number>();
const regPlex = join(DATA_DIR, 'fotos-plex.jsonl');
if (existsSync(regPlex)) for (const l of readFileSync(regPlex, 'utf8').split('\n')) { try { const o = JSON.parse(l); if (o.persona) dePlex.add(o.persona); } catch { /* línea a medias */ } }

const candidatas = (db.prepare(`SELECT p.id AS id, p.thumb AS thumb, pd.profile AS profile FROM people p JOIN people_details pd ON pd.person_id = p.id
  WHERE p.thumb IS NOT NULL AND pd.profile LIKE 'https://image.tmdb.org/t/p/%' ORDER BY p.id`).all() as unknown as Array<{ id: number; thumb: string; profile: string }>)
  .filter((c) => !hechas.has(c.id) && !dePlex.has(c.id) && c.thumb.startsWith(DIR));
console.log(`Candidatas: ${candidatas.length} (ya hechas ${hechas.size}, de Plex ${dePlex.size}).`);
if (simular) process.exit(0);

function dims(f: string): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    const p = spawn(config.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { windowsHide: true, timeout: 15_000 });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => { const [w, h] = out.trim().split(',').map(Number); resolve(w > 0 && h > 0 ? [w, h] : null); });
    p.on('error', () => resolve(null));
  });
}
function aWebp(entrada: string, salida: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', entrada, '-c:v', 'libwebp', '-q:v', '82', salida], { windowsHide: true, stdio: 'ignore', timeout: 30_000 });
    p.on('close', (code) => resolve(code === 0 && existsSync(salida) && statSync(salida).size > 0));
    p.on('error', () => resolve(false));
  });
}
const quitar = (f: string) => { try { unlinkSync(f); } catch { /* ya no estaba */ } };

mkdirSync(PREVIO, { recursive: true });
let indice = 0;
const cuenta = { mejoradas: 0, igualOMenor: 0, sinVersion: 0, fallos: 0, ocupadas: 0, kbAntes: 0, kbDespues: 0 };
async function trabajador() {
  while (indice < Math.min(candidatas.length, limite)) {
    const c = candidatas[indice++];
    const ruta = c.profile.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+/, '');
    const bruto = join(DIR, `${c.id}.hd.jpg`);
    const nuevo = join(DIR, `${c.id}.hd.webp`);
    try {
      try { await descargar(`https://image.tmdb.org/t/p/h632${ruta}`, bruto); } catch { cuenta.sinVersion++; continue; }
      const ok = await aWebp(bruto, nuevo);
      quitar(bruto);
      if (!ok) { cuenta.fallos++; quitar(nuevo); continue; }
      const [dn, dv] = await Promise.all([dims(nuevo), dims(c.thumb)]);
      if (!dn || !dv) { cuenta.fallos++; quitar(nuevo); continue; }
      if (dn[0] * dn[1] < dv[0] * dv[1] * 1.2) { cuenta.igualOMenor++; quitar(nuevo); appendFileSync(REGISTRO, JSON.stringify({ persona: c.id, resultado: 'sin-mejora', antes: dv, nuevo: dn }) + '\n'); continue; }
      const previo = join(PREVIO, `${c.id}.webp`);
      if (!existsSync(previo)) copyFileSync(c.thumb, previo);
      let puesto = false;
      for (let i = 0; i < 4 && !puesto; i++) {
        try { renameSync(nuevo, c.thumb); puesto = true; } catch { await new Promise((r) => setTimeout(r, 250)); } // el servidor puede tenerla abierta un instante
      }
      if (!puesto) { cuenta.ocupadas++; quitar(nuevo); continue; }
      cuenta.mejoradas++;
      cuenta.kbAntes += statSync(previo).size / 1024;
      cuenta.kbDespues += statSync(c.thumb).size / 1024;
      appendFileSync(REGISTRO, JSON.stringify({ persona: c.id, resultado: 'mejorada', antes: dv, despues: dn }) + '\n');
    } catch { cuenta.fallos++; quitar(bruto); quitar(nuevo); }
    const hechasAhora = cuenta.mejoradas + cuenta.igualOMenor + cuenta.sinVersion + cuenta.fallos + cuenta.ocupadas;
    if (hechasAhora % 500 === 0) console.log(`  ${hechasAhora}/${Math.min(candidatas.length, limite)} ${JSON.stringify({ ...cuenta, kbAntes: Math.round(cuenta.kbAntes), kbDespues: Math.round(cuenta.kbDespues) })}`);
  }
}
await Promise.all([trabajador(), trabajador(), trabajador(), trabajador(), trabajador(), trabajador()]);
console.log('Terminado:', JSON.stringify({ ...cuenta, MBantes: Math.round(cuenta.kbAntes / 1024), MBdespues: Math.round(cuenta.kbDespues / 1024) }));
