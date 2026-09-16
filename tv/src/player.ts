/**
 * Reproductor de la televisión.
 *
 * Usa AVPlay, el reproductor nativo de Tizen, que descodifica por hardware MKV,
 * HEVC, AC3 y EAC3. Eso significa reproducción directa del fichero original: el
 * servidor no transcodifica nada y no se pierde el audio multicanal. En un
 * navegador de escritorio (para desarrollar) cae a un <video> normal.
 *
 * Tres cosas que AVPlay hace y que no son evidentes:
 *
 * 1. **Antes del `play()` no se le puede pedir nada.** Ni `seekTo` ni
 *    `setSelectTrack`: la documentación de Samsung los da por válidos solo en
 *    PLAYING o PAUSED, y el callback de `prepareAsync` —donde parece natural
 *    ponerlos— corre en READY. Medido en la QN93A del salón:
 *      · `seekTo` en READY lanza excepción; como estaba antes del `play()`, se
 *        lo llevaba por delante, y la excepción subía hasta el manejador de
 *        teclas y lo dejaba mudo. Por eso no se podía avanzar ni rebobinar.
 *      · `setSelectTrack` en READY es peor: unas veces lanza
 *        `InvalidStateError` —así que elegir pista de audio nunca funcionó, en
 *        silencio— y otras la acepta y **deja el reproductor clavado**: estado
 *        PLAYING, búfer lleno y el reloj parado en 14 ms.
 *    Medido con el mismo fichero: con `play()` primero, el reloj marca 1624,
 *    3125, 4627, 6129 ms; al revés, 14 ms fijos. Así que: `play()`, después las
 *    pistas, y al final la búsqueda.
 * 2. **No dibuja los subtítulos.** Los del contenedor llegan por
 *    `onsubtitlechange` en texto plano y los pinta la aplicación. Sin eso,
 *    elegir subtítulos no hacía nada visible. Para quitarlos está
 *    `setSilentSubtitle`, que sí se puede llamar en READY.
 * 3. **No mira la marca `default` del MKV.** Reproduce la primera pista de audio
 *    del contenedor, así que la elección se hace desde la aplicación.
 */

type AVPlayListener = {
  onbufferingstart?: () => void;
  onbufferingcomplete?: () => void;
  onbufferingprogress?: (porcentaje: number) => void;
  oncurrentplaytime?: (ms: number) => void;
  onstreamcompleted?: () => void;
  onsubtitlechange?: (duracion: string | number, texto: string, tipo?: number, extra?: unknown) => void;
  onevent?: (tipo: string, dato: string) => void;
  onerror?: (e: unknown) => void;
};

type PistaAVPlay = { index: number; type: string; extra_info?: string };

type AVPlay = {
  open: (url: string) => void;
  getTotalTrackInfo: () => PistaAVPlay[];
  setSelectTrack: (tipo: string, indice: number) => void;
  setSilentSubtitle?: (silencio: boolean) => void;
  setSubtitlePosition?: (ms: number) => void;
  setStreamingProperty?: (propiedad: string, valor: string) => void;
  close: () => void;
  prepareAsync: (ok: () => void, err: (e: unknown) => void) => void;
  setDisplayRect: (x: number, y: number, w: number, h: number) => void;
  setDisplayMethod: (m: string) => void;
  setListener: (l: AVPlayListener) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  jumpForward: (ms: number) => void;
  jumpBackward: (ms: number) => void;
  seekTo: (ms: number, ok?: () => void, err?: (e?: unknown) => void) => void;
  getDuration: () => number;
  getCurrentTime: () => number;
  getState: () => string;
};

function avplay(): AVPlay | null {
  const w = window as unknown as { webapis?: { avplay?: AVPlay } };
  return w.webapis && w.webapis.avplay ? w.webapis.avplay : null;
}

/** Texto corto de un error de AVPlay; los suyos vienen como objeto. */
function motivo(e: unknown): string {
  if (!e) return 'sin motivo';
  const x = e as { name?: string; message?: string };
  if (x.message) return (x.name ? x.name + ': ' : '') + x.message;
  if (x.name) return x.name;
  return String(e);
}

type PistaNativa = { ordinal: number; indice: number; idioma: string; codec: string; canales: number };

type Callbacks = {
  onTiempo: (segundos: number, duracionSegundos: number) => void;
  onBuffer: (cargando: boolean) => void;
  onFin: () => void;
  onError: (mensaje: string) => void;
  /** Texto de subtítulo que hay que pintar; cadena vacía para borrarlo. */
  onSubtitulo?: (texto: string, milisegundos: number) => void;
};

export class Reproductor {
  private nativo: AVPlay | null;
  private video: HTMLVideoElement | null = null;
  private cb: Callbacks;
  private duracionConocida = 0;
  /** Segundos que el flujo actual se salta por dentro (modo convertido). */
  private desfase = 0;
  /** Último fallo de AVPlay, para la pantalla de información. */
  public fallo = '';
  /**
   * Qué apertura es la de ahora.
   *
   * `webapis.avplay` es único en todo el aparato: no hay una instancia por
   * película, hay una sola que se abre y se cierra. Así que los avisos de una
   * reproducción anterior —el `prepareAsync` que tarda dos segundos, el reloj
   * del flujo que ya se cerró— siguen llegando después de haber salido, y sin
   * este número acababan llamando a `play()` sobre un reproductor cerrado
   * (audio sin imagen) o guardando el progreso de una película que ya no se
   * está viendo. Cada `abrir` y cada `cerrar` suben el contador; lo que llega
   * con un número viejo se tira.
   */
  private generacion = 0;

  constructor(cb: Callbacks) {
    this.nativo = avplay();
    this.cb = cb;
  }

  get usaNativo() {
    return this.nativo !== null;
  }

  /** PLAYING, PAUSED, READY, IDLE, NONE… */
  estado(): string {
    if (!this.nativo) return this.video ? (this.video.paused ? 'PAUSED' : 'PLAYING') : 'NONE';
    try {
      return this.nativo.getState();
    } catch (e) {
      return 'NONE';
    }
  }

  /** Lo que el flujo actual se salta por dentro: en modo convertido no es cero. */
  get inicioDelFlujo() {
    return this.desfase;
  }

  /** Pistas tal y como las numera AVPlay, ya separadas por tipo. */
  pistasNativas(tipo: 'AUDIO' | 'TEXT'): PistaNativa[] {
    if (!this.nativo) return [];
    let todas: PistaAVPlay[] = [];
    try {
      todas = this.nativo.getTotalTrackInfo() || [];
    } catch (e) {
      this.fallo = 'getTotalTrackInfo: ' + motivo(e);
      return [];
    }
    const salida: PistaNativa[] = [];
    for (let i = 0; i < todas.length; i++) {
      if (todas[i].type !== tipo) continue;
      let extra: Record<string, string> = {};
      try {
        extra = JSON.parse(todas[i].extra_info || '{}');
      } catch (e) {
        /* algunos ficheros traen texto que no es JSON */
      }
      salida.push({
        ordinal: salida.length,
        indice: todas[i].index,
        idioma: String(extra.language || extra.track_lang || extra.lang || ''),
        codec: String(extra.fourCC || extra.codec || ''),
        canales: Number(extra.channels || 0),
      });
    }
    return salida;
  }

  elegirAudio(ordinal: number): boolean {
    const pistas = this.pistasNativas('AUDIO');
    if (!this.nativo || ordinal < 0 || !pistas[ordinal]) return false;
    try {
      this.nativo.setSelectTrack('AUDIO', pistas[ordinal].indice);
      return true;
    } catch (e) {
      this.fallo = 'audio: ' + motivo(e);
      return false;
    }
  }

  /** −1 apaga los subtítulos; el resto es el ordinal de la pista de texto. */
  elegirSubtitulo(ordinal: number): boolean {
    if (!this.nativo) return false;
    if (ordinal < 0) {
      try {
        if (this.nativo.setSilentSubtitle) this.nativo.setSilentSubtitle(true);
      } catch (e) {
        this.fallo = 'subtitulos: ' + motivo(e);
      }
      if (this.cb.onSubtitulo) this.cb.onSubtitulo('', 0);
      return true;
    }
    const pistas = this.pistasNativas('TEXT');
    if (!pistas[ordinal]) return false;
    try {
      if (this.nativo.setSilentSubtitle) this.nativo.setSilentSubtitle(false);
      this.nativo.setSelectTrack('TEXT', pistas[ordinal].indice);
      return true;
    } catch (e) {
      this.fallo = 'subtitulos: ' + motivo(e);
      return false;
    }
  }

  /**
   * Desfase de los subtítulos, en milisegundos (positivo = más tarde).
   *
   * Lo hace AVPlay por dentro con `setSubtitlePosition`, que es lo único que
   * permite adelantarlos: el texto llega por `onsubtitlechange` cuando toca, y
   * desde la aplicación solo se podría retrasar, nunca adelantar.
   */
  retardoSubtitulos(ms: number): boolean {
    if (!this.nativo || !this.nativo.setSubtitlePosition) return false;
    try {
      this.nativo.setSubtitlePosition(Math.round(ms));
      return true;
    } catch (e) {
      this.fallo = 'retardo de subtitulos: ' + motivo(e);
      return false;
    }
  }

  abrir(
    url: string,
    contenedor: HTMLElement,
    desdeSegundos: number,
    duracionSegundos: number,
    pistas?: { audio: number; subtitulo: number },
    /** El flujo ya empieza cortado en este segundo: no hay que buscar. */
    desfaseDelFlujo = 0,
  ) {
    this.duracionConocida = duracionSegundos;
    this.desfase = desfaseDelFlujo;
    const gen = ++this.generacion;
    /** Este aviso, ¿es de la reproducción de ahora o de una que ya se cerró? */
    const vigente = () => gen === this.generacion;

    if (this.nativo) {
      const p = this.nativo;
      /*
       * `open` revienta si el aparato no ha vuelto a IDLE —pasa si el `close`
       * anterior falló, o si se vuelve a dar a reproducir mientras el anterior
       * todavía se estaba preparando—. Sin recogerlo, la excepción subía por
       * la promesa que pide las pistas y se perdía: pantalla negra, sin vídeo
       * y sin un solo mensaje que dijera por qué.
       */
      try {
        p.open(url);
        p.setDisplayRect(0, 0, 1920, 1080);
        p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      } catch (e) {
        this.fallo = 'open: ' + motivo(e);
        this.cb.onError('No se pudo abrir el vídeo: ' + this.fallo);
        return;
      }
      p.setListener({
        onbufferingstart: () => { if (vigente()) this.cb.onBuffer(true); },
        onbufferingcomplete: () => { if (vigente()) this.cb.onBuffer(false); },
        oncurrentplaytime: (ms) => { if (vigente()) this.cb.onTiempo(this.desfase + ms / 1000, this.duracion()); },
        onstreamcompleted: () => { if (vigente()) this.cb.onFin(); },
        onsubtitlechange: (duracion, texto) => {
          if (vigente() && this.cb.onSubtitulo) this.cb.onSubtitulo(String(texto || ''), Number(duracion) || 0);
        },
        onerror: (e) => {
          if (!vigente()) return;
          this.fallo = motivo(e);
          this.cb.onError('AVPlay: ' + this.fallo);
        },
      });
      p.prepareAsync(
        () => {
          // Se ha salido mientras se preparaba: ni `play()` ni nada. Arrancar
          // aquí dejaba la película sonando encima de la pantalla siguiente.
          if (!vigente()) return;
          // Reproducir es lo PRIMERO. Elegir pista o buscar antes del `play()`
          // deja el aparato clavado: ver la nota 1 de la cabecera.
          try {
            p.play();
          } catch (e) {
            this.fallo = 'play: ' + motivo(e);
            this.cb.onError('No se pudo empezar: ' + this.fallo);
            return;
          }
          /*
           * Solo se le pide lo que de verdad hay que cambiar.
           *
           * AVPlay ya arranca con la primera pista de audio y sin subtítulos,
           * que es justo lo que se quiere la mayoría de las veces. Llamarle
           * igualmente a `setSelectTrack` o a `setSilentSubtitle` no añade nada
           * y sí mete al aparato en un camino que no hace falta pisar.
           */
          if (pistas) {
            if (pistas.audio > 0) this.elegirAudio(pistas.audio);
            if (pistas.subtitulo >= 0) this.elegirSubtitulo(pistas.subtitulo);
          }
          if (desdeSegundos > desfaseDelFlujo + 1) this.irA(desdeSegundos);
          this.cb.onBuffer(false);
        },
        (e) => {
          if (!vigente()) return;
          this.fallo = 'prepare: ' + motivo(e);
          this.cb.onError('No se pudo preparar el vídeo: ' + this.fallo);
        },
      );
      return;
    }

    const v = document.createElement('video');
    v.src = url;
    v.autoplay = true;
    v.style.width = '100%';
    v.style.height = '100%';
    v.addEventListener('timeupdate', () => this.cb.onTiempo(this.desfase + v.currentTime, this.duracion()));
    v.addEventListener('waiting', () => this.cb.onBuffer(true));
    v.addEventListener('playing', () => this.cb.onBuffer(false));
    v.addEventListener('ended', () => this.cb.onFin());
    v.addEventListener('error', () => this.cb.onError('El navegador no puede reproducir este fichero'));
    v.addEventListener('loadedmetadata', () => {
      if (desdeSegundos > desfaseDelFlujo) v.currentTime = desdeSegundos - desfaseDelFlujo;
    });
    contenedor.appendChild(v);
    this.video = v;
  }

  /**
   * Duración del fichero, no la del flujo.
   *
   * Cuando el audio se reprocesa, ffmpeg entrega la película ya cortada por el
   * segundo pedido: lo que el reproductor ve es «lo que queda», y unas veces
   * dice eso y otras repite la duración entera de la cabecera del MKV. Ninguna
   * de las dos sirve para la barra, así que con desfase manda siempre la del
   * fichero, que la sabe el servidor.
   */
  duracion(): number {
    if (this.nativo) {
      let d = 0;
      try {
        d = this.nativo.getDuration();
      } catch (e) {
        d = 0;
      }
      if (this.desfase > 0) return this.duracionConocida;
      return d > 0 ? d / 1000 : this.duracionConocida;
    }
    if (this.desfase > 0) return this.duracionConocida;
    return this.video && isFinite(this.video.duration) ? this.video.duration : this.duracionConocida;
  }

  tiempo(): number {
    if (this.nativo) {
      try {
        return this.desfase + this.nativo.getCurrentTime() / 1000;
      } catch (e) {
        return this.desfase;
      }
    }
    return this.video ? this.desfase + this.video.currentTime : 0;
  }

  reproduciendo(): boolean {
    return this.estado() === 'PLAYING';
  }

  reproducir() {
    if (this.nativo) {
      try {
        this.nativo.play();
      } catch (e) {
        this.fallo = 'play: ' + motivo(e);
      }
      return;
    }
    if (this.video) void this.video.play();
  }

  pausar() {
    if (this.nativo) {
      try {
        this.nativo.pause();
      } catch (e) {
        this.fallo = 'pause: ' + motivo(e);
      }
      return;
    }
    if (this.video) this.video.pause();
  }

  alternarPausa() {
    if (this.reproduciendo()) this.pausar();
    else this.reproducir();
  }

  /**
   * Salta a un punto del fichero. Devuelve false si AVPlay lo rechaza, y el
   * motivo queda en `fallo` para que la pantalla lo pueda enseñar.
   */
  irA(segundos: number): boolean {
    const total = this.duracion();
    const tope = total > 3 ? total - 3 : total;
    const destino = Math.max(this.desfase, Math.min(tope, segundos));

    if (!this.nativo) {
      if (!this.video) return false;
      this.video.currentTime = Math.max(0, destino - this.desfase);
      return true;
    }

    const p = this.nativo;
    // Buscar exige estar reproduciendo o en pausa; si viene de READY, se arranca.
    const estado = this.estado();
    if (estado !== 'PLAYING' && estado !== 'PAUSED') {
      try {
        p.play();
      } catch (e) {
        this.fallo = 'play antes de buscar: ' + motivo(e);
        return false;
      }
    }

    const ms = Math.round((destino - this.desfase) * 1000);
    try {
      p.seekTo(ms, undefined, (e) => {
        this.fallo = 'seekTo rechazado: ' + motivo(e);
      });
      this.fallo = '';
      return true;
    } catch (e) {
      this.fallo = 'seekTo: ' + motivo(e);
    }

    // Plan B: el salto relativo, que algunos firmwares aceptan cuando `seekTo`
    // falla.
    try {
      const ahora = p.getCurrentTime();
      const delta = ms - ahora;
      if (delta >= 0) p.jumpForward(delta);
      else p.jumpBackward(-delta);
      this.fallo = '';
      return true;
    } catch (e) {
      this.fallo = 'salto relativo: ' + motivo(e);
      return false;
    }
  }

  cerrar() {
    // Lo que llegue a partir de aquí es de una reproducción que ya no existe.
    this.generacion++;
    if (this.nativo) {
      try {
        this.nativo.stop();
        this.nativo.close();
      } catch (e) {
        /* ya estaba cerrado */
      }
      return;
    }
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      if (this.video.parentElement) this.video.parentElement.removeChild(this.video);
      this.video = null;
    }
  }
}
