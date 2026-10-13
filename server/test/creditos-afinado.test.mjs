import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { adelantarPrimerRango, instantesDeSubtitulo, negroPlausible, primerNegro, ultimoDialogoAntes } from '../src/media/creditos-afinado-puro.ts';

describe('instantesDeSubtitulo', () => {
  test('srt', () => {
    const t = instantesDeSubtitulo('1\n00:01:02,500 --> 00:01:04,000\nHola\n\n2\n01:30:00,000 --> 01:30:02,000\nAdios');
    assert.deepEqual(t, [62.5, 5400]);
  });
  test('vtt', () => {
    assert.deepEqual(instantesDeSubtitulo('WEBVTT\n\n00:00:10.250 --> 00:00:12.000\nHi'), [10.25]);
  });
  test('ass', () => {
    assert.deepEqual(instantesDeSubtitulo('Dialogue: 0,1:02:03.50,1:02:05.00,Default,,0,0,0,,Hola'), [3723.5]);
  });
});

describe('ultimoDialogoAntes', () => {
  const muchas = Array.from({ length: 30 }, (_, i) => i * 100);
  test('el ultimo anterior al limite', () => assert.equal(ultimoDialogoAntes(muchas, 2500), 2400));
  test('con pocas lineas no vale', () => assert.equal(ultimoDialogoAntes([1, 2, 3], 100), null));
  test('lo posterior al limite se ignora', () => assert.equal(ultimoDialogoAntes([...muchas, 99999], 3000), 2900));
});

describe('primerNegro', () => {
  const salida = '[blackdetect @ 0x1] black_start:12.5 black_end:13.2 black_duration:0.7\n[blackdetect @ 0x1] black_start:80.04 black_end:81 black_duration:1';
  test('suma el desplazamiento del -ss y respeta el minimo', () => {
    assert.equal(primerNegro(salida, 1000, 1010, 1100), 1012.5);
    assert.equal(primerNegro(salida, 1000, 1020, 1100), 1080.04);
  });
  test('respeta el maximo', () => assert.equal(primerNegro(salida, 1000, 1010, 1011), null));
  test('sin negros', () => assert.equal(primerNegro('nada', 0, 0, 100), null));
});

describe('adelantarPrimerRango', () => {
  test('solo mueve el primer bloque', () => {
    const r = [{ start_s: 5000, end_s: 5100 }, { start_s: 5200, end_s: 5400 }];
    assert.deepEqual(adelantarPrimerRango(r, 4950.26), [{ start_s: 4950.3, end_s: 5100 }, { start_s: 5200, end_s: 5400 }]);
  });
  test('no toca la lista original', () => {
    const r = [{ start_s: 10, end_s: 20 }];
    adelantarPrimerRango(r, 5);
    assert.equal(r[0].start_s, 10);
  });
  test('lista vacia', () => assert.deepEqual(adelantarPrimerRango([], 5), []));
});

describe('negroPlausible', () => {
  test('un negro cerca del final y poco adelantado vale', () => assert.equal(negroPlausible(7000, 7090, 7600), true));
  test('si dejaria mas de 12 min de creditos no vale (El dilema)', () => assert.equal(negroPlausible(6000, 7160, 7600), false));
  test('adelantar mas de 5 min al detector no vale', () => assert.equal(negroPlausible(7000, 7400, 7600), false));
  test('en la primera mitad no vale', () => assert.equal(negroPlausible(100, 150, 7600), false));
});
