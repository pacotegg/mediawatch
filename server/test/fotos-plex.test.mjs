/*
 * Cruce de fotos de actores entre Plex y nuestra base: misma película (ruta) y mismo nombre exacto en el reparto.
 * Lo ambiguo se descarta: es preferible una persona sin foto a la foto de otra.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clave, emparejarPlex } from '../src/scanner/fotos-plex.ts';

const peli = 'E:\\Peliculas\\Zodiac (2007)\\Zodiac (2007) 1080p AC3.mkv';
const plex = (tag, url, file = peli) => ({ file: file.replace(/\\/g, '/'), tag, url });
const nuestra = (personaId, nombre, path = peli) => ({ path, personaId, nombre });

test('clave ignora tildes, mayúsculas y signos, y deja vacío lo que no es latino', () => {
  assert.equal(clave('Édgar  Ramírez'), 'edgar ramirez');
  assert.equal(clave("Mavor O'Moore"), 'mavor o moore');
  assert.equal(clave('Μελίνα Μερκούρη'), '');
});

test('cruza por película y nombre, con rutas de Windows o con barras, sin importar mayúsculas', () => {
  const r = emparejarPlex([plex('James LeGros', 'https://p/1.jpg'), plex('Otro Actor', 'https://p/2.jpg')], [nuestra(10, 'james legros'), nuestra(11, 'Sin Foto Plex')]);
  assert.deepEqual(r.cruces.map((c) => [c.personaId, c.url]), [[10, 'https://p/1.jpg']]);
});

test('el mismo nombre en OTRA película no cruza (no es el mismo reparto)', () => {
  const r = emparejarPlex([plex('Tom Wilson', 'https://p/1.jpg', 'E:\\Peliculas\\Otra (1999)\\o.mkv')], [nuestra(10, 'Tom Wilson')]);
  assert.equal(r.cruces.length, 0);
});

test('dos nombres iguales en la misma película, en Plex o en nuestra base, se descartan', () => {
  const dosEnPlex = emparejarPlex([plex('Tom Wilson', 'https://p/1.jpg'), plex('Tom Wilson', 'https://p/2.jpg')], [nuestra(10, 'Tom Wilson')]);
  assert.equal(dosEnPlex.cruces.length, 0);
  const dosNuestras = emparejarPlex([plex('Tom Wilson', 'https://p/1.jpg')], [nuestra(10, 'Tom Wilson'), nuestra(11, 'Tom Wilson')]);
  assert.equal(dosNuestras.cruces.length, 0);
  assert.equal(dosNuestras.ambiguos, 1);
});

test('una persona con fotos distintas según la película se descarta; con la misma foto se queda', () => {
  const otra = 'E:\\Peliculas\\Otra (1999)\\o.mkv';
  const distintas = emparejarPlex([plex('Ana Gil', 'https://p/1.jpg'), plex('Ana Gil', 'https://p/2.jpg', otra)], [nuestra(10, 'Ana Gil'), nuestra(10, 'Ana Gil', otra)]);
  assert.equal(distintas.cruces.length, 0);
  assert.equal(distintas.enConflicto, 1);
  const iguales = emparejarPlex([plex('Ana Gil', 'https://p/1.jpg'), plex('Ana Gil', 'https://p/1.jpg', otra)], [nuestra(10, 'Ana Gil'), nuestra(10, 'Ana Gil', otra)]);
  assert.equal(iguales.cruces.length, 1);
});

test('un nombre sin letras latinas no cruza nunca', () => {
  const r = emparejarPlex([plex('Μελίνα Μερκούρη', 'https://p/1.jpg')], [nuestra(10, 'Μελίνα Μερκούρη')]);
  assert.equal(r.cruces.length, 0);
});
