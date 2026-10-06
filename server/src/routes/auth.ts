import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { toString } from 'qrcode';
import { config, DATA_DIR } from '../config.ts';
import { db } from '../db.ts';
import { formatoDeImagen } from '../scanner/tmdb.ts';

export type User = {
  id: number;
  name: string;
  color: string | null;
  is_admin: number;
  has_pin?: number;
  has_avatar?: number;
  kid_ratings?: string[] | null;
};

const COOKIE = 'cineteca_session';
const PAIRING_TTL_MS = 10 * 60_000;

/** Codes live in memory only: they are useless after ten minutes anyway. */
const pending = new Map<string, { token: string; createdAt: number; userId: number | null }>();
const AVATAR_COLORS = ['#e8b64c', '#5ac8fa', '#ff6b6b', '#8e7cff', '#3ddc97', '#ff9f43', '#f368e0', '#54a0ff'];

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/*
 * Dentro de casa y desde internet no son lo mismo.
 *
 * En la red de casa, un perfil sin PIN es una comodidad razonable: quien esta
 * en el salon ya esta en el salon. Desde fuera es una puerta abierta, y este
 * servidor puede borrar peliculas con su carpeta.
 *
 * Se distingue por las cabeceras que pone el proxy inverso: solo llegan si la
 * peticion ha entrado por el, o sea desde fuera. Alguien de casa podria
 * falsificarlas, pero eso solo le haria pasar por «de fuera», que es el lado
 * estricto: no hay nada que ganar.
 */
function esIpLocalOTailscale(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/, '');
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  if (/^10\./.test(clean)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(clean)) return true;
  if (/^192\.168\./.test(clean)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(clean)) return true;
  return false;
}

export function deFuera(req: FastifyRequest): boolean {
  if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-proto']) return true;
  return !esIpLocalOTailscale(req.ip);
}

/**
 * Freno a la fuerza bruta.
 *
 * Un PIN de cuatro cifras son diez mil combinaciones: sin freno, un script las
 * prueba todas en un par de minutos, y no habia ninguno. Cinco fallos y la
 * direccion se queda fuera un cuarto de hora. Vive en memoria porque reiniciar
 * el servidor ya es castigo bastante para quien lo este intentando, y porque no
 * merece la pena escribir en disco en cada intento fallido.
 */
const MAX_FALLOS = 5;
const CASTIGO_MS = 15 * 60_000;
const fallos = new Map<string, { veces: number; hasta: number }>();

function frenado(ip: string): number {
  const f = fallos.get(ip);
  if (!f) return 0;
  if (Date.now() > f.hasta) {
    fallos.delete(ip);
    return 0;
  }
  return f.veces >= MAX_FALLOS ? Math.ceil((f.hasta - Date.now()) / 1000) : 0;
}

function apuntarFallo(ip: string) {
  const f = fallos.get(ip) ?? { veces: 0, hasta: 0 };
  f.veces++;
  f.hasta = Date.now() + CASTIGO_MS;
  fallos.set(ip, f);
}

function olvidarFallos(ip: string) {
  fallos.delete(ip);
}

/**
 * Accepts a cookie or a bearer token. Television and mobile clients cannot
 * rely on cookies — they run from their own origin, not the server's — so the
 * same session table is reachable through an Authorization header.
 */
/**
 * Una sesion sin usar durante medio ano se considera abandonada.
 *
 * Antes no caducaban nunca: el token que se emparejo una vez con la tele valia
 * para siempre y no habia forma de retirar un dispositivo perdido. Mientras se
 * use, se renueva sola; el unico que pierde acceso es el que ya no entra.
 */
const CADUCIDAD_DIAS = 180;

export function limpiarSesiones() {
  const borradas = db
    .prepare(`DELETE FROM sessions WHERE COALESCE(last_seen, created_at) < datetime('now', ?)`)
    .run(`-${CADUCIDAD_DIAS} days`);
  return borradas.changes;
}

// Escribir en cada peticion serian miles de escrituras por pelicula; con una
// vez por hora basta para saber si una sesion sigue viva.
const MARCA_CADA_MS = 60 * 60_000;
const vistas = new Map<string, number>();

function marcarUso(token: string, req: FastifyRequest) {
  const ahora = Date.now();
  if ((vistas.get(token) ?? 0) + MARCA_CADA_MS > ahora) return;
  vistas.set(token, ahora);

  const agente = String(req.headers['user-agent'] ?? '');
  const dispositivo = /tizen|smart-?tv/i.test(agente)
    ? 'Televisión'
    : /android|okhttp/i.test(agente)
      ? 'Android'
      : /iphone|ipad/i.test(agente)
        ? 'iOS'
        : 'Navegador';
  db.prepare('UPDATE sessions SET last_seen = ?, device = COALESCE(device, ?) WHERE token = ?')
    .run(new Date().toISOString(), dispositivo, token);
}

function tokenDe(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;

  // The television's AVPlay opens a plain URL and offers no way to attach an
  // Authorization header, so the video endpoints also accept ?token=.
  const query = (req.query as { token?: string } | undefined)?.token;

  return bearer ?? query ?? req.cookies[COOKIE] ?? null;
}

/**
 * El aparato que hace la petición: los ocho primeros caracteres de su token.
 * Es lo que ya se enseña en «Dispositivos» y lo que usa la pestaña de
 * actividad para mandar un aviso a este aparato y no a otro del mismo perfil.
 */
export function sesionDe(req: FastifyRequest): string | null {
  const t = tokenDe(req);
  return t ? t.slice(0, 8) : null;
}

export function currentUser(req: FastifyRequest): User | null {
  const token = tokenDe(req);
  if (!token) return null;

  /*
   * Las fechas se guardan en ISO con «T»; `datetime('now')` de SQLite da un
   * espacio, y como texto la «T» siempre es mayor, así que la caducidad no
   * caducaba nunca. `strftime` con el mismo formato sí compara bien.
   */
  const row = db
    .prepare(`SELECT u.id, u.name, u.color, u.is_admin, (u.pin IS NOT NULL) AS has_pin, u.kid_ratings FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token = ? AND COALESCE(s.last_seen, s.created_at) >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`)
    .get(token, `-${CADUCIDAD_DIAS} days`) as any;

  if (row) {
    if (typeof row.kid_ratings === 'string') {
      try { row.kid_ratings = JSON.parse(row.kid_ratings); } catch { row.kid_ratings = null; }
    }
    marcarUso(token, req);
  }
  return row ?? null;
}

export function requireUser(req: FastifyRequest): User {
  const user = currentUser(req);
  if (!user) {
    const err = new Error('No autenticado') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
  return user;
}

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export default async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/dispositivos', async (req) => {
    const user = requireUser(req);
    return db
      .prepare(`SELECT substr(token, 1, 8) AS id, COALESCE(device, 'Desconocido') AS dispositivo,
                       created_at AS desde, COALESCE(last_seen, created_at) AS ultimoUso
                  FROM sessions WHERE user_id = ? ORDER BY ultimoUso DESC`)
      .all(user.id);
  });

  app.delete('/api/auth/dispositivos/:id', async (req, reply) => {
    const user = requireUser(req);
    const id = (req.params as { id: string }).id;
    const r = db.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token, 1, 8) = ?').run(user.id, id);
    if (r.changes === 0) return reply.code(404).send({ error: 'Ese dispositivo ya no está' });
    return { retirados: r.changes };
  });

  /**
   * Quien es este servidor y por donde se le llega.
   *
   * La abre cualquiera a proposito: es lo primero que pregunta un cliente que
   * todavia no tiene sesion, y no dice nada que no sepa ya quien ha llegado
   * hasta aqui. La direccion de fuera solo se entrega **dentro de casa**: a
   * quien ya viene de internet no hay que contarle nada, y a quien esta en el
   * salon le sirve para guardarsela y usarla cuando salga.
   */
  app.get('/api/servidor', async (req) => ({
    nombre: 'Media Watch',
    publica: deFuera(req) ? '' : config.publicUrl,
  }));

  app.get('/api/users', async (req) => {
    const users = db
      .prepare('SELECT id, name, color, is_admin, pin IS NOT NULL AS has_pin, avatar IS NOT NULL AS has_avatar, kid_ratings FROM users ORDER BY id')
      .all() as any[];
    for (const u of users) {
      if (typeof u.kid_ratings === 'string') {
        try { u.kid_ratings = JSON.parse(u.kid_ratings); } catch { u.kid_ratings = null; }
      }
    }
    /*
     * Desde internet solo se ensenan los perfiles que piden PIN. Ensenar uno
     * que no lo pide seria ensenar la llave puesta: cualquiera que de con la
     * direccion entra con un clic.
     */
    const visibles = deFuera(req) ? users.filter((u) => u.has_pin === 1) : users;
    return { users: visibles, setupNeeded: users.length === 0 };
  });

  app.post('/api/users', async (req, reply) => {
    const { name, pin, isAdmin, kidRatings } = req.body as { name?: string; pin?: string; isAdmin?: boolean; kidRatings?: string[] };
    if (!name?.trim()) return reply.code(400).send({ error: 'Falta el nombre' });
    // Seis cifras: un millón de combinaciones, que con el freno de cinco
    // intentos por cuarto de hora no se sacan ni en una vida.
    if (pin && !/^\d{6,}$/.test(String(pin))) return reply.code(400).send({ error: 'El PIN tiene que ser de seis cifras o más, solo números' });

    const first = userCount() === 0;
    const esInfantil = Array.isArray(kidRatings) && kidRatings.length > 0;
    if (!first) {
      const me = requireUser(req);
      if (!me.is_admin && (!esInfantil || me.kid_ratings)) {
        return reply.code(403).send({ error: 'Solo un administrador puede crear perfiles estándar' });
      }
    }

    const color = AVATAR_COLORS[userCount() % AVATAR_COLORS.length];
    const finalAdmin = esInfantil ? 0 : (first || isAdmin ? 1 : 0);
    const kidRatingsJson = esInfantil ? JSON.stringify(kidRatings) : null;
    try {
      const row = db
        .prepare('INSERT INTO users (name, color, pin, is_admin, kid_ratings, created_at) VALUES (?,?,?,?,?,?) RETURNING id')
        .get(name.trim(), color, pin ? hashPin(pin) : null, finalAdmin, kidRatingsJson, new Date().toISOString()) as { id: number };
      return { id: row.id };
    } catch {
      return reply.code(409).send({ error: 'Ya existe un perfil con ese nombre' });
    }
  });

  app.post('/api/auth/login', async (req, reply) => {
    const espera = frenado(req.ip);
    if (espera > 0) {
      const minutos = Math.ceil(espera / 60);
      return reply.code(429).send({ error: 'Demasiados intentos. Prueba dentro de ' + minutos + ' min.' });
    }

    const { userId, pin } = req.body as { userId?: number; pin?: string };
    const user = db.prepare('SELECT id, name, color, is_admin, pin FROM users WHERE id = ?').get(userId ?? -1) as
      | (User & { pin: string | null })
      | undefined;
    if (!user) {
      apuntarFallo(req.ip);
      return reply.code(404).send({ error: 'Perfil no encontrado' });
    }

    // Desde fuera, sin PIN no se entra. Ni aunque el perfil no tenga ninguno:
    // entonces es que ese perfil no esta pensado para salir de casa.
    if (deFuera(req) && !user.pin) {
      return reply.code(403).send({
        error: 'Este perfil no tiene PIN y por eso no vale fuera de casa. Ponle uno desde la red de casa.',
      });
    }

    if (user.pin && !(pin && verifyPin(pin, user.pin))) {
      apuntarFallo(req.ip);
      return reply.code(401).send({ error: 'PIN incorrecto' });
    }
    olvidarFallos(req.ip);

    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, user.id, new Date().toISOString());
    /*
     * `secure` solo cuando la conexion ha venido cifrada. Ponerlo siempre haria
     * que la cookie no viajase por HTTP y la web dejaria de funcionar dentro de
     * casa, que es donde mas se usa.
     */
    const cifrada = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: cifrada,
      maxAge: 60 * 60 * 24 * 365,
    });
    return { id: user.id, name: user.name, color: user.color, is_admin: user.is_admin };
  });

  /**
   * Poner, cambiar o quitar el PIN de un perfil.
   *
   * No existia: los PIN solo se podian poner al crear el perfil, asi que el
   * perfil de casa se quedo sin ninguno y no habia forma de arreglarlo sin
   * borrarlo y perder lo visto. Hace falta saber el PIN actual —salvo que no
   * haya— para que tener la sesion abierta en un movil encima de la mesa no
   * sirva para cambiarlo.
   */
  app.post('/api/users/:id/pin', async (req, reply) => {
    const yo = requireUser(req);
    const id = Number((req.params as { id: string }).id);
    if (yo.id !== id && !yo.is_admin) return reply.code(403).send({ error: 'Ese perfil no es tuyo' });

    const { pin, actual } = req.body as { pin?: string; actual?: string };
    const fila = db.prepare('SELECT pin FROM users WHERE id = ?').get(id) as { pin: string | null } | undefined;
    if (!fila) return reply.code(404).send({ error: 'Perfil no encontrado' });

    if (deFuera(req)) {
      if (!fila.pin) return reply.code(403).send({ error: 'El primer PIN se configura desde la red de casa' });
      if (!pin || String(pin).trim().length === 0) return reply.code(403).send({ error: 'No se puede quitar el PIN desde fuera de casa' });
    }

    if (fila.pin && !(actual && verifyPin(actual, fila.pin))) {
      return reply.code(401).send({ error: 'El PIN actual no es correcto' });
    }
    const nuevoTexto = pin === undefined || pin === null ? '' : String(pin);
    if (nuevoTexto.length > 0 && !/^\d{6,}$/.test(nuevoTexto)) {
      return reply.code(400).send({ error: 'El PIN tiene que ser de seis cifras o más, solo números' });
    }

    const nuevo = nuevoTexto ? hashPin(nuevoTexto) : null;
    db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(nuevo, id);

    /*
     * Cambiar el PIN cierra las demas sesiones de ese perfil. Es lo que se
     * espera de un cambio de contrasena: si se cambia porque alguien se lo
     * sabia, dejarle la sesion abierta no arregla nada. La de quien lo cambia
     * se queda, para no echarse uno mismo.
     */
    const miToken = (req.headers.authorization ?? '').replace(/^Bearer /i, '') || req.cookies[COOKIE] || '';
    const cerradas = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(id, miToken);
    return { ok: true, tienePin: Boolean(nuevo), sesionesCerradas: cerradas.changes };
  });

  app.put('/api/users/:id', async (req, reply) => {
    const yo = requireUser(req);
    const id = Number((req.params as { id: string }).id);
    if (yo.id !== id && !yo.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede editar otros perfiles' });

    const user = db.prepare('SELECT id, name, color, is_admin, pin FROM users WHERE id = ?').get(id) as
      | (User & { pin: string | null })
      | undefined;
    if (!user) return reply.code(404).send({ error: 'Perfil no encontrado' });

    const body = req.body as { name?: string; color?: string; isAdmin?: boolean; pin?: string | null; kidRatings?: string[] | null };

    if (body.name !== undefined) {
      const nuevoNombre = body.name.trim();
      if (!nuevoNombre) return reply.code(400).send({ error: 'El nombre no puede estar vacío' });
      try {
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(nuevoNombre, id);
      } catch {
        return reply.code(409).send({ error: 'Ya existe otro perfil con ese nombre' });
      }
    }

    if (body.color !== undefined) {
      db.prepare('UPDATE users SET color = ? WHERE id = ?').run(body.color, id);
    }

    if (body.isAdmin !== undefined && yo.is_admin) {
      if (id === yo.id && !body.isAdmin) {
        const otrosAdmins = (db.prepare('SELECT COUNT(*) as n FROM users WHERE is_admin = 1 AND id != ?').get(id) as { n: number }).n;
        if (otrosAdmins === 0) return reply.code(400).send({ error: 'No puedes quitarte el rol de admin si eres el único' });
      }
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(body.isAdmin ? 1 : 0, id);
    }

    if (body.kidRatings !== undefined) {
      if (!yo.is_admin && yo.id === id) return reply.code(403).send({ error: 'No puedes modificar tu propio control parental' });
      if (!yo.is_admin && yo.kid_ratings) return reply.code(403).send({ error: 'Solo un adulto puede configurar perfiles infantiles' });
      const kr = Array.isArray(body.kidRatings) && body.kidRatings.length > 0 ? JSON.stringify(body.kidRatings) : null;
      db.prepare('UPDATE users SET kid_ratings = ? WHERE id = ?').run(kr, id);
      if (kr) {
        db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(id);
      }
    }

    if (body.pin !== undefined) {
      if (yo.id !== id && !yo.is_admin) return reply.code(403).send({ error: 'No puedes cambiar el PIN de otro usuario' });
      const pinStr = body.pin === null || body.pin === '' ? '' : String(body.pin);
      if (pinStr.length > 0 && !/^\d{6,}$/.test(pinStr)) {
        return reply.code(400).send({ error: 'El PIN tiene que ser de seis cifras o más, solo números' });
      }
      const nuevoHash = pinStr.length > 0 ? hashPin(pinStr) : null;
      db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(nuevoHash, id);
      const miToken = (req.headers.authorization ?? '').replace(/^Bearer /i, '') || req.cookies[COOKIE] || '';
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(id, miToken);
    }

    return { ok: true };
  });

  app.delete('/api/users/:id', async (req, reply) => {
    const yo = requireUser(req);
    const id = Number((req.params as { id: string }).id);
    if (!yo.is_admin) return reply.code(403).send({ error: 'Solo un administrador puede borrar perfiles' });
    if (id === yo.id) return reply.code(400).send({ error: 'No puedes borrar tu propio perfil' });

    const total = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
    if (total <= 1) return reply.code(400).send({ error: 'No se puede borrar el único usuario del sistema' });

    const user = db.prepare('SELECT avatar FROM users WHERE id = ?').get(id) as { avatar: string | null } | undefined;
    if (user?.avatar && existsSync(user.avatar)) {
      try { unlinkSync(user.avatar); } catch {}
    }

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { ok: true };
  });

  app.get('/api/users/:id/avatar', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = db.prepare('SELECT avatar FROM users WHERE id = ?').get(id) as { avatar: string | null } | undefined;
    if (!row?.avatar || !existsSync(row.avatar)) return reply.code(404).send({ error: 'Sin avatar' });
    const ext = extname(row.avatar).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return reply.header('Content-Type', mime).header('Cache-Control', 'public, max-age=86400').send(createReadStream(row.avatar));
  });

  app.post('/api/users/:id/avatar', { bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const yo = requireUser(req);
    const id = Number((req.params as { id: string }).id);
    if (yo.id !== id && !yo.is_admin) return reply.code(403).send({ error: 'No autorizado' });

    const user = db.prepare('SELECT id, avatar FROM users WHERE id = ?').get(id) as { id: number; avatar: string | null } | undefined;
    if (!user) return reply.code(404).send({ error: 'Usuario no encontrado' });

    const datos = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(datos) || datos.length === 0) return reply.code(400).send({ error: 'No llegó ninguna imagen' });
    const ext = formatoDeImagen(datos);
    if (!ext) return reply.code(400).send({ error: 'Eso no es una imagen JPEG, PNG ni WebP' });

    const dir = join(DATA_DIR, 'avatars');
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, `${id}.${ext}`);
    if (user.avatar && user.avatar !== dest && existsSync(user.avatar)) {
      try { unlinkSync(user.avatar); } catch {}
    }
    writeFileSync(dest, datos);
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(dest, id);
    return { ok: true };
  });

  app.delete('/api/users/:id/avatar', async (req, reply) => {
    const yo = requireUser(req);
    const id = Number((req.params as { id: string }).id);
    if (yo.id !== id && !yo.is_admin) return reply.code(403).send({ error: 'No autorizado' });

    const user = db.prepare('SELECT avatar FROM users WHERE id = ?').get(id) as { avatar: string | null } | undefined;
    if (user?.avatar && existsSync(user.avatar)) {
      try { unlinkSync(user.avatar); } catch {}
    }
    db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(id);
    return { ok: true };
  });

  /**
   * Pairing for devices with no keyboard. The television shows the code, and
   * whoever is already signed in on a phone or laptop approves it — nobody has
   * to type a PIN with a remote control.
   */
  app.post('/api/auth/device/start', async (req, reply) => {
    // Emparejar un aparato es algo que se hace en el salon, con la tele
    // delante. Desde internet no hace falta y solo seria superficie regalada.
    if (deFuera(req)) return reply.code(403).send({ error: 'El emparejado se hace desde la red de casa' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const token = randomBytes(32).toString('hex');
    pending.set(code, { token, createdAt: Date.now(), userId: null });

    for (const [key, value] of pending) {
      if (Date.now() - value.createdAt > PAIRING_TTL_MS) pending.delete(key);
    }

    // La tele enseña este enlace como QR: se escanea con el móvil y el
    // emparejado se resuelve solo, sin salir de la app ni teclear nada.
    const host = req.headers.host ?? `${config.host}:${config.port}`;
    return { code, expiresInSeconds: PAIRING_TTL_MS / 1000, url: `http://${host}/emparejar?c=${code}` };
  });

  app.get('/api/qr.svg', async (req, reply) => {
    const { d } = req.query as { d?: string };
    if (!d) return reply.code(400).send('falta el contenido');
    /*
     * Solo el enlace de emparejamiento. Antes convertía cualquier texto en QR
     * sin pedir sesión: un código malicioso servido desde tu propio dominio,
     * que es justo lo que hace creíble a un QR. Es lo único para lo que se usa
     * (`/emparejar?c=NNNNNN`), así que se acota a eso.
     */
    if (!/^https?:\/\/[^/]+\/emparejar\?c=\d{6}$/.test(d)) {
      return reply.code(400).send('contenido no permitido');
    }
    const svg = await toString(d, { type: 'svg', margin: 1, width: 420, color: { dark: '#07070a', light: '#ffffff' } });
    return reply.header('Content-Type', 'image/svg+xml').header('Cache-Control', 'no-store').send(svg);
  });

  app.post('/api/auth/device/claim', async (req, reply) => {
    const user = requireUser(req);
    const { code } = req.body as { code?: string };
    const entry = code ? pending.get(code) : undefined;
    if (!entry) return reply.code(404).send({ error: 'Ese código no existe o ha caducado' });
    if (Date.now() - entry.createdAt > PAIRING_TTL_MS) {
      pending.delete(code!);
      return reply.code(410).send({ error: 'El código ha caducado' });
    }

    entry.userId = user.id;
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(entry.token, user.id, new Date().toISOString());
    return { ok: true, user: user.name };
  });

  app.post('/api/auth/device/pin', async (req, reply) => {
    if (deFuera(req)) return reply.code(403).send({ error: 'El emparejado se hace desde la red de casa' });
    const espera = frenado(req.ip);
    if (espera > 0) {
      return reply.code(429).send({ error: 'Demasiados intentos. Prueba dentro de ' + Math.ceil(espera / 60) + ' min.' });
    }

    const { code, userId, pin } = req.body as { code?: string; userId?: number; pin?: string };
    const entry = code ? pending.get(code) : undefined;
    if (!entry || Date.now() - entry.createdAt > PAIRING_TTL_MS) {
      return reply.code(404).send({ error: 'Ese código no existe o ha caducado' });
    }
    const user = db.prepare('SELECT id, name, pin FROM users WHERE id = ?').get(userId ?? -1) as
      | { id: number; name: string; pin: string | null }
      | undefined;
    if (!user) return reply.code(404).send({ error: 'Perfil no encontrado' });

    if (user.pin && !(pin && verifyPin(pin, user.pin))) {
      apuntarFallo(req.ip);
      return reply.code(401).send({ error: 'PIN incorrecto' });
    }
    olvidarFallos(req.ip);

    entry.userId = user.id;
    db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(entry.token, user.id, new Date().toISOString());
    return { ok: true, user: user.name };
  });

  app.get('/api/auth/device/poll', async (req, reply) => {
    /*
     * Esta ruta entrega un token de sesión entero al que acierte el código, y
     * está abierta sin autenticar porque la tele todavía no tiene ninguno.
     * Son seis cifras: 800.000 combinaciones, ventana de diez minutos y, hasta
     * ahora, ni freno ni límite de origen. La tele sondea cada dos segundos y
     * suele llevarse el token primero, así que la carrera era estrecha —pero
     * la superficie estaba ahí y desde internet no hace ninguna falta, igual
     * que `device/start`.
     *
     * Se cierra desde internet y ya está: nada de freno por intentos fallidos,
     * porque la tele sigue sondeando cada dos segundos aunque el código haya
     * caducado, y esos 404 legítimos agotarían el contador en diez segundos
     * dejando a la casa entera sin poder iniciar sesión.
     */
    if (deFuera(req)) return reply.code(403).send({ error: 'El emparejado se hace desde la red de casa' });

    const { code } = req.query as { code?: string };
    const entry = code ? pending.get(code) : undefined;
    if (!entry) return reply.code(404).send({ error: 'Código desconocido' });
    if (!entry.userId) return { paired: false };

    pending.delete(code!);
    const user = db.prepare('SELECT id, name, color, is_admin FROM users WHERE id = ?').get(entry.userId) as User;
    return { paired: true, token: entry.token, user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const user = currentUser(req);
    if (!user) return reply.code(401).send({ error: 'No autenticado' });
    return user;
  });
}
