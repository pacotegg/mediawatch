import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { ROOT, config } from './config.ts';
import { db } from './db.ts';
import animeRoutes from './routes/anime.ts';
import authRoutes, { currentUser, limpiarSesiones } from './routes/auth.ts';
import descargaRoutes from './routes/descargas.ts';
import enrichRoutes from './routes/enrich.ts';
import libraryRoutes from './routes/library.ts';
import mandoRoutes from './routes/mando.ts';
import playRoutes from './routes/play.ts';
import preferenceRoutes from './routes/preferences.ts';
import subtitleRoutes from './routes/subtitles.ts';
import { scanAll, type ScanProgress } from './scanner/scan.ts';

/*
 * El proxy inverso es de fiar; nadie mas.
 *
 * Sin esto, todo lo que entra por Caddy llega con la IP 127.0.0.1, y el freno
 * de intentos fallidos del login contaria a todo internet como una sola
 * direccion: un solo atacante dejaria fuera a la familia entera. Con la lista
 * acotada al propio equipo, la IP real solo se acepta de quien puede saberla
 * —Caddy— y un cliente de casa no puede inventarse la suya.
 */
const app = Fastify({
  logger: false,
  bodyLimit: 2 * 1024 * 1024,
  trustProxy: ['127.0.0.1', '::1'],
});

await app.register(cookie);

/*
 * A Tizen or Android client runs from its own origin, so every request it makes
 * is cross-origin. Credentials are never reflected here: those clients carry a
 * bearer token instead of a cookie, which keeps this from widening the browser
 * session's exposure.
 */
app.addHook('onRequest', async (req, reply) => {
  if (process.env.CINETECA_LOG === '1') {
    console.log(`${new Date().toISOString().slice(11, 19)} ${req.ip} ${req.method} ${req.url.slice(0, 90)} origin=${req.headers.origin ?? '-'}`);
  }
  const origin = req.headers.origin;
  if (!origin) return;

  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Vary', 'Origin');
  reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  reply.header('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, X-TvWatch-Mode');

  // El `return` no es adorno: sin él el gancho siguiente se ejecuta igual e
  // intenta responder a una petición ya contestada. Fastify lanza, el error se
  // traga, y el preflight de la tele se queda colgado para siempre.
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

/*
 * Guardián único para toda la API.
 *
 * Antes cada ruta decidía por su cuenta y 31 se habían quedado sin comprobar
 * nada: `/api/play/:fileId/stream` entregaba el MKV entero a cualquiera que
 * llegase al puerto, y bastaba con probar números de fichero. En la red de casa
 * daba igual; en cuanto esto sea accesible desde fuera, no.
 *
 * Va aquí y no ruta por ruta a propósito: así una ruta nueva nace protegida y
 * hay que apuntarla explícitamente en la lista de abajo para abrirla.
 */
const ABIERTAS = new Set([
  '/api/servidor', // quien es y por donde se le llega: lo primero que se pregunta
  '/api/users', // la pantalla de «¿quién está viendo?» va antes de tener sesión
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/device/start', // la tele pide el código sin tener aún token
  '/api/auth/device/poll',
  '/api/qr.svg', // el QR de emparejamiento se pinta en esa misma pantalla
]);

app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'OPTIONS') return;

  const ruta = req.url.split('?')[0];
  if (!ruta.startsWith('/api/')) return; // la web y la app de la tele son ficheros
  if (ABIERTAS.has(ruta)) return;

  if (!currentUser(req)) {
    return reply.code(401).send({ error: 'No autenticado' });
  }
});
/*
 * Un error no capturado mataba el proceso y dejaba la casa sin servidor, en
 * silencio. Se registra y se sigue: un fallo sirviendo un fichero raro no puede
 * tirar abajo la reproducción de los demás.
 */
process.on('uncaughtException', (err) => {
  console.error('[fatal evitado]', err);
});

/*
 * Un error dentro de un gancho deja la petición sin respuesta y el cliente
 * esperando. Registrarlo aquí es lo que permitió ver que el preflight de la
 * tele se estaba quedando colgado.
 */
app.addHook('onError', async (req, _reply, err) => {
  console.error(`[error] ${req.method} ${req.url.slice(0, 80)} -> ${err.message}`);
});
process.on('unhandledRejection', (motivo) => {
  console.error('[promesa sin capturar]', motivo);
});

// Las sesiones abandonadas se retiran al arrancar y una vez al dia.
limpiarSesiones();
setInterval(limpiarSesiones, 24 * 60 * 60_000).unref();

/*
 * Escaneo automatico. El pipeline anade y recodifica ficheros a diario, y hasta
 * ahora TvWatch solo se enteraba si alguien pulsaba «escanear»: a los cinco dias
 * habia 62 ficheros en la base de datos que ya no existian, y sus fichas decian
 * «No se pudieron leer las pistas». Un escaneo completo tarda ~30 s.
 */
let escaneando = false;
function escanearSiToca(motivo: string) {
  if (escaneando) return;
  escaneando = true;
  try {
    const t0 = Date.now();
    const r = scanAll();
    console.log(`[escaneo ${motivo}] ${r.map((x) => `${x.name}: ${x.count}`).join(', ')} en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (err) {
    console.error('[escaneo] fallo:', (err as Error).message);
  } finally {
    escaneando = false;
  }
}
setTimeout(() => escanearSiToca('al arrancar'), 20_000).unref();
// Cada 24 h; para el resto esta el boton de «Actualizar biblioteca» en ajustes.
setInterval(() => escanearSiToca('periodico'), 24 * 60 * 60_000).unref();

await app.register(authRoutes);
await app.register(libraryRoutes);
await app.register(playRoutes);
await app.register(preferenceRoutes);
await app.register(enrichRoutes);
await app.register(subtitleRoutes);
await app.register(animeRoutes);
await app.register(descargaRoutes);
await app.register(mandoRoutes);

let scanning = false;

app.post('/api/scan', async () => {
  if (scanning) return { started: false, reason: 'Ya hay un escaneo en curso' };
  scanning = true;
  queueMicrotask(() => {
    try {
      const results = scanAll();
      console.log('Escaneo completado:', results.map((r) => `${r.name}=${r.count}`).join(' '));
    } catch (err) {
      console.error('Escaneo fallido:', err);
    } finally {
      scanning = false;
    }
  });
  return { started: true };
});

app.get('/api/scan/stream', async (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (scanning) {
    send('error', { message: 'Ya hay un escaneo en curso' });
    return reply.raw.end();
  }

  scanning = true;
  try {
    const results = scanAll((p: ScanProgress) => send('progress', p));
    send('done', { results });
  } catch (err) {
    send('error', { message: String(err) });
  } finally {
    scanning = false;
    reply.raw.end();
  }
});

app.get('/api/stats', async () => {
  return db
    .prepare(`SELECT
      (SELECT COUNT(*) FROM items WHERE kind='movie') AS movies,
      (SELECT COUNT(*) FROM items WHERE kind='show')  AS shows,
      (SELECT COUNT(*) FROM episodes)                 AS episodes,
      (SELECT COUNT(*) FROM users)                    AS users,
      (SELECT SUM(size) FROM media_files)             AS bytes`)
    .get();
});

/*
 * La app de televisión también se sirve por HTTP: así se puede probar desde el
 * navegador de la tele antes de empaquetarla e instalarla como app de Tizen.
 */
const tvDist = join(ROOT, 'tv', 'dist');
if (existsSync(tvDist)) {
  await app.register(fastifyStatic, { root: tvDist, prefix: '/tv/', decorateReply: false });
}

const webDist = join(ROOT, 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'No encontrado' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: config.port, host: config.host });
console.log(`TvWatch en http://localhost:${config.port}  (red local: http://<ip-del-equipo>:${config.port})`);
