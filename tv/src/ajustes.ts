/** Preferencias de la televisión. Se guardan en el propio aparato. */

const CLAVE = 'tvwatch.ajustes';

export type Rendimiento = 'rapido' | 'medio' | 'completo';

export type Ajustes = {
  /** 'rapido' quita sombras, degradados y transiciones: la tele va suelta. */
  rendimiento: Rendimiento;
  heroeRotar: boolean;
  heroeSegundos: number;
  reanudar: boolean;
  saltoCorto: number;
  saltoLargo: number;
  /** Claves del menú en el orden elegido; las que falten van al final. */
  ordenMenu: string[];
  ocultos: string[];
  /** Codigo ISO de tres letras de la pista de audio que se elige al empezar. */
  idiomaAudio: string;
  /** Si hay una pista Atmos en otro idioma, ¿gana al idioma preferido? */
  preferirAtmos: boolean;
  /** Tamaño de los subtítulos, en porcentaje del normal (42 px). */
  tamanoSubtitulos: number;
  /** Fondo tras el texto: 'sombra' basta casi siempre, 'caja' para cine ruidoso. */
  fondoSubtitulos: 'sombra' | 'caja';
  /** Retardo por defecto de los subtítulos, en milisegundos. */
  retardoSubtitulos: number;
  /** Cómo sale el audio: normal (sin tocar), noche o voces claras. */
  modoAudio: 'normal' | 'night' | 'dialogue';
  /** Ofrecer el botón de saltar cabecera cuando se haya detectado. */
  saltarCabecera: boolean;
  /** Enseñar en el reproductor a qué hora termina lo que se está viendo. */
  horaDeFin: boolean;
};

const POR_DEFECTO: Ajustes = {
  /*
   * Todos los efectos, y no por gusto: medido en la QN93A con 363 tarjetas en
   * pantalla y veinte saltos de foco seguidos, «completo» da 16,8 ms de mediana
   * por fotograma —60 por segundo clavados— y ningún fotograma por encima de
   * 18,3 ms. «rapido», que quita sombras y transiciones, midió un fotograma de
   * 33,7 ms. O sea que la tele mueve la interfaz bonita sin despeinarse y
   * quitarle cosas no la hacía ir mejor.
   */
  rendimiento: 'completo',
  heroeRotar: true,
  heroeSegundos: 9,
  reanudar: true,
  saltoCorto: 15,
  saltoLargo: 60,
  ordenMenu: [],
  ocultos: [],
  idiomaAudio: 'spa',
  preferirAtmos: false,
  tamanoSubtitulos: 100,
  fondoSubtitulos: 'sombra',
  retardoSubtitulos: 0,
  modoAudio: 'normal',
  saltarCabecera: true,
  horaDeFin: true,
};

let actuales: Ajustes = POR_DEFECTO;

export function cargarAjustes(): Ajustes {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (crudo) {
      const guardado = JSON.parse(crudo) as Partial<Ajustes>;
      actuales = {
        rendimiento: guardado.rendimiento || POR_DEFECTO.rendimiento,
        heroeRotar: guardado.heroeRotar !== false,
        heroeSegundos: guardado.heroeSegundos || POR_DEFECTO.heroeSegundos,
        reanudar: guardado.reanudar !== false,
        saltoCorto: guardado.saltoCorto || POR_DEFECTO.saltoCorto,
        saltoLargo: guardado.saltoLargo || POR_DEFECTO.saltoLargo,
        ordenMenu: recolocarAjustes(guardado.ordenMenu || []),
        ocultos: guardado.ocultos || [],
        idiomaAudio: guardado.idiomaAudio || POR_DEFECTO.idiomaAudio,
        preferirAtmos: guardado.preferirAtmos === true,
        tamanoSubtitulos: guardado.tamanoSubtitulos || POR_DEFECTO.tamanoSubtitulos,
        fondoSubtitulos: guardado.fondoSubtitulos === 'caja' ? 'caja' : 'sombra',
        retardoSubtitulos: guardado.retardoSubtitulos || 0,
        modoAudio: guardado.modoAudio || POR_DEFECTO.modoAudio,
        saltarCabecera: guardado.saltarCabecera !== false,
        horaDeFin: guardado.horaDeFin !== false,
      };
    }
  } catch (e) {
    actuales = POR_DEFECTO;
  }
  aplicarRendimiento();
  return actuales;
}

export const ajustes = () => actuales;

export function guardarAjustes(cambios: Partial<Ajustes>) {
  actuales = Object.assign({}, actuales, cambios);
  try {
    localStorage.setItem(CLAVE, JSON.stringify(actuales));
  } catch (e) {
    /* sin almacenamiento: valdrá solo para esta sesión */
  }
  aplicarRendimiento();
}

/** El modo se aplica con una clase en <body> y lo resuelve el CSS. */
function aplicarRendimiento() {
  const clases = document.body.className.split(/\s+/).filter((c) => c.indexOf('rend-') !== 0);
  clases.push('rend-' + actuales.rendimiento);
  document.body.className = clases.join(' ').trim();
}

/** Ordena las claves del menú según la preferencia, sin perder ninguna nueva. */
/**
 * Un orden guardado de cuando «Ajustes» iba el último, tras las bibliotecas,
 * se corrige una vez: pasa a ir detrás de Favoritos, con los fijos. Si el
 * usuario lo mueve después a mano, se respeta (ya no queda detrás de una
 * biblioteca).
 */
function recolocarAjustes(orden: string[]): string[] {
  const i = orden.indexOf('ajustes');
  if (i < 0) return orden;
  const primeraLib = orden.findIndex((c) => c.indexOf('lib-') === 0);
  if (primeraLib < 0 || i < primeraLib) return orden;
  const sin = orden.filter((c) => c !== 'ajustes');
  const fav = sin.indexOf('favoritos');
  sin.splice(fav >= 0 ? fav + 1 : Math.min(4, sin.length), 0, 'ajustes');
  return sin;
}

export function ordenar<T extends { clave: string }>(lista: T[]): T[] {
  const orden = actuales.ordenMenu;
  const ocultos = actuales.ocultos;
  const visibles = lista.filter((d) => ocultos.indexOf(d.clave) < 0);
  if (orden.length === 0) return visibles;

  const posicion = (clave: string) => {
    const i = orden.indexOf(clave);
    return i < 0 ? 999 : i;
  };
  return visibles.slice().sort((a, b) => posicion(a.clave) - posicion(b.clave));
}
