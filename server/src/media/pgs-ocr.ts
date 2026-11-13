/**
 * PGS (subtítulos de imagen) a WebVTT por OCR, para que la tele los pinte como texto.
 *
 * Lo usan la ruta `/subtitle/` de `routes/play.ts` (bajo demanda) y `cli/precalentar-pgs.ts` (en lote, de noche).
 * Una sola copia a propósito: el OCR y la conversión a VTT no pueden divergir entre los dos caminos.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

export function srtToVtt(text: string): string {
  const body = text
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2})/gm, '');
  return `WEBVTT\n\n${body}`;
}

/** Idioma de Tesseract para una pista: castellano o, si no, inglés (los dos únicos `tessdata` instalados). */
export function idiomaOcr(lang: string | undefined): 'spa' | 'eng' {
  return lang === 'spa' || lang === 'es' || lang === 'esp' ? 'spa' : 'eng';
}

/**
 * OCR de un `.sup` ya extraído. Devuelve el VTT, o null si PgsToSrt no dejó salida. Lanza si PgsToSrt falla.
 * `tmpSrt` lo borra siempre; el `.sup` es de quien llama.
 */
export async function ocrSupAVtt(sup: string, tmpSrt: string, lang: string | undefined): Promise<string | null> {
  const dotnetExe = existsSync('C:\\Program Files\\dotnet\\dotnet.exe') ? 'C:\\Program Files\\dotnet\\dotnet.exe' : 'dotnet';
  const pgsToSrtDll = 'C:\\scripts\\PgsToSrt\\PgsToSrt.dll';
  const tessData = 'C:\\scripts\\PgsToSrt\\tessdata';
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        dotnetExe,
        [pgsToSrtDll, '--input', sup, '--output', tmpSrt, '--tesseractlanguage', idiomaOcr(lang), '--tesseractdata', tessData],
        { windowsHide: true, timeout: 10 * 60_000 },
      );
      proc.on('error', reject);
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`PgsToSrt exit ${code}`))));
    });
    if (!existsSync(tmpSrt)) return null;
    return srtToVtt(readFileSync(tmpSrt, 'utf8'));
  } finally {
    try { if (existsSync(tmpSrt)) unlinkSync(tmpSrt); } catch {}
  }
}
