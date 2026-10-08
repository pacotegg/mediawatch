// node --test src/scanner/identificar.test.ts
// Los datos van a una carpeta temporal: importar el servidor abre su base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MEDIAWATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mw-test-'));
const { coincidenciaSegura } = await import('./identificar.ts');
const { certificacionDe } = await import('./tmdb.ts');

const p = (tmdbId: number, title: string, year: number | null, originalTitle?: string) =>
  ({ tmdbId, kind: 'movie', title, year, originalTitle, overview: null, rating: null, posterUrl: null, backdropUrl: null, logoUrl: null, genres: [] }) as never;

test('con ano: titulo igual y ano a +-1', () => {
  const r = [p(1, 'Dune', 1984), p(2, 'Dune', 2021)];
  assert.equal(coincidenciaSegura({ title: 'Dune', year: 2021 }, r)?.tmdbId, 2);
  assert.equal(coincidenciaSegura({ title: 'Dune', year: 2022 }, r)?.tmdbId, 2);
  assert.equal(coincidenciaSegura({ title: 'Dune', year: 2000 }, r), null);
});

test('sin ano: solo si hay UN resultado con ese titulo', () => {
  assert.equal(coincidenciaSegura({ title: 'Breaking Bad', year: null }, [p(1, 'Breaking Bad', 2008), p(2, 'Breaking Bad: La pelicula', 2019)])?.tmdbId, 1);
  assert.equal(coincidenciaSegura({ title: 'Dune', year: null }, [p(1, 'Dune', 1984), p(2, 'Dune', 2021)]), null);
  assert.equal(coincidenciaSegura({ title: 'Algo raro', year: null }, [p(1, 'Otra cosa', 2000)]), null);
});

test('titulo sin tildes ni mayusculas, y por titulo original', () => {
  assert.equal(coincidenciaSegura({ title: 'amelie', year: 2001 }, [p(1, 'Amélie', 2001)])?.tmdbId, 1);
  assert.equal(coincidenciaSegura({ title: 'Pans Labyrinth', year: 2006 }, [p(1, 'El laberinto del fauno', 2006, 'Pans Labyrinth')])?.tmdbId, 1);
});

test('clasificacion por edades de Espana', () => {
  const peli = (c: { certification: string; type: number }[]) => ({ release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'R', type: 3 }] }, { iso_3166_1: 'ES', release_dates: c }] } });
  assert.equal(certificacionDe(peli([{ certification: '', type: 1 }, { certification: '12', type: 3 }]), 'movie', 'ES'), 'ES:12');
  assert.equal(certificacionDe(peli([{ certification: 'TP', type: 3 }]), 'movie', 'ES'), 'ES:TP');
  assert.equal(certificacionDe(peli([{ certification: 'A', type: 3 }]), 'movie', 'ES'), 'ES:TP');
  assert.equal(certificacionDe(peli([{ certification: '', type: 3 }]), 'movie', 'ES'), null);
  assert.equal(certificacionDe({ release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'R', type: 3 }] }] } }, 'movie', 'ES'), null);
  assert.equal(certificacionDe({ content_ratings: { results: [{ iso_3166_1: 'ES', rating: '16' }] } }, 'show', 'ES'), 'ES:16');
  assert.equal(certificacionDe({ content_ratings: { results: [{ iso_3166_1: 'ES', rating: '10' }] } }, 'show', 'ES'), 'ES:7');
  assert.equal(certificacionDe({}, 'movie', 'ES'), null);
});
