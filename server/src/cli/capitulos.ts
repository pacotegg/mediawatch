/**
 * Herramienta CLI para auditar y enriquecer capítulos de películas desde ChapterDB.
 *
 * Modos de uso:
 *   node src/cli/capitulos.ts estado
 *   node src/cli/capitulos.ts buscar "Gladiator"
 *   node src/cli/capitulos.ts enriquecer [--limite=N] [--forzar]
 *   node src/cli/capitulos.ts mkvpropedit <itemId> --confirmar
 */

import { db } from '../db.ts';
import { mediaInfo, type Capitulo } from '../media/probe.ts';
import {
  buscarEnChapterDb,
  descargarCapitulosChapterDb,
  esTituloGenerico,
  fusionarNombresConTiemposLocales,
  guardarCapitulosBd,
  obtenerCapitulosBd,
  sonCapitulosGenericos,
} from '../media/chapterdb.ts';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

type PeliculaFila = {
  item_id: number;
  file_id: number;
  title: string;
  original_title: string | null;
  year: number | null;
  path: string;
  duration: number | null;
};

function listarPeliculas(): PeliculaFila[] {
  return db
    .prepare(
      `SELECT items.id as item_id, media_files.id as file_id, items.title, items.original_title,
              items.year, media_files.path, media_files.duration
       FROM items
       JOIN media_files ON media_files.item_id = items.id
       WHERE items.kind = 'movie'
       ORDER BY items.title ASC`
    )
    .all() as PeliculaFila[];
}

async function comandoEstado() {
  const peliculas = listarPeliculas();
  console.log(`\n=== ESTADO DE CAPÍTULOS DE PELÍCULAS (${peliculas.length} títulos) ===\n`);

  const enriquecidosIds = new Set(
    (db.prepare('SELECT DISTINCT item_id FROM item_chapters').all() as { item_id: number }[]).map((r) => r.item_id)
  );

  let conNombres = 0;
  let genericos = 0;
  let sinCapitulos = 0;

  for (let i = 0; i < peliculas.length; i++) {
    const p = peliculas[i];
    process.stdout.write(`\rRevisando metadatos: ${i + 1}/${peliculas.length}...`);
    try {
      const info = await mediaInfo(p.path);
      if (!info.chapters || info.chapters.length === 0) {
        sinCapitulos++;
      } else if (sonCapitulosGenericos(info.chapters)) {
        genericos++;
      } else {
        conNombres++;
      }
    } catch {
      sinCapitulos++;
    }
  }

  console.log('\n\nResultados:');
  console.log(`  - Con nombres reales de escenas: ${conNombres}`);
  console.log(`  - Con capítulos genéricos ("Chapter 01..."): ${genericos}`);
  console.log(`  - Sin capítulos en contenedor: ${sinCapitulos}`);
  console.log(`  - Ya enriquecidos en base de datos local (item_chapters): ${enriquecidosIds.size}\n`);
}

async function comandoBuscar(query: string, guardar: boolean) {
  console.log(`Buscando en ChapterDB para: "${query}"...`);
  const resultados = await buscarEnChapterDb(query);
  if (!resultados.length) {
    console.log('No se encontraron resultados en ChapterDB.');
    return;
  }

  console.log(`\nEncontrados ${resultados.length} resultados:\n`);
  for (const r of resultados) {
    const tag = r.hasNames ? '✓ NOMBRES REALES' : '✗ Genérico';
    console.log(`  [ID ${r.id}] ${r.title} (${r.type || 'Desconocido'}) - Duración: ${r.durationStr} - Puntos: ${r.score} [${tag}]`);
  }

  const mejor = resultados.find((r) => r.hasNames);
  if (mejor) {
    console.log(`\nDescargando capítulos del mejor resultado ([ID ${mejor.id}] ${mejor.title})...`);
    const caps = await descargarCapitulosChapterDb(mejor.id);
    console.log(`Descargados ${caps.length} capítulos:`);
    caps.slice(0, 10).forEach((c, idx) => console.log(`  ${idx + 1}. [${c.start.toFixed(1)}s] ${c.title}`));
    if (caps.length > 10) console.log(`  ... y ${caps.length - 10} más.`);

    if (guardar) {
      const peli = db
        .prepare('SELECT id FROM items WHERE kind = ? AND (title LIKE ? OR original_title LIKE ?) LIMIT 1')
        .get('movie', `%${query}%`, `%${query}%`) as { id: number } | undefined;
      if (peli) {
        guardarCapitulosBd(peli.id, caps, `chapterdb:${mejor.id}`);
        console.log(`✓ Guardados ${caps.length} capítulos en BD para item_id = ${peli.id} ("${query}").`);
      } else {
        console.log('No se encontró película en la base local para asociar.');
      }
    }
  }
}

async function comandoEnriquecer(limite: number, soloGenericos: boolean) {
  const peliculas = listarPeliculas();
  console.log(`Iniciando enriquecimiento (límite: ${limite}, solo genéricos: ${soloGenericos})...\n`);

  let procesados = 0;
  let guardados = 0;

  for (const p of peliculas) {
    if (procesados >= limite) break;

    const yaTiene = obtenerCapitulosBd(p.item_id);
    if (yaTiene.length > 0) continue;

    let info;
    try {
      info = await mediaInfo(p.path);
    } catch {
      continue;
    }

    const tieneGenericos = info.chapters && info.chapters.length > 0 && sonCapitulosGenericos(info.chapters);
    const noTiene = !info.chapters || info.chapters.length === 0;

    if (!tieneGenericos && (!noTiene || soloGenericos)) continue;

    procesados++;
    console.log(`[${procesados}/${limite}] Buscando para "${p.title}" (${p.original_title || ''})...`);

    const duracion = info.duration || p.duration || 0;
    let resultados = await buscarEnChapterDb(p.original_title || p.title, duracion);
    if (!resultados.some((r) => r.hasNames) && p.original_title && p.title !== p.original_title) {
      resultados = await buscarEnChapterDb(p.title, duracion);
    }

    const candidato = resultados.find((r) => r.hasNames && (!duracion || Math.abs(r.durationSec - duracion) <= 10));
    if (!candidato) {
      console.log(`  - Sin coincidencia exacta en ChapterDB (duración local: ${duracion.toFixed(0)}s).`);
      continue;
    }

    console.log(`  + Encontrado: [${candidato.id}] "${candidato.title}" (${candidato.durationStr}, diff ${Math.abs(candidato.durationSec - duracion).toFixed(1)}s)`);
    const capsRemotos = await descargarCapitulosChapterDb(candidato.id, duracion);
    if (!capsRemotos.length) continue;

    const capsFinales = info.chapters && info.chapters.length > 0
      ? fusionarNombresConTiemposLocales(info.chapters, capsRemotos)
      : capsRemotos;

    guardarCapitulosBd(p.item_id, capsFinales, `chapterdb:${candidato.id}`);
    guardados++;
    console.log(`  ✓ Guardados ${capsFinales.length} capítulos en BD.`);
  }

  console.log(`\nFinalizado: ${guardados} películas enriquecidas en BD.`);
}

async function comandoMkvpropedit(itemId: number, confirmar: boolean) {
  const peli = db
    .prepare(
      `SELECT items.title, media_files.path
       FROM items
       JOIN media_files ON media_files.item_id = items.id
       WHERE items.id = ?`
    )
    .get(itemId) as { title: string; path: string } | undefined;

  if (!peli) {
    console.error(`Película no encontrada: item_id = ${itemId}`);
    return;
  }

  const caps = obtenerCapitulosBd(itemId);
  if (!caps.length) {
    console.error(`No hay capítulos guardados en BD para item_id = ${itemId}. Usa primero buscar o enriquecer.`);
    return;
  }

  console.log(`Película: "${peli.title}"`);
  console.log(`Ruta: ${peli.path}`);
  console.log(`Capítulos a escribir: ${caps.length}`);

  if (!confirmar) {
    console.log('\n[AVISO] Para escribir en el fichero MKV real en E: debes pasar el argumento --confirmar');
    return;
  }

  // Generar archivo OGG temporal
  let oggContent = '';
  caps.forEach((c, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const horas = Math.floor(c.start / 3600);
    const mins = Math.floor((c.start % 3600) / 60);
    const secs = c.start % 60;
    const hh = String(horas).padStart(2, '0');
    const mm = String(mins).padStart(2, '0');
    const ss = secs.toFixed(3).padStart(6, '0');
    oggContent += `CHAPTER${num}=${hh}:${mm}:${ss}\nCHAPTER${num}NAME=${c.title}\n`;
  });

  const tempFile = join(tmpdir(), `chapters_${itemId}_${Date.now()}.txt`);
  writeFileSync(tempFile, oggContent, 'utf8');

  console.log(`Ejecutando mkvpropedit sobre ${peli.path}...`);
  const mkvpropedit = 'C:\\Program Files\\MKVToolNix\\mkvpropedit.exe';

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(mkvpropedit, [peli.path, '--chapters', tempFile]);
    proc.stdout.on('data', (d) => process.stdout.write(d));
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('close', (code) => {
      try {
        unlinkSync(tempFile);
      } catch {}
      if (code === 0) {
        console.log(`\n✓ Capítulos incrustados correctamente en ${peli.path}`);
        resolve();
      } else {
        reject(new Error(`mkvpropedit falló con código ${code}`));
      }
    });
  });
}

const args = process.argv.slice(2);
const modo = args[0] || 'estado';

if (modo === 'estado') {
  comandoEstado().catch(console.error);
} else if (modo === 'buscar') {
  const q = args[1] || 'Gladiator';
  const guardar = args.includes('--guardar');
  comandoBuscar(q, guardar).catch(console.error);
} else if (modo === 'enriquecer') {
  const limite = parseInt(args.find((a) => a.startsWith('--limite='))?.split('=')[1] || '20', 10);
  const soloGenericos = args.includes('--solo-genericos');
  comandoEnriquecer(limite, soloGenericos).catch(console.error);
} else if (modo === 'mkvpropedit') {
  const id = parseInt(args[1] || '0', 10);
  const confirmar = args.includes('--confirmar');
  comandoMkvpropedit(id, confirmar).catch(console.error);
} else {
  console.log('Comandos disponibles: estado, buscar <título>, enriquecer [--limite=N], mkvpropedit <itemId> --confirmar');
}
