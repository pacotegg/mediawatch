/*
 * De los datos SMART que vuelca la tarea programada a avisos. Pura: no toca discos ni el servidor.
 * (Los nombres de campo son los del JSON de smartctl 7.x; ver la nota de src/media/salud-discos.ts.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MEDIAWATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
const { interpretarSmart } = await import('../src/media/salud-discos.ts');
const ahora = Date.parse('2026-10-15T12:00:00Z');
const reciente = '2026-10-15T08:00:00Z';
const ata = (id, valor) => ({ id, raw: { value: valor } });

test('un disco sano no da avisos', () => {
  const r = interpretarSmart({ generado: reciente, discos: [{ model_name: 'Sano', smart_status: { passed: true }, temperature: { current: 38 }, ata_smart_attributes: { table: [ata(5, 0), ata(197, 0), ata(198, 0)] } }] }, ahora);
  assert.deepEqual(r, []);
});

test('SMART que falla, sectores pendientes y reasignados', () => {
  const r = interpretarSmart({ generado: reciente, discos: [
    { model_name: 'Roto', smart_status: { passed: false } },
    { model_name: 'Pendientes', smart_status: { passed: true }, ata_smart_attributes: { table: [ata(197, 8)] } },
    { model_name: 'Reasignados', smart_status: { passed: true }, ata_smart_attributes: { table: [ata(5, 3)] } },
  ] }, ahora);
  assert.equal(r.find((a) => a.texto.includes('Roto')).nivel, 'error');
  assert.equal(r.find((a) => a.texto.includes('Pendientes')).nivel, 'error');
  assert.equal(r.find((a) => a.texto.includes('Reasignados')).nivel, 'aviso');
});

test('SSD NVMe: aviso critico, errores y desgaste; y temperatura alta', () => {
  const r = interpretarSmart({ generado: reciente, discos: [
    { model_name: 'NVMe', smart_status: { passed: true }, temperature: { current: 61 }, nvme_smart_health_information_log: { critical_warning: 1, media_errors: 2, percentage_used: 95 } },
  ] }, ahora);
  assert.equal(r.length, 4, JSON.stringify(r));
});

test('un disco en reposo no se juzga, y unos datos de hace mas de un dia avisan', () => {
  const r = interpretarSmart({ generado: '2026-10-13T12:00:00Z', discos: [
    { model_name: 'Dormido', smartctl: { messages: [{ string: 'Device is in STANDBY mode, exit(2)' }] }, smart_status: { passed: false } },
  ] }, ahora);
  assert.equal(r.length, 1);
  assert.match(r[0].texto, /más de un día/);
});
