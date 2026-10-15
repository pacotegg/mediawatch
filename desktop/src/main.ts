import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, session } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { iniciarActualizaciones } from './actualizaciones';
import { buscarMpv, hayReproduccion, ordenar, pararReproduccion, pistasActuales, reproducir, type Estado } from './mpv';

const COOKIE = 'cineteca_session';
const ficheroConfig = () => join(app.getPath('userData'), 'config.json');
let ventana: BrowserWindow | null = null;

function leerConfig(): { servidor?: unknown; mpvArgs?: unknown; ventana?: unknown } {
  try {
    return JSON.parse(readFileSync(ficheroConfig(), 'utf8'));
  } catch {
    return {};
  }
}

/** Cambia solo lo que se pide y deja el resto (antes, cambiar de servidor se llevaba por delante `mpvArgs`). */
function guardarConfig(cambios: Record<string, unknown>) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(ficheroConfig(), JSON.stringify({ ...leerConfig(), ...cambios }));
  } catch {
    /* sin config no pasa nada: se abre con lo de siempre */
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
 * Identificador nativo de una ventana, para que mpv dibuje DENTRO de ella (`--wid`) en vez de abrir otra.
 * En Windows es un HWND de 64 bits; en X11, el XID. Si no se puede averiguar, mpv abre su propia ventana.
 */
function widDe(w: BrowserWindow | null): string | null {
  try {
    const b = w?.getNativeWindowHandle();
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

/** Tamaño y sitio de la ventana de la última vez, si todavía caben en alguna pantalla. */
function ventanaGuardada(): { x?: number; y?: number; width: number; height: number; maximizada: boolean } {
  const g = leerConfig().ventana as Record<string, unknown> | undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
  const width = num(g?.width), height = num(g?.height), x = num(g?.x), y = num(g?.y);
  if (!width || !height || width < 600 || height < 400) return { width: 1400, height: 860, maximizada: false };
  const visible = x !== undefined && y !== undefined && screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return x < b.x + b.width - 80 && x + width > b.x + 80 && y < b.y + b.height - 80 && y + height > b.y + 40;
  });
  return { width, height, ...(visible ? { x, y } : {}), maximizada: g?.maximizada === true };
}

function crearVentana() {
  const guardada = ventanaGuardada();
  ventana = new BrowserWindow({
    width: guardada.width, height: guardada.height, x: guardada.x, y: guardada.y,
    backgroundColor: '#08080b', title: 'Media Watch', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  if (guardada.maximizada) ventana.maximize();
  const principal = ventana;
  principal.on('close', () => {
    if (principal.isDestroyed() || principal.isMinimized()) return;
    guardarConfig({ ventana: { ...principal.getNormalBounds(), maximizada: principal.isMaximized() } });
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
  guardarConfig({ servidor: limpia });
  abrir();
  return { ok: true };
});

/*
 * Ventana de reproducción: sin marco, a pantalla completa y TRANSPARENTE. Lo de transparente no es
 * estética: mpv dibuja como ventana hija y la superficie de Chrome se pintaba ENCIMA, así que el vídeo
 * no se veía (pasaba en la 0.2.1). Con la ventana transparente, el vídeo se ve y la interfaz de la web
 * —la misma que en el navegador— se dibuja sobre él.
 */
let ventanaVideo: BrowserWindow | null = null;

// Al acabar un fichero solo, la interfaz decide si pasa al siguiente episodio; si no contesta, se cierra.
let esperaSiguiente: NodeJS.Timeout | undefined;
// Mientras se cambia de episodio a mano, el mpv que se para no debe cerrar la ventana al irse.
let cambiando = false;

/**
 * Teclas multimedia del teclado y de los auriculares, solo mientras hay un vídeo: play/pausa, parar,
 * siguiente episodio (la web sabe cuál es) y volver al principio. Al acabar se sueltan para no quitárselas
 * a otro reproductor.
 */
function atajosMultimedia(activar: boolean) {
  const teclas: Record<string, () => void> = {
    MediaPlayPause: () => ordenar('alternar', undefined, pistasActuales),
    MediaStop: () => cerrarVideo(),
    MediaNextTrack: () => { if (ventanaVideo && !ventanaVideo.isDestroyed()) ventanaVideo.webContents.send('mw:tecla', 'siguiente'); },
    MediaPreviousTrack: () => ordenar('buscar', 0, pistasActuales),
  };
  for (const [tecla, accion] of Object.entries(teclas)) {
    try { if (activar) globalShortcut.register(tecla, accion); else globalShortcut.unregister(tecla); } catch { /* el sistema no la deja */ }
  }
}

function cerrarVideo() {
  clearTimeout(esperaSiguiente);
  atajosMultimedia(false);
  pararReproduccion();
  const v = ventanaVideo;
  ventanaVideo = null;
  if (v && !v.isDestroyed()) v.close();
  if (ventana && !ventana.isDestroyed()) ventana.focus();
}

type Preparado = { servidor: string; exe: string; token: string; externos: { id: string }[] };

/** Lo común a abrir una reproducción y a pasar al siguiente episodio: quién pide, qué pide y con qué se reproduce. */
async function preparar(e: Electron.IpcMainInvokeEvent, o: any): Promise<Preparado | { error: string }> {
  const servidor = leerServidor();
  // Solo la web del servidor configurado puede pedir una reproducción.
  if (!servidor || origen(e.senderFrame?.url ?? '') !== origen(servidor)) return { error: 'No permitido' };
  if (!entero(o?.fileId) || !entero(o?.itemId) || (o.episodeId !== null && !entero(o.episodeId)) || typeof o.start !== 'number' || !(o.start >= 0) || typeof o.title !== 'string') {
    return { error: 'Petición no válida' };
  }
  if (hayReproduccion()) return { error: 'Ya hay una reproducción abierta' };
  const carpetaMpv = join(app.getPath('userData'), 'mpv');
  const exe = buscarMpv([join(process.resourcesPath ?? '', 'mpv'), carpetaMpv]);
  if (!exe) {
    const pista = process.platform === 'win32' ? `Copia mpv.exe en ${carpetaMpv}` : 'Instálalo con el gestor de paquetes (paquete «mpv»)';
    return { error: `No se encontró mpv. ${pista} o déjalo en el PATH.` };
  }
  const galletas = await session.defaultSession.cookies.get({ url: servidor, name: COOKIE });
  if (!galletas[0]) return { error: 'No hay sesión iniciada' };
  const externos = Array.isArray(o.externos)
    ? o.externos.filter((s: any) => typeof s?.id === 'string' && /^external-\d+$/.test(s.id)).slice(0, 40).map((s: any) => ({ id: s.id }))
    : [];
  return { servidor, exe, token: galletas[0].value, externos };
}

const entero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Arranca mpv dentro de la ventana de vídeo que haya ahora. */
function lanzarMpv(o: any, p: Preparado) {
  return reproducir(p.exe, {
    servidor: p.servidor, token: p.token, fileId: o.fileId, itemId: o.itemId, episodeId: o.episodeId,
    start: o.start, title: o.title.slice(0, 200),
    wid: widDe(ventanaVideo) ?? undefined,
    audio: entero(o.audio) ? o.audio : null,
    subtitulo: typeof o.subtitulo === 'string' && /^(off|embedded-\d+|external-\d+)$/.test(o.subtitulo) ? o.subtitulo : null,
    externos: p.externos,
    extra: opcionesExtraMpv(),
  }, (acabado) => {
    if (cambiando) return;
    // Acabó solo: la web (que sabe cuál es el siguiente episodio) contesta con `mw:siguiente` o con «cerrar».
    if (acabado && ventanaVideo && !ventanaVideo.isDestroyed()) esperaSiguiente = setTimeout(cerrarVideo, 8000);
    else cerrarVideo();
  }, (estado: Estado) => {
    if (ventanaVideo && !ventanaVideo.isDestroyed()) ventanaVideo.webContents.send('mw:estado', estado);
  });
}

ipcMain.handle('mw:reproducir', async (e, o: any) => {
  const p = await preparar(e, o);
  if ('error' in p) return { ok: false, error: p.error };
  const { servidor } = p;
  const ep = o.episodeId !== null ? `&ep=${o.episodeId}` : '';
  /*
   * Del tamaño de la pantalla, pero NO en modo «pantalla completa» de Windows: con `fullscreen: true` la
   * ventana hija de mpv deja de componerse y el vídeo no se ve (comprobado el 14/10). Así sí se ve.
   */
  // En la pantalla donde está la app, no siempre en la principal (con dos monitores se abría en el otro).
  const pantalla = (ventana && !ventana.isDestroyed() ? screen.getDisplayMatching(ventana.getBounds()) : screen.getPrimaryDisplay()).bounds;
  ventanaVideo = new BrowserWindow({
    ...pantalla, frame: false, transparent: true, backgroundColor: '#00000000', show: false,
    alwaysOnTop: true, skipTaskbar: false, resizable: false,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  ventanaVideo.on('closed', () => { if (ventanaVideo) { ventanaVideo = null; pararReproduccion(); } });
  // «Siempre encima» hace falta para tapar la barra de tareas, pero solo mientras se está viendo: si se
  // cambia de aplicación (Alt+Tab), el vídeo a pantalla completa se quedaba tapándola.
  const video = ventanaVideo;
  video.on('blur', () => { if (!video.isDestroyed()) video.setAlwaysOnTop(false); });
  video.on('focus', () => { if (!video.isDestroyed()) video.setAlwaysOnTop(true); });
  // `escritorio=1`: la web pinta sus controles pero deja que el vídeo lo ponga mpv.
  await ventanaVideo.loadURL(`${servidor}/ver/${o.fileId}?item=${o.itemId}${ep}&t=${Math.floor(o.start)}&escritorio=1`);
  ventanaVideo.show();
  // Al crearla, Windows la encoge al área libre (deja fuera la barra de tareas). Puesto ya el tamaño
  // a mano, ocupa la pantalla entera, que es lo que toca para ver una película.
  ventanaVideo.setBounds(pantalla);

  try {
    await lanzarMpv(o, p);
    atajosMultimedia(true);
    /*
     * mpv se queda con el tamaño que tenía la ventana al engancharse y dejaba un marco negro alrededor
     * del vídeo. Un cambio de tamaño de un píxel y vuelta le hace recolocarse al tamaño de verdad.
     */
    setTimeout(() => {
      if (!ventanaVideo || ventanaVideo.isDestroyed()) return;
      ventanaVideo.setBounds({ ...pantalla, height: pantalla.height - 1 });
      ventanaVideo.setBounds(pantalla);
      // El foco tiene que quedarse en la web: es quien atiende el teclado (mpv va sin teclas).
      ventanaVideo.focus();
      ventanaVideo.webContents.focus();
    }, 900);
    return { ok: true };
  } catch (err) {
    cerrarVideo();
    return { ok: false, error: (err as Error).message };
  }
});

/** Órdenes de la interfaz al vídeo. Solo las acepta de la ventana de reproducción. */
ipcMain.handle('mw:video', async (e, nombre: unknown, valor: unknown) => {
  if (!ventanaVideo || e.sender !== ventanaVideo.webContents) return { ok: false };
  if (typeof nombre !== 'string') return { ok: false };
  if (nombre === 'cerrar') { cerrarVideo(); return { ok: true }; }
  ordenar(nombre, valor, pistasActuales);
  return { ok: true };
});

/** El fichero acabó y la web pide el siguiente episodio: mismo marco de vídeo, mpv nuevo. Solo desde la ventana de vídeo. */
ipcMain.handle('mw:siguiente', async (e, o: any) => {
  if (!ventanaVideo || ventanaVideo.isDestroyed() || e.sender !== ventanaVideo.webContents) return { ok: false, error: 'No permitido' };
  clearTimeout(esperaSiguiente);
  // A mitad de un episodio (tecla «siguiente»): se para el mpv de ahora, que guarda dónde iba, y se espera a que se vaya.
  if (hayReproduccion()) {
    cambiando = true;
    pararReproduccion();
    for (let i = 0; i < 60 && hayReproduccion(); i++) await new Promise((r) => setTimeout(r, 50));
  }
  try {
    const p = await preparar(e, o);
    if ('error' in p) return { ok: false, error: p.error };
    try {
      await lanzarMpv(o, p);
      return { ok: true };
    } catch (err) {
      cerrarVideo();
      return { ok: false, error: (err as Error).message };
    }
  } finally {
    cambiando = false;
  }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Archivo', submenu: [
        { label: 'Cambiar de servidor', click: () => { guardarConfig({ servidor: undefined }); abrir(); } },
        { role: 'quit', label: 'Salir' },
      ] },
      { label: 'Ver', submenu: [{ role: 'reload', label: 'Recargar' }, { role: 'togglefullscreen', label: 'Pantalla completa' }] },
    ]));
    crearVentana();
    iniciarActualizaciones(() => ventana);
  });
  // Si se cierra la ventana con el vídeo incrustado dentro, mpv se queda sin sitio: se para con ella.
  app.on('window-all-closed', () => { pararReproduccion(); app.quit(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
