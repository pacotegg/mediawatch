import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cajaVisible, lumaVisible, pintarParaFondoOscuro, UMBRAL_OSCURO } from '../src/media/logos-estudio.ts';

const dibujo = (w, h, color) => {
  const b = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = color(x, y); if (c) b.set(c, (y * w + x) * 4); }
  return b;
};
const px = (b, w, x, y) => Array.from(b.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

test('pintarParaFondoOscuro: el azul oscuro sigue azul y se aclara, no se vuelve pastel', () => {
  const r = pintarParaFondoOscuro(dibujo(20, 20, () => [0, 40, 130, 255]), 20, 20);
  const [a, v, z] = px(r.rgba, 20, 10, 10);
  assert.ok(r.cambio);
  assert.ok(z > v && v > a, 'mantiene el tono azul');
  assert.ok(a < 110, 'no se lava hacia un pastel: ' + a);
  assert.ok(0.2126 * a + 0.7152 * v + 0.0722 * z > 60, 'se ve sobre el fondo oscuro');
});

test('pintarParaFondoOscuro: el negro sin color pasa a dorado', () => {
  const r = pintarParaFondoOscuro(dibujo(20, 20, (x) => (x % 4 === 0 ? [0, 0, 0, 255] : null)), 20, 20);
  const [a, v, z] = px(r.rgba, 20, 4, 5);
  assert.ok(a > v && v > z && a > 150, 'dorado: ' + [a, v, z]);
});

test('pintarParaFondoOscuro: el color de un logo que ya se lee no se toca', () => {
  const r = pintarParaFondoOscuro(dibujo(20, 20, (x) => (x < 14 ? [250, 200, 20, 255] : [20, 30, 140, 255])), 20, 20);
  assert.deepEqual(px(r.rgba, 20, 18, 10), [20, 30, 140, 255]);
  assert.deepEqual(px(r.rgba, 20, 2, 10), [250, 200, 20, 255]);
});

test('pintarParaFondoOscuro: un negro suelto junto a color se rescata; el que hace de fondo no', () => {
  const suelto = pintarParaFondoOscuro(dibujo(40, 20, (x) => (x < 20 ? [230, 30, 30, 255] : x > 24 ? [0, 0, 0, 255] : null)), 40, 20);
  assert.ok(px(suelto.rgba, 40, 30, 10)[0] >= 200, 'texto negro suelto aclarado');
  const letra = pintarParaFondoOscuro(dibujo(20, 20, (x, y) => (x >= 8 && x <= 11 && y >= 8 && y <= 11 ? [0, 0, 0, 255] : [230, 230, 30, 255])), 20, 20);
  assert.deepEqual(px(letra.rgba, 20, 10, 10), [0, 0, 0, 255]);
});

test('pintarParaFondoOscuro: un logo con buen contraste no cambia y uno vacío devuelve null', () => {
  assert.equal(pintarParaFondoOscuro(dibujo(10, 10, () => [240, 40, 40, 255]), 10, 10).cambio, false);
  assert.equal(pintarParaFondoOscuro(new Uint8Array(400), 10, 10), null);
});

/** TMDb trae logos con mucho lienzo vacío (Intermedia usa el 22 %): la caja de lo visible es lo que se recorta. */
test('cajaVisible encuentra lo que se ve, deja 2 px de aire y no recorta un logo sin margen', () => {
  const lienzo = (w, h, pintar) => {
    const b = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pintar(x, y)) b[(y * w + x) * 4 + 3] = 255;
    return b;
  };
  // 100x50 con contenido en x 30..69, y 20..29.
  const caja = cajaVisible(lienzo(100, 50, (x, y) => x >= 30 && x < 70 && y >= 20 && y < 30), 100, 50);
  assert.deepEqual(caja, { x: 28, y: 18, w: 44, h: 14 });
  // Sin margen apreciable: null (se sirve tal cual).
  assert.equal(cajaVisible(lienzo(100, 50, (x, y) => x >= 1 && x < 99 && y >= 1 && y < 49), 100, 50), null);
  // Todo transparente: null.
  assert.equal(cajaVisible(lienzo(10, 10, () => false), 10, 10), null);
});

/**
 * La tele pintaba todos los logos como silueta blanca; ahora el servidor solo aclara los que son oscuros. Lo que decide es
 * la luminosidad de lo que SE VE: el fondo transparente no cuenta (si contara, cualquier logo con mucho margen saldría
 * «oscuro» y se invertiría).
 */
test('lumaVisible ignora lo transparente y separa texto negro de un logo de color', () => {
  const px = (r, g, b, a) => [r, g, b, a];
  // Texto negro con mucho fondo transparente (blanco por debajo): oscuro.
  const negro = new Uint8Array([...px(0, 0, 0, 255), ...px(255, 255, 255, 0), ...px(255, 255, 255, 0), ...px(0, 0, 0, 255)]);
  assert.equal(lumaVisible(negro), 0);
  assert.ok(lumaVisible(negro) < UMBRAL_OSCURO);
  // Dorado como el león de MGM: se queda con su color.
  const dorado = new Uint8Array([...px(200, 160, 60, 255), ...px(150, 110, 40, 255)]);
  assert.ok(lumaVisible(dorado) >= UMBRAL_OSCURO);
  // Nada visible: NaN, y NaN < umbral es falso (se sirve tal cual).
  assert.ok(Number.isNaN(lumaVisible(new Uint8Array([0, 0, 0, 0]))));
});

/**
 * Una caja opaca (Crystal Lake: fondo azul oscuro con letras blancas) se invertía en un bloque azul claro sin texto, y una
 * gris (Platinum Dunes) pasaba a dorado con el texto perdido (29/10/2026). Ya traen su fondo: van tal cual.
 */
test('cajaOpaca: una caja opaca, aunque tenga margen transparente, sí; letras sueltas no', async () => {
  const { cajaOpaca } = await import('../src/media/logos-estudio.ts');
  const lienzo = (w, h, pintar) => {
    const b = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pintar(x, y)) b[(y * w + x) * 4 + 3] = 255;
    return b;
  };
  assert.equal(cajaOpaca(lienzo(20, 10, () => true), 20), true);
  // Platinum Dunes: la caja ocupa el 65 % del lienzo y el resto es margen transparente.
  assert.equal(cajaOpaca(lienzo(20, 10, (x, y) => x >= 2 && x < 18 && y >= 1 && y < 9), 20), true);
  // Letras: rayas sueltas dentro de su recuadro.
  assert.equal(cajaOpaca(lienzo(20, 10, (x) => x % 3 === 0), 20), false);
  assert.equal(cajaOpaca(lienzo(20, 10, () => false), 20), false);
});
