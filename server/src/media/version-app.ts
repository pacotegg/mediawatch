/**
 * Cuál es la última versión de la app Android que se puede instalar.
 *
 * La fuente es el propio APK publicado: el `MediaWatch-<versión>.apk` más alto
 * que haya en `web/dist`, que es lo que se copia al entregar cada versión. Así
 * la app no avisa de una versión cuyo APK todavía no existe. Las novedades
 * salen de su sección en CHANGELOG.md, con el mismo criterio que la ventana
 * de novedades de la app (líneas «- » bajo «## <versión>»).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.ts';

export function ultimaVersionApp(): { version: string; novedades: string[] } | null {
  let nombres: string[];
  try {
    nombres = readdirSync(join(ROOT, 'web', 'dist'));
  } catch {
    return null;
  }
  const versiones = nombres
    .map((n) => /^MediaWatch-(\d+)\.(\d+)\.apk$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2])] as const)
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (!versiones.length) return null;
  const version = `${versiones[0][0]}.${versiones[0][1]}`;

  const novedades: string[] = [];
  try {
    let dentro = false;
    for (const linea of readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)) {
      if (linea.startsWith('## ')) {
        if (dentro) break;
        dentro = linea.slice(3).trim().split(/\s/)[0] === version;
      } else if (dentro && linea.startsWith('- ')) {
        novedades.push(linea.slice(2).trim());
      }
    }
  } catch {
    /* sin changelog: el aviso sale sin la lista */
  }
  return { version, novedades };
}
