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
  coincideTitulo,
  decodificarHtml,
  descargarCapitulosChapterDb,
  esTituloGenerico,
  fusionarNombresConTiemposLocales,
  guardarCapitulosBd,
  obtenerCapitulosBd,
  sonCapitulosGenericos,
} from '../media/chapterdb.ts';
import {
  buscarEnChapterEditor,
  descargarCapitulosChapterEditor,
} from '../media/chaptereditor.ts';
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
      const info = await mediaInfo(p.file_id);
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

async function comandoBuscarCE(query: string, guardar: boolean) {
  console.log(`Buscando en Chapter-Database (chapterEditor) para: "${query}"...`);
  const resultados = await buscarEnChapterEditor(query);
  if (!resultados.length) {
    console.log('No se encontraron resultados en Chapter-Database.');
    return;
  }

  console.log(`\nEncontrados ${resultados.length} resultados:\n`);
  for (const r of resultados.slice(0, 15)) {
    console.log(`  [MID ${r.mid}] ${r.title} - Duración: ${r.durationStr} (${r.durationSec.toFixed(0)}s) - Capítulos: ${r.chaptersCount} [${r.lang}]`);
  }

  const mejor = resultados[0];
  if (mejor) {
    console.log(`\nDescargando capítulos del mejor resultado ([MID ${mejor.mid}] ${mejor.title})...`);
    const caps = await descargarCapitulosChapterEditor(mejor.mid, mejor.durationSec);
    console.log(`Descargados ${caps.length} capítulos:`);
    caps.slice(0, 10).forEach((c, idx) => console.log(`  ${idx + 1}. [${c.start.toFixed(1)}s] ${c.title}`));
    if (caps.length > 10) console.log(`  ... y ${caps.length - 10} más.`);

    if (guardar) {
      const peli = db
        .prepare('SELECT id FROM items WHERE kind = ? AND (title LIKE ? OR original_title LIKE ?) LIMIT 1')
        .get('movie', `%${query}%`, `%${query}%`) as { id: number } | undefined;
      if (peli) {
        guardarCapitulosBd(peli.id, caps, `chaptereditor:${mejor.mid}`);
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
    if (limite > 0 && procesados >= limite) break;

    const yaTiene = obtenerCapitulosBd(p.item_id);
    if (yaTiene.length > 0) continue;

    let info;
    try {
      info = await mediaInfo(p.file_id);
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

    const candidatosConNombre = resultados.filter(
      (r) => r.hasNames && (coincideTitulo(p.original_title || p.title, r.title) || coincideTitulo(p.title, r.title))
    );
    let candidato: (typeof candidatosConNombre)[0] | undefined;
    if (noTiene) {
      candidato = candidatosConNombre.find((r) => r.durationSec > 0 && Math.abs(r.durationSec - duracion) <= 120);
    } else {
      candidato = candidatosConNombre.find((r) => r.durationSec > 0 && Math.abs(r.durationSec - duracion) <= 15)
        || candidatosConNombre[0];
    }
    if (!candidato) {
      // Intentar en Chapter-Database (Doom9 / hubblec4)
      let ceResultados = await buscarEnChapterEditor(p.original_title || p.title, duracion);
      if (!ceResultados.length && p.original_title && p.title !== p.original_title) {
        ceResultados = await buscarEnChapterEditor(p.title, duracion);
      }
      const ceCandidatos = ceResultados.filter(
        (r) => (coincideTitulo(p.original_title || p.title, r.title) || coincideTitulo(p.title, r.title)) && r.chaptersCount > 0
      );
      const ceMatch = ceCandidatos.find(
        (r) => r.durationSec > 0 && Math.abs(r.durationSec - duracion) <= (noTiene ? 120 : 15)
      ) || (noTiene ? undefined : ceCandidatos[0]);

      if (ceMatch) {
        console.log(`  + Encontrado en Chapter-Database: [MID ${ceMatch.mid}] "${ceMatch.title}" (${ceMatch.durationStr}, ${ceMatch.chaptersCount} caps)`);
        const capsRemotos = await descargarCapitulosChapterEditor(ceMatch.mid, duracion);
        if (capsRemotos.length > 0 && !sonCapitulosGenericos(capsRemotos)) {
          const capsFinales = info.chapters && info.chapters.length > 0
            ? fusionarNombresConTiemposLocales(info.chapters, capsRemotos)
            : capsRemotos;
          guardarCapitulosBd(p.item_id, capsFinales, `chaptereditor:${ceMatch.mid}`);
          guardados++;
          console.log(`  ✓ Guardados ${capsFinales.length} capítulos en BD desde Chapter-Database.`);
          continue;
        }
      }

      console.log(`  - Sin coincidencia válida en ChapterDB ni Chapter-Database (duración local: ${duracion.toFixed(0)}s).`);
      continue;
    }

    console.log(`  + Encontrado: [${candidato.id}] "${candidato.title}" (${candidato.durationStr}, puntos ${candidato.score})`);
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

async function comandoEnriquecerCE(limite: number, soloGenericos: boolean) {
  const peliculas = listarPeliculas();
  console.log(`Iniciando enriquecimiento con Chapter-Database (hubblec4) (límite: ${limite}, solo genéricos: ${soloGenericos})...\n`);

  let procesados = 0;
  let guardados = 0;

  for (const p of peliculas) {
    if (limite > 0 && procesados >= limite) break;

    const yaTiene = obtenerCapitulosBd(p.item_id);
    if (yaTiene.length > 0) continue;

    let info;
    try {
      info = await mediaInfo(p.file_id);
    } catch {
      continue;
    }

    const tieneGenericos = info.chapters && info.chapters.length > 0 && sonCapitulosGenericos(info.chapters);
    const noTiene = !info.chapters || info.chapters.length === 0;

    if (!tieneGenericos && (!noTiene || soloGenericos)) continue;

    procesados++;
    console.log(`[${procesados}/${limite || 'todos'}] Buscando en Chapter-Database para "${p.title}" (${p.original_title || ''})...`);

    const duracion = info.duration || p.duration || 0;
    let ceResultados = await buscarEnChapterEditor(p.original_title || p.title, duracion);
    if (!ceResultados.length && p.original_title && p.title !== p.original_title) {
      ceResultados = await buscarEnChapterEditor(p.title, duracion);
    }

    const ceCandidatos = ceResultados.filter(
      (r) => (coincideTitulo(p.original_title || p.title, r.title) || coincideTitulo(p.title, r.title)) && r.chaptersCount > 0
    );
    const ceMatch = ceCandidatos.find(
      (r) => r.durationSec > 0 && Math.abs(r.durationSec - duracion) <= (noTiene ? 120 : 15)
    ) || (noTiene ? undefined : ceCandidatos[0]);

    if (!ceMatch) {
      console.log(`  - Sin coincidencia válida en Chapter-Database (duración local: ${duracion.toFixed(0)}s).`);
      continue;
    }

    console.log(`  + Encontrado: [MID ${ceMatch.mid}] "${ceMatch.title}" (${ceMatch.durationStr}, ${ceMatch.chaptersCount} caps)`);
    const capsRemotos = await descargarCapitulosChapterEditor(ceMatch.mid, duracion);
    if (!capsRemotos.length || sonCapitulosGenericos(capsRemotos)) {
      console.log(`  - Capítulos vacíos o sin nombres reales.`);
      continue;
    }

    const capsFinales = info.chapters && info.chapters.length > 0
      ? fusionarNombresConTiemposLocales(info.chapters, capsRemotos)
      : capsRemotos;

    guardarCapitulosBd(p.item_id, capsFinales, `chaptereditor:${ceMatch.mid}`);
    guardados++;
    console.log(`  ✓ Guardados ${capsFinales.length} capítulos en BD.`);
  }

  console.log(`\nFinalizado: ${guardados} películas enriquecidas en BD desde Chapter-Database.`);
}

async function comandoPurgar() {
  const pelis = db
    .prepare(
      `SELECT DISTINCT items.id, items.title, items.original_title, ic.source
       FROM items
       JOIN item_chapters ic ON ic.item_id = items.id`
    )
    .all() as { id: number; title: string; original_title: string | null; source: string }[];

  console.log(`\nAuditoría y purga de capítulos enriquecidos (${pelis.length} títulos en BD)...`);

  const idMap = new Map<string, string | null>();
  for (const p of pelis) {
    const m = p.source.match(/chapterdb:(\d+)/);
    if (m) idMap.set(m[1], null);
  }

  const uniqueIds = Array.from(idMap.keys());
  let idx = 0;
  const batchSize = 25;
  while (idx < uniqueIds.length) {
    const batch = uniqueIds.slice(idx, idx + batchSize);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const res = await fetch(`https://chapterdb.plex.tv/browse/${id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(6000),
          });
          const text = await res.text();
          const m = text.match(/<title>ChaptersDb\.org - (.*?) Chapters<\/title>/i);
          if (m) idMap.set(id, decodificarHtml(m[1].trim()));
        } catch {
          idMap.set(id, null);
        }
      })
    );
    idx += batchSize;
    process.stdout.write(`\rVerificando fuentes remotas: ${Math.min(idx, uniqueIds.length)}/${uniqueIds.length}...`);
  }

  let purgados = 0;
  let confirmados = 0;
  const borrados: { id: number; title: string; remote: string }[] = [];

  for (const p of pelis) {
    const m = p.source.match(/chapterdb:(\d+)/);
    if (!m) continue;
    const remote = idMap.get(m[1]);
    if (!remote) continue;

    const ok = coincideTitulo(p.original_title || p.title, remote) || coincideTitulo(p.title, remote);
    if (!ok) {
      db.prepare('DELETE FROM item_chapters WHERE item_id = ?').run(p.id);
      purgados++;
      borrados.push({ id: p.id, title: p.title, remote });
    } else {
      confirmados++;
    }
  }

  console.log(`\n\nAuditoría completada:`);
  console.log(`  ✓ Válidos y confirmados: ${confirmados}`);
  console.log(`  ✗ Falsos positivos purgados de BD: ${purgados}`);
  if (borrados.length > 0) {
    console.log(`\nTítulos purgados (${borrados.length}):`);
    borrados.forEach((b, i) => console.log(`  ${i + 1}. [${b.id}] "${b.title}" no coincide con "${b.remote}"`));
  }
}

async function comandoMkvpropedit(itemId: number, confirmar: boolean, silencioso = false) {
  const peli = db
    .prepare(
      `SELECT items.title, media_files.path
       FROM items
       JOIN media_files ON media_files.item_id = items.id
       WHERE items.id = ?`
    )
    .get(itemId) as { title: string; path: string } | undefined;

  if (!peli) {
    if (!silencioso) console.error(`Película no encontrada: item_id = ${itemId}`);
    return;
  }

  const caps = obtenerCapitulosBd(itemId);
  if (!caps.length) {
    if (!silencioso) console.error(`No hay capítulos guardados en BD para item_id = ${itemId}. Usa primero buscar o enriquecer.`);
    return;
  }

  if (!silencioso) {
    console.log(`Película: "${peli.title}"`);
    console.log(`Ruta: ${peli.path}`);
    console.log(`Capítulos a escribir: ${caps.length}`);
  }

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

  if (!silencioso) console.log(`Ejecutando mkvpropedit sobre ${peli.path}...`);
  const mkvpropedit = 'C:\\Program Files\\MKVToolNix\\mkvpropedit.exe';

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(mkvpropedit, [peli.path, '--chapters', tempFile]);
    let errOutput = '';
    if (!silencioso) {
      proc.stdout.on('data', (d) => process.stdout.write(d));
    }
    proc.stderr.on('data', (d) => {
      errOutput += d.toString();
      if (!silencioso) process.stderr.write(d);
    });
    proc.on('close', (code) => {
      try {
        unlinkSync(tempFile);
      } catch {}
      if (code === 0) {
        if (!silencioso) console.log(`\n✓ Capítulos incrustados correctamente en ${peli.path}`);
        resolve();
      } else {
        reject(new Error(`mkvpropedit falló con código ${code}: ${errOutput}`));
      }
    });
  });
}

async function comandoIncrustarTodos(confirmar: boolean) {
  const pelis = db
    .prepare(
      `SELECT DISTINCT items.id as item_id, items.title, media_files.path
       FROM items
       JOIN media_files ON media_files.item_id = items.id
       JOIN item_chapters ON item_chapters.item_id = items.id
       WHERE items.kind = 'movie' AND media_files.path LIKE '%.mkv'`
    )
    .all() as { item_id: number; title: string; path: string }[];

  console.log(`\n=== INCRUSTAR CAPÍTULOS CON MKVPROPEDIT (${pelis.length} películas) ===\n`);
  if (!pelis.length) {
    console.log('No hay películas con capítulos enriquecidos en BD para incrustar.');
    return;
  }

  if (!confirmar) {
    console.log(`Se han encontrado ${pelis.length} películas en MKV con capítulos listos en BD.`);
    console.log('[AVISO DE SEGURIDAD] Modificar ficheros en E: requiere confirmación explícita (--confirmar).');
    return;
  }

  let exitos = 0;
  let fallos = 0;

  for (let i = 0; i < pelis.length; i++) {
    const p = pelis[i];
    process.stdout.write(`\rIncrustando capítulos [${i + 1}/${pelis.length}]: "${p.title.slice(0, 40)}" (éxitos: ${exitos})...`);
    try {
      await comandoMkvpropedit(p.item_id, true, true);
      exitos++;
    } catch (e: any) {
      console.error(`\nError en ${p.title}: ${e.message}`);
      fallos++;
    }
  }

  console.log(`\n\nFinalizado: ${exitos} películas actualizadas con mkvpropedit, ${fallos} fallos.\n`);
}

const args = process.argv.slice(2);
const modo = args[0] || 'estado';

if (modo === 'estado') {
  comandoEstado().catch(console.error);
} else if (modo === 'buscar') {
  const q = args[1] || 'Gladiator';
  const guardar = args.includes('--guardar');
  comandoBuscar(q, guardar).catch(console.error);
} else if (modo === 'buscar-ce') {
  const q = args[1] || 'Gladiator';
  const guardar = args.includes('--guardar');
  comandoBuscarCE(q, guardar).catch(console.error);
} else if (modo === 'enriquecer') {
  const limiteStr = args.find((a) => a.startsWith('--limite='))?.split('=')[1];
  const limite = limiteStr ? parseInt(limiteStr, 10) : args.includes('--todos') ? 0 : 20;
  const soloGenericos = args.includes('--solo-genericos');
  comandoEnriquecer(limite, soloGenericos).catch(console.error);
} else if (modo === 'enriquecer-ce') {
  const limiteStr = args.find((a) => a.startsWith('--limite='))?.split('=')[1];
  const limite = limiteStr ? parseInt(limiteStr, 10) : args.includes('--todos') ? 0 : 20;
  const soloGenericos = args.includes('--solo-genericos');
  comandoEnriquecerCE(limite, soloGenericos).catch(console.error);
} else if (modo === 'purgar') {
  comandoPurgar().catch(console.error);
} else if (modo === 'mkvpropedit') {
  const id = parseInt(args[1] || '0', 10);
  const confirmar = args.includes('--confirmar');
  comandoMkvpropedit(id, confirmar).catch(console.error);
} else if (modo === 'incrustar-todos') {
  const confirmar = args.includes('--confirmar');
  comandoIncrustarTodos(confirmar).catch(console.error);
} else {
  console.log(
    'Comandos disponibles: estado, buscar <título>, buscar-ce <título>, enriquecer [--limite=N|--todos], enriquecer-ce [--limite=N|--todos], purgar, incrustar-todos --confirmar, mkvpropedit <itemId> --confirmar'
  );
}
