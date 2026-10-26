/**
 * Trae de Plex las fotos de actores que nos faltan (cruce por película y nombre exacto, ver scanner/fotos-plex.ts).
 *
 *   node src/cli/fotos-desde-plex.ts --simular            cuenta cuántas serían, sin descargar ni escribir nada
 *   node src/cli/fotos-desde-plex.ts [--limite 100]       las descarga (WebP, 600 px como mucho) y las apunta en la base
 *   ... [--plex <ruta al com.plexapp.plugins.library.db>]  por defecto, la carpeta estándar de Plex en este equipo
 *
 * Solo lee la base de Plex (solo lectura) y solo rellena personas SIN foto. No activa la integración con Plex
 * (`plexDb` de config.json): esa manda además avisos de progreso a Plex y no hace falta para esto.
 * Lo hecho queda en data/fotos-plex.jsonl (persona, nombre, URL de Plex y película del cruce).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { descargar } from '../scanner/tmdb.ts';
import { emparejarPlex, type FilaPlex, type NuestraSinFoto } from '../scanner/fotos-plex.ts';

const args = process.argv.slice(2);
const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const simular = args.includes('--simular');
const limite = Number(valor('--limite') ?? Infinity);
const rutaPlex = valor('--plex') ?? join(process.env.LOCALAPPDATA ?? '', 'Plex Media Server', 'Plug-in Support', 'Databases', 'com.plexapp.plugins.library.db');
const DIR = join(DATA_DIR, 'artwork', 'personas');
const REGISTRO = join(DATA_DIR, 'fotos-plex.jsonl');

if (!existsSync(rutaPlex)) { console.error('No encuentro la base de Plex:', rutaPlex); process.exit(1); }
const plexDb = new DatabaseSync(rutaPlex, { readOnly: true, timeout: 5000 });
const plex = plexDb.prepare(`SELECT mp.file AS file, t.tag AS tag, t.user_thumb_url AS url FROM taggings tg JOIN tags t ON t.id = tg.tag_id
  JOIN metadata_items mi ON mi.id = tg.metadata_item_id JOIN media_items med ON med.metadata_item_id = mi.id JOIN media_parts mp ON mp.media_item_id = med.id
  WHERE t.tag_type = 6 AND t.user_thumb_url LIKE 'https://%'`).all() as unknown as FilaPlex[];
plexDb.close();
const nuestras = db.prepare(`SELECT f.path AS path, p.id AS personaId, p.name AS nombre FROM media_files f JOIN item_people ip ON ip.item_id = f.item_id
  JOIN people p ON p.id = ip.person_id WHERE f.episode_id IS NULL AND f.item_id IS NOT NULL AND ip.role = 'actor' AND p.thumb IS NULL`).all() as unknown as NuestraSinFoto[];

const { cruces, ambiguos, enConflicto } = emparejarPlex(plex, nuestras);
const hechas = cruces.slice(0, limite);
console.log(`Plex: ${plex.length} (película, actor con foto). Nuestras sin foto: ${new Set(nuestras.map((n) => n.personaId)).size} personas.`);
console.log(`Cruces: ${cruces.length} personas (descartados por ambiguos: ${ambiguos}, por fotos distintas: ${enConflicto}).`);
if (simular) { for (const c of cruces.slice(0, 8)) console.log('  ', c.personaId, c.nombre, c.url.slice(0, 60)); process.exit(0); }

mkdirSync(DIR, { recursive: true });
function aWebp(entrada: string, salida: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', entrada, '-vf', "scale='min(600,iw)':-2", '-c:v', 'libwebp', '-q:v', '82', salida],
      { windowsHide: true, stdio: 'ignore', timeout: 30_000 });
    p.on('close', (code) => {
      if (code === 0 && existsSync(salida) && statSync(salida).size > 0) resolve(true);
      else { try { if (existsSync(salida)) unlinkSync(salida); } catch { /* sin fichero */ } resolve(false); }
    });
    p.on('error', () => { try { if (existsSync(salida)) unlinkSync(salida); } catch { /* sin fichero */ } resolve(false); });
  });
}

const ponerFoto = db.prepare('UPDATE people SET thumb = ? WHERE id = ? AND thumb IS NULL');
let indice = 0, nuevas = 0, fallos = 0;
async function trabajador() {
  while (indice < hechas.length) {
    const c = hechas[indice++];
    const destino = join(DIR, `${c.personaId}.webp`);
    const tmp = join(DIR, `${c.personaId}.plex.tmp`);
    try {
      if (existsSync(destino)) { fallos++; continue; } // ya hay un fichero de otra pasada: no se pisa
      await descargar(c.url, tmp);
      const ok = await aWebp(tmp, destino);
      try { unlinkSync(tmp); } catch { /* ya no estaba */ }
      if (!ok) { fallos++; continue; }
      ponerFoto.run(destino, c.personaId);
      appendFileSync(REGISTRO, JSON.stringify({ cuando: new Date().toISOString(), persona: c.personaId, nombre: c.nombre, url: c.url, pelicula: c.ruta }) + '\n');
      nuevas++;
    } catch { fallos++; try { unlinkSync(tmp); } catch { /* sin temporal */ } }
    if ((nuevas + fallos) % 50 === 0) console.log(`  ${nuevas + fallos}/${hechas.length}  nuevas ${nuevas}  fallos ${fallos}`);
  }
}
await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);
console.log(`Terminado: ${nuevas} fotos nuevas, ${fallos} fallos de ${hechas.length}.`);
