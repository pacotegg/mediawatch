import { execFile } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { promisify } from 'node:util';
import { config } from '../config.ts';
import { db } from '../db.ts';

const run = promisify(execFile);

export type EncoderProbe = {
  name: string;
  label: string;
  compiled: boolean;
  working: boolean;
  /** How many seconds of video it encodes per wall second. 1.0 is barely real time. */
  realtimeFactor: number | null;
  note?: string;
};

export type Capabilities = {
  detectedAt: string;
  cpu: { model: string; cores: number; memoryGb: number };
  gpus: { name: string; driver: string; memoryMb: number | null }[];
  hwaccels: string[];
  encoders: EncoderProbe[];
  tonemap: { supported: boolean; note: string };
  best: { hwaccel: 'qsv' | 'none'; encoder: string; transcodeQuality: number; tonemap: boolean; concurrentStreams: number };
  notes: string[];
};

const CANDIDATES: { name: string; label: string; hwaccel: 'qsv' | 'none' }[] = [
  { name: 'h264_qsv', label: 'Intel Quick Sync · H.264', hwaccel: 'qsv' },
  { name: 'hevc_qsv', label: 'Intel Quick Sync · HEVC', hwaccel: 'qsv' },
  { name: 'av1_qsv', label: 'Intel Quick Sync · AV1', hwaccel: 'qsv' },
  { name: 'h264_nvenc', label: 'NVIDIA NVENC · H.264', hwaccel: 'none' },
  { name: 'hevc_nvenc', label: 'NVIDIA NVENC · HEVC', hwaccel: 'none' },
  { name: 'h264_amf', label: 'AMD AMF · H.264', hwaccel: 'none' },
  { name: 'libx264', label: 'Software · H.264 (CPU)', hwaccel: 'none' },
];

async function ffmpegText(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await run(config.ffmpeg, ['-hide_banner', ...args], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return stdout + stderr;
  } catch (err) {
    return String((err as { stdout?: string; stderr?: string }).stdout ?? '') + String((err as { stderr?: string }).stderr ?? '');
  }
}

async function listGpus() {
  if (process.platform !== 'win32') return [];
  try {
    const { stdout } = await run(
      'powershell',
      ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Json -Compress'],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout || 'null');
    const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return list.map((g: any) => ({
      name: String(g.Name ?? 'Desconocida'),
      driver: String(g.DriverVersion ?? ''),
      memoryMb: typeof g.AdapterRAM === 'number' && g.AdapterRAM > 0 ? Math.round(g.AdapterRAM / 1048576) : null,
    }));
  } catch {
    return [];
  }
}

const SAMPLE_SECONDS = 8;

/**
 * Measured against a real 1080p title when one exists: synthetic patterns
 * compress trivially and flatter software encoders by an order of magnitude.
 */
async function runEncode(name: string, sample: Sample | null): Promise<{ ok: boolean; seconds: number; reason?: string }> {
  const isQsv = name.endsWith('_qsv');
  const input = sample
    ? ['-ss', String(sample.seek), ...(isQsv ? ['-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv'] : []), '-i', sample.path, '-t', String(SAMPLE_SECONDS)]
    : ['-f', 'lavfi', '-i', `testsrc=size=1920x1080:rate=24:duration=${SAMPLE_SECONDS}`];

  const started = Date.now();
  const output = await ffmpegText([
    ...input,
    '-map', '0:v:0', '-an', '-sn',
    ...(sample && isQsv ? ['-vf', 'vpp_qsv=format=nv12'] : []),
    '-c:v', name,
    ...(name === 'libx264' ? ['-preset', 'veryfast'] : []),
    '-f', 'null', '-',
  ]);

  if (/Error|error while opening|not supported|Cannot load|No device|Function not implemented/i.test(output)) {
    return { ok: false, seconds: 0, reason: output.split('\n').find((l) => /error|not supported|no device/i.test(l))?.trim() };
  }
  return { ok: true, seconds: (Date.now() - started) / 1000 };
}

/**
 * Compiled-in is not the same as usable: a driver can be missing or the GPU
 * unavailable, so every encoder has to actually encode before we trust it.
 */
async function probeEncoder(name: string, compiled: boolean, sample: Sample | null): Promise<Omit<EncoderProbe, 'name' | 'label' | 'compiled'>> {
  if (!compiled) return { working: false, realtimeFactor: null, note: 'no incluido en esta compilación de ffmpeg' };

  let attempt = await runEncode(name, sample);
  let usedSample = Boolean(sample);

  // A short or damaged sample must not be mistaken for broken hardware,
  // so a real-file failure gets a second chance on synthetic video.
  if (!attempt.ok && sample) {
    attempt = await runEncode(name, null);
    usedSample = false;
  }

  if (!attempt.ok) {
    return { working: false, realtimeFactor: null, note: attempt.reason?.slice(0, 120) ?? 'el codificador no arrancó' };
  }

  return {
    working: true,
    realtimeFactor: attempt.seconds > 0 ? Number((SAMPLE_SECONDS / attempt.seconds).toFixed(1)) : null,
    note: usedSample ? undefined : 'medido con vídeo sintético; la cifra real será distinta',
  };
}

type Sample = { path: string; seek: number };

/**
 * Seeks to a quarter of the way in rather than a fixed offset: a container's
 * duration can outlast its video stream, and a fixed seek then lands on no
 * frames at all, which looks exactly like broken hardware.
 */
function sampleFile(where: string, order = 'size DESC'): Sample | null {
  try {
    const row = db
      .prepare(`SELECT path, duration FROM media_files WHERE ${where} AND duration > 120 ORDER BY ${order} LIMIT 1`)
      .get() as { path: string; duration: number } | undefined;
    if (!row) return null;
    return { path: row.path, seek: Math.max(20, Math.min(600, Math.round(row.duration * 0.25))) };
  } catch {
    return null;
  }
}

/**
 * Tonemapping must be probed against a real HDR file. A synthetic p010 source
 * pushed through hwupload fails on drivers that handle genuine HDR decode
 * fine, which would wrongly disable the feature.
 */
async function probeTonemap(qsvWorks: boolean): Promise<{ supported: boolean; note: string }> {
  if (!qsvWorks) return { supported: false, note: 'requiere Quick Sync operativo' };

  const help = await ffmpegText(['-h', 'filter=vpp_qsv']);
  if (!/tonemap/i.test(help)) return { supported: false, note: 'este ffmpeg no trae tonemap en vpp_qsv' };

  const hdr = sampleFile('hdr IS NOT NULL');
  if (!hdr) return { supported: true, note: 'el filtro existe, pero no hay HDR en la biblioteca para comprobarlo' };

  const output = await ffmpegText([
    '-ss', String(hdr.seek),
    '-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv',
    '-i', hdr.path,
    '-t', '2', '-map', '0:v:0', '-an',
    '-vf', 'vpp_qsv=tonemap=1:format=nv12',
    '-c:v', 'h264_qsv', '-f', 'null', '-',
  ]);
  return /Error|not supported|Function not implemented|Invalid/i.test(output)
    ? { supported: false, note: 'el driver rechazó el tonemapping con un fichero HDR real' }
    : { supported: true, note: 'verificado con HDR real de tu biblioteca' };
}

function recommend(encoders: EncoderProbe[], tonemap: boolean, gpus: { name: string }[]) {
  const notes: string[] = [];
  const working = encoders.filter((e) => e.working);
  const preference = ['h264_qsv', 'h264_nvenc', 'h264_amf', 'libx264'];
  const chosen = preference.find((name) => working.some((e) => e.name === name)) ?? 'libx264';
  const winner = working.find((e) => e.name === chosen);

  const isQsv = chosen.endsWith('_qsv');
  const isArc = gpus.some((g) => /\bArc\b/i.test(g.name));

  // Higher quality costs nothing meaningful on a discrete GPU over a LAN,
  // while a CPU-only fallback has to stay conservative to keep up in real time.
  let quality = 23;
  if (isQsv) quality = isArc ? 20 : 22;
  if (chosen === 'libx264') quality = 23;

  // Leave headroom: a stream that only just keeps up stutters on any hiccup.
  const speed = winner?.realtimeFactor ?? 2;
  const concurrent = Math.max(1, Math.min(10, Math.floor(speed / 1.5)));

  if (chosen === 'libx264') notes.push('Sin aceleración por hardware disponible: la transcodificación usará CPU y admitirá pocas reproducciones simultáneas.');
  else notes.push(`Aceleración por hardware activa (${chosen}): codifica a ${speed}× el tiempo real, unas ${concurrent} reproducciones 1080p simultáneas con margen.`);
  if (!tonemap) notes.push('Sin tonemapping por GPU: el contenido HDR puede verse desvaído al transcodificar.');
  if (working.some((e) => e.name === 'av1_qsv')) notes.push('Tu GPU codifica AV1, útil más adelante si añades clientes compatibles.');

  return {
    best: { hwaccel: (isQsv ? 'qsv' : 'none') as 'qsv' | 'none', encoder: chosen, transcodeQuality: quality, tonemap, concurrentStreams: concurrent },
    notes,
  };
}

let cached: Capabilities | null = null;

export async function detectCapabilities(force = false): Promise<Capabilities> {
  if (cached && !force) return cached;

  const [encoderList, hwaccelList, gpus] = await Promise.all([
    ffmpegText(['-encoders']),
    ffmpegText(['-hwaccels']),
    listGpus(),
  ]);

  // A feature-length 1080p title: representative of what actually gets transcoded.
  const sample = sampleFile("height BETWEEN 900 AND 1200 AND video_codec IN ('hevc','h264') AND duration > 3000");

  const encoders: EncoderProbe[] = [];
  for (const candidate of CANDIDATES) {
    const compiled = new RegExp(`\\s${candidate.name}\\s`).test(encoderList);
    const result = await probeEncoder(candidate.name, compiled, sample);
    encoders.push({ name: candidate.name, label: candidate.label, compiled, ...result });
  }

  const tonemap = await probeTonemap(encoders.some((e) => e.name === 'h264_qsv' && e.working));
  const { best, notes } = recommend(encoders, tonemap.supported, gpus);

  const cpuInfo = cpus();
  cached = {
    detectedAt: new Date().toISOString(),
    cpu: { model: cpuInfo[0]?.model.trim() ?? 'Desconocida', cores: cpuInfo.length, memoryGb: Math.round(totalmem() / 2 ** 30) },
    gpus,
    hwaccels: hwaccelList.split('\n').map((l) => l.trim()).filter((l) => l && !l.includes(':')),
    encoders,
    tonemap,
    best,
    notes,
  };
  return cached;
}
