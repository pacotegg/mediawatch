/**
 * Qué hace el escaneo de la biblioteca ahora mismo, para quien lo lanzó desde la app: el servidor escanea de fondo y
 * `POST /api/scan` solo contesta «started». Aquí se apunta el último avance que manda el worker y cómo acabó el último,
 * y `GET /api/scan/estado` (solo administrador) lo cuenta. Solo vive en memoria: tras un reinicio no hay «último».
 *
 * Sin importar `db` ni el escáner (solo el tipo): se puede probar sin abrir la base.
 */
import type { ScanProgress } from '../scanner/scan.ts';

export type ResultadoEscaneo = { name: string; count: number };
/** Lo que entró y salió en el escaneo (29/10/2026). Por carpeta y por ruta: los ids se renumeran en cada escaneo. */
export type CambiosEscaneo = {
  titulosAnadidos: number;
  titulosRetirados: number;
  ficherosAnadidos: number;
  ficherosRetirados: number;
  /** Hasta 5 títulos de cada lista, para enseñarlos. */
  nuevos: string[];
  retirados: string[];
};
export type UltimoEscaneo = { fin: string; ok: boolean; resultados: ResultadoEscaneo[]; cambios: CambiosEscaneo | null; error: string | null };

/** Carpeta → título de cada título, y la ruta de cada fichero. La saca `index.ts` de la base. */
export type FotoBiblioteca = { titulos: Map<string, string>; ficheros: Set<string> };

export function compararFotos(antes: FotoBiblioteca, despues: FotoBiblioteca): CambiosEscaneo {
  const nuevos: string[] = [];
  const retirados: string[] = [];
  for (const [carpeta, titulo] of despues.titulos) if (!antes.titulos.has(carpeta)) nuevos.push(titulo);
  for (const [carpeta, titulo] of antes.titulos) if (!despues.titulos.has(carpeta)) retirados.push(titulo);
  let ficherosAnadidos = 0;
  let ficherosRetirados = 0;
  for (const f of despues.ficheros) if (!antes.ficheros.has(f)) ficherosAnadidos++;
  for (const f of antes.ficheros) if (!despues.ficheros.has(f)) ficherosRetirados++;
  return {
    titulosAnadidos: nuevos.length,
    titulosRetirados: retirados.length,
    ficherosAnadidos,
    ficherosRetirados,
    nuevos: nuevos.slice(0, 5),
    retirados: retirados.slice(0, 5),
  };
}

let enCurso: { desde: string; ruta: string | null; progreso: ScanProgress | null } | null = null;
let ultimo: UltimoEscaneo | null = null;

/** `ruta`: la carpeta que se escanea, o `null` si son todas. */
export function escaneoIniciado(ruta: string | null): void {
  enCurso = { desde: new Date().toISOString(), ruta, progreso: null };
}

export function escaneoAvanza(p: ScanProgress): void {
  if (enCurso) enCurso.progreso = p;
}

export function escaneoTerminado(resultados: ResultadoEscaneo[], cambios: CambiosEscaneo | null = null): void {
  enCurso = null;
  ultimo = { fin: new Date().toISOString(), ok: true, resultados, cambios, error: null };
}

export function escaneoFallido(error: string): void {
  enCurso = null;
  ultimo = { fin: new Date().toISOString(), ok: false, resultados: [], cambios: null, error };
}

export function estadoEscaneo() {
  return {
    scanning: enCurso !== null,
    desde: enCurso?.desde ?? null,
    ruta: enCurso?.ruta ?? null,
    progreso: enCurso?.progreso ?? null,
    ultimo,
  };
}
