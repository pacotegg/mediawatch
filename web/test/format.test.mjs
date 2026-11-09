/* Formatos de la web, con los casos que de verdad hay en la biblioteca (contados el 15/10/2026). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { audioLabel, certification, clock, languageName, remaining, resolutionLabel } from '../src/lib/format.ts';

test('idiomas: los de la lista, los del otro estándar de códigos y los que no son idioma', () => {
  assert.equal(languageName('spa'), 'Español');
  assert.equal(languageName('chi'), 'Chino');
  // Mismo idioma, el otro código: antes salía «ZHO», «NLD», «CES».
  assert.equal(languageName('zho'), 'Chino');
  assert.equal(languageName('nld'), 'Neerlandés');
  assert.equal(languageName('ces'), 'Checo');
  assert.equal(languageName('ron'), 'Rumano');
  // Sin idioma marcado: el navegador lo llamaría «root».
  assert.equal(languageName('und'), 'Desconocido');
  assert.equal(languageName(null), 'Desconocido');
  // Basura que hay de verdad en la tabla de subtítulos.
  assert.equal(languageName('3'), '3');
});

test('reloj: horas solo cuando hacen falta, y nada de NaN', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(3600), '1:00:00');
  assert.equal(clock(6809), '1:53:29');
  assert.equal(clock(Number.NaN), '0:00');
  assert.equal(clock(-5), '0:00');
});

test('lo que queda', () => {
  assert.equal(remaining(0, 600), 'Quedan 10 min');
  assert.equal(remaining(0, 3 * 3600 + 120), 'Quedan 3 h 2 min');
  assert.equal(remaining(700, 600), 'Quedan 0 min');
});

test('resolución: también las películas panorámicas, que no llegan a 2160 de alto', () => {
  assert.equal(resolutionLabel(3840, 1600), '4K');
  assert.equal(resolutionLabel(1920, 800), '1080p');
  assert.equal(resolutionLabel(1280, 536), '720p');
  assert.equal(resolutionLabel(720, 576), 'SD');
  assert.equal(resolutionLabel(null, null), null);
});

test('audio y clasificación por edad', () => {
  assert.equal(audioLabel('eac3', 6), 'Dolby Digital Plus 5.1');
  assert.equal(audioLabel('truehd', 8), 'Dolby TrueHD 7.1');
  assert.equal(certification('ES:16 / ES:16/fig'), '16');
});

test('premios: OMDb los da en inglés y se enseñan en español sin inventar nada', async () => {
  const { premiosEnEspanol } = await import('../src/lib/format.ts');
  assert.equal(premiosEnEspanol('Won 1 Oscar. 19 wins & 22 nominations total'), 'Ganó 1 Óscar. 19 premios y 22 nominaciones en total');
  assert.equal(premiosEnEspanol('Nominated for 3 Oscars. 5 wins & 10 nominations total'), 'Nominada a 3 Óscar. 5 premios y 10 nominaciones en total');
  assert.equal(premiosEnEspanol('Won 2 Primetime Emmys. 140 wins & 300 nominations total'), 'Ganó 2 Emmys. 140 premios y 300 nominaciones en total');
  assert.equal(premiosEnEspanol('1 win & 1 nomination'), '1 premio y 1 nominación');
  assert.equal(premiosEnEspanol('Another 12 wins & 3 nominations'), 'Otros 12 premios y 3 nominaciones');
  assert.equal(premiosEnEspanol('Won 1 BAFTA Award. 3 wins total'), 'Ganó 1 BAFTA Award. 3 premios en total');
  assert.equal(premiosEnEspanol(''), null);
  assert.equal(premiosEnEspanol(null), null);
  assert.equal(premiosEnEspanol('N/A'), null);
});
