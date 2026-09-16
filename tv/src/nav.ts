/**
 * Foco y desplazamiento en el televisor.
 *
 * Tres decisiones que salen de ver la app funcionando en la tele:
 *
 * 1. **Nada de `window.scroll`.** Movía la página unos píxeles por pulsación y
 *    subir tras bajar varias filas iba a tirones. El lienzo se desplaza con
 *    `transform` y salta de fila en fila.
 * 2. **La geometría se calcula una vez por pantalla, no en cada tecla.** Medir
 *    con `getBoundingClientRect` los 175 elementos de una rejilla obliga al
 *    navegador a rehacer el diseño entero en cada pulsación, y en la tele se
 *    nota. Como al navegar solo cambian transformaciones —que no alteran el
 *    diseño— las posiciones de `offsetLeft/offsetTop` siguen siendo válidas.
 * 3. **El menú es una zona aparte.** Ocupa toda la altura, así que compitiendo
 *    por distancia se colaba en cualquier movimiento vertical. Se entra a él
 *    yendo a la izquierda y se sale yendo a la derecha, sin cálculos.
 */

export const TECLA = {
  IZQUIERDA: 37,
  ARRIBA: 38,
  DERECHA: 39,
  ABAJO: 40,
  ENTRAR: 13,
  ATRAS: 10009,
  ESCAPE: 27,
  REPRODUCIR: 415,
  PAUSA: 19,
  PLAY_PAUSA: 10252,
  PARAR: 413,
  RETROCEDER: 412,
  AVANZAR: 417,
  INFO: 457,
};

/** Altura a la que se coloca la fila enfocada. Deja ver la de arriba asomando. */
const FILA_Y = 300;
/** Igual que el `padding-left` de la pista: la primera carátula queda entera. */
const MARGEN_LATERAL = 150;
/** Holgura que se deja al traer un elemento a la vista fuera de las filas. */
const MARGEN_SUPERIOR = 60;
const MARGEN_INFERIOR = 110;

type Nodo = { el: HTMLElement; x: number; y: number; ancho: number; alto: number; menu: boolean };

let indice: Nodo[] = [];

/** Posición dentro del documento, sin que las transformaciones la falseen. */
function posicion(el: HTMLElement) {
  let x = 0;
  let y = 0;
  let actual: HTMLElement | null = el;
  while (actual) {
    x += actual.offsetLeft;
    y += actual.offsetTop;
    actual = actual.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

/** Se llama una vez tras pintar; navegar después no vuelve a medir nada. */
export function indexar() {
  indice = [];
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
    const p = posicion(el);
    indice.push({
      el,
      x: p.x + el.offsetWidth / 2,
      y: p.y + el.offsetHeight / 2,
      ancho: el.offsetWidth,
      alto: el.offsetHeight,
      menu: !!el.closest('[data-menu]'),
    });
  });
}

/**
 * Mide solo lo recien anadido y lo suma al indice.
 *
 * `indexar()` vuelve a medir todo, y eso cuesta: 53 ms con 617 elementos —tres
 * fotogramas perdidos— cada vez que la rejilla pide otra pagina de 120 titulos,
 * y va a mas segun se baja. Midiendo solo las tarjetas nuevas, el trabajo es
 * siempre el mismo por pagina.
 */
export function indexarAdemas(nuevos: HTMLElement[]) {
  nuevos.forEach((el) => {
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
    const p = posicion(el);
    indice.push({
      el,
      x: p.x + el.offsetWidth / 2,
      y: p.y + el.offsetHeight / 2,
      ancho: el.offsetWidth,
      alto: el.offsetHeight,
      menu: !!el.closest('[data-menu]'),
    });
  });
}

export const enfocables = (): HTMLElement[] => indice.map((n) => n.el);

export function actual(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.enfocado');
}

function desplazarCarrusel(carrusel: HTMLElement, tarjeta: HTMLElement) {
  const pista = carrusel.firstElementChild as HTMLElement | null;
  if (!pista) return;

  // `scrollWidth`, no `offsetWidth`: la pista es un bloque con `nowrap`, asi que
  // mide lo mismo que el carrusel aunque las tarjetas se salgan por la derecha.
  // Con offsetWidth el tope daba 0 y ninguna fila se desplazaba jamas.
  const maximo = Math.max(0, pista.scrollWidth - carrusel.offsetWidth);
  const objetivo = Math.min(maximo, Math.max(0, tarjeta.offsetLeft - MARGEN_LATERAL));
  pista.style.transform = 'translateX(' + -Math.round(objetivo) + 'px)';
}

function desplazarVertical(el: HTMLElement, nodo: Nodo | undefined) {
  const lienzo = document.querySelector<HTMLElement>('[data-lienzo]');
  if (!lienzo) return;

  const bloque = el.closest('[data-bloque]') as HTMLElement | null;
  if (!bloque) return;

  const actualY = -(parseFloat((/translateY\((-?[0-9.]+)px\)/.exec(lienzo.style.transform || '') || ['', '0'])[1]) || 0);

  let objetivo: number;
  if (bloque.hasAttribute('data-heroe')) {
    objetivo = 0;
  } else if (bloque.classList.contains('ficha')) {
    /*
     * La ficha se enseña entera desde arriba. Con la regla de «desplazar lo
     * justo», al volver del reparto a los botones la pantalla se quedaba donde
     * estaba y el logo, los datos y la sinopsis se perdian por encima: el
     * elemento enfocado ya se veia, asi que no habia nada que desplazar.
     */
    objetivo = Math.max(0, bloque.offsetTop);
  } else if (bloque.classList.contains('fila')) {
    // Las filas de la portada se colocan siempre a la misma altura: es lo que
    // hace que subir y bajar vaya de fila en fila y no a trompicones.
    objetivo = Math.max(0, bloque.offsetTop - FILA_Y);
  } else if (nodo) {
    /*
     * Fuera de las filas se desplaza lo justo para que el elemento se vea. Con
     * la altura fija, al entrar en la ficha de un actor el foco caía en la
     * primera carátula y empujaba la foto y la biografía fuera de la pantalla.
     */
    const arriba = nodo.y - nodo.alto / 2;
    const abajo = nodo.y + nodo.alto / 2;
    if (arriba - actualY < MARGEN_SUPERIOR) objetivo = arriba - MARGEN_SUPERIOR;
    else if (abajo - actualY > 1080 - MARGEN_INFERIOR) objetivo = abajo - 1080 + MARGEN_INFERIOR;
    else objetivo = actualY;
  } else {
    objetivo = Math.max(0, bloque.offsetTop - FILA_Y);
  }

  const maximo = Math.max(0, lienzo.offsetHeight - 1080 + 80);
  lienzo.style.transform = 'translateY(' + -Math.round(Math.max(0, Math.min(objetivo, maximo))) + 'px)';
}

export function enfocar(el: HTMLElement | null | undefined) {
  if (!el) return;

  const previo = actual();
  if (previo) previo.classList.remove('enfocado');
  el.classList.add('enfocado');

  const nodo = indice.filter((n) => n.el === el)[0];

  const carrusel = el.closest('[data-carrusel]') as HTMLElement | null;
  if (carrusel) desplazarCarrusel(carrusel, el);

  desplazarVertical(el, nodo);
}

/** Mejor candidato en una dirección, dentro de la misma zona. */
function mejorEn(desde: Nodo, direccion: number): HTMLElement | null {
  let mejor: HTMLElement | null = null;
  let mejorCoste = Infinity;

  for (let i = 0; i < indice.length; i++) {
    const n = indice[i];
    if (n.el === desde.el || n.menu !== desde.menu) continue;

    const dx = n.x - desde.x;
    const dy = n.y - desde.y;

    let avance: number;
    let desvio: number;
    if (direccion === TECLA.IZQUIERDA) { avance = -dx; desvio = Math.abs(dy); }
    else if (direccion === TECLA.DERECHA) { avance = dx; desvio = Math.abs(dy); }
    else if (direccion === TECLA.ARRIBA) { avance = -dy; desvio = Math.abs(dx); }
    else { avance = dy; desvio = Math.abs(dx); }

    if (avance <= 8) continue;
    const coste = avance + desvio * 3;
    if (coste < mejorCoste) {
      mejorCoste = coste;
      mejor = n.el;
    }
  }
  return mejor;
}

export function siguiente(direccion: number): HTMLElement | null {
  const foco = actual();
  if (!foco) return indice.length ? indice[0].el : null;

  const desde = indice.filter((n) => n.el === foco)[0];
  if (!desde) return indice.length ? indice[0].el : null;

  // Cambio de zona: directo, sin medir distancias entre dos sistemas de
  // coordenadas que no se pueden comparar (el menú es fijo, el lienzo se mueve).
  if (!desde.menu && direccion === TECLA.IZQUIERDA && !mejorEn(desde, direccion)) {
    const activa = document.querySelector<HTMLElement>('.opcion.activa') || document.querySelector<HTMLElement>('.opcion');
    if (activa) return activa;
  }
  if (desde.menu && direccion === TECLA.DERECHA) {
    const contenido = indice.filter((n) => !n.menu)[0];
    if (contenido) return contenido.el;
  }

  return mejorEn(desde, direccion);
}

type Manejador = (tecla: number, evento: KeyboardEvent) => boolean | void;
let manejador: Manejador | null = null;

/** A quien contarle que algo ha fallado; lo pone la aplicacion al arrancar. */
let alFallar: ((mensaje: string) => void) | null = null;

export function avisarDeFallos(fn: (mensaje: string) => void) {
  alFallar = fn;
}

/** La pantalla activa decide; si no devuelve true, actúa la navegación normal. */
export function alPulsar(fn: Manejador | null) {
  manejador = fn;
}

/**
 * Quien tiene el mando ahora mismo.
 *
 * Lo necesitan los paneles que se abren encima de una pantalla —elegir pista,
 * confirmar un borrado— para devolverlo al cerrarse. Antes cada uno lo
 * devolvia «a la portada», y cerrar el menu de audio y pulsar Volver te sacaba
 * al inicio vinieras de donde vinieras.
 */
export function manejadorActual(): Manejador | null {
  return manejador;
}

export function iniciarNavegacion() {
  document.addEventListener('keydown', (e) => {
    const tecla = e.keyCode;

    /*
     * Si la pantalla activa revienta manejando una tecla, la excepcion subia
     * hasta aqui y se llevaba por delante el resto del manejador: a partir de
     * ese momento el mando dejaba de responder y no habia forma de saber por
     * que. Paso de verdad con `seekTo` en la tele. Ahora se recoge, se avisa y
     * la navegacion normal sigue funcionando.
     */
    let atendida = false;
    try {
      atendida = manejador ? manejador(tecla, e) === true : false;
    } catch (err) {
      atendida = false;
      if (alFallar) alFallar((err as Error).message || String(err));
    }
    if (atendida) {
      e.preventDefault();
      return;
    }

    if (tecla === TECLA.IZQUIERDA || tecla === TECLA.DERECHA || tecla === TECLA.ARRIBA || tecla === TECLA.ABAJO) {
      const destino = siguiente(tecla);
      if (destino) enfocar(destino);
      e.preventDefault();
      return;
    }

    if (tecla === TECLA.ENTRAR) {
      const el = actual();
      if (el) {
        el.click();
        e.preventDefault();
      }
    }
  });

  const w = window as unknown as {
    tizen?: { tvinputdevice?: { registerKey?: (k: string) => void; registerKeys?: (k: string[]) => void } };
  };
  const entrada = w.tizen && w.tizen.tvinputdevice ? w.tizen.tvinputdevice : null;
  if (entrada && !entrada.registerKey && entrada.registerKeys) {
    // Firmware sin la version de una en una: se registra el bloque de siempre,
    // sin «Info», que es la unica que puede no existir.
    try {
      entrada.registerKeys(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward']);
    } catch (e) {
      /* el emulador no siempre las expone */
    }
  } else if (entrada && entrada.registerKey) {
    // Una a una, no la lista entera: si un modelo no conoce alguna (en la QN93A
    // «Info» es la dudosa), `registerKeys` rechaza el bloque completo y se
    // quedan sin registrar tambien las de reproduccion, que si existen.
    const teclas = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward', 'Info'];
    for (let i = 0; i < teclas.length; i++) {
      try {
        entrada.registerKey(teclas[i]);
      } catch (e) {
        /* esa tecla no existe en este modelo */
      }
    }
  }
}
