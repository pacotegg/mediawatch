import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarSegundos, validarRangoContraFichero } from '../src/media/sync-introdb.ts';

test('normalizarSegundos extrae segundos directos o milisegundos', () => {
  assert.deepStrictEqual(normalizarSegundos({ start_sec: 10.5, end_sec: 35.2 }), { start_s: 10.5, end_s: 35.2 });
  assert.deepStrictEqual(normalizarSegundos({ start_ms: 10500, end_ms: 35200 }), { start_s: 10.5, end_s: 35.2 });
  assert.strictEqual(normalizarSegundos(null), null);
  assert.strictEqual(normalizarSegundos({ start_sec: 50, end_sec: 10 }), null);
});

test('validarRangoContraFichero: rechaza créditos fuera de la segunda mitad o inverosímiles', () => {
  const duracion = 3600; // 1 hora
  // En el minuto 10 no pueden ser créditos
  const res1 = validarRangoContraFichero(999999, duracion, 'credits', { start_s: 600, end_s: 700 });
  assert.strictEqual(res1.valido, false);
  assert.strictEqual(res1.motivo, 'inicio_fuera_de_rango');

  // Crédito de 5 segundos es inverosímil
  const res2 = validarRangoContraFichero(999999, duracion, 'credits', { start_s: 3500, end_s: 3505 });
  assert.strictEqual(res2.valido, false);
  assert.strictEqual(res2.motivo, 'duracion_inverosimil');

  // Crédito de 120s en los últimos minutos es válido
  const res3 = validarRangoContraFichero(999999, duracion, 'credits', { start_s: 3480, end_s: 3600 });
  assert.strictEqual(res3.valido, true);
  assert.strictEqual(res3.start_s, 3480);
  assert.strictEqual(res3.end_s, 3600);
});

test('validarRangoContraFichero: rechaza créditos si hay diálogos posteriores en la trama', () => {
  // Usamos file_id = 1 (007, que tiene diálogos hasta el segundo 8540 en la BD real)
  const duracion = 8542;
  // Proponemos créditos de 200s (8200 a 8400), pero la película tiene diálogos hasta el 8540
  const res = validarRangoContraFichero(1, duracion, 'credits', { start_s: 8200, end_s: 8400 });
  assert.strictEqual(res.valido, false);
  assert.strictEqual(res.motivo, 'dialogos_posteriores_detectados');
});

test('validarRangoContraFichero: rechaza intros en la segunda mitad o de duración absurda', () => {
  const duracion = 1800; // 30 min
  // Intro a los 20 minutos (segunda mitad) es inválida
  const res1 = validarRangoContraFichero(999999, duracion, 'intro', { start_s: 1200, end_s: 1300 });
  assert.strictEqual(res1.valido, false);
  assert.strictEqual(res1.motivo, 'intro_fuera_de_primera_mitad');

  // Intro de 3 segundos es inválida
  const res2 = validarRangoContraFichero(999999, duracion, 'intro', { start_s: 60, end_s: 63 });
  assert.strictEqual(res2.valido, false);
  assert.strictEqual(res2.motivo, 'duracion_intro_inverosimil');

  // Intro estándar de 45s en el minuto 2 es válida
  const res3 = validarRangoContraFichero(999999, duracion, 'intro', { start_s: 120, end_s: 165 });
  assert.strictEqual(res3.valido, true);
  assert.strictEqual(res3.start_s, 120);
  assert.strictEqual(res3.end_s, 165);
});
