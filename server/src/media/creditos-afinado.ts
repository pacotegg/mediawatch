/**
 * Afina el INICIO de los créditos de las películas que ya tienen rango por «texto que sube».
 *
 * Ese detector llega tarde: el texto sube después de las tarjetas y de los créditos sobre imagen
 * (mediana 95 s de retraso medida el 13/10/2026 sobre 12 películas con capítulo de créditos como
 * verdad-terreno). Los créditos casi siempre arrancan con un corte o fundido a negro, así que se
 * busca el PRIMER NEGRO entre el último diálogo subtitulado y el inicio que marca el detector.
 *
 * Medido sobre esas 12: error mediano 33 s (frente a 95 s), 5 dentro de ±20 s (frente a 1) y un
 * solo caso en que el botón sale antes de tiempo (36 s). Si no hay negro, o no hay subtítulos, no se
 * toca nada. Es reversible: el rango original queda en `rangos_texto`.
 *
 * Corre dentro del servidor porque solo él sabe si alguien está viendo algo (ocupado.ts es por proceso).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { esperarSiHayAlguienViendo, hayAlguienViendo } from './ocupado.ts';
import './creditos-detector.ts'; // crea la tabla pelicula_creditos
import { adelantarPrimerRango, instantesDeSubtitulo, primerNegro, ultimoDialogoAntes, type Tramo } from './creditos-afinado-puro.ts';

const cols = db.prepare('PRAGMA table_info(pelicula_creditos)').all() as { name: string }[];
if (!cols.some((c) => c.name === 'rangos_texto')) db.exec('ALTER TABLE pelicula_creditos ADD COLUMN rangos_texto TEXT');

export const METODO_AFINADO = 'texto-sube+negro';

/* ----------------------------------------------------------------------------------- el trabajo */

export type JobAfinado = {
  running: boolean;
  total: number;
  hechas: number;
  afinadas: number;
  actual: string;
  parando: boolean;
  esperando: boolean;
  error: string | null;
  finishedAt: string | null;
};

export const jobAfinado: JobAfinado = {
  running: false, total: 0, hechas: 0, afinadas: 0, actual: '', parando: false, esperando: false, error: null, finishedAt: null,
};

/*
 * Un lote de ~30 horas no puede depender de que nadie reinicie el servidor: mientras corre queda apuntado
 * aquí, y si el proceso muere se retoma solo al arrancar (lo ya mirado lleva `rangos_texto`, así que no
 * se repite). Lo mismo vale para lanzarlo sin sesión: basta con crear este fichero y reiniciar.
 */
const PENDIENTE = join(DATA_DIR, 'creditos-afinar.json');

export function reanudarAfinadoSiPendiente(): void {
  if (!existsSync(PENDIENTE) || jobAfinado.running) return;
  try {
    const total = afinarPeliculas();
    console.log(`[creditos-afinado] reanudado el lote pendiente: ${total} por mirar`);
  } catch (err) {
    console.error('[creditos-afinado] no se pudo reanudar:', (err as Error).message);
  }
}

export const pararAfinado = () => {
  if (!jobAfinado.running) return false;
  jobAfinado.parando = true;
  return true;
};

export function resumenAfinado() {
  const f = db
    .prepare(`SELECT COUNT(*) AS conRango,
                     SUM(metodo = '${METODO_AFINADO}') AS afinadas,
                     SUM(rangos_texto IS NOT NULL) AS vistas
                FROM pelicula_creditos WHERE rangos NOT IN ('[]', '')`)
    .get() as { conRango: number | null; afinadas: number | null; vistas: number | null };
  return { conRango: f.conRango ?? 0, afinadas: f.afinadas ?? 0, vistas: f.vistas ?? 0 };
}

/** Deja los rangos como los dejó el detector del texto que sube. Devuelve cuántas películas volvió. */
export function deshacerAfinado(): number {
  return Number(
    db
      .prepare(`UPDATE pelicula_creditos SET rangos = rangos_texto, metodo = 'texto-sube'
                 WHERE metodo = '${METODO_AFINADO}' AND rangos_texto IS NOT NULL`)
      .run().changes,
  );
}

type Candidata = { itemId: number; fileId: number; path: string; title: string; duracion: number; rangos: string };

function candidatas(): Candidata[] {
  return db
    .prepare(`SELECT i.id AS itemId, f.id AS fileId, f.path, i.title, f.duration AS duracion, c.rangos
                FROM pelicula_creditos c
                JOIN items i ON i.id = c.item_id
                JOIN media_files f ON f.item_id = i.id
               WHERE c.metodo = 'texto-sube' AND c.rangos NOT IN ('[]', '') AND c.rangos_texto IS NULL AND f.duration >= 1800
               GROUP BY i.id ORDER BY i.id`)
    .all() as Candidata[];
}

/** blackdetect sobre [desde, desde+largo]. A 320 px de ancho: solo se mira si el fotograma es negro. */
function blackdetect(path: string, desde: number, largo: number): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn(
      config.ffmpeg,
      ['-hide_banner', '-nostats', '-nostdin', '-ss', String(desde), '-t', String(largo), '-i', path,
        '-vf', 'scale=320:-2,blackdetect=d=0.2:pic_th=0.95:pix_th=0.10', '-an', '-f', 'null', '-'],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let salida = '';
    p.stderr.on('data', (d) => { salida = (salida + d.toString()).slice(-200_000); });
    const limite = setTimeout(() => p.kill(), 10 * 60_000);
    p.on('error', () => { clearTimeout(limite); resolve(''); });
    p.on('close', () => { clearTimeout(limite); resolve(salida); });
  });
}

const apuntar = () => db.prepare('UPDATE pelicula_creditos SET rangos_texto = ? WHERE item_id = ?');

async function afinarUna(c: Candidata): Promise<boolean> {
  const rangos = JSON.parse(c.rangos) as Tramo[];
  // Siempre se apunta el original: es la marca de «ya mirada» y lo que permite deshacer.
  const marcar = () => apuntar().run(c.rangos, c.itemId);
  if (!existsSync(c.path) || !rangos.length) { marcar(); return false; }

  const inicio = Math.min(...rangos.map((r) => r.start_s));
  let ultimo: number | null = null;
  for (const s of db.prepare('SELECT external FROM sub_tracks WHERE file_id = ? AND external IS NOT NULL').all(c.fileId) as { external: string }[]) {
    if (!existsSync(s.external)) continue;
    let t: number[];
    try { t = instantesDeSubtitulo(readFileSync(s.external, 'utf8')); } catch { continue; }
    const u = ultimoDialogoAntes(t, inicio);
    if (u !== null) ultimo = Math.max(ultimo ?? 0, u);
  }
  if (ultimo === null) { marcar(); return false; }

  const desde = Math.max(0, ultimo - 5);
  const salida = await blackdetect(c.path, desde, inicio + 5 - desde);
  const negro = primerNegro(salida, desde, ultimo + 2, inicio);
  // Un negro en la primera mitad de la película no es el principio de los créditos.
  if (negro === null || negro < c.duracion * 0.5) { marcar(); return false; }

  db.prepare('UPDATE pelicula_creditos SET rangos = ?, rangos_texto = ?, metodo = ? WHERE item_id = ?')
    .run(JSON.stringify(adelantarPrimerRango(rangos, negro)), c.rangos, METODO_AFINADO, c.itemId);
  return true;
}

export function afinarPeliculas(): number {
  if (jobAfinado.running) throw new Error('Ya hay un afinado de créditos en curso');
  const lista = candidatas();
  try {
    writeFileSync(PENDIENTE, JSON.stringify({ desde: new Date().toISOString() }));
  } catch {
    // Sin el apunte solo se pierde la reanudación automática.
  }
  Object.assign(jobAfinado, { running: true, total: lista.length, hechas: 0, afinadas: 0, actual: '', parando: false, esperando: false, error: null, finishedAt: null });

  void (async () => {
    try {
      for (const c of lista) {
        if (jobAfinado.parando) break;
        jobAfinado.esperando = hayAlguienViendo();
        const sigue = await esperarSiHayAlguienViendo(() => !jobAfinado.parando);
        jobAfinado.esperando = false;
        if (!sigue) break;
        jobAfinado.actual = c.title;
        try {
          if (await afinarUna(c)) jobAfinado.afinadas++;
        } catch (err) {
          console.error('[creditos-afinado] ' + c.title + ' ' + (err as Error).message);
        }
        jobAfinado.hechas++;
      }
    } catch (err) {
      jobAfinado.error = (err as Error).message;
    } finally {
      jobAfinado.running = false;
      jobAfinado.actual = '';
      jobAfinado.parando = false;
      jobAfinado.finishedAt = new Date().toISOString();
      // Terminado o parado a mano: ya no hay nada que reanudar.
      rmSync(PENDIENTE, { force: true });
      console.log(`[creditos-afinado] terminado: ${jobAfinado.afinadas} afinadas de ${jobAfinado.hechas} miradas`);
    }
  })();

  return lista.length;
}
