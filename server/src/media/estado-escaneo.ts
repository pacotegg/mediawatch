/**
 * Qué hace el escaneo de la biblioteca ahora mismo, para quien lo lanzó desde la app: el servidor escanea de fondo y
 * `POST /api/scan` solo contesta «started». Aquí se apunta el último avance que manda el worker y cómo acabó el último,
 * y `GET /api/scan/estado` (solo administrador) lo cuenta. Solo vive en memoria: tras un reinicio no hay «último».
 *
 * Sin importar `db` ni el escáner (solo el tipo): se puede probar sin abrir la base.
 */
import type { ScanProgress } from '../scanner/scan.ts';

export type ResultadoEscaneo = { name: string; count: number };
export type UltimoEscaneo = { fin: string; ok: boolean; resultados: ResultadoEscaneo[]; error: string | null };

let enCurso: { desde: string; ruta: string | null; progreso: ScanProgress | null } | null = null;
let ultimo: UltimoEscaneo | null = null;

/** `ruta`: la carpeta que se escanea, o `null` si son todas. */
export function escaneoIniciado(ruta: string | null): void {
  enCurso = { desde: new Date().toISOString(), ruta, progreso: null };
}

export function escaneoAvanza(p: ScanProgress): void {
  if (enCurso) enCurso.progreso = p;
}

export function escaneoTerminado(resultados: ResultadoEscaneo[]): void {
  enCurso = null;
  ultimo = { fin: new Date().toISOString(), ok: true, resultados, error: null };
}

export function escaneoFallido(error: string): void {
  enCurso = null;
  ultimo = { fin: new Date().toISOString(), ok: false, resultados: [], error };
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
