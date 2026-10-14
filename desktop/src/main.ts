import { app, BrowserWindow, ipcMain, Menu, session } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buscarMpv, hayReproduccion, reproducir } from './mpv';

const COOKIE = 'cineteca_session';
const ficheroConfig = () => join(app.getPath('userData'), 'config.json');
let ventana: BrowserWindow | null = null;

function leerServidor(): string | null {
  try {
    const url = JSON.parse(readFileSync(ficheroConfig(), 'utf8')).servidor;
    return typeof url === 'string' && url ? url : null;
  } catch {
    return null;
  }
}

const origen = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };

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
  if (!exe) return { ok: false, error: `No se encontró mpv. Copia mpv.exe en ${carpetaMpv} o instálalo en el PATH.` };
  const galletas = await session.defaultSession.cookies.get({ url: servidor, name: COOKIE });
  if (!galletas[0]) return { ok: false, error: 'No hay sesión iniciada' };
  try {
    await reproducir(exe, { servidor, token: galletas[0].value, fileId: o.fileId, itemId: o.itemId, episodeId: o.episodeId, start: o.start, title: o.title.slice(0, 200) });
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
  });
  app.on('window-all-closed', () => app.quit());
}
