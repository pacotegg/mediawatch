import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { creditosDeEpisodio } from '../src/media/creditos-episodio.ts';

describe('creditosDeEpisodio', () => {
  it('detecta capítulo nombrado "Credits" o "Créditos"', () => {
    const capitulos = [
      { start: 0, end: 300, title: 'Chapter 1' },
      { start: 300, end: 1200, title: 'Chapter 2' },
      { start: 1200, end: 1260, title: 'End Credits' },
    ];
    const res = creditosDeEpisodio(capitulos, 1260);
    assert.equal(res.length, 1);
    assert.equal(res[0].kind, 'credits');
    assert.equal(res[0].start_s, 1200);
    assert.equal(res[0].end_s, 1260);
    assert.equal(res[0].confidence, 95);
  });

  it('detecta último capítulo genérico si todos son genéricos y dura entre 25s y 300s', () => {
    const capitulos = [
      { start: 0, end: 600, title: 'Chapter 1' },
      { start: 600, end: 1200, title: 'Chapter 2' },
      { start: 1200, end: 1280, title: 'Chapter 3' },
    ];
    const res = creditosDeEpisodio(capitulos, 1280);
    assert.equal(res.length, 1);
    assert.equal(res[0].start_s, 1200);
    assert.equal(res[0].confidence, 70);
  });

  it('descarta si el último capítulo genérico es demasiado largo (> 300s)', () => {
    const capitulos = [
      { start: 0, end: 600, title: 'Chapter 1' },
      { start: 600, end: 1200, title: 'Chapter 2' },
    ];
    // Restante = 600s (> 300s) -> no son créditos
    const res = creditosDeEpisodio(capitulos, 1200);
    assert.equal(res.length, 0);
  });

  it('descarta si los capítulos no son genéricos ni nombrados créditos', () => {
    const capitulos = [
      { start: 0, end: 600, title: 'Escena del robo' },
      { start: 600, end: 1200, title: 'Persecución en el puente' },
      { start: 1200, end: 1260, title: 'Conversación en la cafetería' },
    ];
    const res = creditosDeEpisodio(capitulos, 1260);
    assert.equal(res.length, 0);
  });
});
