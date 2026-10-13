/*
 * Tras `vite build`: deja junto a cada JS/CSS/SVG de dist/assets su .br y su .gz. El servidor los
 * sirve tal cual (@fastify/static con preCompressed) a quien los acepte; así en la red de casa,
 * donde no hay Caddy delante, tampoco viajan los 460 KB del JS principal sin comprimir.
 * Comprimir al máximo aquí sale gratis: se hace una vez por build, no en cada petición.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dir = join(import.meta.dirname, '..', 'dist', 'assets');
let antes = 0, despues = 0, n = 0;
for (const nombre of readdirSync(dir)) {
  if (!/\.(js|css|svg|json)$/.test(nombre)) continue;
  const ruta = join(dir, nombre);
  const datos = readFileSync(ruta);
  if (datos.length < 1024) continue;
  const br = brotliCompressSync(datos, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: datos.length },
  });
  writeFileSync(ruta + '.br', br);
  writeFileSync(ruta + '.gz', gzipSync(datos, { level: 9 }));
  antes += datos.length; despues += br.length; n++;
}
console.log(`precomprimidos ${n} ficheros: ${(antes / 1024).toFixed(0)} KB -> ${(despues / 1024).toFixed(0)} KB en brotli`);
if (n === 0) throw new Error('no se precomprimió nada en dist/assets');
