import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearReinicio, ESPERA_AVISO_MS, MENSAJE_POR_DEFECTO, CADUCA_MS } from '../src/media/reinicio.ts';

/**
 * El reinicio con aviso sale del proceso: un fallo aquí deja a alguien sin vídeo o el servidor parado. Se prueba la
 * máquina de estados con reloj y dependencias falsas.
 */
function montar({ viendo = false } = {}) {
  const f = { t: 1_000_000, viendo, enviados: [], salidas: 0 };
  const r = crearReinicio({
    ahora: () => f.t,
    alguienViendo: () => f.viendo,
    sesiones: () => ['aaaaaaaa', 'bbbbbbbb'],
    enviarMensaje: (s, texto) => f.enviados.push([s, texto]),
    salir: () => { f.salidas++; },
  });
  return { f, r };
}

test('«ya» avisa a todos los aparatos al momento y sale pasada la espera, no antes', () => {
  const { f, r } = montar({ viendo: true });
  r.pedir('ya');
  assert.deepEqual(f.enviados, [['aaaaaaaa', MENSAJE_POR_DEFECTO], ['bbbbbbbb', MENSAJE_POR_DEFECTO]]);
  f.t += ESPERA_AVISO_MS - 1;
  assert.equal(r.tic(), false);
  assert.equal(f.salidas, 0);
  f.t += 1;
  assert.equal(r.tic(), true);
  assert.equal(f.salidas, 1);
});

test('«cuando-libre» no avisa ni sale mientras alguien ve algo, y lo hace en cuanto se libera', () => {
  const { f, r } = montar({ viendo: true });
  r.pedir('cuando-libre', '  Vuelvo enseguida  ');
  for (let i = 0; i < 5; i++) { f.t += 60_000; assert.equal(r.tic(), false); }
  assert.equal(f.enviados.length, 0, 'no se avisa a nadie con gente viendo');
  assert.equal(f.salidas, 0);
  f.viendo = false;
  assert.equal(r.tic(), false);
  assert.equal(f.enviados.length, 2);
  assert.equal(f.enviados[0][1], 'Vuelvo enseguida', 'el mensaje se recorta de espacios');
  f.t += ESPERA_AVISO_MS;
  assert.equal(r.tic(), true);
});

test('cancelar antes de la salida lo deja todo como estaba, y pedirlo dos veces no avisa dos veces', () => {
  const { f, r } = montar();
  r.pedir('ya');
  r.pedir('ya');
  assert.equal(f.enviados.length, 2, 'la segunda petición no repite el aviso');
  r.cancelar();
  f.t += ESPERA_AVISO_MS * 2;
  assert.equal(r.tic(), false);
  assert.equal(f.salidas, 0);
  assert.equal(r.estado().pendiente, false);
});

test('una petición «cuando-libre» que nunca se cumple caduca y no sale', () => {
  const { f, r } = montar({ viendo: true });
  r.pedir('cuando-libre');
  f.t += CADUCA_MS + 1;
  r.tic();
  assert.equal(r.estado().pendiente, false);
  f.viendo = false;
  f.t += ESPERA_AVISO_MS * 2;
  assert.equal(r.tic(), false);
  assert.equal(f.salidas, 0);
});

test('un mensaje largo se recorta y uno vacío usa el de por defecto', () => {
  const { r } = montar();
  assert.equal(r.pedir('cuando-libre', 'x'.repeat(500)).mensaje.length, 200);
  r.cancelar();
  assert.equal(r.pedir('cuando-libre', '   ').mensaje, MENSAJE_POR_DEFECTO);
});
