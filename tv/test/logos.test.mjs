// Colocación de los logos de productoras (tv/src/logos.ts). `node --test` importa el .ts tal cual.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tamanoBase, mejorDisposicion, regionesLibres, elegir, HUECO_X, HUECO_Y, MARGEN_X, ANCHO_MAX_CAJA,
} from '../src/logos.ts';

const DERECHA = 1815; // borde derecho de la caja: right: 105px sobre 1920
const TOP = 455;      // justo bajo la carátula (70 + 365 = 435)
const RESERVADO = 42; // rótulo «Producida por» + su margen

/** Rectángulos finales de cada logo, como los dejaría main.ts: caja anclada a la derecha, filas centradas. */
function rectangulos(tam, region, disp) {
  const anchoCaja = Math.max(disp.ancho, 280);
  const izq = DERECHA - anchoCaja;
  const salida = new Array(tam.length);
  let y = TOP + RESERVADO;
  for (const fila of disp.filas) {
    const altoFila = Math.max(...fila.map((i) => tam[i].h * disp.k));
    const anchoFila = fila.reduce((s, i) => s + tam[i].w * disp.k, 0) + HUECO_X * (fila.length - 1);
    let x = izq + (anchoCaja - anchoFila) / 2;
    for (const i of fila) {
      const w = tam[i].w * disp.k, h = tam[i].h * disp.k;
      salida[i] = { left: x, top: y + (altoFila - h) / 2, right: x + w, bottom: y + (altoFila - h) / 2 + h };
      x += w + HUECO_X;
    }
    y += altoFila + HUECO_Y;
  }
  return salida;
}

const choca = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// La ficha de «Project Hail Mary» (12/11/2026), con lo que se midió de ella: sinopsis hasta x=1170, las etiquetas de audio
// debajo, siete botones hasta x=1411, y el reparto desde y=960.
const HAIL_MARY_OBSTACULOS = [
  { left: 150, top: 330, right: 1170, bottom: 520 },   // sinopsis, 3 líneas
  { left: 150, top: 540, right: 1090, bottom: 600 },   // etiquetas técnicas y de pista
  { left: 150, top: 800, right: 1411, bottom: 930 },   // acciones
];
const LIMITE = 960 - 14;
// proporciones ancho/alto aproximadas de los cinco logos de la foto: escudo, Amazon MGM, Pascal, Open Invite, Waypoint
const HAIL_MARY_PROPORCIONES = [1.15, 3.4, 2.6, 1.55, 3.1];

test('un logo solo no pasa de 280 x 95 y conserva la proporción', () => {
  for (const r of [0.5, 1, 2, 3.5, 8, 11]) {
    const t = tamanoBase(r, true);
    assert.ok(t.w <= 280.001 && t.h <= 95.001, `r=${r}: ${t.w}x${t.h}`);
    assert.ok(Math.abs(t.w / t.h - r) < 1e-6);
  }
});

test('un logo muy alargado (DreamWorks, 11:1) sale más ancho que uno normal, pero no pasa de 480', () => {
  const largo = tamanoBase(11, false), normal = tamanoBase(2, false);
  assert.ok(largo.w > normal.w && largo.w <= 480.001);
});

test('una proporción rota (0, NaN, Infinity) no revienta ni da tamaños absurdos', () => {
  for (const r of [0, NaN, Infinity, -3]) {
    const t = tamanoBase(r, false);
    assert.ok(isFinite(t.w) && isFinite(t.h) && t.w > 0 && t.h > 0);
  }
});

test('mejorDisposicion: nunca se sale del hueco, no pierde ni repite logos y conserva el orden (500 casos)', () => {
  let semilla = 12345;
  const azar = () => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla / 0x7fffffff; };
  for (let caso = 0; caso < 500; caso++) {
    const n = 1 + Math.floor(azar() * 8);
    const tam = Array.from({ length: n }, () => tamanoBase(0.4 + azar() * 11, n === 1));
    const W = 200 + azar() * 800, H = 80 + azar() * 400;
    const d = mejorDisposicion(tam, W, H);
    assert.ok(d, `sin disposición (n=${n} W=${W} H=${H})`);
    assert.ok(d.k > 0 && d.k <= 1 + 1e-9);
    assert.ok(d.ancho <= W + 1e-6, `ancho ${d.ancho} > ${W}`);
    assert.ok(d.alto <= H + 1e-6, `alto ${d.alto} > ${H}`);
    assert.deepEqual(d.filas.flat(), Array.from({ length: n }, (_, i) => i));
  }
});

test('con sitio de sobra, los logos salen a su tamaño natural (k = 1) y 2 logos van uno al lado del otro', () => {
  const tam = [tamanoBase(2, false), tamanoBase(2.5, false)];
  const d = mejorDisposicion(tam, 900, 400);
  assert.equal(d.k, 1);
  assert.equal(d.filas.length, 1);
});

test('si el hueco es bajo pero ancho, prefiere menos filas; si es alto y estrecho, más', () => {
  const tam = [0, 1, 2, 3].map(() => tamanoBase(2, false));
  const ancho = mejorDisposicion(tam, 960, 130);
  const estrecho = mejorDisposicion(tam, 300, 500);
  assert.equal(ancho.filas.length, 1);
  assert.ok(estrecho.filas.length > 1);
});

test('sin hueco (ancho o alto <= 0) no inventa una disposición', () => {
  const tam = [tamanoBase(2, true)];
  assert.equal(mejorDisposicion(tam, 0, 100), null);
  assert.equal(mejorDisposicion(tam, 100, 0), null);
  assert.equal(mejorDisposicion([], 100, 100), null);
});

test('sin obstáculos hay un solo hueco, del ancho máximo', () => {
  const r = regionesLibres([], TOP, LIMITE, DERECHA);
  assert.equal(r.length, 1);
  assert.equal(r[0].ancho, ANCHO_MAX_CAJA);
  assert.equal(r[0].alto, LIMITE - TOP);
});

test('un obstáculo ancho y bajo (los botones) genera además un hueco más corto que acaba encima de él', () => {
  const r = regionesLibres(HAIL_MARY_OBSTACULOS, TOP, LIMITE, DERECHA);
  assert.ok(r.length >= 2, JSON.stringify(r));
  const corto = r.find((x) => x.alto < LIMITE - TOP);
  assert.ok(corto && TOP + corto.alto <= 800 - 14 + 1e-9, 'el hueco corto no acaba encima de los botones');
  const alto = r.find((x) => x.alto === LIMITE - TOP);
  assert.ok(alto.izq >= 1411 + MARGEN_X - 1e-9, 'el hueco alto tiene que quedar a la derecha de los botones');
});

test('Hail Mary: cinco logos, ninguno pisa la sinopsis, las etiquetas ni los botones (el fallo de la foto)', () => {
  const tam = HAIL_MARY_PROPORCIONES.map((r) => tamanoBase(r, false));
  const regiones = regionesLibres(HAIL_MARY_OBSTACULOS, TOP, LIMITE, DERECHA);
  const e = elegir(tam, regiones, DERECHA, TOP, LIMITE, RESERVADO);
  assert.ok(e, 'sin disposición');
  const rects = rectangulos(tam, e.region, e.disp);
  rects.forEach((rc, i) => {
    HAIL_MARY_OBSTACULOS.forEach((o, j) => assert.ok(!choca(rc, o), `el logo ${i} pisa el obstáculo ${j}: ${JSON.stringify(rc)}`));
    assert.ok(rc.bottom <= LIMITE + 1e-6, `el logo ${i} baja hasta ${rc.bottom}, más allá de ${LIMITE}`);
    assert.ok(rc.right <= DERECHA + 1e-6);
  });
  assert.ok(e.disp.k >= 0.5, `salen demasiado pequeños: k=${e.disp.k}`);
});

test('Hail Mary con la regla VIEJA (caja de 920 px hacia la izquierda) sí pisaba los botones: la prueba detecta el fallo', () => {
  // Lo de antes: 5 logos -> 2 filas (3 + 2) en una caja de 920 px anclada a la derecha, desde y=455.
  const tam = HAIL_MARY_PROPORCIONES.map((r) => tamanoBase(r, false));
  const disp = { k: 1, filas: [[0, 1, 2], [3, 4]], ancho: 920, alto: 330 };
  const rects = rectangulos(tam, null, disp);
  assert.ok(rects.some((rc) => HAIL_MARY_OBSTACULOS.some((o) => choca(rc, o))),
    'la disposición vieja no choca con nada: la prueba no demuestra nada');
});

test('muchos logos en un hueco pequeño: se encogen TODOS por igual en vez de dejar alguno fuera', () => {
  const tam = Array.from({ length: 8 }, (_, i) => tamanoBase(1 + i * 0.7, false));
  const e = elegir(tam, [{ izq: 1215, ancho: 600, alto: 200 }], DERECHA, TOP, LIMITE, RESERVADO);
  assert.ok(e);
  assert.deepEqual(e.disp.filas.flat(), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(e.disp.k < 1);
  assert.ok(e.disp.ancho <= 600 + 1e-6 && e.disp.alto <= 200 - RESERVADO + 1e-6);
});

test('si los obstáculos tapan todo, queda el último recurso: la columna de la carátula (280 px)', () => {
  const tapa = [{ left: 100, top: 400, right: 1800, bottom: 950 }];
  assert.equal(regionesLibres(tapa, TOP, LIMITE, DERECHA).length, 0);
  const tam = [tamanoBase(2, true)];
  const e = elegir(tam, [], DERECHA, TOP, LIMITE, RESERVADO);
  assert.ok(e && e.region.ancho === 280);
});
