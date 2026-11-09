/*
 * OMDb con `identidad`: pone titulo y ano y marca `meta_origen = 'omdb'`. Pregunta: ¿sobrevive eso a un reescaneo?
 * El UPSERT de scan.ts solo protege `tmdb` y `servidor`; si `omdb` no esta protegido, el .nfo (o la carpeta) lo pisa.
 * OMDb FALSO en local, biblioteca falsa y datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const datos = mkdtempSync(join(tmpdir(), 'mediawatch-omdbid-'));
const falso = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ Title: 'The Matrix', Year: '1999', Rated: 'R', Genre: 'Action', Plot: 'X', Poster: 'N/A', imdbRating: '8.7', imdbVotes: '1', imdbID: 'tt0133093', Response: 'True' }));
});
await new Promise((r) => falso.listen(0, '127.0.0.1', r));
process.env.MEDIAWATCH_DATA_DIR = datos;
process.env.MEDIAWATCH_OMDB_URL = `http://127.0.0.1:${falso.address().port}/`;
writeFileSync(join(datos, 'config.json'), JSON.stringify({ omdbApiKey: 'clave-falsa' }));
const { scanLibrary } = await import('../src/scanner/scan.ts');
const { aplicarOmdb } = await import('../src/scanner/omdb-ficha.ts');
const { db } = await import('../src/db.ts');

const raiz = join(datos, 'peliculas');
const lib = { name: 'Pelis', path: raiz, kind: 'movie' };
const d = join(raiz, 'Matriz sucia (1999)');
const dato = () => db.prepare('SELECT id, title, year, meta_origen FROM items WHERE folder = ?').get(d);

before(() => {
  mkdirSync(d, { recursive: true });
  const fd = openSync(join(d, 'Matriz sucia (1999).mkv'), 'w');
  ftruncateSync(fd, 6 * 1024 * 1024);
  closeSync(fd);
  writeFileSync(join(d, 'Matriz sucia (1999).nfo'), '<?xml version="1.0" encoding="UTF-8"?><movie><title>Matriz sucia</title><year>1999</year></movie>');
});
after(() => { try { db.close(); } catch { /* ya cerrada */ } falso.close(); rmSync(datos, { recursive: true, force: true }); });

test('OMDb con identidad pone el titulo y el ano de OMDb', async () => {
  await scanLibrary(lib);
  assert.equal(dato().title, 'Matriz sucia');
  await aplicarOmdb({ itemId: dato().id, imdbId: 'tt0133093', kind: 'movie', fields: ['rating'], identidad: true });
  assert.deepEqual({ t: dato().title, o: dato().meta_origen }, { t: 'The Matrix', o: 'omdb' });
});

test('un reescaneo conserva la identidad puesta desde OMDb', async () => {
  await scanLibrary(lib);
  assert.equal(dato().title, 'The Matrix', `tras reescanear el titulo es «${dato().title}» y meta_origen «${dato().meta_origen}»`);
});
