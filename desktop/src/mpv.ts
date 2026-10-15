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

/** Lo que la interfaz necesita saber en cada momento. Los identificadores son los del servidor. */
export type Estado = {
  tiempo: number;
  duracion: number;
  pausado: boolean;
  cargando: boolean;
  audio: number | null;
  subtitulo: string;
  fin?: boolean;
  /** El fichero llegó a su final solo (no lo cerró nadie): la interfaz decide si pasa al siguiente episodio. */
  acabado?: boolean;
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
let enviar: ((...orden: unknown[]) => void) | null = null;
// Un mpv matado (kill) no tiene `exitCode`: Node deja ese a null y pone `signalCode`. Hay que mirar los dos.
export const hayReproduccion = () => actual !== null && actual.exitCode === null && actual.signalCode === null;
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
 * Órdenes que manda la interfaz. Se traducen aquí a lo que entiende mpv para que el resto del
 * programa no tenga que saber de pistas ni de propiedades.
 */
export function ordenar(nombre: string, valor?: unknown, pistasDe?: () => { pistas: Pista[]; urlDeExterno: Map<string, string> }) {
  if (!enviar) return;
  switch (nombre) {
    case 'pausa': return enviar('set_property', 'pause', Boolean(valor));
    // La tecla multimedia de play/pausa no sabe en qué estado está el vídeo: que lo cambie mpv.
    case 'alternar': return enviar('cycle', 'pause');
    case 'buscar': return enviar('seek', Number(valor), 'absolute');
    case 'volumen': return enviar('set_property', 'volume', Math.max(0, Math.min(100, Number(valor) * 100)));
    case 'silencio': return enviar('set_property', 'mute', Boolean(valor));
    case 'subDelay': return enviar('set_property', 'sub-delay', Number(valor) / 1000);
    case 'cerrar': return enviar('quit');
    case 'audio': {
      const { pistas } = pistasDe!();
      const p = pistas.find((t) => t.type === 'audio' && t['ff-index'] === Number(valor));
      return p ? enviar('set_property', 'aid', p.id) : undefined;
    }
    case 'subtitulo': {
      if (valor === 'off' || valor === null) return enviar('set_property', 'sid', 'no');
      const { pistas, urlDeExterno } = pistasDe!();
      const p = pistas.find((t) => t.type === 'sub' && idDeServidor(t, urlDeExterno) === valor);
      return p ? enviar('set_property', 'sid', p.id) : undefined;
    }
  }
}

/**
 * Lanza mpv sin ficheros ni cabeceras en la línea de comandos (se verían en la lista de procesos) y le manda
 * la dirección y el token por su canal de control. El fichero se pide en crudo (`raw=1`): mpv decodifica casi
 * todo, así que el servidor no transcodifica nada.
 *
 * mpv aquí solo pinta: sin controles propios ni teclas, porque de eso se encarga la interfaz de la web.
 * `onEstado` la mantiene al día y `onFin` avisa cuando se cierra el vídeo.
 */
export function reproducir(exe: string, p: Pedido, onFin: (acabado: boolean) => void, onEstado: (e: Estado) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = randomBytes(6).toString('hex');
    const canal = process.platform === 'win32' ? `\\\\.\\pipe\\mw-${id}` : join(process.env.XDG_RUNTIME_DIR ?? '/tmp', `mw-${id}.sock`);
    const args = [
      '--idle=yes',
      '--force-window=yes',
      '--hwdec=auto-safe',
      // Los subtítulos sueltos del disco no pintan nada aquí: los de este fichero los manda el servidor.
      '--sub-auto=no',
      // Sin controles ni teclas de mpv: manda la interfaz de la web, que es la misma que en el navegador.
      '--osc=no',
      '--osd-level=0',
      '--input-default-bindings=no',
      '--input-vo-keyboard=no',
      '--cursor-autohide=no',
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
    let pausado = false;
    let cargando = true;
    let ultimoGuardado = 0;
    let ultimoAviso = 0;
    let conectado = false;
    let cerrado = false;
    let acabado = false;
    let timerReintento: NodeJS.Timeout | undefined;
    let pistas: Pista[] = [];
    let aid: number | null = null;
    let sid: number | null = null;
    let aplicado = false;
    const urlDeExterno = new Map<string, string>();

    const audioGuardable = () => pistas.find((t) => t.type === 'audio' && t.id === aid)?.['ff-index'] ?? null;
    const subGuardable = () => (sid === null ? 'off' : idDeServidor(pistas.find((t) => t.type === 'sub' && t.id === sid), urlDeExterno) ?? 'off');
    const avisar = (fin = false) => onEstado({ tiempo: posicion, duracion, pausado, cargando, audio: audioGuardable(), subtitulo: subGuardable(), fin, acabado });

    async function guardar() {
      if (!(posicion > 5)) return;
      try {
        await fetch(`${p.servidor}/api/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.token}` },
          body: JSON.stringify({
            itemId: p.itemId,
            episodeId: p.episodeId,
            // Al llegar al final solo se da por visto, igual que hace el reproductor de la web.
            position: acabado && duracion > 0 ? duracion : posicion,
            duration: duracion > 0 ? duracion : undefined,
            ...(acabado ? { watched: true } : {}),
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
      enviar = null;
      void guardar();
      avisar(true);
      onFin(acabado);
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
       * fichero aparte se añaden todos (así se pueden elegir desde la interfaz) y al final se fija el
       * que toca: `sub-add` selecciona lo que añade, de modo que sin este último paso ganaría el último.
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
        enviar = mandar;
        mandar('observe_property', 1, 'time-pos');
        mandar('observe_property', 2, 'duration');
        mandar('observe_property', 3, 'track-list');
        mandar('observe_property', 4, 'aid');
        mandar('observe_property', 5, 'sid');
        mandar('observe_property', 6, 'pause');
        mandar('observe_property', 7, 'core-idle');
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
          if (e.event === 'end-file') { acabado = e.reason === 'eof'; mandar('quit'); continue; }
          if (e.event !== 'property-change') continue;
          if (e.name === 'track-list' && Array.isArray(e.data)) { pistas = e.data as Pista[]; aplicarPistas(); avisar(); }
          else if (e.name === 'aid') { aid = typeof e.data === 'number' ? e.data : null; avisar(); }
          else if (e.name === 'sid') { sid = typeof e.data === 'number' ? e.data : null; avisar(); }
          else if (e.name === 'pause') { pausado = Boolean(e.data); avisar(); }
          else if (e.name === 'core-idle') { cargando = Boolean(e.data); avisar(); }
          else if (e.name === 'duration' && typeof e.data === 'number') { duracion = e.data; avisar(); }
          else if (e.name === 'time-pos' && typeof e.data === 'number') {
            posicion = e.data;
            // mpv da la posición muchas veces por segundo; la interfaz solo necesita unas pocas.
            if (Date.now() - ultimoAviso > 200) { ultimoAviso = Date.now(); avisar(); }
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

    // Para que `ordenar` pueda traducir pistas sin exponer el estado interno.
    contexto = () => ({ pistas, urlDeExterno });
  });
}

let contexto: (() => { pistas: Pista[]; urlDeExterno: Map<string, string> }) | null = null;
export const pistasActuales = () => (contexto ? contexto() : { pistas: [] as Pista[], urlDeExterno: new Map<string, string>() });
