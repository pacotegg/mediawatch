import { contextBridge, ipcRenderer } from 'electron';

// Lo único que la web ve del escritorio. `reproducir` lo atiende main.ts, que comprueba que la
// llamada viene de la propia web del servidor.
contextBridge.exposeInMainWorld('mediawatchDesktop', {
  version: 2,
  reproducir: (o: {
    fileId: number; itemId: number; episodeId: number | null; start: number; title: string;
    audio?: number | null; subtitulo?: string | null; externos?: { id: string }[];
  }) => ipcRenderer.invoke('mw:reproducir', o) as Promise<{ ok: boolean; error?: string }>,
  /** Avisa cuando se cierra el vídeo, para volver a la ficha. Devuelve la función para dejar de escuchar. */
  alTerminar: (cb: () => void) => {
    const h = () => cb();
    ipcRenderer.on('mw:fin', h);
    return () => ipcRenderer.removeListener('mw:fin', h);
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
