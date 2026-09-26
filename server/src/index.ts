import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { DATA_DIR, ROOT, config } from './config.ts';
import { backupBaseDeDatosEnWorker, db } from './db.ts';
import { limpiarCache as limpiarCacheImagenes } from './media/images.ts';
import { hayAlguienViendo } from './media/ocupado.ts';
import { limpiarHuerfanas as limpiarTrickplayHuerfano } from './media/trickplay.ts';
import animeRoutes from './routes/anime.ts';
import actividadRoutes from './routes/actividad.ts';
import authRoutes, { currentUser, limpiarSesiones } from './routes/auth.ts';
import descargaRoutes from './routes/descargas.ts';
import enrichRoutes from './routes/enrich.ts';
import libraryRoutes from './routes/library.ts';
import mandoRoutes from './routes/mando.ts';
import mantenimientoRoutes from './routes/mantenimiento.ts';
import playRoutes from './routes/play.ts';
import preferenceRoutes from './routes/preferences.ts';
import subtitleRoutes from './routes/subtitles.ts';
import { scanAllEnWorker, type ScanProgress } from './scanner/scan.ts';

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
    console.log(`${new Date().toISOString().slice(11, 19)} ${req.ip} ${req.method} ${sinToken(req.url).slice(0, 90)} origin=${req.headers.origin ?? '-'}`);
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
/*
 * Método y ruta, no solo la ruta. Comparando solo la ruta, abrir el `GET` de
 * `/api/users` abría de paso su `POST` —el que crea perfiles—, que se salvaba
 * únicamente porque el propio handler vuelve a comprobar que quien pide sea
 * administrador. Funcionaba, pero la siguiente ruta que naciera con dos
 * métodos no tendría por qué tener esa suerte.
 */
const ABIERTAS = new Set([
  'GET /api/servidor', // quien es y por donde se le llega: lo primero que se pregunta
  'GET /api/users', // la pantalla de «¿quién está viendo?» va antes de tener sesión
  'POST /api/users', // crear el primer perfil, cuando todavía no hay ninguno
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/device/start', // la tele pide el código sin tener aún token
  'GET /api/auth/device/poll',
  'GET /api/qr.svg', // el QR de emparejamiento se pinta en esa misma pantalla
]);

app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'OPTIONS') return;

  const ruta = req.url.split('?')[0];
  if (!ruta.startsWith('/api/')) return; // la web y la app de la tele son ficheros
  if (ABIERTAS.has(`${req.method} ${ruta}`)) return;

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

/*
 * Vigilancia del propio servidor, para cazar los cuelgues.
 *
 * Pasa esto: el proceso sigue vivo y el puerto escuchando, pero deja de
 * contestar a todo —hasta a la raíz—, se acumulan conexiones en `CloseWait` y
 * al rato vuelve solo. Se han descartado ya, con medición: no es el log sin
 * recortar, no es un bucle de CPU (11 s en 4 minutos), y no son los
 * `statSync`/`existsSync` sobre `E:` del camino de petición (0,2 ms en el peor
 * caso con el disco leyendo seis películas a la vez).
 *
 * Como no se sabe qué es, se mide en vez de seguir adivinando. Tres cosas, a
 * `data/latido.log` para no ensuciar el registro de errores:
 *
 * 1. Cuánto se retrasa el bucle de eventos. Un `setInterval` de un segundo que
 *    llega tarde solo puede ser porque algo bloqueó el hilo: con la hora y los
 *    milisegundos del retraso se sabrá cuándo y cuánto.
 * 2. Qué peticiones estaban en vuelo en ese momento y desde cuándo, que es lo
 *    que dirá cuál es la que ata el hilo.
 * 3. Cuántas peticiones se han atendido, para distinguir «bloqueado» de
 *    «nadie le está pidiendo nada».
 */
const enVuelo = new Map<string, { url: string; desde: number }>();
let atendidas = 0;
let siguientePeticion = 0;

/*
 * El token de sesión va en la URL de los vídeos y de cada imagen porque ni
 * AVPlay ni una etiqueta `<img>` pueden mandar cabeceras. Eso está asumido,
 * pero no puede acabar escrito en un fichero: `latido.log` crece solo y lleva
 * meses guardado. Misma regla que las claves de API, que ya no se registran.
 */
export function sinToken(url: string): string {
  return url.replace(/([?&]token=)[^&]*/gi, '$1oculto');
}

app.addHook('onRequest', async (req) => {
  const id = String(++siguientePeticion);
  (req as unknown as { idLatido?: string }).idLatido = id;
  enVuelo.set(id, { url: `${req.method} ${sinToken(req.url).slice(0, 90)}`, desde: Date.now() });
});
app.addHook('onResponse', async (req) => {
  const id = (req as unknown as { idLatido?: string }).idLatido;
  if (id) enVuelo.delete(id);
  atendidas++;
});

{
  const registro = join(DATA_DIR, 'latido.log');
  const apuntar = (texto: string) => {
    try {
      appendFileSync(registro, `${new Date().toISOString()}  ${texto}\n`);
    } catch {
      /* si no se puede apuntar, no se tumba el servidor por ello */
    }
  };

  const PERIODO = 1000;
  // A partir de medio segundo de retraso ya no es ruido del planificador.
  const AVISAR_DESDE = 500;
  let ultimo = Date.now();
  let atendidasAntes = 0;

  apuntar(`[arranque] vigilancia en marcha, avisa desde ${AVISAR_DESDE} ms de retraso`);
  setInterval(() => {
    const ahora = Date.now();
    const retraso = ahora - ultimo - PERIODO;
    ultimo = ahora;
    if (retraso >= AVISAR_DESDE) {
      const enCurso = [...enVuelo.values()]
        .sort((a, b) => a.desde - b.desde)
        .slice(0, 5)
        .map((p) => `${p.url} (${ahora - p.desde} ms)`);
      apuntar(
        `[bloqueo] el bucle llegó ${retraso} ms tarde | en vuelo: ${enVuelo.size}` +
          ` | atendidas desde el último aviso: ${atendidas - atendidasAntes}` +
          (enCurso.length ? ` | las más viejas: ${enCurso.join(' ; ')}` : ''),
      );
      atendidasAntes = atendidas;
    }
  }, PERIODO).unref();
}

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
async function escanearSiToca(motivo: string) {
  if (escaneando) return;
  escaneando = true;
  try {
    const t0 = Date.now();
    const r = await scanAllEnWorker();
    try {
      writeFileSync(SELLO_ESCANEO, new Date().toISOString());
    } catch {
      /* sin sello se reintentará dentro de una hora; no vale tumbar nada por esto */
    }
    console.log(`[escaneo ${motivo}] ${r.map((x) => `${x.name}: ${x.count}`).join(', ')} en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (err) {
    console.error('[escaneo] fallo:', (err as Error).message);
  } finally {
    escaneando = false;
  }
}

/*
 * Cuándo escanear, después de descubrir por qué el servidor «no conectaba».
 *
 * `scanAll()` recorría los 5.566 ficheros de `E:` en una única transacción
 * síncrona de SQLite: mientras duraba, el único hilo de Node estaba ocupado y
 * el servidor no contestaba a nadie, ni a la raíz. Medido con el latido del
 * bucle de eventos: **235 segundos clavados**, y el propio log del escaneo
 * decía «en 235 s» esa misma vez. Ha llegado a tardar 12, 17, 63 y 235
 * segundos según lo ocupado que estuviera el disco mecánico.
 *
 * Lo peor era que saltaba 20 segundos después de **cada arranque**: reiniciar
 * el servidor significaba dejarlo muerto unos minutos justo después, y eso es
 * lo que se veía desde el móvil como «no se llega al servidor».
 *
 * Ahora hay dos arreglos, uno encima del otro:
 * - `scanLibrary` (scanner/scan.ts) trocea en lotes de 25 carpetas, cada lote
 *   en su propia transacción, cediendo el hilo entre lotes — nunca a mitad de
 *   una transacción abierta, que es donde `node:sqlite` sí podría entrelazarse
 *   mal con otra petición. El escaneo ya no bloquea ni cuando le toca correr.
 * - Y ni falta que hace la mayoría de las veces: nada al arrancar, una pasada
 *   de madrugada y el botón «Actualizar biblioteca ahora» para cuando acabas
 *   de dejar algo y lo quieres ver ya. La fecha va en un fichero y no en un
 *   contador en memoria, que con un servidor que se reinicia a diario no
 *   llegaría a escanear nunca.
 *
 * Había además un vigilante de `fs.watch` sobre `E:` que reescaneaba la
 * carpeta de cada aviso del sistema de ficheros. Se quitó el 24/09: el log
 * tenía **20.072 líneas de «indexado» para 1.838 títulos distintos** —la
 * biblioteca entera reindexada unas once veces—, porque `scanFolder()` releía
 * la carpeta y abría una transacción sin comprobar siquiera si algo había
 * cambiado. Y lo hacía **síncrono, en el hilo principal y sin mirar si había
 * alguien viendo**, así que competía por el plato mecánico a mitad de
 * película y una ráfaga de avisos bloqueaba el bucle de eventos (lo más
 * probable detrás del parón de 90 s del 24/09 a las 07:11). El escaneo
 * completo es además estrictamente más completo: también retira de la base
 * los ficheros que han desaparecido, cosa que `scanFolder()` no hacía.
 */
const SELLO_ESCANEO = join(DATA_DIR, 'ultimo-escaneo.txt');
const HORA_ESCANEO = 2; // de madrugada, con la casa dormida y el disco libre

/*
 * Dos condiciones, no una. La de las 02:00 es la normal; la de las 48 h es la
 * red de seguridad para cuando el HTPC estuvo apagado o el servidor caído a
 * esa hora, que si no se saltaría el escaneo ese día sin que nadie se entere.
 */
function tocaEscanear(): boolean {
  let cuando: number;
  try {
    cuando = Date.parse(readFileSync(SELLO_ESCANEO, 'utf8').trim());
    if (!Number.isFinite(cuando)) return true;
  } catch {
    return true; // sin sello: nunca se ha escaneado desde que existe esto
  }
  const horas = (Date.now() - cuando) / 3_600_000;
  return (new Date().getHours() === HORA_ESCANEO && horas >= 20) || horas >= 48;
}
setInterval(() => {
  if (!tocaEscanear()) return;
  if (hayAlguienViendo()) return; // ya volverá dentro de una hora
  void escanearSiToca('periodico');
}, 60 * 60_000).unref();

/*
 * Mantenimiento al estilo Plex, en silencio y sin esperar a que alguien pulse
 * un boton. Huerfanos de trickplay: carpetas que dejo atras un fichero
 * retirado del escaneo. Cache de imagenes: miniaturas cuya carpeta de origen
 * ya cambio de caratula y que nadie ha vuelto a pedir en 45 dias.
 */
async function limpiarSiToca() {
  try {
    const trickplay = await limpiarTrickplayHuerfano();
    const cache = await limpiarCacheImagenes();
    if (trickplay || cache) console.log(`[limpieza] trickplay huerfano: ${trickplay}, cache de imagenes: ${cache}`);
  } catch (err) {
    console.error('[limpieza] fallo:', (err as Error).message);
  }
}
setTimeout(() => void limpiarSiToca(), 40_000).unref();
setInterval(() => void limpiarSiToca(), 7 * 24 * 60 * 60_000).unref();

// Copia de seguridad diaria; se rota sola a las 14 mas recientes en `data/copias`.
// En su propio hilo: medido, VACUUM INTO bloqueaba ~466 ms sobre 168 MB, y
// esta corre sola, sin que nadie la pida — el servidor no debe congelarse
// por una copia de fondo. Ver `optimizarBaseDeDatosEnWorker` en db.ts.
async function copiaSiToca() {
  try {
    const ruta = await backupBaseDeDatosEnWorker();
    console.log(`[copia] guardada en ${ruta}`);
  } catch (err) {
    console.error('[copia] fallo:', (err as Error).message);
  }
}
setTimeout(() => void copiaSiToca(), 60_000).unref();
setInterval(() => void copiaSiToca(), 24 * 60 * 60_000).unref();

await app.register(authRoutes);
await app.register(libraryRoutes);
await app.register(playRoutes);
await app.register(preferenceRoutes);
await app.register(enrichRoutes);
await app.register(subtitleRoutes);
await app.register(animeRoutes);
await app.register(actividadRoutes);
await app.register(descargaRoutes);
await app.register(mandoRoutes);
await app.register(mantenimientoRoutes);

let scanning = false;

app.post('/api/scan', async () => {
  if (scanning) return { started: false, reason: 'Ya hay un escaneo en curso' };
  scanning = true;
  // Sin esperar: la petición contesta ya, y el escaneo (ahora por lotes, cede
  // el hilo entre lotes) sigue de fondo sin bloquear al resto del servidor.
  void (async () => {
    try {
      const results = await scanAllEnWorker();
      console.log('Escaneo completado:', results.map((r) => `${r.name}=${r.count}`).join(' '));
    } catch (err) {
      console.error('Escaneo fallido:', err);
    } finally {
      scanning = false;
    }
  })();
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
    const results = await scanAllEnWorker((p: ScanProgress) => send('progress', p));
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
