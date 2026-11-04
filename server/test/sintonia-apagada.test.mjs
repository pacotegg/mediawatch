import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../../' + ruta, import.meta.url), 'utf8');

/*
 * La sintonía sonó en bucle sin que nadie la pidiera (03/11/2026). Clave nueva a propósito: la tele y la web guardan el
 * ajuste entero, así que un `true` viejo no se distingue de uno elegido y no bastaba con cambiar el valor por defecto.
 */
test('la sintonía de la ficha está apagada por defecto en todos los clientes', () => {
  const tele = leer('tv/src/ajustes.ts');
  assert.match(tele, /sintoniaFicha: false/);
  assert.match(tele, /sintoniaFicha: guardado\.sintoniaFicha === true/);
  assert.doesNotMatch(tele, /musicaCabecera/);

  const web = leer('web/src/lib/preferences.tsx');
  assert.match(web, /sintoniaFicha: false/);
  assert.doesNotMatch(web, /themeMusic/);

  const servidor = leer('server/src/routes/preferences.ts');
  assert.match(servidor, /sintoniaFicha: false/);
  assert.doesNotMatch(servidor, /themeMusic/);

  const android = leer('android/app/src/main/java/casa/tvwatch/datos/Ajustes.kt');
  assert.match(android, /getBoolean\("sintoniaFicha", false\)/);
  assert.doesNotMatch(android, /"musicaCabecera"/);
});
