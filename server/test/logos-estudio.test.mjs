import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lumaVisible, UMBRAL_OSCURO } from '../src/media/logos-estudio.ts';

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
