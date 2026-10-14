import { ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { delimiter, join } from 'node:path';

export type Pedido = {
  servidor: string;
  token: string;
  fileId: number;
  itemId: number;
  episodeId: number | null;
  start: number;
  title: string;
  /** Ventana donde incrustar el vídeo (HWND en Windows, XID en X11). Sin esto, mpv abre la suya. */
  wid?: string;
  /** Pista de audio guardada en el perfil: el índice de flujo del fichero. */
  audio?: number | null;
  /** Subtítulo guardado: `embedded-<índice>`, `external-<id>` u `off`. */
  subtitulo?: string | null;
  /** Subtítulos en fichero aparte, que mpv no ve solo porque el vídeo le llega por HTTP. */
  externos?: { id: string }[];
  /** Opciones extra para mpv, de `mpvArgs` en el config del usuario (ver main.ts). */
  extra?: string[];
};

type Pista = { id: number; type: string; 'ff-index'?: number; external?: boolean; 'external-filename'?: string };

const GUARDAR_CADA_MS = 10_000;
const EXE = process.platform === 'win32' ? 'mpv.exe' : 'mpv';

/** Primero el mpv que lleva la app o el que el usuario dejó en su carpeta; después el del PATH. */
export function buscarMpv(carpetas: string[]): string | null {
  for (const c of [...carpetas, ...(process.env.PATH ?? '').split(delimiter)]) {
    if (!c) continue;
    const ruta = join(c, EXE);
    if (existsSync(ruta)) return ruta;
  }
  return null;
}

let actual: ChildProcess | null = null;
export const hayReproduccion = () => actual !== null && actual.exitCode === null;
export function pararReproduccion() {
  if (hayReproduccion()) actual!.kill();
}

/** De una pista de mpv al identificador que usa el servidor, que es el que se guarda en el perfil. */
function idDeServidor(p: Pista | undefined, urlDeExterno: Map<string, string>): string | null {
  if (!p) return null;
  if (p.external) return urlDeExterno.get(p['external-filename'] ?? '') ?? null;
  return p['ff-index'] === undefined ? null : `embedded-${p['ff-index']}`;
}

/**
 * Lanza mpv sin ficheros ni cabeceras en la línea de comandos (se verían en la lista de procesos) y le manda
 * la dirección y el token por su canal de control. El fichero se pide en crudo (`raw=1`): mpv decodifica casi
 * todo, así que el servidor no transcodifica nada.
 *
 * `onFin` avisa cuando mpv se cierra, para que la ventana vuelva a enseñar la web.
 */
export function reproducir(exe: string, p: Pedido, onFin: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = randomBytes(6).toString('hex');
    const canal = process.platform === 'win32' ? `\\\\.\\pipe\\mw-${id}` : join(process.env.XDG_RUNTIME_DIR ?? '/tmp', `mw-${id}.sock`);
    const args = [
      '--idle=yes',
      '--force-window=yes',
      '--hwdec=auto-safe',
      // Los subtítulos sueltos del disco no pintan nada aquí: los de este fichero los manda el servidor.
      '--sub-auto=no',
      `--title=${p.title.replace(/[\r\n]/g, ' ')}`,
      `--input-ipc-server=${canal}`,
    ];
    if (p.wid) args.push(`--wid=${p.wid}`);
    args.push(...(p.extra ?? []));
    // La salida de error de mpv se guarda: cuando no arranca (sin GPU, un códec que falta, una opción
    // mala) es lo único que dice por qué, y sin esto el usuario solo veía «mpv se cerró antes de empezar».
    const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let queja = '';
    proc.stderr?.on('data', (d) => { queja = (queja + d).slice(-1200); });
    actual = proc;

    let posicion = 0;
    let duracion = 0;
    let ultimoGuardado = 0;
    let conectado = false;
    let cerrado = false;
    let timerReintento: NodeJS.Timeout | undefined;
    let pistas: Pista[] = [];
    let aid: number | null = null;
    let sid: number | null = null;
    let aplicado = false;
    const urlDeExterno = new Map<string, string>();

    const audioGuardable = () => {
      const pista = pistas.find((t) => t.type === 'audio' && t.id === aid);
      return pista?.['ff-index'] ?? null;
    };
    const subGuardable = () => (sid === null ? 'off' : idDeServidor(pistas.find((t) => t.type === 'sub' && t.id === sid), urlDeExterno) ?? 'off');

    async function guardar() {
      if (!(posicion > 5)) return;
      try {
        await fetch(`${p.servidor}/api/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.token}` },
          body: JSON.stringify({
            itemId: p.itemId,
            episodeId: p.episodeId,
            position: posicion,
            duration: duracion > 0 ? duracion : undefined,
            audio: audioGuardable(),
            subtitle: subGuardable(),
          }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        // Sin red un momento no es grave: el siguiente guardado lo recupera.
      }
    }

    const cerrar = () => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timerReintento);
      void guardar();
      onFin();
    };
    proc.on('error', (err) => { cerrar(); reject(err); });
    proc.on('exit', () => {
      cerrar();
      if (conectado) return;
      const motivo = queja.split('\n').filter((l) => l.trim()).slice(-3).join(' · ');
      reject(new Error(`mpv se cerró antes de empezar${motivo ? `: ${motivo}` : ''}`));
    });

    const intentar = (n: number) => {
      const sock = net.connect(canal);
      let resto = '';
      const mandar = (...command: unknown[]) => sock.write(JSON.stringify({ command }) + '\n');

      /*
       * Las pistas se eligen cuando mpv ya ha abierto el fichero y sabe cuáles hay. Los subtítulos en
       * fichero aparte se añaden todos (así se pueden elegir desde mpv) y al final se fija el que toca:
       * `sub-add` selecciona lo que añade, de modo que sin este último paso ganaría el último añadido.
       */
      const aplicarPistas = () => {
        if (aplicado || pistas.length === 0) return;
        aplicado = true;
        for (const e of p.externos ?? []) {
          const url = `${p.servidor}/api/play/${p.fileId}/subtitle/${e.id}.vtt`;
          urlDeExterno.set(url, e.id);
          mandar('sub-add', url, 'select');
        }
        const audio = pistas.find((t) => t.type === 'audio' && t['ff-index'] === p.audio);
        if (audio) mandar('set_property', 'aid', audio.id);
        if (p.subtitulo && p.subtitulo !== 'off') {
          const sub = pistas.find((t) => t.type === 'sub' && idDeServidor(t, urlDeExterno) === p.subtitulo);
          if (sub) mandar('set_property', 'sid', sub.id);
          else if (!p.subtitulo.startsWith('external-')) mandar('set_property', 'sid', 'no');
        } else {
          mandar('set_property', 'sid', 'no');
        }
      };

      sock.on('connect', () => {
        conectado = true;
        mandar('observe_property', 1, 'time-pos');
        mandar('observe_property', 2, 'duration');
        mandar('observe_property', 3, 'track-list');
        mandar('observe_property', 4, 'aid');
        mandar('observe_property', 5, 'sid');
        mandar('set_property', 'http-header-fields', [`Authorization: Bearer ${p.token}`]);
        mandar('loadfile', `${p.servidor}/api/play/${p.fileId}/stream?raw=1`, 'replace', -1, `start=${Math.max(0, Math.floor(p.start))}`);
        resolve();
      });

      sock.on('data', (d) => {
        resto += d.toString();
        const lineas = resto.split('\n');
        resto = lineas.pop() ?? '';
        for (const l of lineas) {
          let e: any;
          try { e = JSON.parse(l); } catch { continue; } // una línea a medias
          // Solo al terminar el fichero. `idle` NO vale: mpv ya está ocioso al arrancar (--idle=yes) y
          // avisaba antes incluso de cargar nada, así que el vídeo se cerraba solo nada más abrirlo.
          if (e.event === 'end-file') { mandar('quit'); continue; }
          if (e.event !== 'property-change') continue;
          if (e.name === 'track-list' && Array.isArray(e.data)) {
            pistas = e.data as Pista[];
            aplicarPistas();
          } else if (e.name === 'aid') aid = typeof e.data === 'number' ? e.data : null;
          else if (e.name === 'sid') sid = typeof e.data === 'number' ? e.data : null;
          else if (e.name === 'duration' && typeof e.data === 'number') duracion = e.data;
          else if (e.name === 'time-pos' && typeof e.data === 'number') {
            posicion = e.data;
            if (Date.now() - ultimoGuardado > GUARDAR_CADA_MS) { ultimoGuardado = Date.now(); void guardar(); }
          }
        }
      });

      sock.on('error', () => {
        // mpv tarda un instante en crear el canal.
        if (!conectado && n < 40 && proc.exitCode === null) timerReintento = setTimeout(() => intentar(n + 1), 150);
      });
    };
    intentar(0);
  });
}
