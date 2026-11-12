/**
 * Colocación de los logos de productoras en la ficha de la tele.
 *
 * El problema que resuelve (12/11/2026, «Project Hail Mary», cinco logos): la caja flotaba a la derecha, bajo la carátula,
 * y se ensanchaba hacia la izquierda «donde no hay nada». Sí había algo: la sinopsis llega hasta x≈1170 y la fila de
 * botones —siete, 1.261 px— hasta x≈1411. Los logos salían encima de los botones, de la etiqueta de audio y de la
 * sinopsis, amontonados.
 *
 * Ahora no se supone nada: se MIDE lo que hay en pantalla (obstáculos), se buscan los huecos libres a la derecha y se
 * elige la disposición (cuántas filas) que deja los logos más grandes sin pisar a nadie. Nunca se descarta un logo: si no
 * cabe, se encogen todos por igual.
 *
 * Sin dependencias, para poder probarlo con `node --test` (tv/test/logos.test.mjs). Compila a ES2016: la tele es Chrome 76.
 */

export type Tam = { w: number; h: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
/** Un hueco libre anclado a la derecha: desde `izq` hasta el borde derecho de la caja, `alto` px hacia abajo. */
export type Region = { izq: number; ancho: number; alto: number };
export type Disposicion = { k: number; filas: number[][]; ancho: number; alto: number };

/** Hueco entre logos de una misma fila y entre filas (igual que el CSS de .fila-logos-estudio). */
export const HUECO_X = 28;
export const HUECO_Y = 20;
/** Aire que se deja a cada obstáculo: a los lados y por arriba. */
export const MARGEN_X = 28;
export const MARGEN_Y = 14;
/** Ancho máximo de la caja: más no aporta, los logos ya salen grandes. */
export const ANCHO_MAX_CAJA = 960;
/** Una región más estrecha que esto no sirve para nada. */
const ANCHO_MIN_REGION = 160;

// Áreas de partida (px²). Un logo solo, el más grande (se pidió más pequeño el 19/10/2026: 12.000 -> 9.500); varios, todos
// con la misma área; los muy alargados (4:1 o más, el texto de DreamWorks Pictures, 11:1) con algo más para que se lean.
const AREA_SOLO = 9500;
const AREA_VARIOS = 18000;
const AREA_LARGO = 24000;

/** Tamaño «natural» de un logo de proporción `r` (ancho/alto), antes de encogerlo para que quepa. */
export function tamanoBase(r: number, solo: boolean): Tam {
  const prop = r > 0 && isFinite(r) ? r : 1;
  const largo = !solo && prop >= 4;
  const maxW = solo ? 280 : largo ? 480 : 300;
  const maxH = solo ? 95 : 110;
  const area = solo ? AREA_SOLO : largo ? AREA_LARGO : AREA_VARIOS;
  let w = Math.sqrt(area * prop);
  let h = w / prop;
  if (w > maxW) { w = maxW; h = w / prop; }
  if (h > maxH) { h = maxH; w = h * prop; }
  return { w: w, h: h };
}

/** Reparte `n` elementos en `nf` filas lo más iguales posible, conservando el orden. */
function repartir(n: number, nf: number): number[][] {
  const filas: number[][] = [];
  let i = 0;
  for (let f = 0; f < nf; f++) {
    const m = Math.floor(n / nf) + (f < n % nf ? 1 : 0);
    const fila: number[] = [];
    for (let j = 0; j < m; j++) fila.push(i++);
    filas.push(fila);
  }
  return filas;
}

/**
 * La mejor forma de colocar `tam` en un hueco de `W` x `H`: se prueban todos los números de filas posibles y se queda la que
 * permite el MAYOR factor de escala `k` (tope 1: nunca más grandes que su tamaño natural). A igualdad, la de menos filas.
 * Devuelve null si ni encogiendo cabe (hueco sin sitio).
 */
export function mejorDisposicion(tam: Tam[], W: number, H: number): Disposicion | null {
  const n = tam.length;
  if (!n || W <= 0 || H <= 0) return null;
  let mejor: Disposicion | null = null;
  for (let nf = 1; nf <= n; nf++) {
    const filas = repartir(n, nf);
    let kAncho = Infinity;
    let altoNatural = 0;
    for (let f = 0; f < filas.length; f++) {
      let suma = 0;
      let alto = 0;
      for (let j = 0; j < filas[f].length; j++) {
        suma += tam[filas[f][j]].w;
        alto = Math.max(alto, tam[filas[f][j]].h);
      }
      kAncho = Math.min(kAncho, (W - HUECO_X * (filas[f].length - 1)) / suma);
      altoNatural += alto;
    }
    const kAlto = (H - HUECO_Y * (nf - 1)) / altoNatural;
    const k = Math.min(1, kAncho, kAlto);
    if (!(k > 0)) continue;
    let ancho = 0;
    for (let f = 0; f < filas.length; f++) {
      let s = HUECO_X * (filas[f].length - 1);
      for (let j = 0; j < filas[f].length; j++) s += tam[filas[f][j]].w * k;
      ancho = Math.max(ancho, s);
    }
    const disp: Disposicion = { k: k, filas: filas, ancho: ancho, alto: altoNatural * k + HUECO_Y * (nf - 1) };
    if (!mejor || disp.k > mejor.k + 1e-9) mejor = disp;
  }
  return mejor;
}

/**
 * Huecos libres a la derecha. `top` es donde empieza la caja, `limite` hasta dónde puede bajar (justo antes del reparto o de
 * los episodios) y `derecha` su borde derecho. Cada obstáculo que cae en la banda [top, bottom] empuja hacia la derecha el
 * borde izquierdo. Si el obstáculo es ancho y bajo (los botones), también sale un hueco MÁS CORTO que acaba justo encima de él:
 * a veces es mejor un hueco ancho y bajo que uno estrecho y alto.
 */
export function regionesLibres(obst: Rect[], top: number, limite: number, derecha: number): Region[] {
  const banda = obst.filter(function (o) { return o.bottom > top && o.top < limite && o.right > o.left && o.bottom > o.top; });
  const fondos: number[] = [limite];
  banda.forEach(function (o) {
    const f = o.top - MARGEN_Y;
    if (f - top >= 50) fondos.push(f);
  });
  const regiones: Region[] = [];
  fondos.forEach(function (fondo) {
    let izq = derecha - ANCHO_MAX_CAJA;
    banda.forEach(function (o) {
      if (o.top < fondo && o.bottom > top) izq = Math.max(izq, o.right + MARGEN_X);
    });
    const ancho = derecha - izq;
    if (ancho >= ANCHO_MIN_REGION && fondo - top > 0) regiones.push({ izq: izq, ancho: ancho, alto: fondo - top });
  });
  return regiones;
}

/**
 * Entre todos los huecos, el que deja los logos más grandes. `reservado` es lo que ocupa el rótulo «Producida por» (se resta
 * del alto). Si no hay hueco que sirva, un último recurso: la columna de la carátula (280 px), que es donde iba un logo solo.
 */
export function elegir(tam: Tam[], regiones: Region[], derecha: number, top: number, limite: number, reservado: number):
  { region: Region; disp: Disposicion } | null {
  let mejor: { region: Region; disp: Disposicion } | null = null;
  const candidatas = regiones.length ? regiones : [{ izq: derecha - 280, ancho: 280, alto: Math.max(0, limite - top) }];
  candidatas.forEach(function (r) {
    const d = mejorDisposicion(tam, r.ancho, r.alto - reservado);
    if (!d) return;
    if (!mejor || d.k > mejor.disp.k + 1e-9 || (Math.abs(d.k - mejor.disp.k) <= 1e-9 && d.filas.length < mejor.disp.filas.length)) {
      mejor = { region: r, disp: d };
    }
  });
  return mejor;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Lo que toca el DOM. Está aquí, junto a lo demás, pero la parte de arriba no lo necesita.                           */
/* ------------------------------------------------------------------------------------------------------------------ */

function interseccion(a: Rect, b: Rect): Rect {
  return {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  };
}

function aRect(r: ClientRect | DOMRect): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/**
 * Lo que de verdad ocupa cada bloque del cuerpo de la ficha. NO sirve el rectángulo del elemento: la sinopsis es un bloque de
 * 1.020 px aunque el texto solo llegue a la mitad, y la fila de acciones declara 1.400 px. Se mide el contenido: el texto con
 * un Range (recortado al elemento, porque `-webkit-line-clamp` deja las líneas ocultas en el diseño) y los botones uno a uno.
 */
export function medirObstaculos(cuerpo: HTMLElement): Rect[] {
  const salida: Rect[] = [];
  for (let i = 0; i < cuerpo.children.length; i++) {
    const el = cuerpo.children[i] as HTMLElement;
    const caja = el.getBoundingClientRect();
    if (caja.width <= 0 || caja.height <= 0) continue;
    if (el.classList.contains('acciones')) {
      const botones = el.querySelectorAll('.boton');
      let der = caja.left;
      for (let j = 0; j < botones.length; j++) der = Math.max(der, botones[j].getBoundingClientRect().right);
      salida.push({ left: caja.left, top: caja.top, right: der, bottom: caja.bottom });
      continue;
    }
    if (el.tagName === 'IMG') { salida.push(aRect(caja)); continue; }
    const rango = document.createRange();
    rango.selectNodeContents(el);
    const texto = interseccion(aRect(rango.getBoundingClientRect()), aRect(caja));
    salida.push(texto.right > texto.left && texto.bottom > texto.top ? texto : aRect(caja));
  }
  return salida;
}

/**
 * Coloca las imágenes `imgs` dentro de `caja` en filas, en el mejor hueco libre de la ficha. Devuelve false si no hay hueco
 * (y entonces mejor ocultar la caja que dejar los logos encima de los botones). Se puede llamar más de una vez: rehace las filas.
 *
 * `fondo`: hasta dónde pueden bajar si no hay reparto ni episodios debajo que marquen el límite.
 */
export function colocarFilas(caja: HTMLElement, rotulo: HTMLElement, marco: HTMLElement, imgs: HTMLImageElement[], fondo: number): boolean {
  const solo = imgs.length === 1;
  // Re-colocación: sacar las imágenes de sus filas antes de rehacerlas.
  Array.prototype.slice.call(caja.querySelectorAll('.fila-logos-estudio')).forEach(function (f: HTMLElement) {
    while (f.firstChild) caja.appendChild(f.firstChild);
    caja.removeChild(f);
  });
  const cuerpo = marco.querySelector('.ficha-cuerpo') as HTMLElement | null;
  const cajaRect = caja.getBoundingClientRect();
  const repartoEl = marco.querySelector('.reparto') as HTMLElement | null;
  const episodiosEl = marco.querySelector('.episodios') as HTMLElement | null;
  let limite = repartoEl ? repartoEl.getBoundingClientRect().top - MARGEN_Y : fondo;
  if (episodiosEl) limite = Math.min(limite, episodiosEl.getBoundingClientRect().top - MARGEN_Y);
  const tam = imgs.map(function (img) { return tamanoBase(img.naturalWidth / img.naturalHeight || 1, solo); });
  const eleccion = elegir(
    tam,
    regionesLibres(cuerpo ? medirObstaculos(cuerpo) : [], cajaRect.top, limite, cajaRect.right),
    cajaRect.right, cajaRect.top, limite, rotulo.offsetHeight + 12,
  );
  if (!eleccion) return false;
  const disp = eleccion.disp;
  // Un logo solo conserva su columna de siempre (280 px, centrada bajo la carátula); varios, el ancho de lo que ocupan.
  caja.style.width = Math.round(Math.max(disp.ancho, solo ? 280 : 200)) + 'px';
  disp.filas.forEach(function (f, n) {
    const fila = document.createElement('div');
    fila.className = 'fila-logos-estudio';
    fila.style.height = Math.round(Math.max.apply(null, f.map(function (i) { return tam[i].h * disp.k; }))) + 'px';
    if (n) fila.style.marginTop = HUECO_Y + 'px';
    f.forEach(function (i) {
      const img = imgs[i];
      img.style.width = Math.round(tam[i].w * disp.k) + 'px';
      img.style.height = Math.round(tam[i].h * disp.k) + 'px';
      fila.appendChild(img);
      img.classList.add('listo');
    });
    caja.appendChild(fila);
  });
  return true;
}
