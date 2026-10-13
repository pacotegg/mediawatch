/*
 * Pruebas de autenticacion del servidor, contra un servidor REAL arrancado en modo portable
 * (datos en una carpeta temporal, puerto libre, solo localhost). No tocan la base de datos
 * ni la biblioteca de nadie.
 *
 *   npm test --workspace server
 *
 * Nacieron del fallo del 13/10/2026: /%61pi/libraries llegaba a la ruta sin pasar por el
 * guardian, porque este miraba el texto crudo de la URL y el enrutador descodifica «%61» a «a».
 * Las rutas se leen de los propios ficheros, de modo que una ruta nueva entra sola en la prueba.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(SERVER, 'src');

// ---- rutas y lista de abiertas, leidas del codigo -------------------------------------------
function leerAbiertas() {
  const t = readFileSync(join(SRC, 'index.ts'), 'utf8');
  const bloque = t.slice(t.indexOf('const ABIERTAS = new Set(['));
  const hasta = bloque.indexOf(']);');
  return new Set([...bloque.slice(0, hasta).matchAll(/'((?:GET|POST|PUT|DELETE|PATCH) \/api\/[^']+)'/g)].map((m) => m[1]));
}

function leerRutas() {
  const ficheros = ['index.ts', ...readdirSync(join(SRC, 'routes')).filter((f) => f.endsWith('.ts')).map((f) => 'routes/' + f)];
  const rutas = new Set();
  for (const f of ficheros) {
    const t = readFileSync(join(SRC, f), 'utf8');
    for (const m of t.matchAll(/app\.(get|post|put|delete|patch)\(\s*(['"`])([^'"`]+)\2/g)) {
      if (m[3].includes('${') || !m[3].startsWith('/api/')) continue;
      rutas.add(m[1].toUpperCase() + ' ' + m[3].replace(/:[A-Za-z_]+/g, '1'));
    }
  }
  return [...rutas].sort();
}

const ABIERTAS = leerAbiertas();
// Excepcion aparte en el guardian: los avatares se ven en la pantalla de entrada, antes de tener sesion.
ABIERTAS.add('GET /api/users/1/avatar');
const RUTAS = leerRutas();

// ---- servidor de prueba -----------------------------------------------------------------------
let proceso;
let datos;
let base;
let stderr = '';

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

async function pedir(metodo, ruta, { cabeceras = {}, cuerpo } = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...cabeceras },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const texto = await res.text();
  return { codigo: res.status, texto };
}

before(async () => {
  const puerto = await puertoLibre();
  base = `http://127.0.0.1:${puerto}`;
  datos = mkdtempSync(join(tmpdir(), 'mediawatch-test-'));
  proceso = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER,
    env: { ...process.env, MEDIAWATCH_DATA_DIR: datos, MEDIAWATCH_HOST: '127.0.0.1', MEDIAWATCH_PORT: String(puerto) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proceso.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });

  for (let i = 0; i < 80; i++) {
    try {
      if ((await pedir('GET', '/api/salud')).codigo === 200) return;
    } catch { /* aun arrancando */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('El servidor de prueba no arranco en 40 s.\n' + stderr);
});

after(async () => {
  if (proceso && proceso.exitCode === null) {
    proceso.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
  if (datos) rmSync(datos, { recursive: true, force: true });
});

// ---- pruebas ----------------------------------------------------------------------------------
describe('guardian de la API sin credenciales', () => {
  test('hay rutas que probar', () => {
    assert.ok(RUTAS.length > 100, `solo se encontraron ${RUTAS.length} rutas: ¿ha cambiado la forma de registrarlas?`);
    assert.ok(ABIERTAS.size >= 5, 'no se pudo leer ABIERTAS de index.ts');
  });

  test('toda ruta cerrada da 401, tambien con la variante «%61pi»', async () => {
    const fallos = [];
    for (const r of RUTAS) {
      const [metodo, ruta] = r.split(' ');
      const variantes = [ruta, ruta.replace('/api/', '/%61pi/')];
      for (const v of variantes) {
        const cerrada = v !== ruta || !ABIERTAS.has(r);
        if (!cerrada) continue;
        const { codigo } = await pedir(metodo, v, { cuerpo: metodo === 'GET' || metodo === 'DELETE' ? undefined : {} });
        if (codigo !== 401) fallos.push(`${metodo} ${v} -> ${codigo}`);
      }
    }
    assert.deepEqual(fallos, [], 'rutas que responden sin sesion:\n  ' + fallos.join('\n  '));
  });

  test('otras formas no canonicas tampoco entregan la API', async () => {
    const fallos = [];
    for (const ruta of ['/%61pi/libraries', '/%61pi/home', '/%61pi/items', '/%61pi/play/1/stream', '/%41pi/libraries', '/api%2Flibraries']) {
      const { codigo, texto } = await pedir('GET', ruta);
      // 401 (guardian) o 404 (el enrutador no la conoce); nunca datos.
      if (codigo === 200 && /^\s*[[{]/.test(texto)) fallos.push(`${ruta} -> ${codigo} con JSON`);
    }
    assert.deepEqual(fallos, []);
  });
});

describe('cabeceras', () => {
  test('las respuestas llevan X-Content-Type-Options: nosniff, y no se rompe el iframe del trailer', async () => {
    for (const ruta of ['/api/salud', '/api/home', '/trailer?v=x']) {
      const res = await fetch(base + ruta, { signal: AbortSignal.timeout(8000) });
      await res.text();
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', ruta);
      // La tele incrusta /trailer en un iframe de otro origen: estas cabeceras lo impedirian.
      assert.equal(res.headers.get('x-frame-options'), null, ruta + ' no debe llevar X-Frame-Options');
      assert.ok(!(res.headers.get('content-security-policy') ?? '').includes('frame-ancestors'), ruta);
    }
  });
});

describe('estaticos', () => {
  test('no se sale de la carpeta con rutas codificadas', async () => {
    for (const ruta of ['/assets/..%2f..%2f..%2fpackage.json', '/assets/%2e%2e/%2e%2e/package.json', '/tv/..%2f..%2fpackage.json']) {
      const { texto } = await pedir('GET', ruta);
      assert.ok(!texto.includes('@tvwatch/server'), `${ruta} entrego un package.json`);
    }
  });
});

describe('primer administrador en modo portable', () => {
  const nuevo = { name: 'Admin', pin: '654321' };

  test('una web ajena (Origin) no puede crearlo', async () => {
    const { codigo } = await pedir('POST', '/api/users', { cuerpo: nuevo, cabeceras: { Origin: 'https://evil.example' } });
    assert.equal(codigo, 403);
  });

  test('un dominio reasignado a localhost (Host) no puede crearlo', async () => {
    const { codigo } = await pedir('POST', '/api/users', {
      cuerpo: nuevo,
      cabeceras: { Host: 'evil.example', Origin: 'http://evil.example' },
    });
    assert.equal(codigo, 403);
  });

  test('exige PIN', async () => {
    const { codigo } = await pedir('POST', '/api/users', { cuerpo: { name: 'Admin' } });
    assert.equal(codigo, 400);
  });

  test('desde localhost, con Origin propio, se crea', async () => {
    const host = new URL(base).host;
    const { codigo } = await pedir('POST', '/api/users', { cuerpo: nuevo, cabeceras: { Host: host, Origin: base } });
    assert.equal(codigo, 200);
  });

  test('despues, crear otro perfil sin sesion da 401', async () => {
    const { codigo } = await pedir('POST', '/api/users', { cuerpo: { name: 'Otro', pin: '123456' } });
    assert.equal(codigo, 401);
  });
});
