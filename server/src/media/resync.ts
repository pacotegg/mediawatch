import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
// Igual que en intros.ts: se usa `config.python`, asi que hay que traerlo.
import { ROOT, config } from '../config.ts';
import { db } from '../db.ts';
import { mediaInfo } from './probe.ts';

const run = promisify(execFile);
const SCRIPT = join(ROOT, 'server', 'scripts', 'resync.py');

export type ResyncResult = {
  ok: boolean;
  offsetMs: number | null;
  sigma: number | null;
  reason: string;
};

export type StoredOffset = { offset_ms: number; sigma: number | null; method: string; updated_at: string };

export const offsetFor = (fileId: number, trackId: string): StoredOffset | null =>
  (db.prepare('SELECT offset_ms, sigma, method, updated_at FROM sub_offsets WHERE file_id = ? AND track_id = ?').get(fileId, trackId) as StoredOffset | undefined) ?? null;

export function saveOffset(fileId: number, trackId: string, offsetMs: number, method: 'auto' | 'manual', sigma: number | null) {
  db.prepare(`INSERT INTO sub_offsets (file_id, track_id, offset_ms, sigma, method, updated_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(file_id, track_id) DO UPDATE SET
                offset_ms = excluded.offset_ms, sigma = excluded.sigma,
                method = excluded.method, updated_at = excluded.updated_at`)
    .run(fileId, trackId, Math.round(offsetMs), sigma, method, new Date().toISOString());
}

export const clearOffset = (fileId: number, trackId: string) =>
  db.prepare('DELETE FROM sub_offsets WHERE file_id = ? AND track_id = ?').run(fileId, trackId);

const jobs = new Map<string, Promise<ResyncResult>>();
export const jobKey = (fileId: number, trackId: string) => `${fileId}:${trackId}`;
export const isMeasuring = (fileId: number, trackId: string) => jobs.has(jobKey(fileId, trackId));

/**
 * Measures how far a subtitle sits from the spoken audio.
 *
 * The correlation itself lives in the pipeline's subsfetch.py, which already
 * has the two corrections that matter: it measures against the centre channel
 * (dialogue drowns under music in a mono downmix) and its offset sign was
 * verified against a known case. Nothing is applied unless it can be proven.
 */
export function measure(fileId: number, trackId: string, audioStreamIndex: number): Promise<ResyncResult> {
  const key = jobKey(fileId, trackId);
  const running = jobs.get(key);
  if (running) return running;

  const task = (async (): Promise<ResyncResult> => {
    if (!existsSync(SCRIPT)) return { ok: false, offsetMs: null, sigma: null, reason: 'falta el script de medición' };

    const info = await mediaInfo(fileId);
    const args = [SCRIPT, '--video', info.path, '--audio-index', String(audioStreamIndex), '--duracion', String(Math.round(info.duration))];

    if (trackId.startsWith('external-')) {
      const row = db.prepare('SELECT external FROM sub_tracks WHERE id = ?').get(Number(trackId.slice(9))) as { external: string } | undefined;
      if (!row?.external) return { ok: false, offsetMs: null, sigma: null, reason: 'no se encuentra el fichero de subtítulos' };
      args.push('--srt', row.external);
    } else if (trackId.startsWith('embedded-')) {
      args.push('--pista-embebida', trackId.slice(9));
    } else {
      return { ok: false, offsetMs: null, sigma: null, reason: 'pista desconocida' };
    }

    let stdout = '';
    try {
      ({ stdout } = await run(config.python, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 15 * 60_000 }));
    } catch (err) {
      stdout = String((err as { stdout?: string }).stdout ?? '');
      // The script exits non-zero when it cannot prove sync, and still prints its verdict.
      if (!stdout.trim()) return { ok: false, offsetMs: null, sigma: null, reason: `no se pudo medir: ${(err as Error).message}` };
    }

    let parsed: { ok?: boolean; offset_s?: number; factor?: number; sigma?: number; motivo?: string };
    try {
      parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
    } catch {
      return { ok: false, offsetMs: null, sigma: null, reason: 'respuesta ilegible del medidor' };
    }

    /*
     * Desde el 25/09 el medidor (subsfetch.py) también detecta subtítulos que
     * van a otra velocidad (24 frente a 23,976, PAL...) y devuelve `factor`.
     * Aquí solo se sabe guardar un desplazamiento: guardar el desfase sin el
     * factor sería media corrección —cuadraría en un punto de la película y
     * se iría separando en el resto—. En ese caso no se guarda nada y se dice
     * qué pasa; la corrección de verdad es reescribir el subtítulo.
     */
    const factor = typeof parsed.factor === 'number' ? parsed.factor : 1;
    if (parsed.ok && factor !== 1) {
      return {
        ok: false,
        offsetMs: null,
        sigma: parsed.sigma ?? null,
        reason: `va a otra velocidad (×${factor.toFixed(5)}): un desfase fijo no lo arregla, hay que reescribir el subtítulo con los tiempos reescalados`,
      };
    }

    const result: ResyncResult = {
      ok: Boolean(parsed.ok),
      offsetMs: parsed.offset_s === undefined ? null : Math.round(parsed.offset_s * 1000),
      sigma: parsed.sigma ?? null,
      reason: parsed.ok
        ? `sincronía demostrada (${parsed.sigma?.toFixed(1)} sigma)`
        : `${parsed.motivo || 'no se pudo demostrar'}. Suele significar que el subtítulo es de otro montaje o va a otra velocidad (PAL 25 fps); ajústalo a mano.`,
    };

    if (result.ok && result.offsetMs !== null) saveOffset(fileId, trackId, result.offsetMs, 'auto', result.sigma);
    return result;
  })().finally(() => jobs.delete(key));

  jobs.set(key, task);
  return task;
}
