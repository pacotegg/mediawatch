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
/** Holgura bajo la lista de episodios: es a lo que se viene, se le da casi todo. */
const MARGEN_LISTA = 40;
/** Filas que como minimo se ven a la vez en la lista de episodios. */
const FILAS_MINIMAS = 3;

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

/**
 * Deja la lista de episodios con una ventana propia.
 *
 * Los episodios estaban fuera de todo `data-bloque`, y `desplazarVertical`
 * salia sin hacer nada en cuanto el elemento enfocado no estaba dentro de uno:
 * al bajar por la lista el foco se iba por debajo de la pantalla y no se veia
 * el cursor. Ahora la lista tiene una altura fija -lo que queda de pantalla- y
 * se desplaza por dentro; la pantalla no se mueve hasta que se sale de ella.
 *
 * La altura es de filas enteras, para que nunca quede una cortada a medias.
 * Hay que llamarla antes de `indexar()`: recorta la lista y todo lo que va
 * detras cambia de sitio.
 */
export function ajustarListaEpisodios(caja: HTMLElement) {
  const pista = caja.firstElementChild as HTMLElement | null;
  if (!pista) return;
  caja.style.height = '';
  pista.style.transform = '';

  const primera = pista.firstElementChild as HTMLElement | null;
  const fila = primera ? primera.offsetHeight + 10 : 73; // 10 = margin-bottom
  const arriba = posicion(caja).y;
  const natural = pista.offsetHeight;

  // Si con la pantalla quieta no caben ni las filas minimas, se sube la
  // pantalla lo justo. Para una ficha normal esto queda en cero.
  const yLienzo = Math.max(0, arriba - (1080 - MARGEN_LISTA - fila * FILAS_MINIMAS));
  caja.setAttribute('data-y-lienzo', String(Math.round(yLienzo)));

  const ventana = 1080 - MARGEN_LISTA - (arriba - yLienzo);
  if (natural <= ventana) return; // cabe entera: sin recorte ni desplazamiento
  const filas = Math.max(FILAS_MINIMAS, Math.floor((ventana + 10) / fila));
  caja.style.height = filas * fila - 10 + 'px';
}

/** Mueve la lista por dentro lo justo para que el episodio enfocado se vea. */
function desplazarLista(caja: HTMLElement, episodio: HTMLElement) {
  const pista = caja.firstElementChild as HTMLElement | null;
  if (!pista) return;
  const ventana = caja.offsetHeight;
  const maximo = Math.max(0, pista.offsetHeight - ventana);
  const actualY = -(parseFloat((/translateY\((-?[0-9.]+)px\)/.exec(pista.style.transform || '') || ['', '0'])[1]) || 0);

  const arriba = episodio.offsetTop;
  const abajo = arriba + episodio.offsetHeight;
  let objetivo = actualY;
  if (arriba < actualY) objetivo = arriba;
  else if (abajo > actualY + ventana) objetivo = abajo - ventana;

  pista.style.transform = 'translateY(' + -Math.round(Math.max(0, Math.min(objetivo, maximo))) + 'px)';
}

function desplazarVertical(el: HTMLElement, nodo: Nodo | undefined) {
  const lienzo = document.querySelector<HTMLElement>('[data-lienzo]');
  if (!lienzo) return;

  /*
   * Temporadas y episodios: la pantalla se queda donde deja ver la ventana de
   * la lista (casi siempre, en su sitio). Sin esta rama caian en el
   * `if (!bloque) return` de abajo y la pantalla no se movia nunca, ni siquiera
   * al volver a la lista desde el reparto, que la dejaba por encima.
   */
  if (el.closest('.episodios')) {
    const caja = document.querySelector<HTMLElement>('[data-lista-episodios]');
    const y = caja ? Number(caja.getAttribute('data-y-lienzo') || 0) : 0;
    const tope = Math.max(0, lienzo.offsetHeight - 1080 + 80);
    lienzo.style.transform = 'translateY(' + -Math.round(Math.max(0, Math.min(y, tope))) + 'px)';
    return;
  }

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

  const lista = el.closest('[data-lista-episodios]') as HTMLElement | null;
  if (lista) desplazarLista(lista, el);

  desplazarVertical(el, nodo);
}

/**
 * Cuánto está desplazada la fila (carrusel) de un elemento, en píxeles.
 *
 * El índice guarda la posición en el documento, y las filas se mueven con
 * `translateX`: una tarjeta que está la cuarta en su fila puede verse la
 * primera si la fila está desplazada. Subir y bajar tiene que mirar dónde se
 * ve cada tarjeta, no dónde está en el documento; si no, desde la cuarta de
 * «Conciertos» se subía a la cuarta de «Documentales» aunque estuviera fuera
 * de la pantalla.
 */
function desplazamientoDe(el: HTMLElement): number {
  const carrusel = el.closest('[data-carrusel]');
  const pista = carrusel ? (carrusel.firstElementChild as HTMLElement | null) : null;
  if (!pista) return 0;
  const m = /translateX\((-?[0-9.]+)px\)/.exec(pista.style.transform || '');
  return m ? parseFloat(m[1]) : 0;
}

/** Mejor candidato en una dirección, dentro de la misma zona. */
function mejorEn(desde: Nodo, direccion: number, excluir?: HTMLElement): HTMLElement | null {
  let mejor: HTMLElement | null = null;
  let mejorCoste = Infinity;
  const vertical = direccion === TECLA.ARRIBA || direccion === TECLA.ABAJO;
  const xDesde = desde.x + (vertical ? desplazamientoDe(desde.el) : 0);

  // El desplazamiento de cada fila se lee una vez, no por tarjeta.
  const desplazamientos = new Map<Element, number>();
  const xVisible = (n: Nodo) => {
    if (!vertical) return n.x;
    const c = n.el.closest('[data-carrusel]');
    if (!c) return n.x;
    let d = desplazamientos.get(c);
    if (d === undefined) { d = desplazamientoDe(n.el); desplazamientos.set(c, d); }
    return n.x + d;
  };

  for (let i = 0; i < indice.length; i++) {
    const n = indice[i];
    if (n.el === desde.el || n.menu !== desde.menu) continue;
    if (excluir && excluir.contains(n.el)) continue;

    const dx = xVisible(n) - xDesde;
    const dy = n.y - desde.y;
    // Lo que está fuera de la pantalla por la izquierda no es candidato al
    // subir o bajar: no se ve, y el foco iría a una tarjeta invisible.
    if (vertical && xVisible(n) + n.ancho / 2 < 0) continue;

    /*
     * Al subir o bajar, el desvío se mide hasta el BORDE más cercano del
     * candidato, no hasta su centro. Con el centro, una fila ancha (la lista
     * de episodios, casi todo el ancho de la pantalla) queda con el centro
     * muy lejos del de una píldora de temporada estrecha, y bajar desde la
     * temporada salía disparado hasta el reparto —mucho más lejos, pero mejor
     * alineado con el centro— en vez de entrar en el episodio de justo
     * debajo. Restar la mitad del ancho no cambia nada para las tarjetas
     * estrechas (carátulas, píldoras): sigue haciendo falta salirse de su
     * franja para que el desvío deje de ser cero.
     */
    let avance: number;
    let desvio: number;
    if (direccion === TECLA.IZQUIERDA) { avance = -dx; desvio = Math.abs(dy); }
    else if (direccion === TECLA.DERECHA) { avance = dx; desvio = Math.abs(dy); }
    else if (direccion === TECLA.ARRIBA) { avance = -dy; desvio = Math.max(0, Math.abs(dx) - n.ancho / 2); }
    else { avance = dy; desvio = Math.max(0, Math.abs(dx) - n.ancho / 2); }

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

  const lista = foco.closest('[data-lista-episodios]') as HTMLElement | null;
  const vertical = direccion === TECLA.ARRIBA || direccion === TECLA.ABAJO;

  /*
   * Dentro de la lista se va de episodio en episodio, sin medir distancias: sus
   * posiciones son las del documento, y la lista se desplaza por dentro, asi que
   * el ultimo episodio «esta» muy por debajo de donde se ve.
   */
  if (lista && vertical) {
    const hermano = (direccion === TECLA.ABAJO ? foco.nextElementSibling : foco.previousElementSibling) as HTMLElement | null;
    if (hermano && hermano.hasAttribute('data-nav')) return hermano;
    if (direccion === TECLA.ABAJO) {
      // Salir por abajo: se parte del borde inferior de la ventana, no de donde
      // estaria el episodio si la lista no estuviera recortada.
      const borde = posicion(lista).y + lista.offsetHeight - desde.alto / 2;
      return mejorEn({ el: desde.el, x: desde.x, y: borde, ancho: desde.ancho, alto: desde.alto, menu: desde.menu }, direccion, lista);
    }
  }

  /*
   * Desde algo que esta POR DEBAJO de la lista, bajar no puede entrar en ella.
   * Los episodios profundos tienen, en el documento, coordenadas mas abajo que
   * el reparto -la lista esta recortada, pero sus filas no-, y bajar desde el
   * ultimo bloque los elegia como destino: se saltaba al primer episodio.
   */
  const cajaLista = document.querySelector<HTMLElement>('[data-lista-episodios]');
  const bajoLaLista = !!cajaLista && !lista && direccion === TECLA.ABAJO
    && desde.y > posicion(cajaLista).y + cajaLista.offsetHeight;
  const candidato = mejorEn(desde, direccion, bajoLaLista ? cajaLista! : undefined);

  /*
   * Entrar en la lista desde fuera: por arriba se cae en el primer episodio, y
   * por abajo -volviendo del reparto- en el ultimo. Medido por distancia se
   * caia en uno cualquiera del medio.
   */
  if (candidato && !lista && vertical) {
    const destino = candidato.closest('[data-lista-episodios]') as HTMLElement | null;
    if (destino) {
      const elegido = (direccion === TECLA.ABAJO ? destino.firstElementChild!.firstElementChild : destino.firstElementChild!.lastElementChild) as HTMLElement | null;
      if (elegido) return elegido;
    }
  }
  return candidato;
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
