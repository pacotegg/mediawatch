/**
 * Deja mpv en build/mpv para empaquetarlo. Build fijada por versión y comprobada contra su SHA-256: si el
 * fichero descargado no coincide, se aborta (el instalador lleva un ejecutable que corre en el PC del usuario).
 * Para cambiar de versión: nueva URL y nuevo hash, mirados a mano en la release de shinchiro/mpv-winbuild-cmake.
 */
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const NOMBRE = 'mpv-x86_64-v3-20261014-git-ec38361c56.7z';
const URL = `https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261014/${NOMBRE}`;
const SHA256 = '0ac476a74cce37119cec4a60f474dce9e051256c659b186f4712058ead354a17';

const destino = join(__dirname, '..', 'build', 'mpv');
if (existsSync(join(destino, 'mpv.exe'))) {
  console.log('mpv ya está en build/mpv');
  process.exit(0);
}
mkdirSync(destino, { recursive: true });

// 7-Zip viene en los ejecutores de GitHub; en un PC normal, en Archivos de programa.
const rutaLocal = join(process.env.ProgramFiles ?? '', '7-Zip', '7z.exe');
const sevenZip = existsSync(rutaLocal) ? rutaLocal : '7z';

(async () => {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`No se pudo descargar mpv: ${res.status}`);
  const datos = Buffer.from(await res.arrayBuffer());
  const hash = createHash('sha256').update(datos).digest('hex');
  if (hash !== SHA256) throw new Error(`El SHA-256 de mpv no coincide: ${hash}`);
  const archivo = join(destino, '..', NOMBRE);
  writeFileSync(archivo, datos);
  execFileSync(sevenZip, ['x', '-y', `-o${destino}`, archivo], { stdio: 'ignore' });
  if (!existsSync(join(destino, 'mpv.exe'))) throw new Error('El paquete de mpv no contiene mpv.exe');
  console.log('mpv listo en build/mpv');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
