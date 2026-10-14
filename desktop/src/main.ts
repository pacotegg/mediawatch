import { app, BrowserWindow, ipcMain, Menu, session } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { iniciarActualizaciones } from './actualizaciones';
import { buscarMpv, hayReproduccion, pararReproduccion, reproducir } from './mpv';

const COOKIE = 'cineteca_session';
const ficheroConfig = () => join(app.getPath('userData'), 'config.json');
let ventana: BrowserWindow | null = null;

function leerConfig(): { servidor?: unknown; mpvArgs?: unknown } {
  try {
    return JSON.parse(readFileSync(ficheroConfig(), 'utf8'));
  } catch {
    return {};
  }
}

function leerServidor(): string | null {
  const url = leerConfig().servidor;
  return typeof url === 'string' && url ? url : null;
}

/**
 * Salida de escape para mpv: `"mpvArgs": ["--vo=x11"]` en el config del usuario. Hace falta en equipos
 * donde la salida normal de mpv no arranca (máquinas virtuales sin GPU, por ejemplo). Solo opciones
 * largas, para que un valor raro en el fichero no acabe siendo un nombre de fichero que mpv abra.
 */
function opcionesExtraMpv(): string[] {
  const v = leerConfig().mpvArgs;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^--[a-z0-9-]+(=|$)/i.test(x)).slice(0, 20) : [];
}

const origen = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };

/**
 * Identificador nativo de la ventana, para que mpv dibuje DENTRO de ella (`--wid`) en vez de abrir otra:
 * así el vídeo va siempre en la misma ventana y lo pinta mpv, que es lo rápido. En Windows es un HWND de
 * 64 bits; en X11, el XID. Si no se puede averiguar, mpv abre su propia ventana y todo lo demás sigue igual.
 */
function widDeLaVentana(): string | null {
  try {
    const b = ventana?.getNativeWindowHandle();
    if (!b) return null;
    return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
  } catch {
    return null;
  }
}

function abrir() {
  if (!ventana) return;
  const servidor = leerServidor();
  if (servidor) void ventana.loadURL(servidor);
  else void ventana.loadFile(join(__dirname, 'conectar.html'));
}

/** Enlaces de fuera (Watchmode, tráileres…): ventana aparte, sin el puente del escritorio y sin Node. Solo http(s). */
function abrirExterno(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  const w = new BrowserWindow({
    width: 1100, height: 780, parent: ventana ?? undefined, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Dentro de esa ventana, los enlaces nuevos reutilizan la misma en vez de abrir más.
  w.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:\/\//i.test(u)) void w.loadURL(u); return { action: 'deny' }; });
  void w.loadURL(url);
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1400, height: 860, backgroundColor: '#08080b', title: 'Media Watch', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // La ventana principal solo navega por el servidor; cualquier otra dirección se abre en una ventana propia.
  ventana.webContents.on('will-navigate', (e, url) => {
    const servidor = leerServidor();
    if (url.startsWith('file:') || (servidor && origen(url) === origen(servidor))) return;
    e.preventDefault();
    abrirExterno(url);
  });
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    abrirExterno(url);
    return { action: 'deny' };
  });
  abrir();
}

ipcMain.handle('mw:guardar-servidor', async (e, url: unknown) => {
  if (!e.senderFrame?.url.startsWith('file:')) return { ok: false, error: 'No permitido' };
  if (typeof url !== 'string') return { ok: false, error: 'Dirección no válida' };
  const limpia = url.replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/i.test(limpia)) return { ok: false, error: 'Escribe la dirección completa, por ejemplo http://192.168.1.10:8730' };
  try {
    const r = await fetch(`${limpia}/api/salud`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    return { ok: false, error: 'No se pudo conectar con esa dirección' };
  }
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(ficheroConfig(), JSON.stringify({ servidor: limpia }));
  abrir();
  return { ok: true };
});

ipcMain.handle('mw:reproducir', async (e, o: any) => {
  const servidor = leerServidor();
  // Solo la web del servidor configurado puede pedir una reproducción.
  if (!servidor || origen(e.senderFrame?.url ?? '') !== origen(servidor)) return { ok: false, error: 'No permitido' };
  const entero = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!entero(o?.fileId) || !entero(o?.itemId) || (o.episodeId !== null && !entero(o.episodeId)) || typeof o.start !== 'number' || !(o.start >= 0) || typeof o.title !== 'string') {
    return { ok: false, error: 'Petición no válida' };
  }
  if (hayReproduccion()) return { ok: false, error: 'Ya hay una reproducción abierta' };
  const carpetaMpv = join(app.getPath('userData'), 'mpv');
  const exe = buscarMpv([join(process.resourcesPath ?? '', 'mpv'), carpetaMpv]);
  if (!exe) {
    const pista = process.platform === 'win32' ? `Copia mpv.exe en ${carpetaMpv}` : 'Instálalo con el gestor de paquetes (paquete «mpv»)';
    return { ok: false, error: `No se encontró mpv. ${pista} o déjalo en el PATH.` };
  }
  const galletas = await session.defaultSession.cookies.get({ url: servidor, name: COOKIE });
  if (!galletas[0]) return { ok: false, error: 'No hay sesión iniciada' };
  const externos = Array.isArray(o.externos)
    ? o.externos.filter((s: any) => typeof s?.id === 'string' && /^external-\d+$/.test(s.id)).slice(0, 40).map((s: any) => ({ id: s.id }))
    : [];
  try {
    await reproducir(exe, {
      servidor, token: galletas[0].value, fileId: o.fileId, itemId: o.itemId, episodeId: o.episodeId,
      start: o.start, title: o.title.slice(0, 200),
      wid: widDeLaVentana() ?? undefined,
      audio: entero(o.audio) ? o.audio : null,
      subtitulo: typeof o.subtitulo === 'string' && /^(off|embedded-\d+|external-\d+)$/.test(o.subtitulo) ? o.subtitulo : null,
      externos,
      extra: opcionesExtraMpv(),
    }, () => ventana?.webContents.send('mw:fin'));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Archivo', submenu: [
        { label: 'Cambiar de servidor', click: () => { try { writeFileSync(ficheroConfig(), '{}'); } catch { /* sin config */ } abrir(); } },
        { role: 'quit', label: 'Salir' },
      ] },
      { label: 'Ver', submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'togglefullscreen', label: 'Pantalla completa' }] },
    ]));
    crearVentana();
    iniciarActualizaciones(() => ventana);
  });
  // Si se cierra la ventana con el vídeo incrustado dentro, mpv se queda sin sitio: se para con ella.
  app.on('window-all-closed', () => { pararReproduccion(); app.quit(); });
}
