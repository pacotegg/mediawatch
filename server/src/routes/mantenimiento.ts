import { execFile } from 'node:child_process';
import { appendFileSync, readdirSync, statfsSync, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { backupBaseDeDatosEnWorker, optimizarBaseDeDatosEnWorker, tamanoBaseDeDatos } from '../db.ts';
import { limpiarCache as limpiarCacheImagenes } from '../media/images.ts';
import { limpiarHuerfanas as limpiarTrickplayHuerfano } from '../media/trickplay.ts';
import { requireUser } from './auth.ts';
import { avisosSmart, avisosWindows } from '../media/salud-discos.ts';
import { enviarMensaje } from '../media/avisos.ts';
import { hayAlguienViendo } from '../media/ocupado.ts';
import { crearReinicio, type ModoReinicio } from '../media/reinicio.ts';

/*
 * Tamaño total y número de ficheros de una carpeta, sin bajar a subcarpetas
 * raras. Async y cediendo el hilo cada 500 ficheros: la caché de imágenes ha
 * llegado a tener 63.613, un `statSync` por cada uno sin ceder es el mismo
 * fallo que el escaneo completo, y esto lo dispara cualquiera que abra
 * Ajustes → Mantenimiento.
 */
async function tamanoCarpeta(dir: string): Promise<{ bytes: number; ficheros: number }> {
  let bytes = 0;
  let ficheros = 0;
  let vistos = 0;
  const pila = [dir];
  while (pila.length) {
    const actual = pila.pop()!;
    let entradas: string[];
    try {
      entradas = readdirSync(actual);
    } catch {
      continue;
    }
    for (const nombre of entradas) {
      const ruta = join(actual, nombre);
      let st;
      try {
        st = statSync(ruta);
      } catch {
        continue;
      }
      if (st.isDirectory()) pila.push(ruta);
      else {
        bytes += st.size;
        ficheros++;
      }
      if (++vistos % 500 === 0) await new Promise((r) => setImmediate(r));
    }
  }
  return { bytes, ficheros };
}

/*
 * Mantenimiento al estilo Plex: vaciar caché, retirar huérfanos y optimizar
 * la base de datos, todo a la vista y a un clic desde Ajustes en vez de
 * quedarse creciendo en silencio para siempre.
 */
type Aviso = { nivel: 'error' | 'aviso'; texto: string };

/*
 * Si las bibliotecas responden, en asíncrono y como mucho cada 5 minutos: están en E:, que se duerme, y un
 * `existsSync` con el disco dormido congelaba el servidor ~7 s en cada consulta (Ajustes pregunta cada 60 s).
 * Entre comprobaciones se avisa con lo de la última.
 */
let bibliotecasCaidas: { name: string; path: string }[] = [];
let ultimaComprobacion = 0;
async function comprobarBibliotecas() {
  if (Date.now() - ultimaComprobacion < 5 * 60_000) return;
  ultimaComprobacion = Date.now();
  const libs = db.prepare('SELECT name, path FROM libraries').all() as { name: string; path: string }[];
  const caidas: typeof libs = [];
  for (const l of libs) if (!(await access(l.path).then(() => true, () => false))) caidas.push(l);
  bibliotecasCaidas = caidas;
}

/**
 * Lo que conviene mirar y hasta ahora solo se veía yendo a buscarlo: una biblioteca que no responde (disco
 * desmontado), el registro de errores del servidor con contenido, una copia de seguridad que no se hace o el
 * disco de los datos casi lleno. Barato a propósito: no recorre carpetas.
 */
async function avisosDeSalud(): Promise<Aviso[]> {
  const avisos: Aviso[] = [];

  await comprobarBibliotecas();
  for (const l of bibliotecasCaidas) avisos.push({ nivel: 'error', texto: `La biblioteca «${l.name}» no responde (${l.path}): ¿está montado el disco?` });

  try {
    const st = statSync(join(DATA_DIR, 'server.err'));
    const dias = (Date.now() - st.mtimeMs) / 86_400_000;
    if (st.size > 0 && dias < 7) {
      avisos.push({ nivel: 'aviso', texto: `El registro de errores del servidor (data/server.err) tiene ${Math.ceil(st.size / 1024)} KB, la última vez hace ${dias < 1 ? 'menos de un día' : `${Math.floor(dias)} días`}.` });
    }
  } catch { /* sin registro: nada que avisar */ }

  try {
    const copias = readdirSync(join(DATA_DIR, 'copias')).filter((f) => f.startsWith('tvwatch-') && (f.endsWith('.db') || f.endsWith('.db.gz'))).sort();
    const ultima = copias.at(-1);
    const horas = ultima ? (Date.now() - statSync(join(DATA_DIR, 'copias', ultima)).mtimeMs) / 3_600_000 : Infinity;
    if (horas > 36) avisos.push({ nivel: 'aviso', texto: ultima ? `La última copia de seguridad de la base tiene ${Math.floor(horas / 24)} días.` : 'No hay ninguna copia de seguridad de la base.' });
  } catch {
    avisos.push({ nivel: 'aviso', texto: 'No hay ninguna copia de seguridad de la base.' });
  }

  try {
    const f = statfsSync(DATA_DIR);
    const libre = f.bavail * f.bsize;
    if (libre < 20e9) avisos.push({ nivel: libre < 5e9 ? 'error' : 'aviso', texto: `Quedan ${(libre / 1e9).toFixed(1)} GB libres en el disco de los datos.` });
  } catch { /* plataforma sin statfs */ }

  // Salud de los discos: lo que dice Windows (sin administrador) y el detalle SMART si la tarea programada lo deja.
  avisos.push(...avisosWindows(), ...avisosSmart());

  return avisos;
}

export default async function mantenimientoRoutes(app: FastifyInstance) {
  app.get('/api/mantenimiento/avisos', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'No autorizado' });
    return { avisos: await avisosDeSalud() };
  });

  app.get('/api/mantenimiento/estado', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });

    const cache = await tamanoCarpeta(join(DATA_DIR, 'cache', 'images'));
    const trickplay = await tamanoCarpeta(join(DATA_DIR, 'trickplay'));
    const copias = (() => {
      try {
        return readdirSync(join(DATA_DIR, 'copias')).filter((f) => f.endsWith('.db') || f.endsWith('.db.gz')).sort();
      } catch {
        return [];
      }
    })();

    return {
      baseDeDatos: { bytes: tamanoBaseDeDatos() },
      cacheImagenes: cache,
      trickplay,
      copias: { total: copias.length, ultima: copias.at(-1) ?? null },
    };
  });

  app.post('/api/mantenimiento/limpiar', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'No autorizado' });

    const cacheImagenes = await limpiarCacheImagenes();
    const trickplayHuerfano = await limpiarTrickplayHuerfano();
    return { cacheImagenes, trickplayHuerfano };
  });

  app.post('/api/mantenimiento/optimizar', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede optimizar la base de datos' });

    const antes = tamanoBaseDeDatos();
    await optimizarBaseDeDatosEnWorker();
    return { antes, despues: tamanoBaseDeDatos() };
  });

  app.post('/api/mantenimiento/copia', async (req, reply) => {
    const user = requireUser(req);
    if (!user.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede hacer copias de seguridad' });

    const ruta = await backupBaseDeDatosEnWorker();
    return { ruta };
  });

  /*
   * Reinicio con aviso (pedido desde la app del móvil, 19/10/2026): ver media/reinicio.ts. Solo administradores, y solo si
   * hay vigilante que lo levante después; si no, salir dejaría el servidor parado y sin forma de arrancarlo desde el móvil.
   */
  const reinicio = crearReinicio({
    ahora: () => Date.now(),
    // Solo la señal de actividad, que ya no refresca una pausa (ver /api/progress): con la tabla `playbacks` una película en
    // pausa bloqueaba el reinicio «cuando libre» para siempre.
    alguienViendo: () => hayAlguienViendo(),
    sesiones: () => {
      const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
      return (db.prepare('SELECT substr(token, 1, 8) AS s FROM sessions WHERE COALESCE(last_seen, created_at) >= ?').all(desde) as { s: string }[]).map((r) => r.s);
    },
    enviarMensaje,
    salir: () => {
      app.log.warn('reinicio con aviso: saliendo; lo levanta el vigilante');
      // app.log no llega a ningún fichero: sin esta línea, una salida por el botón no se distinguía de otra cualquiera.
      try { appendFileSync(join(DATA_DIR, 'latido.log'), `${new Date().toISOString()}  [servidor] reinicio pedido por un administrador\n`); } catch { /* nada */ }
      // Cerrar sin esperar a nadie más de 3 s: un streaming abierto no debe impedir la salida.
      const forzar = setTimeout(() => process.exit(0), 3000);
      void app.close().finally(() => { clearTimeout(forzar); process.exit(0); });
    },
  });
  setInterval(() => { try { reinicio.tic(); } catch (e) { app.log.error(e); } }, 5000).unref();

  /** ¿Hay un `vigilar-servidor.ps1` vivo? Se pregunta a Windows; sin respuesta en 8 s, se da por no. */
  function hayVigilante(): Promise<boolean> {
    if (process.platform !== 'win32') return Promise.resolve(false);
    return new Promise((resolve) => {
      const p = execFile('powershell.exe',
        ['-NoProfile', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'vigilar-servidor' }).Count"],
        { timeout: 8000, windowsHide: true }, (err, out) => resolve(!err && Number(String(out).trim()) > 0));
      p.on('error', () => resolve(false));
    });
  }

  app.get('/api/mantenimiento/reinicio', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    const desde = new Date(Date.now() - 120_000).toISOString();
    const viendo = (db.prepare('SELECT COUNT(*) AS n FROM playbacks WHERE updated_at >= ? AND finished = 0').get(desde) as { n: number }).n;
    return { ...reinicio.estado(), viendo };
  });

  app.post('/api/mantenimiento/reinicio', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    const cuerpo = (req.body ?? {}) as { modo?: string; mensaje?: string };
    if (cuerpo.modo !== 'ya' && cuerpo.modo !== 'cuando-libre') return reply.code(400).send({ error: 'modo debe ser «ya» o «cuando-libre»' });
    if (!reinicio.estado().pendiente && !(await hayVigilante())) {
      return reply.code(409).send({ error: 'No hay vigilante (vigilar-servidor.ps1) vivo: el servidor no volvería a arrancar solo.' });
    }
    return reinicio.pedir(cuerpo.modo as ModoReinicio, cuerpo.mensaje);
  });

  app.post('/api/mantenimiento/reinicio/cancelar', async (req, reply) => {
    if (!requireUser(req).is_admin) return reply.code(403).send({ error: 'Solo un administrador' });
    return reinicio.cancelar();
  });
}
