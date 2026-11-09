/*
 * Servicio para TorrentDWN (opción B): reglas de decisión. Sin base de datos ni TMDb: las operaciones reales entran por `deps`.
 *
 *   npm test --workspace server
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { claveValida, pasosSeguros, procesarAuto } from '../src/scanner/servicio-auto.ts';

const fila = (confianza, extra = {}) => ({ itemId: 7, titulo: 'Serie X', confianza, tmdbId: 99, propuesta: 'Serie X', ...extra });

function deps(o = {}) {
  const llamadas = { aplicar: 0, plan: 0, renombrar: 0 };
  return {
    llamadas,
    ocupado: () => false,
    buscar: async () => ({ fila: fila('segura') }),
    aplicar: async () => { llamadas.aplicar++; return { ok: true }; },
    plan: async () => { llamadas.plan++; return { pasos: [{ desde: 'E:\\Series\\Vieja', hacia: 'E:\\Series\\Serie X (2020)', final: 'E:\\Series\\Serie X (2020)' }] }; },
    renombrar: async () => { llamadas.renombrar++; return { ok: true, detalle: 'NFO escritos: 3' }; },
    alguienViendo: () => false,
    carpetaDe: () => 'E:\\Series\\Vieja',
    ...o,
  };
}

describe('Servicio TorrentDWN: solo escrapea lo seguro', () => {
  test('si el Asistente está en marcha no se pisa: ocupado', async () => {
    const d = deps({ ocupado: () => true });
    assert.equal((await procesarAuto('E:\\Series\\Vieja', { renombrar: true }, d)).estado, 'ocupado');
    assert.equal(d.llamadas.aplicar, 0);
  });

  test('un error de la búsqueda se devuelve como error', async () => {
    const d = deps({ buscar: async () => ({ error: 'Falta la clave de API de TMDb' }) });
    const r = await procesarAuto('E:\\x', { renombrar: false }, d);
    assert.equal(r.estado, 'error');
    assert.match(r.error, /TMDb/);
  });

  test('carpeta sin vídeo reconocible', async () => {
    const d = deps({ buscar: async () => ({}) });
    assert.equal((await procesarAuto('E:\\x', { renombrar: false }, d)).estado, 'sin_video');
  });

  test('confianza «probable» o «dudosa»: NO se aplica nada, queda en la cola del Asistente', async () => {
    for (const c of ['probable', 'dudosa']) {
      const d = deps({ buscar: async () => ({ fila: fila(c) }) });
      const r = await procesarAuto('E:\\x', { renombrar: true }, d);
      assert.equal(r.estado, 'dudoso', c);
      assert.equal(d.llamadas.aplicar, 0, c);
      assert.equal(d.llamadas.renombrar, 0, c);
    }
  });

  test('sin coincidencia en TMDb: no se toca nada', async () => {
    const d = deps({ buscar: async () => ({ fila: fila('ninguna', { tmdbId: null, propuesta: null }) }) });
    const r = await procesarAuto('E:\\x', { renombrar: true }, d);
    assert.equal(r.estado, 'sin_coincidencia');
    assert.equal(d.llamadas.aplicar, 0);
  });

  test('coincidencia segura con renombrar apagado: aplica la ficha y NADA más (ni siquiera mira el plan)', async () => {
    const d = deps();
    const r = await procesarAuto('E:\\Series\\Vieja', { renombrar: false }, d);
    assert.equal(r.estado, 'aplicado');
    assert.equal(r.tmdbId, 99);
    assert.deepEqual(d.llamadas, { aplicar: 1, plan: 0, renombrar: 0 });
  });

  test('coincidencia segura + renombrar + plan seguro: renombra', async () => {
    const d = deps();
    const r = await procesarAuto('E:\\Series\\Vieja', { renombrar: true }, d);
    assert.equal(r.estado, 'renombrado');
    assert.equal(d.llamadas.renombrar, 1);
  });

  test('un plan que SALE de la carpeta de la biblioteca (otro disco o carpeta) no se ejecuta solo', async () => {
    const d = deps({ plan: async () => ({ pasos: [{ desde: 'E:\\Series\\Vieja', hacia: 'D:\\Otro\\Serie X', final: 'D:\\Otro\\Serie X' }] }) });
    const r = await procesarAuto('E:\\Series\\Vieja', { renombrar: true }, d);
    assert.equal(r.estado, 'aplicado');
    assert.match(r.detalle, /sale de la carpeta/);
    assert.equal(d.llamadas.renombrar, 0);
  });

  test('con alguien viendo algo no se renombra (pero la ficha sí queda aplicada)', async () => {
    const d = deps({ alguienViendo: () => true });
    const r = await procesarAuto('E:\\Series\\Vieja', { renombrar: true }, d);
    assert.equal(r.estado, 'aplicado');
    assert.match(r.detalle, /viendo/);
    assert.equal(d.llamadas.renombrar, 0);
  });

  test('plan con error o vacío: no se renombra', async () => {
    const conError = deps({ plan: async () => ({ error: 'Destino ya existe', pasos: [] }) });
    assert.match((await procesarAuto('E:\\x', { renombrar: true }, conError)).detalle, /Destino ya existe/);
    const vacio = deps({ plan: async () => ({ pasos: [] }) });
    assert.match((await procesarAuto('E:\\x', { renombrar: true }, vacio)).detalle, /ya estaban bien/);
  });

  test('si aplicar la ficha falla, es un error y no se renombra', async () => {
    const d = deps({ aplicar: async () => ({ ok: false, error: 'TMDb 500' }) });
    const r = await procesarAuto('E:\\x', { renombrar: true }, d);
    assert.equal(r.estado, 'error');
    assert.equal(d.llamadas.renombrar, 0);
  });
});

describe('Servicio TorrentDWN: seguridad de la clave y de los pasos', () => {
  test('la clave: vacía o corta nunca vale; la correcta sí; una distinta no', () => {
    const clave = 'a'.repeat(32);
    assert.equal(claveValida(clave, ''), false);
    assert.equal(claveValida('corta', 'corta'), false, 'menos de 24 caracteres = servicio apagado');
    assert.equal(claveValida(clave, clave), true);
    assert.equal(claveValida('b'.repeat(32), clave), false);
    assert.equal(claveValida('', clave), false);
  });

  test('pasosSeguros: dentro de la carpeta contenedora sí; fuera o vacío no', () => {
    const carpeta = 'E:\\Series\\Vieja';
    assert.equal(pasosSeguros([{ desde: 'E:\\Series\\Vieja\\a.mkv', hacia: 'E:\\Series\\Nueva\\a.mkv', final: 'E:\\Series\\Nueva\\a.mkv' }], carpeta), true);
    assert.equal(pasosSeguros([{ desde: 'E:\\Series\\Vieja', hacia: 'E:\\Peliculas\\Vieja', final: 'E:\\Peliculas\\Vieja' }], carpeta), false);
    assert.equal(pasosSeguros([], carpeta), false);
  });
});
