/**
 * Logos de estudio que se lean sobre el fondo oscuro de la ficha sin perder su dibujo.
 *
 * Antes la tele les pasaba a todos `filter: brightness(0) invert(1)`: cada píxel visible a blanco. Para un logo de texto
 * negro (casi todos los de TMDb) da lo mismo, pero el león de MGM —dorado y lleno de detalle— salía como una mancha blanca.
 * Ahora se mira cada logo UNA vez: si lo que se ve de él es oscuro, se guarda una versión con la luminosidad invertida (el negro
 * pasa a blanco, un azul marino a azul claro, y el dibujo se conserva); si ya es claro o tiene color, se sirve tal cual.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { config, DATA_DIR } from '../config.ts';

const ejecutar = promisify(execFile);

/** Por debajo de esta luminosidad (0-255) de lo que se ve, el logo no se leería sobre fondo oscuro. */
export const UMBRAL_OSCURO = 100;

/**
 * Luminosidad media de los píxeles que se ven (alfa > 128) en un volcado RGBA; NaN si no hay ninguno.
 * Medido el 19/10/2026: EON, United Artists, Columbia, Pixar y Walt Disney Pictures dan 0 (texto negro); Walt Disney
 * Animation Studios, 31; el león de MGM, 126.
 */
export function lumaVisible(rgba: Uint8Array): number {
  let n = 0;
  let suma = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] <= 128) continue;
    n++;
    suma += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return n ? suma / n : NaN;
}

/**
 * Mediana de la misma luminosidad. Se usa JUNTO a la media, no en vez de ella: la media la arruina un logo con una
 * silueta negra DE ADORNO junto a un dibujo que ya se lee (Gracie Films: pantalla azul + público en silueta negra —
 * media 78, bajo el umbral, pero la mediana da 104 porque más de la mitad de lo visible ya se lee; invertirlo entero
 * lo dejaba en un cian deslavado, comprobado el 03/11/2026 sirviendo esa imagen tal cual y con el filtro). Usar SOLO
 * la mediana habría sido peor: con NBC (plumas de color + «NBC» en negro, mediana 100) ya iba justa, pero con Marvel
 * Studios (caja roja/blanca con «STUDIOS» en negro sobre blanco, mediana 84, media 112) habría invertido un logo que
 * ya se lee perfectamente, dejando «STUDIOS» casi invisible por blanco-sobre-gris-claro. Exigir que las DOS midan
 * oscuro evita ese caso: solo se deja de aclarar cuando la mediana lo desmiente, nunca se empieza a aclarar algo que
 * la media ya daba por bueno.
 */
export function medianaLumaVisible(rgba: Uint8Array): number {
  const valores: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] <= 128) continue;
    valores.push(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]);
  }
  if (!valores.length) return NaN;
  valores.sort((a, b) => a - b);
  return valores[Math.floor(valores.length / 2)];
}

// v4 (19/10/2026): dorado para los que no tienen color; aclarado que conserva el color para los oscuros con color.
// v5 (26/10/2026): se hace sobre el logo ya recortado. Las carpetas de versiones anteriores quedan sin usar.
// v7: descartada (una v7 de prueba salió con la mediana SOLA, sin la media — rompía Marvel Studios). No reutilizar.
// v8 (03/11/2026): «oscuro» exige que la media Y la mediana lo digan (ver medianaLumaVisible) — Gracie Films y NBC
// dejan de invertirse sin necesidad, sin tocar los que ya estaban bien (Marvel Studios entre ellos). Carpeta nueva
// para forzar que los 612 logos ya procesados se rehagan con la regla nueva.
// v9 (03/11/2026): 26 logos que no tenían color en TMDb se sustituyeron por una versión en color real (TMDb
// `original` no tenía alternativa; Wikidata/Commons sí para algunos, Wikipedia directa para el resto, verificados
// uno a uno a mano contra el nombre real de la empresa — una búsqueda automática sin esa comprobación coló el logo
// de otra «Intermedia» rusa y hasta un sello postal de Mosfilm). Carpeta nueva para que se regeneren.
// v10 (04/11/2026): pintarParaFondoOscuro en vez de invertir la imagen entera, que lavaba los colores. Recorte v2 porque
// se sustituyeron logos: el recorte se recuerda por nombre y seguiría sirviendo el dibujo anterior.
const DIR_CLARO = join(DATA_DIR, 'artwork', 'studios-claro-v10');
const DIR_RECORTE = join(DATA_DIR, 'artwork', 'studios-recorte-v2');

/**
 * Caja de lo que se ve (alfa > 16) con 2 px de aire, o null si no hay margen que quitar (ningún lado pasa del 3 %).
 * Medido el 26/10/2026 sobre los 806 logos: 51 traen más de un 5 % de lienzo vacío en algún lado y 11 usan menos de la
 * mitad (Intermedia, el 22 %). Ese vacío salía en las fichas como un margen raro alrededor del logo.
 */
export function cajaVisible(rgba: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] <= 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const sobra = Math.max(x0, w - 1 - x1) / w > 0.03 || Math.max(y0, h - 1 - y1) / h > 0.03;
  if (!sobra) return null;
  const x = Math.max(0, x0 - 2), y = Math.max(0, y0 - 2);
  return { x, y, w: Math.min(w, x1 + 3) - x, h: Math.min(h, y1 + 3) - y };
}

/** El logo sin el lienzo vacío de alrededor. Se decide una vez y se recuerda; el original no se toca. */
export async function sinMargen(ruta: string): Promise<string> {
  const base = basename(ruta, extname(ruta));
  const recortado = join(DIR_RECORTE, base + '.webp');
  const talCual = join(DIR_RECORTE, base + '.tal-cual');
  if (existsSync(recortado)) return recortado;
  if (existsSync(talCual)) return ruta;
  mkdirSync(DIR_RECORTE, { recursive: true });
  try {
    const { stdout: dim } = await ejecutar(config.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ruta],
      { timeout: 15_000, windowsHide: true });
    const [w, h] = String(dim).trim().split(',').map(Number);
    if (!(w > 0 && h > 0)) return ruta;
    const { stdout } = await ejecutar(config.ffmpeg, ['-v', 'error', '-i', ruta, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
      { encoding: 'buffer', maxBuffer: w * h * 4 + 1024, timeout: 20_000, windowsHide: true });
    const caja = cajaVisible(stdout, w, h);
    if (!caja) {
      writeFileSync(talCual, '');
      return ruta;
    }
    await ejecutar(config.ffmpeg, ['-v', 'error', '-y', '-i', ruta, '-vf', `crop=${caja.w}:${caja.h}:${caja.x}:${caja.y}`, '-c:v', 'libwebp', '-q:v', '90', recortado],
      { timeout: 60_000, windowsHide: true });
    return existsSync(recortado) ? recortado : ruta;
  } catch {
    return ruta;
  }
}

/** Saturación media (0-1) de lo que se ve: por debajo de 0,15 el logo no tiene color propio (blanco, negro o gris). */
export function saturacionVisible(rgba: Uint8Array): number {
  let n = 0;
  let suma = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] <= 128) continue;
    n++;
    const mx = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    const mn = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    suma += mx ? (mx - mn) / mx : 0;
  }
  return n ? suma / n : 0;
}

export const UMBRAL_SIN_COLOR = 0.15;

/**
 * El logo es una caja opaca: el 90 % o más de lo que hay dentro del recuadro de lo visible no es transparente. Dentro del
 * recuadro y no en todo el lienzo: Platinum Dunes es una caja con margen transparente y en el lienzo entero da un 65 %.
 * Medido el 29/10/2026 en los 815 logos (sobre el lienzo entero): 82 pasan del 90 % y la cuenta apenas cambia hasta 0,99.
 */
export function cajaOpaca(rgba: Uint8Array, w: number): boolean {
  const h = w > 0 ? Math.floor(rgba.length / 4 / w) : 0;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] <= 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return false;
  let opacos = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (rgba[(y * w + x) * 4 + 3] > 240) opacos++;
  return opacos / ((x1 - x0 + 1) * (y1 - y0 + 1)) >= 0.9;
}

/*
 * Se invierte SOLO la luminosidad (Y) y se deja el color (U, V) y el alfa: el negro pasa a blanco y un azul marino
 * (DreamWorks Animation) a azul claro; con hue=s=0 + negate todo quedaba en grises. Con un mínimo de 205: un rojo oscuro
 * (Malpaso, luminosidad 96) invertido se quedaba en un gris medio que no se leía.
 */
const ACLARAR = "format=yuva444p,lutyuv=y='max(255-val\\,205)'";

/*
 * Dorado metalizado suave para los logos sin color (pedido el 19/10/2026: los blancos «se ven aburridos»): cada canal del
 * logo, ya claro, por el tono del oro (1; 0,83; 0,52) y por un brillo vertical que sube hacia el tercio de arriba y baja
 * hacia el pie, como un metal pulido. geq va píxel a píxel, pero se hace una vez por logo y a 800 px como mucho.
 */
const BRILLO = '(0.80+0.25*cos(2*PI*(Y/H-0.3)))';
const DORADO = "format=rgba,geq=r='min(255\\,r(X\\,Y)*1.00*" + BRILLO + ")':g='min(255\\,g(X\\,Y)*0.83*" + BRILLO +
  ")':b='min(255\\,b(X\\,Y)*0.52*" + BRILLO + ")':a='alpha(X\\,Y)'";

const FONDO_FICHA: [number, number, number] = [20, 22, 28];
const lineal = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminancia = (r: number, g: number, b: number) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
const LUMINANCIA_FONDO = luminancia(...FONDO_FICHA);
/** Contraste WCAG contra el fondo de la ficha; 3 es el mínimo que se lee en un elemento grande. */
function contrasteConFondo(r: number, g: number, b: number): number {
  const l = luminancia(r, g, b);
  return (Math.max(l, LUMINANCIA_FONDO) + 0.05) / (Math.min(l, LUMINANCIA_FONDO) + 0.05);
}

function aHsl(r0: number, g0: number, b0: number): [number, number, number] {
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function deHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [a, b, d] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(a + m) * 255, (b + m) * 255, (d + m) * 255];
}

/** El mismo tono con la luz justa para leerse: lo mínimo, para que un azul marino siga siendo azul y no celeste. */
function aclararConservandoTono(r: number, g: number, b: number): [number, number, number] {
  const [h, s, l] = aHsl(r, g, b);
  const sat = Math.max(s, 0.6);
  let bajo = l, alto = 0.9;
  for (let i = 0; i < 10; i++) {
    const medio = (bajo + alto) / 2;
    if (contrasteConFondo(...deHsl(h, sat, medio)) < 3.6) bajo = medio; else alto = medio;
  }
  return deHsl(h, sat, Math.min(0.92, alto * (0.9 + 0.2 * Math.min(1, l / alto))));
}

const NEUTRO_LEGIBLE = 1, CON_COLOR = 2, NEUTRO_OSCURO = 3;

/**
 * Prepara un logo para el fondo oscuro píxel a píxel. Invertir la imagen entera lavaba los colores (Universal y Paramount
 * salían en pastel) y dejaba ilegibles otros (ABC, Cine+). Sin color: dorado. Con color: el negro suelto se aclara (texto
 * de Marvel Studios), el negro rodeado de color se deja porque es dibujo o fondo de otra cosa, y el color oscuro se aclara
 * con su tono, salvo si la mayor parte ya se lee (Warner: 57 %), que se respeta.
 */
export function pintarParaFondoOscuro(fuente: Uint8Array, w: number, h: number): { rgba: Uint8ClampedArray; cambio: boolean } | null {
  const px = new Uint8ClampedArray(fuente);
  const n = w * h;
  let alfaMax = 0;
  for (let i = 0; i < n; i++) if (px[i * 4 + 3] > alfaMax) alfaMax = px[i * 4 + 3];
  if (!alfaMax) return null;
  let cambio = false;
  if (alfaMax < 220) {
    const k = 255 / alfaMax;
    for (let i = 0; i < n; i++) px[i * 4 + 3] = px[i * 4 + 3] * k;
    cambio = true;
  }
  const clase = new Uint8Array(n);
  let visibles = 0, conColor = 0, legibles = 0;
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3];
    if (!a) continue;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], max = Math.max(r, g, b), min = Math.min(r, g, b);
    const seLee = contrasteConFondo(r, g, b) >= 3;
    if (a > 128) { visibles++; if (seLee) legibles++; }
    if (max >= 30 && (max - min) / max >= 0.25) { clase[i] = CON_COLOR; if (a > 128) conColor++; } else clase[i] = seLee ? NEUTRO_LEGIBLE : NEUTRO_OSCURO;
  }
  // Tabla integral de lo que se ve y no es negro: dice en O(1) si un trozo oscuro está rodeado de dibujo.
  const tabla = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let fila = 0;
    for (let x = 0; x < w; x++) {
      const k = clase[y * w + x];
      if ((k === NEUTRO_LEGIBLE || k === CON_COLOR) && px[(y * w + x) * 4 + 3] > 128) fila++;
      tabla[(y + 1) * (w + 1) + x + 1] = tabla[y * (w + 1) + x + 1] + fila;
    }
  }
  const dibujoEn = (x0: number, y0: number, x1: number, y1: number) =>
    tabla[(y1 + 1) * (w + 1) + x1 + 1] - tabla[y0 * (w + 1) + x1 + 1] - tabla[(y1 + 1) * (w + 1) + x0] + tabla[y0 * (w + 1) + x0];
  const vistos = new Uint8Array(n), rescatar = new Uint8Array(n), pila = new Int32Array(n);
  for (let inicio = 0; inicio < n; inicio++) {
    if (clase[inicio] !== NEUTRO_OSCURO || vistos[inicio]) continue;
    let cima = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, suelto = false;
    const trozo: number[] = [];
    pila[cima++] = inicio;
    vistos[inicio] = 1;
    while (cima) {
      const i = pila[--cima];
      trozo.push(i);
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) suelto = true;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0) continue;
        if (!clase[j]) suelto = true;
        else if (clase[j] === NEUTRO_OSCURO && !vistos[j]) { vistos[j] = 1; pila[cima++] = j; }
      }
    }
    if (suelto && dibujoEn(x0, y0, x1, y1) / ((x1 - x0 + 1) * (y1 - y0 + 1)) < 0.08) for (const i of trozo) rescatar[i] = 1;
  }
  const sinColor = visibles > 0 && conColor / visibles < 0.05;
  const yaSeLee = visibles > 0 && legibles / visibles >= 0.5;
  const luz = (i: number) => 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
  let luzMax = 0;
  if (sinColor) for (let i = 0; i < n; i++) if (clase[i] === NEUTRO_LEGIBLE && luz(i) > luzMax) luzMax = luz(i);
  for (let i = 0; i < n; i++) {
    const k = clase[i];
    if (!k) continue;
    if (sinColor) {
      if (!rescatar[i] && k !== NEUTRO_LEGIBLE) continue;
      const v = rescatar[i] ? Math.max(255 - luz(i), 205) : 150 + 105 * Math.max(0, luz(i) - 70) / Math.max(1, luzMax - 70);
      const brillo = 0.80 + 0.25 * Math.cos(2 * Math.PI * (((i - (i % w)) / w) / h - 0.3));
      px[i * 4] = v * brillo; px[i * 4 + 1] = v * 0.83 * brillo; px[i * 4 + 2] = v * 0.52 * brillo;
      cambio = true;
    } else if (rescatar[i]) {
      const v = Math.max(255 - luz(i), 205);
      px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v;
      cambio = true;
    } else if (!yaSeLee && k === CON_COLOR && contrasteConFondo(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) < 3) {
      const [a, b, c] = aclararConservandoTono(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      px[i * 4] = a; px[i * 4 + 1] = b; px[i * 4 + 2] = c;
      cambio = true;
    }
  }
  return { rgba: px, cambio };
}

/** Revisados a ojo el 04/11/2026: con pintarParaFondoOscuro se ven peor que invirtiéndolos, así que siguen con el filtro anterior. */
const CON_FILTRO_ANTERIOR = new Set(['bona-fide-productions', 'double-edge-films', 'nostromo-pictures', 'winkler-films', 'cinergi-pictures',
  'mythology-entertainment', 'g-base', 'pressman-film', 'the-cannon-group']);

async function guardarWebp(rgba: Uint8ClampedArray, w: number, h: number, destino: string): Promise<void> {
  await new Promise<void>((bien, mal) => {
    const p = spawn(config.ffmpeg, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', w + 'x' + h, '-i', '-', '-c:v', 'libwebp', '-q:v', '90', destino],
      { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, timeout: 60_000 });
    p.on('error', mal);
    p.stdin.on('error', () => undefined);
    p.on('close', (c) => (c === 0 ? bien() : mal(new Error('ffmpeg salió con ' + c))));
    p.stdin.end(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
  });
}

/** El logo para fondo oscuro: la versión pintada si hace falta, o el mismo fichero. Se decide una vez y se recuerda. */
export async function versionClara(ruta: string): Promise<string> {
  const base = basename(ruta, extname(ruta));
  const claro = join(DIR_CLARO, base + '.webp');
  const talCual = join(DIR_CLARO, base + '.tal-cual');
  if (existsSync(claro)) return claro;
  if (existsSync(talCual)) return ruta;
  mkdirSync(DIR_CLARO, { recursive: true });
  try {
    if (!CON_FILTRO_ANTERIOR.has(base)) {
      const { stdout: dim } = await ejecutar(config.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ruta],
        { timeout: 15_000, windowsHide: true });
      let [w, h] = String(dim).trim().split(',').map(Number);
      if (!(w > 0 && h > 0)) return ruta;
      if (w > 800) { h = Math.max(2, Math.round(h * 800 / w / 2) * 2); w = 800; }
      const { stdout } = await ejecutar(config.ffmpeg, ['-v', 'error', '-i', ruta, '-vf', 'scale=' + w + ':' + h, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
        { encoding: 'buffer', maxBuffer: w * h * 4 + 1024, timeout: 30_000, windowsHide: true });
      const pintado = cajaOpaca(stdout, w) ? null : pintarParaFondoOscuro(stdout, w, h);
      if (!pintado || !pintado.cambio) {
        writeFileSync(talCual, '');
        return ruta;
      }
      await guardarWebp(pintado.rgba, w, h, claro);
      return existsSync(claro) ? claro : ruta;
    }
    const { stdout } = await ejecutar(config.ffmpeg, ['-v', 'error', '-i', ruta, '-vf', 'scale=64:-1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
      { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 20_000, windowsHide: true });
    const oscuro = lumaVisible(stdout) < UMBRAL_OSCURO && medianaLumaVisible(stdout) < UMBRAL_OSCURO;
    const sinColor = saturacionVisible(stdout) < UMBRAL_SIN_COLOR;
    // Con color y claro (Warner, Pixar, Marvel…): tal cual. Oscuro: se aclara. Sin color: dorado (aclarado antes si es oscuro).
    // Una caja opaca (Crystal Lake, Platinum Dunes, Canal+) ya trae su fondo y se lee: tal cual (29/10/2026).
    if (cajaOpaca(stdout, 64) || (!oscuro && !sinColor)) {
      writeFileSync(talCual, '');
      return ruta;
    }
    const filtros = ["scale='min(800\\,iw)':-2"];
    if (oscuro) filtros.push(ACLARAR);
    if (sinColor) filtros.push(DORADO);
    await ejecutar(config.ffmpeg, ['-v', 'error', '-y', '-i', ruta, '-vf', filtros.join(','), '-c:v', 'libwebp', '-q:v', '90', claro],
      { timeout: 60_000, windowsHide: true });
    return existsSync(claro) ? claro : ruta;
  } catch {
    // Sin ffmpeg o con un fichero raro: mejor el original que nada (no se recuerda, se reintenta la próxima vez).
    return ruta;
  }
}

const aspectos = new Map<string, number>();

/** Ancho / alto del logo, para que los clientes sin el logo a mano (Android) decidan el sitio. Se mide una vez. */
export async function aspectoDe(ruta: string): Promise<number> {
  const hecho = aspectos.get(ruta);
  if (hecho !== undefined) return hecho;
  let a = 0;
  try {
    const { stdout } = await ejecutar(config.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ruta],
      { timeout: 15_000, windowsHide: true });
    const [w, h] = String(stdout).trim().split(',').map(Number);
    if (w > 0 && h > 0) a = Math.round((w / h) * 1000) / 1000;
  } catch { /* sin medida: el cliente usa un cuadrado */ }
  if (a > 0) aspectos.set(ruta, a);
  return a || 1;
}

const huellas = new Map<string, string>();

/**
 * Huella del CONTENIDO de un logo. Dos estudios distintos pueden dar dos ficheros con la misma imagen (en «Collateral»,
 * «Parkes» y «MacDonald Productions» son una sola productora, «Parkes/MacDonald Productions», partida por la barra): quitar
 * repetidos por nombre de fichero no los veía y salía el logo dos veces (visto el 19/10/2026).
 */
export function huellaDe(ruta: string): string {
  const h = huellas.get(ruta);
  if (h) return h;
  let v = ruta;
  try { v = createHash('md5').update(readFileSync(ruta)).digest('hex'); } catch { /* sin fichero: se queda la ruta */ }
  huellas.set(ruta, v);
  return v;
}
