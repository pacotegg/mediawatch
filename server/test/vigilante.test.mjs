/*
 * El vigilante de los discos: que lo que aparece entre solo, y que NO entre antes de tiempo.
 *
 * Aquí ya hubo un vigilante y se quitó el 24/09/2026 porque escaneaba a cada aviso, en el hilo principal y sin mirar
 * si alguien estaba viendo algo. Estas pruebas fijan justo lo que lo arregla: agrupar, esperar el silencio, no tocar
 * nada si el servidor está ocupado, y pedir un escaneo completo cuando lo que ha entrado es una tanda entera.
 *
 * Tiempos cortos a propósito (espera 300 ms, tic 50 ms) para que la batería siga durando segundos.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const base = mkdtempSync(join(tmpdir(), 'mediawatch-vigilante-'));
process.env.MEDIAWATCH_DATA_DIR = join(base, 'datos');
mkdirSync(process.env.MEDIAWATCH_DATA_DIR);
const { arrancarVigilante, carpetaDelTitulo } = await import('../src/scanner/vigilante.ts');

const E = join(base, 'E');
const video = (r) => { mkdirSync(join(r, '..'), { recursive: true }); const fd = openSync(r, 'w'); ftruncateSync(fd, 6 * 1024 * 1024); closeSync(fd); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Arranca un vigilante que apunta lo que le piden escanear en vez de escanear. */
function conVigilante(extra = {}) {
  const llamadas = [];
  const v = arrancarVigilante({
    escanear: async (raiz, carpetas) => { llamadas.push({ raiz, carpetas: [...carpetas].sort() }); },
    esperaMs: 300,
    ticMs: 50,
    raices: [E],
    registrar: () => {},
    ...extra,
  });
  return { v, llamadas };
}

before(() => mkdirSync(E, { recursive: true }));
/*
 * En Windows la carpeta VIGILADA guarda un handle abierto después de cerrar el vigilante y borrarla da EPERM, incluso
 * con `maxRetries`. Afecta solo a la raíz que se vigila —borrar la carpeta de un título sí funciona, y hay una prueba
 * que lo comprueba—, así que aquí se intenta y si no se puede se deja: es un temporal del sistema, no parte de la
 * prueba. Lo que NO se hace es dar por bueno que se borró.
 */
after(async () => {
  await esperar(300);
  try {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* el sistema se lo lleva; no es lo que se está probando */
  }
});

test('de qué título es cada aviso', () => {
  const r = 'E:\\Peliculas';
  assert.equal(carpetaDelTitulo(r, 'Peli (2026)\\Peli (2026).mkv'), resolve('E:\\Peliculas\\Peli (2026)'), 'la carpeta del título, no el fichero');
  assert.equal(carpetaDelTitulo(r, 'Serie\\Temporada 1\\cap.mkv'), resolve('E:\\Peliculas\\Serie'), 'de primer nivel aunque el vídeo esté hondo');
  assert.equal(carpetaDelTitulo(r, 'Suelta (2020).mkv'), resolve('E:\\Peliculas\\Suelta (2020).mkv'), 'un vídeo suelto en la raíz es un título por sí mismo');
  assert.equal(carpetaDelTitulo(r, 'Peli (2026)\\Peli (2026).srt'), null, 'los subtítulos no disparan nada');
  assert.equal(carpetaDelTitulo(r, 'Peli (2026)\\extras\\escena.mkv'), null, 'SKIP_DIRS: los extras tienen su propia vía');
  assert.equal(carpetaDelTitulo(r, '_entrando\\a medias.mkv'), null, 'las carpetas que empiezan por _ las ignora también el escáner');
  assert.equal(carpetaDelTitulo(r, 'Peli (2026)\\Peli-trailer.mkv'), null, 'JUNK: un trailer no es un título');
  assert.equal(carpetaDelTitulo(r, 'Peli (2026)\\Peli (2026).mkv.part'), null, 'una descarga a medias no tiene extensión de vídeo');
  assert.equal(carpetaDelTitulo(r, 'Peli (2026)\\_recon_a1b2c3.mkv'), null, 'un fichero de trabajo del pipeline mantiene la extensión: hay que mirar el nombre');
  assert.equal(carpetaDelTitulo(r, null), null, 'fs.watch puede avisar sin nombre');
  assert.equal(carpetaDelTitulo(r, 'Peli (2026)'), null, 'un aviso de la carpeta a secas no basta: hace falta ver un vídeo');
});

test('una película nueva entra sola, una sola vez y con su carpeta', async () => {
  const { v, llamadas } = conVigilante();
  try {
    video(join(E, 'Nueva (2026)', 'Nueva (2026).mkv'));
    await esperar(150);
    assert.deepEqual(llamadas, [], 'todavía no: aún no ha pasado el silencio que se exige');
    await esperar(400);
    assert.equal(llamadas.length, 1, 'un escaneo, no uno por aviso (el fallo del vigilante de 2026-09)');
    assert.equal(llamadas[0].raiz, resolve(E));
    assert.deepEqual(llamadas[0].carpetas, [resolve(join(E, 'Nueva (2026)'))]);
    assert.deepEqual(v.pendientes(), [], 'lo escaneado deja de estar pendiente');
  } finally {
    v.parar();
  }
});

test('mientras se sigue escribiendo no se escanea: la espera se reinicia', async () => {
  const { v, llamadas } = conVigilante();
  const f = join(E, 'Copiandose (2026)', 'Copiandose (2026).mkv');
  try {
    video(f);
    // Cuatro escrituras repartidas en más de lo que dura la espera: si no se reiniciara, ya habría escaneado.
    for (let i = 0; i < 4; i++) {
      await esperar(120);
      writeFileSync(f, `trozo ${i}`);
    }
    assert.deepEqual(llamadas, [], 'un fichero a medio copiar no se escanea, por larga que sea la copia');
    await esperar(450);
    assert.equal(llamadas.length, 1, 'y al callarse, un único escaneo');
  } finally {
    v.parar();
  }
});

test('si hay alguien viendo algo no se escanea, pero no se pierde', async () => {
  let viendo = true;
  const { v, llamadas } = conVigilante({ ocupado: () => viendo });
  try {
    video(join(E, 'Mientras ves (2026)', 'Mientras ves (2026).mkv'));
    await esperar(500);
    assert.deepEqual(llamadas, [], 'el disco es mecánico: no se toca mientras alguien ve algo');
    assert.deepEqual(v.pendientes(), [resolve(join(E, 'Mientras ves (2026)'))], 'sigue apuntado');
    viendo = false;
    await esperar(200);
    assert.equal(llamadas.length, 1, 'al acabar la película, entra');
  } finally {
    v.parar();
  }
});

test('una tanda entera pide escaneo completo, no una carpeta cada vez', async () => {
  const { v, llamadas } = conVigilante({ topeCarpetas: 3 });
  try {
    for (let i = 0; i < 5; i++) video(join(E, `Tanda ${i} (2026)`, `Tanda ${i}.mkv`));
    await esperar(600);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].raiz, null, 'raíz nula = escaneo completo: cuesta ~30 s y además retira lo que ya no está');
    assert.deepEqual(v.pendientes(), []);
  } finally {
    v.parar();
  }
});

/*
 * Vigilar NO puede estorbar al borrado de un título: el panel y la app borran la carpeta de una película, y si el
 * vigilante retuviera un handle de ella, borrar fallaría con EPERM. Un vigilante recursivo abre handle de la raíz
 * vigilada, no de cada subcarpeta — esto lo comprueba en vez de darlo por supuesto.
 */
test('se puede borrar la carpeta de un título mientras se vigila', async () => {
  const { v } = conVigilante();
  try {
    const carpeta = join(E, 'Para borrar (2026)');
    video(join(carpeta, 'Para borrar (2026).mkv'));
    await esperar(100);
    rmSync(carpeta, { recursive: true });
    assert.equal(existsSync(carpeta), false, 'borrar un título sigue funcionando con el vigilante en marcha');
  } finally {
    v.parar();
  }
});

test('parar deja de vigilar', async () => {
  const { v, llamadas } = conVigilante();
  v.parar();
  video(join(E, 'Despues de parar (2026)', 'Despues de parar (2026).mkv'));
  await esperar(500);
  assert.deepEqual(llamadas, []);
});
