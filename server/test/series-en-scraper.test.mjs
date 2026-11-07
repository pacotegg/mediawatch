import test from 'node:test';
import assert from 'node:assert/strict';
import { esCarpetaDeSerie } from '../src/scanner/scan.ts';
import { resolverDestino } from '../src/scanner/enviar.ts';

test('esCarpetaDeSerie: detecta carpetas con episodios de serie', () => {
  const archivosSerie = [
    { name: 'Finales.Felices.1x01.Piloto.mkv', path: 'C:/Videos/Finales Felices/Finales.Felices.1x01.Piloto.mkv', isDir: false },
    { name: 'Finales.Felices.1x02.La.Pelea.mkv', path: 'C:/Videos/Finales Felices/Finales.Felices.1x02.La.Pelea.mkv', isDir: false },
  ];
  assert.equal(esCarpetaDeSerie(archivosSerie), true);

  const conTvshowNfo = [
    { name: 'tvshow.nfo', path: 'C:/Videos/MiSerie/tvshow.nfo', isDir: false },
    { name: 'video.mkv', path: 'C:/Videos/MiSerie/video.mkv', isDir: false },
  ];
  assert.equal(esCarpetaDeSerie(conTvshowNfo), true);

  const conTemporada = [
    { name: 'Season 1', path: 'C:/Videos/MiSerie/Season 1', isDir: true },
  ];
  assert.equal(esCarpetaDeSerie(conTemporada), true);

  const peliculaSola = [
    { name: 'Logan (2017).mkv', path: 'C:/Videos/Logan (2017)/Logan (2017).mkv', isDir: false },
    { name: 'poster.jpg', path: 'C:/Videos/Logan (2017)/poster.jpg', isDir: false },
  ];
  assert.equal(esCarpetaDeSerie(peliculaSola), false);
});

test('resolverDestino: resuelve automáticamente biblioteca correcta según tipo', () => {
  const pelicula = { id: 1, kind: 'movie', folder: 'C:/Videos/Logan', library_id: 10, raiz: 'C:/Videos' };
  const serie = { id: 2, kind: 'show', folder: 'C:/Videos/Finales Felices', library_id: 10, raiz: 'C:/Videos' };

  // Para una película, si se sugiere E:\Peliculas, la mantiene
  assert.equal(resolverDestino(pelicula, 'E:\\Peliculas').toLowerCase(), 'e:\\peliculas');

  // Para una serie, aunque se sugiera E:\Peliculas (o nada), resuelve a E:\Series
  assert.equal(resolverDestino(serie, 'E:\\Peliculas').toLowerCase(), 'e:\\series');
  assert.equal(resolverDestino(serie).toLowerCase(), 'e:\\series');
});
