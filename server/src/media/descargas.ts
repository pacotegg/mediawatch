/**
 * Descargas para ver sin conexión.
 *
 * La queja repetida contra Plex es que sus descargas llevan años rotas. Aquí no
 * se intenta guardar el vídeo dentro del navegador —en Android eso se cae en
 * cuanto el fichero pasa de un par de gigas— sino algo más aburrido y más
 * fiable: el servidor prepara una copia ligera, la deja en disco, y el móvil se
 * la baja con su gestor de descargas de toda la vida. Una vez bajada es un
 * fichero suyo: se ve sin servidor, sin sesión y sin que caduque nada.
 *
 * Se prepara antes en vez de transcodificar al vuelo para que la descarga tenga
 * tamaño conocido y se pueda reanudar; una descarga que no se puede reanudar en
 * el móvil no sirve de nada.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import { db } from '../db.ts';

const DIR = join(config.transcodeDir, 'descargas');
mkdirSync(DIR, { recursive: true });

export type Perfil = 'baja' | 'movil' | 'tablet' | 'fhd' | 'original';
export type Codec = 'h265' | 'h264';

/*
 * Calidad constante con un techo, no bitrate fijo. Con bitrate fijo un corto de
 * dibujos de 1929 salía a 1331 kbps y ocupaba 77 MB, tanto como si fuera cine
 * moderno; con CRF ocupa lo que necesite y el techo solo actúa en las escenas
 * complicadas.
 */
export const PERFILES: Record<Exclude<Perfil, 'original'>, { alto: number; crf: number; techo: string; audio: string; nombre: string; estimacion: string; techoKbps: number }> = {
  baja: { alto: 360, crf: 28, techo: '500k', audio: '96k', nombre: '360p', estimacion: 'Muy ligera (~150 MB)', techoKbps: 500 },
  movil: { alto: 480, crf: 26, techo: '900k', audio: '128k', nombre: '480p', estimacion: 'Móvil (~300 MB)', techoKbps: 900 },
  tablet: { alto: 720, crf: 24, techo: '1800k', audio: '160k', nombre: '720p', estimacion: 'HD (~650 MB)', techoKbps: 1800 },
  fhd: { alto: 1080, crf: 22, techo: '3500k', audio: '192k', nombre: '1080p', estimacion: 'Full HD (~1.4 GB)', techoKbps: 3500 },
};

export type Descarga = {
  id: number;
  file_id: number;
  user_id: number;
  perfil: Perfil;
  codec: Codec;
  estado: 'preparando' | 'lista' | 'error';
  ruta: string | null;
  bytes: number | null;
  progreso: number;
  error: string | null;
  titulo: string;
  creado: string;
};

const enCurso = new Map<number, { proc: ReturnType<typeof spawn>; duracion: number }>();

function fila(id: number) {
  return db.prepare('SELECT * FROM descargas WHERE id = ?').get(id) as Descarga | undefined;
}

export function listar(userId: number) {
  return db.prepare('SELECT * FROM descargas WHERE user_id = ? ORDER BY id DESC').all(userId) as Descarga[];
}

export function una(id: number) {
  return fila(id);
}

/**
 * Encola una copia. El perfil «original» no transcodifica: entrega el fichero
 * tal cual, que para una red local suele ser lo más rápido y lo de mejor
 * calidad; los otros dos existen para caber en el móvil y en los datos.
 */
function origenDe(fileId: number) {
  return db
    .prepare(
      `SELECT f.id, f.path, f.duration, f.hdr, f.width, f.height,
              COALESCE(i.title, s.title) AS titulo, e.season, e.episode
         FROM media_files f
         LEFT JOIN items i ON i.id = f.item_id
         LEFT JOIN episodes e ON e.id = f.episode_id
         LEFT JOIN items s ON s.id = e.show_id
        WHERE f.id = ?`,
    )
    .get(fileId) as { id: number; path: string; duration: number | null; hdr: string | null; width: number | null; height: number | null; titulo: string; season: number | null; episode: number | null } | undefined;
}

export function pedir(userId: number, fileId: number, perfil: Perfil, codec: Codec = 'h265'): Descarga {
  const origen = origenDe(fileId);

  if (!origen) throw new Error('Fichero no encontrado');
  if (!existsSync(origen.path)) throw new Error('El fichero ya no está en disco');

  const titulo =
    origen.season != null ? `${origen.titulo} T${origen.season}E${String(origen.episode).padStart(2, '0')}` : origen.titulo;

  const previa = db
    .prepare("SELECT * FROM descargas WHERE file_id = ? AND perfil = ? AND codec = ? AND estado = 'lista' LIMIT 1")
    .get(fileId, perfil, codec) as Descarga | undefined;
  if (previa && previa.ruta && existsSync(previa.ruta)) {
    if (previa.user_id === userId) return previa;
    const res = db
      .prepare(
        `INSERT INTO descargas (file_id, user_id, perfil, codec, estado, ruta, bytes, progreso, titulo, creado)
         VALUES (?,?,?,?,'lista',?,?,100,?,?)`,
      )
      .run(fileId, userId, perfil, codec, previa.ruta, previa.bytes, titulo, new Date().toISOString());
    return fila(Number(res.lastInsertRowid)) as Descarga;
  }

  if (perfil === 'original') {
    const bytes = statSync(origen.path).size;
    const res = db
      .prepare(
        `INSERT INTO descargas (file_id, user_id, perfil, codec, estado, ruta, bytes, progreso, titulo, creado)
         VALUES (?,?,?,?,'lista',?,?,100,?,?)`,
      )
      .run(fileId, userId, perfil, codec, origen.path, bytes, titulo, new Date().toISOString());
    return fila(Number(res.lastInsertRowid)) as Descarga;
  }

  const res = db
    .prepare(
      `INSERT INTO descargas (file_id, user_id, perfil, codec, estado, ruta, bytes, progreso, titulo, creado)
       VALUES (?,?,?,?,'preparando',NULL,NULL,0,?,?)`,
    )
    .run(fileId, userId, perfil, codec, titulo, new Date().toISOString());

  const id = Number(res.lastInsertRowid);
  const w = origen.width ?? 0;
  const h = origen.height ?? 0;
  preparar(id, origen.path, origen.duration ?? 0, perfil, Boolean(origen.hdr), codec, w, h);
  return fila(id) as Descarga;
}

function preparar(id: number, origen: string, duracion: number, perfil: Exclude<Perfil, 'original'>, esHdr: boolean, codec: Codec, origenW: number, origenH: number) {
  const ajustes = PERFILES[perfil];
  const destino = join(DIR, `${id}-${perfil}-${codec}.mp4`);

  const alto = origenH > 0 ? Math.min(ajustes.alto, origenH) : ajustes.alto;
  const ancho = origenW > 0 && origenH > 0
    ? Math.round((origenW * alto / origenH) / 2) * 2
    : -1;

  const vppParts = [
    ancho > 0 ? `w=${ancho}` : 'w=-1',
    `h=${alto}`,
    'format=nv12',
    ...(esHdr ? ['tonemap=1'] : []),
    'async_depth=8',
  ];

  const esH264 = codec === 'h264';
  const codecArgs = esH264
    ? ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-profile:v', 'high']
    : ['-c:v', 'hevc_qsv', '-preset', 'veryfast', '-profile:v', 'main', '-tag:v', 'hvc1'];

  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-init_hw_device', 'qsv=qsv:hw,child_device_type=d3d11va,child_device=0',
    '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv',
    '-i', origen,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `vpp_qsv=${vppParts.join(':')}`,
    ...codecArgs,
    '-low_power', '1',
    '-async_depth', '8',
    '-global_quality', String(ajustes.crf),
    '-maxrate', ajustes.techo,
    '-bufsize', `${ajustes.techoKbps * 2}k`,
    '-c:a', 'aac', '-b:a', ajustes.audio, '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    destino,
  ];

  const proc = spawn(config.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  enCurso.set(id, { proc, duracion });

  let errores = '';
  proc.stderr.on('data', (d) => {
    errores = (errores + d.toString()).slice(-2000);
  });
  proc.on('error', (e) => {
    enCurso.delete(id);
    db.prepare("UPDATE descargas SET estado = 'error', error = ? WHERE id = ?").run('No arrancó ffmpeg: ' + e.message, id);
  });

  // `-progress` escribe pares clave=valor; el que interesa es el tiempo ya
  // codificado, que dividido por la duración da el porcentaje. Throttling de 1 s
  // para no saturar SQLite con escrituras en cada chunk de stdout.
  let ultimoProgreso = -1;
  let ultimoGuardado = 0;
  proc.stdout.on('data', (d) => {
    const m = /out_time_ms=(\d+)/.exec(d.toString());
    if (m && duracion > 0) {
      const ahora = Date.now();
      const progreso = Math.min(99, Math.round((Number(m[1]) / 1e6 / duracion) * 100));
      if (progreso !== ultimoProgreso && (ahora - ultimoGuardado >= 1000 || progreso === 99)) {
        ultimoProgreso = progreso;
        ultimoGuardado = ahora;
        db.prepare('UPDATE descargas SET progreso = ? WHERE id = ?').run(progreso, id);
      }
    }
  });

  proc.on('close', (code) => {
    enCurso.delete(id);
    if (code === 0 && existsSync(destino)) {
      db.prepare("UPDATE descargas SET estado = 'lista', ruta = ?, bytes = ?, progreso = 100 WHERE id = ?").run(
        destino,
        statSync(destino).size,
        id,
      );
    } else {
      if (existsSync(destino)) unlinkSync(destino);
      db.prepare("UPDATE descargas SET estado = 'error', error = ? WHERE id = ?").run(
        errores.trim() || `ffmpeg terminó con código ${code}`,
        id,
      );
    }
  });
}

/** Borra la copia. El perfil «original» apunta al fichero de la biblioteca: ese no se toca. */
export function borrar(userId: number, id: number) {
  const d = fila(id);
  if (!d || d.user_id !== userId) throw new Error('Descarga no encontrada');

  enCurso.get(id)?.proc.kill('SIGKILL');
  enCurso.delete(id);

  const otros = db.prepare('SELECT COUNT(*) AS n FROM descargas WHERE ruta = ? AND id <> ?').get(d.ruta, id) as { n: number };
  if (d.perfil !== 'original' && d.ruta && existsSync(d.ruta) && otros.n === 0) unlinkSync(d.ruta);

  db.prepare('DELETE FROM descargas WHERE id = ?').run(id);
  return { borrado: true };
}

/** Nombre con el que se guardará en el móvil. */
export function nombreFichero(d: Descarga) {
  const limpio = d.titulo.replace(/[\\/:*?"<>|]/g, '-').trim();
  const extension = d.perfil === 'original' ? (d.ruta?.match(/\.[a-z0-9]+$/i)?.[0] ?? '.mkv') : '.mp4';
  const codecLabel = d.codec === 'h264' ? 'H.264' : 'HEVC';
  const sufijo = d.perfil === 'original' ? '' : ` - ${PERFILES[d.perfil as Exclude<Perfil, 'original'>]?.nombre ?? d.perfil} ${codecLabel}`;
  return `${limpio}${sufijo}${extension}`;
}

// Un reinicio deja descargas a medias. ffmpeg no puede seguir donde lo dejó:
// se rehacen desde cero sobre el mismo destino (-y pisa el parcial). Entran
// también las que la versión anterior ya había dado por perdidas. Va al FINAL
// del módulo: arriba, PERFILES y enCurso aún no estarían inicializados.
for (const d of db
  .prepare(
    "SELECT * FROM descargas WHERE perfil <> 'original' AND (estado = 'preparando' OR (estado = 'error' AND error = 'Interrumpida al reiniciar el servidor'))",
  )
  .all() as Descarga[]) {
  const o = origenDe(d.file_id);
  if (!o || !existsSync(o.path)) {
    db.prepare("UPDATE descargas SET estado = 'error', error = 'El fichero ya no está en disco' WHERE id = ?").run(d.id);
    continue;
  }
  db.prepare("UPDATE descargas SET estado = 'preparando', error = NULL, progreso = 0 WHERE id = ?").run(d.id);
  preparar(d.id, o.path, o.duration ?? 0, d.perfil as Exclude<Perfil, 'original'>, Boolean(o.hdr), d.codec ?? 'h265', o.width ?? 0, o.height ?? 0);
}
