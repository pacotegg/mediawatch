/* Nombres «como tMM»: los casos son nombres REALES de la biblioteca (medidos el 20/10/2026). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carpetaDePelicula, carpetaDeSerie, carpetaDeTemporada, codecDeAudio, ficheroDeEpisodio, ficheroDePelicula, formatoDeVideo, limpiarParaDisco } from '../src/scanner/nombres-tmm.ts';

test('los caracteres que Windows no admite se cambian por otros parecidos, como hacia tMM', () => {
  assert.equal(carpetaDePelicula({ titulo: '11:14 - Destino fatal', anio: 2003 }), '11∶14 - Destino fatal (2003)');
  assert.equal(carpetaDePelicula({ titulo: "Boys Don't Cry", anio: 1999 }), "Boys Don't Cry (1999)", 'el apostrofo se queda (22 de 29 en la biblioteca)');
  assert.equal(carpetaDePelicula({ titulo: 'Agárralo como puedas 2 1/2: el aroma del miedo', anio: 1991 }), 'Agárralo como puedas 2 1⁄2∶ el aroma del miedo (1991)');
  assert.equal(carpetaDePelicula({ titulo: 'Colega, ¿dónde está mi coche?', anio: 2001 }), 'Colega, ¿dónde está mi coche❓ (2001)');
  assert.equal(carpetaDePelicula({ titulo: 'Crazy, Stupid, Love.', anio: 2011 }), 'Crazy, Stupid, Love. (2011)', 'el punto de en medio se queda');
  assert.equal(limpiarParaDisco('Fin.   '), 'Fin.');
});

test('la edicion va entre el titulo y el ano', () => {
  assert.equal(carpetaDePelicula({ titulo: 'Blade Runner', anio: 1982, edicion: 'Final Edition' }), 'Blade Runner - Final Edition (1982)');
  assert.equal(carpetaDePelicula({ titulo: 'Arma letal', anio: 1987, edicion: 'Extended Edition' }), 'Arma letal - Extended Edition (1987)');
});

test('fichero de pelicula: titulo (ano) formato audio', () => {
  assert.equal(ficheroDePelicula({ titulo: 'Asesinos natos', anio: 1994, formato: '1080p', audio: 'AAC' }), 'Asesinos natos (1994) 1080p AAC');
  assert.equal(ficheroDePelicula({ titulo: 'Sin datos', anio: 2001 }), 'Sin datos (2001)');
});

test('el formato sale del ANCHO: un 1920x800 es 1080p, un 3840x1600 es 2160p', () => {
  assert.equal(formatoDeVideo(1920, 800), '1080p');
  assert.equal(formatoDeVideo(3840, 1600), '2160p');
  assert.equal(formatoDeVideo(1280, 720), '720p');
  assert.equal(formatoDeVideo(720, 576), '576p');
  assert.equal(formatoDeVideo(720, 480), '480p');
  assert.equal(formatoDeVideo(null, null), null);
});

test('codec de audio como en los nombres reales', () => {
  assert.equal(codecDeAudio('ac3'), 'AC3');
  assert.equal(codecDeAudio('eac3', 'EAC3 Atmos 5.1'), 'EAC3⁄Atmos');
  assert.equal(codecDeAudio('truehd', 'TrueHD Atmos 7.1'), 'TrueHD Atmos');
  assert.equal(codecDeAudio('dts'), 'DTS');
  // Como lo guarda el servidor al medir un Atmos (probe.ts): el codec lleva el sufijo.
  assert.equal(codecDeAudio('eac3_ddp_atmos'), 'EAC3⁄Atmos');
  assert.equal(codecDeAudio('truehd_atmos'), 'TrueHD Atmos');
  assert.equal(codecDeAudio(null), null);
});

test('series: carpeta, temporada y episodio', () => {
  assert.equal(carpetaDeSerie('Apocalipsis', 1994), 'Apocalipsis (1994)');
  assert.equal(carpetaDeTemporada(1), 'Season 1');
  assert.equal(carpetaDeTemporada(0), 'Specials');
  assert.equal(ficheroDeEpisodio('Apocalipsis', 1, 1, 'La Plaga'), 'Apocalipsis - S01E01 - La Plaga');
  assert.equal(ficheroDeEpisodio('Serie', 12, 103, 'Qué: pasa'), 'Serie - S12E103 - Qué pasa', 'en series se quitan los dos puntos');
  assert.equal(carpetaDeSerie('JFK: Destiny Betrayed', 2021), 'JFK Destiny Betrayed (2021)');
  assert.equal(ficheroDeEpisodio('Atrapado en el tiempo (Day Break)', 1, 5, "What If They're Stuck"), "Atrapado en el tiempo (Day Break) - S01E05 - What If They're Stuck");
});
