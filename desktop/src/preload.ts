import { contextBridge, ipcRenderer } from 'electron';

// Lo único que la web ve del escritorio. `reproducir` lo atiende main.ts, que comprueba que la
// llamada viene de la propia web del servidor.
contextBridge.exposeInMainWorld('mediawatchDesktop', {
  version: 1,
  reproducir: (o: { fileId: number; itemId: number; episodeId: number | null; start: number; title: string }) =>
    ipcRenderer.invoke('mw:reproducir', o) as Promise<{ ok: boolean; error?: string }>,
});

contextBridge.exposeInMainWorld('mediawatchConectar', {
  guardar: (url: string) => ipcRenderer.invoke('mw:guardar-servidor', url) as Promise<{ ok: boolean; error?: string }>,
});
