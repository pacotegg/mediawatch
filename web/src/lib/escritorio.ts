/** Lo que expone el cliente de escritorio (desktop/src/preload.ts). Fuera de él, `window.mediawatchDesktop` no existe. */
export type EscritorioApi = {
  version: number;
  reproducir: (o: {
    fileId: number; itemId: number; episodeId: number | null; start: number; title: string;
    /** Pista de audio del perfil (índice de flujo) y subtítulo (`embedded-N`, `external-N` u `off`). */
    audio?: number | null; subtitulo?: string | null; externos?: { id: string }[];
  }) => Promise<{ ok: boolean; error?: string }>;
  /** Al acabar un episodio, el siguiente en la misma ventana de vídeo (el cliente de escritorio ≥ 0.4). */
  siguiente?: EscritorioApi['reproducir'];
  /** Órdenes al vídeo: pausa, buscar, volumen, silencio, audio, subtitulo, subDelay, cerrar. */
  video: (nombre: string, valor?: unknown) => Promise<{ ok: boolean }>;
  /** Estado del vídeo según mpv; devuelve la función para dejar de escuchar. */
  alEstado: (cb: (e: unknown) => void) => () => void;
  alActualizar: (cb: (v: { version: string }) => void) => () => void;
};

export const escritorio = (): EscritorioApi | undefined => (window as unknown as { mediawatchDesktop?: EscritorioApi }).mediawatchDesktop;
