/**
 * Que la biblioteca se entere sola de lo que aparece en los discos.
 *
 * Aquí ya hubo un vigilante y **se quitó el 24/09/2026** por buenos motivos,
 * apuntados en `index.ts`: reaccionaba a cada aviso del sistema de ficheros
 * releyendo la carpeta y abriendo una transacción sin comprobar si algo había
 * cambiado (20.072 líneas de «indexado» para 1.838 títulos, la biblioteca
 * entera reindexada once veces), **síncrono, en el hilo principal y sin mirar
 * si alguien estaba viendo algo**, así que competía por el plato mecánico a
 * mitad de película.
 *
 * El fallo nunca fue vigilar: era qué se hacía con cada aviso. Vigilar es
 * gratis, medido el 03/11/2026 con los nueve directorios raíz de la biblioteca
 * y `recursive: true` en Node 26.4: **+0,13 MB de RSS y 0,0 ms de CPU en 20 s
 * de reposo**. Lo que costaba era escanear de más.
 *
 * Así que aquí un aviso **no escanea nada**: solo apunta en un `Set` la carpeta
 * del título a la que pertenece. Las reglas, cada una contra uno de los motivos
 * por los que se retiró el anterior:
 *
 * 1. El aviso solo apunta. Ni lee disco ni toca la base de datos.
 * 2. Se espera a que esa carpeta lleve `esperaMs` **en silencio** (90 s). Un
 *    encode o una copia de 40 GB escriben durante minutos y van soltando avisos
 *    sin parar: la espera se reinicia con cada uno, así que nunca se escanea un
 *    fichero a medio escribir y una obra larga acaba en **un** escaneo, no mil.
 *    La espera es por carpeta y no global: una copia lenta no debe retrasar
 *    indefinidamente a la película que ya terminó.
 * 3. Solo vídeos (`VIDEO_EXT`), y fuera lo que el escáner tampoco quiere:
 *    `SKIP_DIRS`, carpetas que empiezan por `_` y nombres de `JUNK`
 *    (trailer, sample…). Las listas se importan del escáner a propósito: dos
 *    copias acabarían diciendo cosas distintas.
 * 4. Si hay alguien viendo algo, **no se escanea**: lo apuntado espera al
 *    siguiente tic. Esto es lo que faltaba y lo que estropeaba reproducciones.
 * 5. Se escanea con el escaneo **parcial** (`carpetas`), que no relee el resto
 *    de la biblioteca, y **en el worker**, que no puede congelar el servidor.
 * 6. Si de golpe hay más de `topeCarpetas` (20) carpetas pendientes, eso no es
 *    una película nueva: es una tanda de descargas. Entonces se pide un escaneo
 *    **completo**, que cuesta ~30 s y además retira lo que ya no existe.
 * 7. `on('error')` en cada vigilante y rearme con espera creciente: si `E:` se
 *    desconecta, `fs.watch` lanza y el servidor no se puede caer por eso.
 *
 * Lo que este vigilante **no** hace, a propósito:
 *
 * - **No retira nada.** Un escaneo parcial no puede: sin el recorrido completo
 *   no se sabe qué falta de verdad. Borrar una película se sigue notando en la
 *   pasada de las 02:00, que se queda como estaba y es también la red de
 *   seguridad si Node pierde avisos (no medido: `ReadDirectoryChangesW` tiene
 *   un búfer que puede desbordarse en una ráfaga larga).
 * - **No reacciona a subtítulos ni carátulas sueltas**, solo a vídeos. Un
 *   `.srt` que llega después entra en la pasada de madrugada.
 */
import { watch, type FSWatcher } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { config } from '../config.ts';
import { JUNK, SKIP_DIRS, VIDEO_EXT } from './scan.ts';

export type OpcionesVigilante = {
  /** Qué hacer con lo apuntado. `raiz` a `null` significa escaneo completo (regla 6). */
  escanear: (raiz: string | null, carpetas: string[]) => Promise<unknown>;
  /** Si devuelve `true` no se escanea ahora: hay alguien viendo algo o ya hay un escaneo en marcha. */
  ocupado?: () => boolean;
  /** Silencio que ha de llevar una carpeta antes de escanearla. */
  esperaMs?: number;
  /** Cada cuánto se mira si algo ha madurado. */
  ticMs?: number;
  topeCarpetas?: number;
  /** Por defecto, las bibliotecas de verdad (no las carpetas de entrada del scraper). */
  raices?: string[];
  registrar?: (linea: string) => void;
};

export type Vigilante = {
  parar: () => void;
  /** Para las pruebas y para el registro: qué hay apuntado sin escanear. */
  pendientes: () => string[];
};

/**
 * De qué título es este aviso.
 *
 * `nombre` llega relativo a la raíz vigilada y con los separadores del sistema.
 * Devuelve la ruta que entiende el escaneo parcial: la carpeta de primer nivel,
 * o el propio fichero si es un vídeo suelto en la raíz (que para una biblioteca
 * de películas es un título por sí mismo). `null` si no interesa.
 */
export function carpetaDelTitulo(raiz: string, nombre: string | null): string | null {
  if (!nombre) return null;
  const partes = nombre.split(/[\\/]/).filter(Boolean);
  if (!partes.length) return null;
  const fichero = partes[partes.length - 1];
  if (!VIDEO_EXT.has(extname(fichero).toLowerCase())) return null;
  if (JUNK.test(fichero)) return null;
  /*
   * Ficheros de trabajo. Los `.part` de JDownloader y los `.tmp` ya se caen solos por la extensión; esto es por los
   * que mantienen la de vídeo, como el `_recon_*.mkv` de `atmos-lib.ps1` (que hoy vive en G:\MediaTmp, fuera de lo
   * vigilado, pero un trabajo a medio hacer no debe poder entrar como una segunda versión de la película). Si se
   * ignora uno de verdad, lo único que pasa es que entra en la pasada de las 02:00 en vez de en 90 s.
   */
  if (fichero.startsWith('_') || fichero.startsWith('.')) return null;
  // Las carpetas intermedias (no el fichero) tienen que ser de contenido.
  for (let i = 0; i < partes.length - 1; i++) {
    const p = partes[i];
    if (p.startsWith('_') || SKIP_DIRS.has(p.toLowerCase())) return null;
  }
  return resolve(join(raiz, partes[0]));
}

export function arrancarVigilante(opciones: OpcionesVigilante): Vigilante {
  const esperaMs = opciones.esperaMs ?? 90_000;
  const ticMs = opciones.ticMs ?? 15_000;
  const topeCarpetas = opciones.topeCarpetas ?? 20;
  const registrar = opciones.registrar ?? ((l: string) => console.log(l));
  const entradas = new Set(config.fuentesScraper.map((f) => resolve(f.path).toLowerCase()));
  const raices = (opciones.raices ?? config.libraries.map((l) => l.path)).filter(
    (r) => !entradas.has(resolve(r).toLowerCase()),
  );

  /** Carpeta de título → cuándo se oyó la última señal suya. */
  const pendientes = new Map<string, { raiz: string; cuando: number }>();
  const vigilantes: FSWatcher[] = [];
  let tic: NodeJS.Timeout | null = null;
  let parado = false;
  let trabajando = false;

  const arrancarTic = () => {
    if (tic || parado) return;
    tic = setInterval(() => void repasar(), ticMs);
    tic.unref?.();
  };
  const pararTic = () => {
    if (!tic) return;
    clearInterval(tic);
    tic = null;
  };

  async function repasar(): Promise<void> {
    if (parado || trabajando) return;
    if (!pendientes.size) {
      pararTic();
      return;
    }
    const ahora = Date.now();
    const maduras = [...pendientes].filter(([, v]) => ahora - v.cuando >= esperaMs);
    if (!maduras.length) return;
    // Regla 4: lo apuntado no se pierde, solo espera al siguiente tic.
    if (opciones.ocupado?.()) return;

    trabajando = true;
    try {
      // Regla 6: una tanda entera no se escanea carpeta a carpeta.
      if (pendientes.size > topeCarpetas) {
        const cuantas = pendientes.size;
        pendientes.clear();
        registrar(`[vigilante] ${cuantas} carpetas nuevas: escaneo completo`);
        await opciones.escanear(null, []);
        return;
      }
      /*
       * Solo lo maduro, y agrupado por biblioteca: `scanAll` recibe una raíz y
       * las carpetas de dentro. Se borra de lo pendiente ANTES de escanear: si
       * mientras escaneamos vuelve a escribirse esa carpeta, el aviso nuevo la
       * apunta otra vez y se vuelve a mirar, que es lo que se quiere.
       */
      const porRaiz = new Map<string, string[]>();
      for (const [carpeta, v] of maduras) {
        pendientes.delete(carpeta);
        const lista = porRaiz.get(v.raiz);
        if (lista) lista.push(carpeta);
        else porRaiz.set(v.raiz, [carpeta]);
      }
      for (const [raiz, carpetas] of porRaiz) {
        registrar(`[vigilante] ${carpetas.length} carpeta(s) en ${raiz}: ${carpetas.map((c) => c.slice(raiz.length + 1)).join(', ')}`);
        await opciones.escanear(raiz, carpetas);
      }
    } catch (e) {
      registrar(`[vigilante] el escaneo falló: ${(e as Error).message}`);
    } finally {
      trabajando = false;
    }
  }

  function apuntar(raiz: string, nombre: string | null): void {
    const carpeta = carpetaDelTitulo(raiz, nombre);
    if (!carpeta) return;
    pendientes.set(carpeta, { raiz: resolve(raiz), cuando: Date.now() });
    arrancarTic();
  }

  /** Regla 7: si la unidad desaparece, `fs.watch` lanza o emite error. Se reintenta cada vez más tarde. */
  function vigilar(raiz: string, esperaRearme = 30_000): void {
    if (parado) return;
    let w: FSWatcher;
    try {
      w = watch(raiz, { recursive: true, persistent: false }, (_tipo, nombre) => apuntar(raiz, nombre));
    } catch (e) {
      registrar(`[vigilante] no se pudo vigilar ${raiz}: ${(e as Error).message}; se reintenta en ${Math.round(esperaRearme / 1000)} s`);
      setTimeout(() => vigilar(raiz, Math.min(esperaRearme * 2, 30 * 60_000)), esperaRearme).unref?.();
      return;
    }
    w.on('error', (e) => {
      registrar(`[vigilante] ${raiz} dejó de avisar: ${(e as Error).message}; se reintenta en ${Math.round(esperaRearme / 1000)} s`);
      try { w.close(); } catch { /* ya cerrado */ }
      const i = vigilantes.indexOf(w);
      if (i >= 0) vigilantes.splice(i, 1);
      setTimeout(() => vigilar(raiz, Math.min(esperaRearme * 2, 30 * 60_000)), esperaRearme).unref?.();
    });
    vigilantes.push(w);
  }

  for (const r of raices) vigilar(r);
  registrar(`[vigilante] vigilando ${vigilantes.length} de ${raices.length} carpeta(s); espera ${esperaMs / 1000} s`);

  return {
    parar() {
      parado = true;
      pararTic();
      for (const w of vigilantes) {
        try { w.close(); } catch { /* ya cerrado */ }
      }
      vigilantes.length = 0;
      pendientes.clear();
    },
    pendientes: () => [...pendientes.keys()],
  };
}
