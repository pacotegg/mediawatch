/*
 * Control parental en las rutas que listan titulos de pasada: la busqueda por dialogo y la ficha de una persona
 * no pueden ensenar a un perfil infantil titulos que no puede ver. Servidor real con datos temporales.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
let proceso, datos, base, galletaAdmin, galletaNino, nino, persona;
const ids = {};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const puertoLibre = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});
const pedir = (metodo, ruta, { cuerpo, galleta, cabeceras = {} } = {}) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(galleta ? { Cookie: galleta } : {}), ...cabeceras },
  body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  signal: AbortSignal.timeout(8000),
});
const galletaDe = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
const bd = () => { const d = new DatabaseSync(join(datos, 'tvwatch.db')); d.exec('PRAGMA busy_timeout = 10000'); return d; };

before(async () => {
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER, stdio: 'ignore',
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) },
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/salud')).ok) break; } catch { /* arrancando */ }
    await esperar(500);
  }
  const d = bd();
  d.prepare("INSERT OR IGNORE INTO libraries (id,name,path,kind) VALUES (1,'t','x','movie')").run();
  persona = d.prepare("INSERT INTO people (name) VALUES ('Actor Comun') RETURNING id").get().id;
  const genero = d.prepare("INSERT INTO genres (name) VALUES ('Animacion') RETURNING id").get().id;
  // Sagas con caracteres que se codifican en la ruta: la ficha de una con «%» daba 500 por decodificarla dos veces.
  for (const [titulo, saga] of [['Pelicula con %', '100% Real'], ['Pelicula con barra', 'F/X - Coleccion'], ['Otra con %', '100% Real'], ['Otra con barra', 'F/X - Coleccion']]) {
    d.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at, mpaa, collection) VALUES (1,'movie',?,?,?,'x','ES:TP',?)").run(titulo, titulo, titulo, saga);
  }
  for (const [titulo, mpaa] of [['Pelicula de adultos', 'ES:18'], ['Pelicula apta', 'ES:TP']]) {
    const it = d.prepare("INSERT INTO items (library_id, kind, folder, title, search_title, scanned_at, mpaa, collection) VALUES (1,'movie',?,?,?,'x',?,'Saga X') RETURNING id").get(titulo, titulo, titulo, mpaa).id;
    d.prepare('INSERT INTO item_genres (item_id, genre_id) VALUES (?,?)').run(it, genero);
    const f = d.prepare('INSERT INTO media_files (item_id, path, duration, probed) VALUES (?,?,5400,1) RETURNING id').get(it, 'C:/no/existe/' + titulo + '.mkv').id;
    ids[mpaa] = { item: it, file: f };
    const caratula = join(datos, `caratula-${it}.jpg`);
    writeFileSync(caratula, 'imagen de prueba');
    d.prepare('UPDATE items SET poster = ?, fanart = ? WHERE id = ?').run(caratula, caratula, it);
    d.prepare('INSERT INTO item_people (item_id, person_id, role) VALUES (?,?,?)').run(it, persona, 'actor');
    d.prepare("INSERT INTO extras (item_id, path, titulo, tipo, scanned_at) VALUES (?,?,?,?,?)").run(it, 'C:/no/existe/extra-' + titulo + '.mkv', 'Extra', 'Trailer', 'x');
    d.prepare('INSERT INTO dialogue (text, file_id, start_ms) VALUES (?,?,?)').run('una frase compartida muy especial', f, 1000);
  }
  d.close();
  const host = new URL(base).host;
  await pedir('POST', '/api/users', { cuerpo: { name: 'Admin', pin: '654321' }, cabeceras: { Host: host, Origin: base } });
  galletaAdmin = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: 1, pin: '654321' } }));
  nino = (await (await pedir('POST', '/api/users', { cuerpo: { name: 'Peque', pin: '112233', kidRatings: ['TP'] }, galleta: galletaAdmin })).json()).id;
  galletaNino = galletaDe(await pedir('POST', '/api/auth/login', { cuerpo: { userId: nino, pin: '112233' } }));
});

after(async () => {
  if (proceso && proceso.exitCode === null) { proceso.kill(); await esperar(500); }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

const titulos = (lista) => lista.map((x) => x.title).sort();

test('busqueda por dialogo: el adulto ve las dos, el perfil infantil solo la apta', async () => {
  const q = encodeURIComponent('frase compartida');
  const adulto = await (await pedir('GET', `/api/search/dialogue?q=${q}`, { galleta: galletaAdmin })).json();
  assert.deepEqual(titulos(adulto.hits), ['Pelicula apta', 'Pelicula de adultos']);
  const peque = await (await pedir('GET', `/api/search/dialogue?q=${q}`, { galleta: galletaNino })).json();
  assert.deepEqual(titulos(peque.hits), ['Pelicula apta']);
});

test('ficha de una persona: el perfil infantil no ve su filmografia para adultos', async () => {
  const adulto = await (await pedir('GET', `/api/people/${persona}`, { galleta: galletaAdmin })).json();
  assert.deepEqual(titulos(adulto.credits), ['Pelicula apta', 'Pelicula de adultos']);
  const peque = await (await pedir('GET', `/api/people/${persona}`, { galleta: galletaNino })).json();
  assert.deepEqual(titulos(peque.credits), ['Pelicula apta']);
});

test('miniaturas, extras y trailer de un titulo para adultos: nada para el perfil infantil', async () => {
  const a = ids['ES:18'];
  assert.equal((await pedir('GET', `/api/play/${a.file}/trickplay`, { galleta: galletaNino })).status, 404);
  assert.equal((await pedir('GET', `/api/play/${a.file}/trickplay/0`, { galleta: galletaNino })).status, 404);
  assert.deepEqual((await (await pedir('GET', `/api/items/${a.item}/extras`, { galleta: galletaNino })).json()).extras, []);
  assert.equal((await (await pedir('GET', `/api/items/${a.item}/extras`, { galleta: galletaAdmin })).json()).extras.length, 1);
  const extra = (await (await pedir('GET', `/api/items/${a.item}/extras`, { galleta: galletaAdmin })).json()).extras[0];
  assert.equal((await pedir('GET', `/api/extras/${extra.id}/stream`, { galleta: galletaNino })).status, 404);
  assert.equal((await (await pedir('GET', `/api/items/${a.item}/trailer`, { galleta: galletaNino })).json()).trailer, null);
});

test('ficha de un titulo apto: la saga y los parecidos no cuelan titulos para adultos al perfil infantil', async () => {
  const apta = ids['ES:TP'].item;
  const peque = await (await pedir('GET', `/api/items/${apta}`, { galleta: galletaNino })).json();
  assert.deepEqual(titulos(peque.collectionItems), ['Pelicula apta'], 'saga');
  assert.deepEqual(titulos(peque.similar), [], 'parecidos');
  const adulto = await (await pedir('GET', `/api/items/${apta}`, { galleta: galletaAdmin })).json();
  assert.deepEqual(titulos(adulto.collectionItems), ['Pelicula apta', 'Pelicula de adultos']);
  assert.deepEqual(titulos(adulto.similar), ['Pelicula de adultos']);
});

test('sagas cuyo nombre lleva % o /: la ficha de la saga responde (no 500)', async () => {
  for (const [nombre, esperadas] of [['100% Real', ['Otra con %', 'Pelicula con %']], ['F/X - Coleccion', ['Otra con barra', 'Pelicula con barra']]]) {
    const r = await pedir('GET', `/api/collections/${encodeURIComponent(nombre)}`, { galleta: galletaAdmin });
    assert.equal(r.status, 200, nombre);
    assert.deepEqual(titulos((await r.json()).items), esperadas, nombre);
  }
});

test('el papel del arte de una saga se valida: no se puede salir de su carpeta', async () => {
  const r = await pedir('POST', `/api/collections/${encodeURIComponent('Saga X')}/arte`, {
    galleta: galletaAdmin, cuerpo: { url: 'http://127.0.0.1:1/x.jpg', papel: '../../../fuera' },
  });
  assert.equal(r.status, 400);
  const r2 = await pedir('POST', `/api/collections/${encodeURIComponent('Saga X')}/arte/subir?papel=${encodeURIComponent('../../fuera')}`, { galleta: galletaAdmin });
  assert.equal(r2.status, 400);
});

test('caratulas y fondos de un titulo para adultos: 404 para el perfil infantil, 200 para el adulto', async () => {
  const a = ids['ES:18'].item, t = ids['ES:TP'].item;
  for (const papel of ['poster', 'fanart']) {
    assert.equal((await pedir('GET', `/api/items/${a}/${papel}`, { galleta: galletaAdmin })).status, 200, papel + ' adulto');
    assert.equal((await pedir('GET', `/api/items/${a}/${papel}`, { galleta: galletaNino })).status, 404, papel + ' infantil');
    assert.equal((await pedir('GET', `/api/items/${t}/${papel}`, { galleta: galletaNino })).status, 200, papel + ' apto');
  }
});

test('progreso: valores que no valen dan 400, no 500; lo normal sigue funcionando', async () => {
  const t = ids['ES:TP'].item;
  const malos = [{}, { itemId: 'abc', position: 5 }, { itemId: t, position: 'x' }, { itemId: t, position: -4 }, { itemId: 999999, position: 5 }];
  for (const cuerpo of malos) assert.equal((await pedir('POST', '/api/progress', { galleta: galletaNino, cuerpo })).status, 400, JSON.stringify(cuerpo));
  assert.equal((await pedir('POST', '/api/progress', { galleta: galletaNino, cuerpo: { itemId: t, position: 120, duration: 5400 } })).status, 200);
  assert.equal((await pedir('POST', `/api/items/999999/watched`, { galleta: galletaNino, cuerpo: { watched: true } })).status, 404);
  assert.equal((await pedir('POST', `/api/items/${t}/watched`, { galleta: galletaNino, cuerpo: { watched: true } })).status, 200);
});

test('favoritos y resenas: el perfil infantil no ve lo que no puede ver; favorito de un titulo que no existe da 404', async () => {
  const a = ids['ES:18'].item, t = ids['ES:TP'].item;
  // Estaba en favoritos de antes de restringir el perfil: se guarda por la base, no por la API.
  const bd = new DatabaseSync(join(datos, 'tvwatch.db'));
  bd.exec('PRAGMA busy_timeout = 10000');
  bd.prepare('INSERT OR IGNORE INTO favorites (user_id, item_id, added_at) VALUES (?,?,?)').run(nino, a, 'x');
  bd.close();
  assert.equal((await pedir('POST', `/api/items/${t}/favorite`, { galleta: galletaNino, cuerpo: { favorite: true } })).status, 200);
  const favs = await (await pedir('GET', '/api/favorites', { galleta: galletaNino })).json();
  assert.deepEqual(titulos(favs), ['Pelicula apta']);
  assert.equal((await pedir('POST', '/api/items/999999/favorite', { galleta: galletaNino, cuerpo: { favorite: true } })).status, 404);
  assert.deepEqual((await (await pedir('GET', `/api/items/${a}/reviews`, { galleta: galletaNino })).json()).items, []);
  assert.equal((await pedir('GET', `/api/items/${a}/theme`, { galleta: galletaNino })).status, 404);
});
