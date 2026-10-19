/**
 * Reinicio del servidor con aviso, para pedirlo desde el móvil (19/10/2026).
 *
 * Reiniciar a mano exige estar en el HTPC, y quien está viendo algo se queda sin vídeo sin saber por qué. Aquí el
 * administrador lo pide desde la app: se avisa a todos los aparatos con sesión («Mantenimiento en curso, volvemos en un
 * minuto»), se espera lo justo para que el aviso llegue (los reproductores preguntan a /api/mando cada ~5 s, la tele
 * cada 2) y el proceso sale. Lo levanta el vigilante (`vigilar-servidor.ps1`, mira cada 60 s): si no hay vigilante,
 * salir dejaría el servidor parado para siempre, y por eso la ruta lo comprueba antes y se niega.
 *
 * Dos modos: `ya`, y `cuando-libre`, que espera a que nadie esté viendo nada (los mismos criterios que los lotes:
 * ningún visionado con informe en los últimos 2 min y 5 min sin señal de reproducción).
 *
 * Vive en memoria: si el servidor sale por otro motivo, la petición se pierde, que es lo que se quiere.
 */

export const MENSAJE_POR_DEFECTO = 'Mantenimiento en curso, volvemos en un minuto';
/** Entre el aviso y la salida: que lo recojan los aparatos que preguntan cada pocos segundos. */
export const ESPERA_AVISO_MS = 20_000;
/** Una petición «cuando libre» que no llega a cumplirse en este tiempo se abandona. */
export const CADUCA_MS = 6 * 3600_000;

export type ModoReinicio = 'ya' | 'cuando-libre';

export type EstadoReinicio = {
  pendiente: boolean;
  modo: ModoReinicio | null;
  mensaje: string | null;
  /** Cuándo se pidió (ms de época). */
  desde: number | null;
  /** Si ya se avisó y solo falta salir: cuándo sale (ms de época). */
  salePara: number | null;
};

export type DependenciasReinicio = {
  ahora: () => number;
  /** ¿Hay algún visionado en marcha o muy reciente? */
  alguienViendo: () => boolean;
  /** Los ocho primeros caracteres del token de cada aparato con sesión reciente. */
  sesiones: () => string[];
  enviarMensaje: (sesion: string, texto: string) => void;
  salir: () => void;
};

export function crearReinicio(dep: DependenciasReinicio) {
  let estado: EstadoReinicio = { pendiente: false, modo: null, mensaje: null, desde: null, salePara: null };

  function avisarYProgramarSalida() {
    for (const s of dep.sesiones()) dep.enviarMensaje(s, estado.mensaje ?? MENSAJE_POR_DEFECTO);
    estado = { ...estado, salePara: dep.ahora() + ESPERA_AVISO_MS };
  }

  return {
    estado: (): EstadoReinicio => ({ ...estado }),

    pedir(modo: ModoReinicio, mensaje?: string): EstadoReinicio {
      if (estado.pendiente) return { ...estado };
      const texto = (mensaje ?? '').trim().slice(0, 200) || MENSAJE_POR_DEFECTO;
      estado = { pendiente: true, modo, mensaje: texto, desde: dep.ahora(), salePara: null };
      if (modo === 'ya') avisarYProgramarSalida();
      return { ...estado };
    },

    cancelar(): EstadoReinicio {
      estado = { pendiente: false, modo: null, mensaje: null, desde: null, salePara: null };
      return { ...estado };
    },

    /** Una pasada del temporizador (cada pocos segundos). Devuelve true si ha llamado a `salir`. */
    tic(): boolean {
      if (!estado.pendiente) return false;
      const ahora = dep.ahora();
      if (estado.salePara !== null) {
        if (ahora >= estado.salePara) { dep.salir(); return true; }
        return false;
      }
      if (estado.desde !== null && ahora - estado.desde > CADUCA_MS) { this.cancelar(); return false; }
      if (estado.modo === 'cuando-libre' && !dep.alguienViendo()) avisarYProgramarSalida();
      return false;
    },
  };
}
