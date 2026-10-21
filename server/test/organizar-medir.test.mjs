/*
 * Un titulo recien escrapeado y sin reproducir esta SIN MEDIR (el servidor solo mide un video la primera vez que se reproduce): «Organizar»
 * no puede pedir que se espere, tiene que medirlo el mismo (ffprobe, ~1 s) para saber formato y audio del nombre. Video real corto.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-medir-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { planOrganizar, asegurarMedidos } = await import('../src/scanner/organizar.ts');
const { planesDeLoteMedidos } = await import('../src/scanner/lote.ts');
const { config } = await import('../src/config.ts');
const { db } = await import('../src/db.ts');

const pelis = join(base, 'peliculas');
let id;

before(async () => {
  const d = join(pelis, 'Sin.Medir.2022');
  mkdirSync(d, { recursive: true });
  // 6 s con relleno para pasar el suelo de 5 MB del escaner: video 1280x720 + audio AC3 de 6 canales, de verdad.
  const r = spawnSync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=6', '-f', 'lavfi', '-i', 'anoisesrc=d=6:c=pink', '-c:v', 'mpeg4', '-q:v', '1', '-c:a', 'ac3', '-ac', '6', '-b:a', '640k', join(d, 'Sin.Medir.2022.mkv')]);
  assert.equal(r.status, 0, 'ffmpeg genera el video de prueba: ' + String(r.stderr));
  await scanLibrary({ name: 'Pelis', path: pelis, kind: 'movie' });
  id = db.prepare('SELECT id FROM items').get().id;
  db.prepare("UPDATE items SET title = 'La Sin Medir', year = 2022 WHERE id = ?").run(id);
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } rmSync(base, { recursive: true, force: true }); });

test('sin medir, planificar da error con motivo (comportamiento de siempre)', () => {
  assert.equal(db.prepare('SELECT probed FROM media_files WHERE item_id = ?').get(id).probed, 0);
  assert.throws(() => planOrganizar(id), /sin medir/);
});

test('asegurarMedidos mide el fichero con ffprobe y entonces el plan sale con el formato y el audio reales', async () => {
  await asegurarMedidos(id);
  const f = db.prepare('SELECT probed, width, height FROM media_files WHERE item_id = ?').get(id);
  assert.deepEqual({ ...f }, { probed: 1, width: 1280, height: 720 });
  const plan = planOrganizar(id);
  assert.ok(plan.pasos.some((p) => p.final.endsWith('La Sin Medir (2022) 720p AC3.mkv')), plan.pasos.map((p) => p.final).join(' | '));
});

test('el plan del lote mide por su cuenta lo que haga falta (otro titulo, aun sin medir)', async () => {
  const d = join(pelis, 'Otra.Sin.Medir.2023');
  mkdirSync(d, { recursive: true });
  const r = spawnSync(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25:d=4', '-f', 'lavfi', '-i', 'anoisesrc=d=4:c=pink', '-c:v', 'mpeg4', '-q:v', '1', '-c:a', 'aac', join(d, 'Otra.Sin.Medir.2023.mkv')]);
  assert.equal(r.status, 0, String(r.stderr));
  await scanLibrary({ name: 'Pelis', path: pelis, kind: 'movie' });
  const id2 = db.prepare("SELECT id FROM items WHERE title LIKE 'Otra%'").get().id;
  db.prepare("UPDATE items SET title = 'Otra Sin Medir', year = 2023 WHERE id = ?").run(id2);
  assert.equal(db.prepare('SELECT probed FROM media_files WHERE item_id = ?').get(id2).probed, 0);
  const planes = await planesDeLoteMedidos([id2]);
  assert.equal(planes[0].error, undefined);
  assert.ok(planes[0].pasos.some((p) => p.final.endsWith('Otra Sin Medir (2023) 1080p AAC.mkv')), planes[0].pasos.map((p) => p.final).join(' | '));
});
