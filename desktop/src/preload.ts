import { contextBridge, ipcRenderer } from 'electron';

// Lo único que la web ve del escritorio. `reproducir` lo atiende main.ts, que comprueba que la
// llamada viene de la propia web del servidor.
contextBridge.exposeInMainWorld('mediawatchDesktop', {
  version: 5,
  reproducir: (o: {
    fileId: number; itemId: number; episodeId: number | null; start: number; title: string;
    audio?: number | null; subtitulo?: string | null; externos?: { id: string }[];
  }) => ipcRenderer.invoke('mw:reproducir', o) as Promise<{ ok: boolean; error?: string }>,
  /** Al acabar un episodio: el siguiente en la misma ventana de vídeo. Solo la ventana de vídeo puede pedirlo. */
  siguiente: (o: {
    fileId: number; itemId: number; episodeId: number | null; start: number; title: string;
    audio?: number | null; subtitulo?: string | null; externos?: { id: string }[];
  }) => ipcRenderer.invoke('mw:siguiente', o) as Promise<{ ok: boolean; error?: string }>,
  /** Órdenes al vídeo desde los controles de la web: pausa, buscar, volumen, audio, subtítulo, cerrar. */
  video: (nombre: string, valor?: unknown) => ipcRenderer.invoke('mw:video', nombre, valor) as Promise<{ ok: boolean }>,
  /** Estado del vídeo (tiempo, duración, pausa, pistas). Devuelve la función para dejar de escuchar. */
  alEstado: (cb: (e: unknown) => void) => {
    const h = (_e: unknown, v: unknown) => cb(v);
    ipcRenderer.on('mw:estado', h);
    return () => ipcRenderer.removeListener('mw:estado', h);
  },
  /** Teclas multimedia que la ventana de vídeo recibe del sistema y que le tocan a la web (hoy: «siguiente»). */
  alTecla: (cb: (t: string) => void) => {
    const h = (_e: unknown, v: string) => cb(v);
    ipcRenderer.on('mw:tecla', h);
    return () => ipcRenderer.removeListener('mw:tecla', h);
  },
  alActualizar: (cb: (v: { version: string }) => void) => {
    const h = (_e: unknown, v: { version: string }) => cb(v);
    ipcRenderer.on('mw:actualizacion', h);
    return () => ipcRenderer.removeListener('mw:actualizacion', h);
  },
});

contextBridge.exposeInMainWorld('mediawatchConectar', {
  guardar: (url: string) => ipcRenderer.invoke('mw:guardar-servidor', url) as Promise<{ ok: boolean; error?: string }>,
});
