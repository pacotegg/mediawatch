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
};

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

async function guardar(p: Pedido, position: number, duration: number) {
  if (!(position > 5)) return;
  try {
    await fetch(`${p.servidor}/api/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.token}` },
      body: JSON.stringify({ itemId: p.itemId, episodeId: p.episodeId, position, duration: duration > 0 ? duration : undefined }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Sin red un momento no es grave: el siguiente guardado lo recupera.
  }
}

/**
 * Lanza mpv sin ficheros ni cabeceras en la línea de comandos (se verían en la lista de procesos) y le manda
 * la dirección y el token por su canal de control. El fichero se pide en crudo (`raw=1`): mpv decodifica casi
 * todo, así que el servidor no transcodifica nada.
 */
export function reproducir(exe: string, p: Pedido): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = randomBytes(6).toString('hex');
    const canal = process.platform === 'win32' ? `\\\\.\\pipe\\mw-${id}` : join(process.env.XDG_RUNTIME_DIR ?? '/tmp', `mw-${id}.sock`);
    const proc = spawn(
      exe,
      ['--idle=yes', '--force-window=yes', '--hwdec=auto-safe', `--title=${p.title.replace(/[\r\n]/g, ' ')}`, `--input-ipc-server=${canal}`],
      { stdio: 'ignore' },
    );
    actual = proc;
    let posicion = 0;
    let duracion = 0;
    let ultimoGuardado = 0;
    let conectado = false;
    let cerrado = false;
    let timerReintento: NodeJS.Timeout | undefined;

    const cerrar = () => {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(timerReintento);
      void guardar(p, posicion, duracion);
    };
    proc.on('error', (err) => { cerrar(); reject(err); });
    proc.on('exit', () => { cerrar(); if (!conectado) reject(new Error('mpv se cerró antes de empezar')); });

    const intentar = (n: number) => {
      const sock = net.connect(canal);
      let resto = '';
      const mandar = (...command: unknown[]) => sock.write(JSON.stringify({ command }) + '\n');
      sock.on('connect', () => {
        conectado = true;
        mandar('observe_property', 1, 'time-pos');
        mandar('observe_property', 2, 'duration');
        mandar('set_property', 'http-header-fields', [`Authorization: Bearer ${p.token}`]);
        mandar('loadfile', `${p.servidor}/api/play/${p.fileId}/stream?raw=1`, 'replace', -1, `start=${Math.max(0, Math.floor(p.start))}`);
        resolve();
      });
      sock.on('data', (d) => {
        resto += d.toString();
        const lineas = resto.split('\n');
        resto = lineas.pop() ?? '';
        for (const l of lineas) {
          try {
            const e = JSON.parse(l);
            if (e.event !== 'property-change' || typeof e.data !== 'number') continue;
            if (e.name === 'time-pos') {
              posicion = e.data;
              if (Date.now() - ultimoGuardado > GUARDAR_CADA_MS) { ultimoGuardado = Date.now(); void guardar(p, posicion, duracion); }
            } else if (e.name === 'duration') duracion = e.data;
          } catch { /* una línea a medias: se ignora */ }
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
