/*
 * El scraper trabaja en carpetas de entrada (C:\Videos…) aunque alguien esté viendo algo: solo se frena lo que cae dentro
 * de una biblioteca, que es el disco que se está leyendo (pedido el 26/10/2026).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MEDIAWATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
const { config } = await import('../src/config.ts');
const { hayAlguienViendoEn, marcarActividad } = await import('../src/media/ocupado.ts');

test('con alguien viendo, solo se frena lo que está dentro de una biblioteca', () => {
  const biblio = join(tmpdir(), 'Biblio Pelis');
  config.libraries = [{ name: 'Películas', path: biblio, kind: 'movie' }];
  assert.equal(hayAlguienViendoEn(join(biblio, 'Alien (1979)')), false, 'nadie viendo: no frena');
  marcarActividad();
  assert.equal(hayAlguienViendoEn(join(biblio, 'Alien (1979)')), true);
  assert.equal(hayAlguienViendoEn(biblio), true);
  assert.equal(hayAlguienViendoEn(join(tmpdir(), 'Videos', 'Alien (1979)')), false, 'carpeta de entrada: no frena');
  assert.equal(hayAlguienViendoEn(join(tmpdir(), 'Biblio Pelis 2', 'x')), false, 'un prefijo de nombre no es estar dentro');
});
