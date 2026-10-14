/** Lo que expone el cliente de escritorio (desktop/src/preload.ts). Fuera de él, `window.mediawatchDesktop` no existe. */
export type EscritorioApi = {
  version: number;
  reproducir: (o: {
    fileId: number; itemId: number; episodeId: number | null; start: number; title: string;
    /** Pista de audio del perfil (índice de flujo) y subtítulo (`embedded-N`, `external-N` u `off`). */
    audio?: number | null; subtitulo?: string | null; externos?: { id: string }[];
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Se llama al cerrar el vídeo; devuelve la función para dejar de escuchar. */
  alTerminar: (cb: () => void) => () => void;
  alActualizar: (cb: (v: { version: string }) => void) => () => void;
};

export const escritorio = (): EscritorioApi | undefined => (window as unknown as { mediawatchDesktop?: EscritorioApi }).mediawatchDesktop;
