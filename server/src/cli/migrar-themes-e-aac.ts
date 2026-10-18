/**
 * Migración de temas de series en E:\ a AAC-LC .m4a.
 *
 * Convierte los archivos theme.mp3 ubicados en las carpetas de series en E:\
 * al formato AAC-LC (.m4a a 96 kbps con +faststart) para máxima compatibilidad
 * con Smart TVs y dispositivos móviles.
 *
 * Uso:
 *   npx tsx src/cli/migrar-themes-e-aac.ts [--confirmar]
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join } from 'node:path';
import { config } from '../config.ts';

const confirmar = process.argv.includes('--confirmar');

console.log('=== Migración de Sintonías en E:\\ a AAC-LC (.m4a) ===');
console.log(`Modo: ${confirmar ? 'APLICAR CAMBIOS' : 'SIMULACIÓN / PRUEBA'}\n`);

const CARPETAS_SERIES = [
  'E:\\Series',
  'E:\\Series Peques',
  'E:\\Docuseries',
];

const temas: string[] = [];

for (const base of CARPETAS_SERIES) {
  if (!existsSync(base)) continue;
  try {
    const series = readdirSync(base, { withFileTypes: true });
    for (const s of series) {
      if (s.isDirectory()) {
        const themeMp3 = join(base, s.name, 'theme.mp3');
        if (existsSync(themeMp3)) {
          temas.push(themeMp3);
        }
      }
    }
  } catch {}
}

console.log(`Total sintonías theme.mp3 encontradas en E:\\: ${temas.length}`);

function convertirAAC(input: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(config.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-c:a', 'aac',
      '-b:a', '96k',
      '-movflags', '+faststart',
      output,
    ], { windowsHide: true, timeout: 30_000 });

    proc.on('close', (code) => {
      resolve(code === 0 && existsSync(output) && statSync(output).size > 0);
    });
    proc.on('error', () => resolve(false));
  });
}

async function main() {
  let convertidos = 0;
  let bytesAntes = 0;
  let bytesDespues = 0;

  for (let i = 0; i < temas.length; i++) {
    const orig = temas[i];
    const nuevo = orig.replace(/\.mp3$/i, '.m4a');
    const szOrig = statSync(orig).size;

    if (!confirmar) {
      console.log(`[SIMULACIÓN ${i + 1}/${temas.length}] ${orig} (${(szOrig / 1024).toFixed(1)} KB) -> theme.m4a`);
      continue;
    }

    const exito = await convertirAAC(orig, nuevo);
    if (exito) {
      const szNuevo = statSync(nuevo).size;
      bytesAntes += szOrig;
      bytesDespues += szNuevo;
      unlinkSync(orig);
      convertidos++;
      console.log(`[${convertidos}/${temas.length}] ${(szOrig / 1024).toFixed(1)} KB -> ${(szNuevo / 1024).toFixed(1)} KB: ${nuevo}`);
    } else {
      console.log(`[x] Falló conversión: ${orig}`);
    }
  }

  if (confirmar) {
    const ahorroMb = ((bytesAntes - bytesDespues) / 1048576).toFixed(1);
    console.log(`\nConversión finalizada: ${convertidos} sintonías convertidas a .m4a. Espacio liberado: ${ahorroMb} MB.`);
  }
}

main().catch(console.error);
