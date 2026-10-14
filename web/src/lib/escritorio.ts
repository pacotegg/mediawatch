/** Lo que expone el cliente de escritorio (desktop/src/preload.ts). Fuera de él, `window.mediawatchDesktop` no existe. */
export type EscritorioApi = {
  version: number;
  reproducir: (o: { fileId: number; itemId: number; episodeId: number | null; start: number; title: string }) => Promise<{ ok: boolean; error?: string }>;
};

export const escritorio = (): EscritorioApi | undefined => (window as unknown as { mediawatchDesktop?: EscritorioApi }).mediawatchDesktop;
