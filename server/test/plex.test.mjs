import { test } from 'node:test';
import assert from 'node:assert/strict';
import { procesarWebhookPlex } from '../src/media/plex.ts';
import { db } from '../src/db.ts';

test('webhook de Plex: ignora eventos que no son de parada o scrobble', () => {
  const r1 = procesarWebhookPlex({ event: 'media.play' });
  assert.equal(r1.ok, true);
  assert.match(r1.motivo ?? '', /ignorado/);

  const r2 = procesarWebhookPlex({ event: 'media.resume' });
  assert.equal(r2.ok, true);
});

test('webhook de Plex: ignora cuentas que no son el dueño principal', () => {
  const r = procesarWebhookPlex({
    event: 'media.stop',
    Account: { id: 2 },
    Metadata: { ratingKey: 100 }
  });
  assert.equal(r.ok, true);
  assert.match(r.motivo ?? '', /cuenta no principal/);
});

test('webhook de Plex: ignora aperturas de menos de 60 segundos', () => {
  const f = db.prepare('SELECT path FROM media_files LIMIT 1').get();
  assert.ok(f?.path);
  const r = procesarWebhookPlex({
    event: 'media.stop',
    Account: { id: 1 },
    Metadata: {
      ratingKey: 100,
      viewOffset: 30000, // 30s
      Media: [{ Part: [{ file: f.path }] }]
    }
  });
  assert.equal(r.ok, true);
  assert.match(r.motivo ?? '', /posicion menor a 60s/);
});

test('webhook de Plex: rechaza payloads vacíos o sin metadata', () => {
  assert.equal(procesarWebhookPlex(null).ok, false);
  assert.equal(procesarWebhookPlex({ event: 'media.stop', Account: { id: 1 } }).ok, false);
});
