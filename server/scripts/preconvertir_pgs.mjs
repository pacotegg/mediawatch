import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const DATA_DIR = 'C:/tvwatch/data';
const SUBS_CACHE = join(DATA_DIR, 'subtitles');
mkdirSync(SUBS_CACHE, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, 'tvwatch.db'));

function srtToVtt(text) {
  const body = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2})/gm, '');
  return `WEBVTT\n\n${body}`;
}

async function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
  });
}

async function convertPgs(videoPath, streamIndex, lang, cachePath) {
  if (existsSync(cachePath)) {
    console.log(`[skip] ya en caché: ${cachePath}`);
    return;
  }
  const tag = `batch_${Date.now()}_${streamIndex}`;
  const tmpSup = join(SUBS_CACHE, `${tag}.sup`);
  const tmpSrt = join(SUBS_CACHE, `${tag}.srt`);

  try {
    console.log(`[extract] ${videoPath} stream ${streamIndex}...`);
    await runProcess('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', videoPath, '-map', `0:${streamIndex}`, '-c:s', 'copy', tmpSup]);
    if (!existsSync(tmpSup) || statSync(tmpSup).size < 64) {
      await writeFile(cachePath, 'WEBVTT\n\n', 'utf8');
      console.log(`[done] pista vacía -> ${cachePath}`);
      return;
    }

    const ocrLang = lang === 'spa' || lang === 'es' || lang === 'esp' ? 'spa' : 'eng';
    console.log(`[ocr] ejecutando PgsToSrt (${ocrLang})...`);
    await runProcess('C:\\Program Files\\dotnet\\dotnet.exe', [
      'C:\\scripts\\PgsToSrt\\PgsToSrt.dll',
      '--input', tmpSup,
      '--output', tmpSrt,
      '--tesseractlanguage', ocrLang,
      '--tesseractdata', 'C:\\scripts\\PgsToSrt\\tessdata'
    ]);

    if (existsSync(tmpSrt)) {
      const srt = readFileSync(tmpSrt, 'utf8');
      const vtt = srtToVtt(srt);
      await writeFile(cachePath, vtt, 'utf8');
      console.log(`[ok] guardado: ${cachePath} (${statSync(cachePath).size} bytes)`);
    } else {
      console.log(`[warn] PgsToSrt no generó fichero`);
    }
  } catch (err) {
    console.error(`[error] fallo en stream ${streamIndex}:`, err.message);
  } finally {
    try { if (existsSync(tmpSup)) unlinkSync(tmpSup); } catch {}
    try { if (existsSync(tmpSrt)) unlinkSync(tmpSrt); } catch {}
  }
}

async function main() {
  const rows = db.prepare(`
    SELECT DISTINCT f.id, f.path
    FROM media_files f
    JOIN sub_tracks s ON s.file_id = f.id
    WHERE s.codec LIKE '%pgs%'
    ORDER BY f.id
  `).all();

  console.log(`Iniciando preconversión de PGS para ${rows.length} ficheros...`);

  for (const row of rows) {
    if (!existsSync(row.path)) continue;
    // Leer streams con ffprobe
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_name:stream_tags=language',
      '-of', 'json',
      row.path
    ]);
    const chunks = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    await new Promise((r) => proc.on('close', r));
    const raw = Buffer.concat(chunks).toString('utf8');
    let data;
    try { data = JSON.parse(raw); } catch { continue; }

    const pgsStreams = (data.streams || []).filter((s) => s.codec_name === 'hdmv_pgs_subtitle');
    for (const s of pgsStreams) {
      const streamIndex = s.index;
      const lang = s.tags?.language || 'eng';
      const cachePath = join(SUBS_CACHE, `${row.id}-${streamIndex}.vtt`);
      await convertPgs(row.path, streamIndex, lang, cachePath);
    }
  }

  console.log('Preconversión PGS completada con éxito.');
}

main().catch(console.error);
