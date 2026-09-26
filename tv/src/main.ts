import {
  api,
  guardarServidor,
  guardarToken,
  imagen,
  olvidarToken,
  servidor,
  token,
  idioma,
  urlReproduccion,
  type Ficha,
  type InfoReproduccion,
  type RangoSalto,
  type Tira,
  type Titulo,
} from './api.ts';
import { ajustes, cargarAjustes, guardarAjustes, ordenar, type Rendimiento } from './ajustes.ts';
import { actual, alPulsar, avisarDeFallos, enfocables, enfocar, indexar, indexarAdemas, iniciarNavegacion, manejadorActual, TECLA } from './nav.ts';
import { Reproductor } from './player.ts';

const marco = document.getElementById('app') as HTMLElement;

/* ------------------------------------------------------------- utilidades */

function reloj(segundos: number): string {
  if (!isFinite(segundos) || segundos < 0) segundos = 0;
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  const dos = (n: number) => (n < 10 ? '0' + n : String(n));
  return h > 0 ? h + ':' + dos(m) + ':' + dos(s) : m + ':' + dos(s);
}

/**
 * La hora del reloj de pared dentro de `segundos`.
 *
 * Saber que quedan 47 minutos obliga a hacer la cuenta; saber que termina a las
 * 23:40 se entiende sin pensar, que es de lo que más se pide en Plex y lo que
 * el Apple TV lleva puesto de serie. Se enseña en formato de 24 h, que es como
 * está la casa.
 */
function horaDeFin(segundos: number): string {
  const fin = new Date(Date.now() + segundos * 1000);
  const dos = (n: number) => (n < 10 ? '0' + n : String(n));
  return dos(fin.getHours()) + ':' + dos(fin.getMinutes());
}

/** Los títulos vienen de ficheros del disco: pueden traer comillas o < >. */
function esc(texto: string | null | undefined): string {
  if (!texto) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ICONOS: Record<string, string> = {
  inicio: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z',
  buscar: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-3.5-3.5',
  saga: 'M4 6h10M4 12h16M4 18h13',
  favorito: 'M12 20.5s-7-4.4-8.7-8.4A5 5 0 0 1 12 6.8a5 5 0 0 1 8.7 5.3C19 16.1 12 20.5 12 20.5Z',
  pelicula: 'M3 5.5h18v13H3zM3 9.5h18M8 5.5v4M16 5.5v4',
  serie: 'M4 8h16v11H4zM9 4l3 4 3-4',
  ajustes: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M4 12h2M18 12h2M12 4v2M12 18v2',
};

const icono = (nombre: string) =>
  '<svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="' + ICONOS[nombre] + '"/></svg>';

function aviso(mensaje: string) {
  const el = document.createElement('div');
  el.className = 'aviso';
  el.textContent = mensaje;
  marco.appendChild(el);
  setTimeout(() => {
    if (el.parentElement) el.parentElement.removeChild(el);
  }, 4500);
}

/* ------------------------------------------------------------ menú lateral */

type Destino = { clave: string; etiqueta: string; icono: string; ir: () => void };

let bibliotecas: { id: number; name: string; kind: string }[] = [];
let temporizadorHeroe = 0;

/**
 * La última portada pintada y por dónde iba el foco.
 *
 * Volver de una ficha volvía a pedir `/api/home`, y como las filas de cada
 * biblioteca son al azar, salía OTRA portada con el foco en «Ver ficha»: se
 * perdía el sitio cada vez. Cinco minutos de vigencia, como en el móvil.
 */
type DatosPortada = { hero: Titulo[]; rows: { key: string; title: string; kind: string; items: Titulo[] }[] };
let portadaGuardada: { datos: DatosPortada; cuando: number } | null = null;
let focoPortada: string | null = null;
const VIGENCIA_PORTADA_MS = 5 * 60_000;

/** Quién es el perfil de esta sesión; lo que decide si sale «Eliminar». */
let soyAdmin = false;

/** El reproductor de la película que se está viendo ahora, si hay alguna. */
let reproductorActivo: Reproductor | null = null;

/** La última saga abierta y la última tarjeta pulsada en Buscar: para volver ahí. */
let focoSaga: string | null = null;
let focoBuscar: string | null = null;

function destinosBase(): Destino[] {
  // Los cinco fijos juntos, Ajustes incluido; debajo, con su separador, las
  // bibliotecas. Antes Ajustes iba al final, perdido tras nueve bibliotecas.
  const fijos: Destino[] = [
    { clave: 'inicio', etiqueta: 'Inicio', icono: 'inicio', ir: () => void pantallaPortada() },
    { clave: 'buscar', etiqueta: 'Buscar', icono: 'buscar', ir: () => pantallaBuscar() },
    { clave: 'sagas', etiqueta: 'Sagas', icono: 'saga', ir: () => void pantallaSagas() },
    { clave: 'favoritos', etiqueta: 'Favoritos', icono: 'favorito', ir: () => void pantallaFavoritos() },
    { clave: 'ajustes', etiqueta: 'Ajustes', icono: 'ajustes', ir: () => pantallaAjustes() },
  ];
  const libs = bibliotecas.map((b) => ({
    clave: 'lib-' + b.id,
    etiqueta: b.name,
    icono: b.kind === 'movie' ? 'pelicula' : 'serie',
    ir: () => void pantallaBiblioteca(b.id, b.name),
  }));
  return fijos.concat(libs);
}

/** Lo que ve el menú: el orden elegido y sin las secciones escondidas. */
const destinos = (): Destino[] => ordenar(destinosBase());

function menuHtml(activa: string): string {
  const lista = destinos();
  let html =
    '<nav class="menu" data-menu>' +
    // Plegado se ve el icono; desplegado, el icono y el nombre. Antes salía
    // el nombre cortado a la mitad contra el borde del menú.
    '<div class="menu-marca"><img class="menu-icono" src="./icon.png" alt="">' +
    '<span class="menu-nombre">Media Watch</span></div>';
  let seccionPuesta = false;

  lista.forEach((d) => {
    if (d.clave.indexOf('lib-') === 0 && !seccionPuesta) {
      html += '<div class="menu-seccion">Bibliotecas</div>';
      seccionPuesta = true;
    }
    html +=
      '<button data-nav data-destino="' + d.clave + '" class="opcion' + (d.clave === activa ? ' activa' : '') + '">' +
      icono(d.icono) +
      '<span class="etiqueta">' + esc(d.etiqueta) + '</span></button>';
  });

  return html + '</nav>';
}

function conectarMenu() {
  const lista = destinos();
  marco.querySelectorAll<HTMLElement>('[data-destino]').forEach((el) => {
    el.addEventListener('click', () => {
      const d = lista.filter((x) => x.clave === el.getAttribute('data-destino'))[0];
      if (d) d.ir();
    });
  });
}

/** El menú se ensancha solo cuando el foco entra en él. */
function ajustarMenu() {
  const menu = marco.querySelector<HTMLElement>('[data-menu]');
  if (!menu) return;
  const foco = actual();
  const dentro = !!(foco && foco.closest('[data-menu]'));
  if (dentro) menu.classList.add('abierto');
  else menu.classList.remove('abierto');
}

/** Estructura común: menú + lienzo desplazable. */
function pintar(activa: string, contenido: string) {
  window.clearInterval(temporizadorHeroe);
  alPulsar(null);
  // Cualquier pantalla que no sea el reproductor vuelve a tener fondo opaco.
  document.body.classList.remove('viendo');
  marco.innerHTML =
    '<div class="marco">' + menuHtml(activa) +
    '<div class="contenido"><div class="lienzo" data-lienzo>' + contenido + '</div></div></div>';
  conectarMenu();
  observarImagenes();
  indexar();
}

/** Desde cualquier pantalla, Atrás lleva al menú; desde el menú, a Inicio. */
function atrasHaciaMenu(): boolean {
  const foco = actual();
  if (foco && foco.closest('[data-menu]')) {
    const inicio = marco.querySelector<HTMLElement>('[data-destino="inicio"]');
    if (inicio && !inicio.classList.contains('activa')) {
      void pantallaPortada();
      return true;
    }
    return false;
  }
  const opcion = marco.querySelector<HTMLElement>('.opcion.activa') || marco.querySelector<HTMLElement>('.opcion');
  if (opcion) {
    enfocar(opcion);
    ajustarMenu();
    return true;
  }
  return false;
}

/* --------------------------------------------------- volver donde estabas */

/*
 * Dos memorias muy cortas, que es lo que separa «una lista de botones» de algo
 * que se maneja como el Apple TV.
 *
 * 1. De dónde vengo. Al salir de una película se volvía SIEMPRE a la portada:
 *    después de bajar por 700 títulos de Películas, Atrás te dejaba en el
 *    inicio y había que rehacer el camino entero.
 * 2. Por dónde iba. Al volver a una biblioteca se pedían otra vez los primeros
 *    120 títulos y el foco caía en el primero, así que daba igual lo que
 *    hubieras bajado.
 */
let reabrirActual: (() => void) | null = null;
/** Qué pantalla es la de ahora, para no tomarla como su propio «atrás». */
let idActual = '';
/** De dónde se vino a la pantalla de ahora. */
let volverDesde: (() => void) | null = null;

/**
 * Anota que se entra en una pantalla y desde dónde.
 *
 * La comprobación del identificador es lo importante: al salir de una película
 * se vuelve a pintar la MISMA ficha, y sin ella la ficha se quedaba apuntada
 * como su propio origen. Resultado: Atrás la reabría una y otra vez y no había
 * forma de salir de ahí — que es justo lo que pasaba.
 */
function entrarEn(id: string, comoVolverAqui: () => void) {
  if (idActual !== id) volverDesde = reabrirActual;
  idActual = id;
  reabrirActual = comoVolverAqui;
}

type PosicionRejilla = { cargados: number; foco: number };
const posiciones: Record<string, PosicionRejilla> = {};

/** El servidor no sirve más de 500 de una vez; de ahí en adelante se pagina. */
const MAXIMO_RESTAURADO = 480;

/* ------------------------------------------------------------- tarjetas */

function tarjeta(t: Titulo): string {
  const duracion = t.progressDuration || (t.runtime ? t.runtime * 60 : 0);
  const pct = t.position && duracion ? Math.min(100, (t.position / duracion) * 100) : 0;
  return (
    '<div class="tarjeta" data-nav data-id="' + t.id + '">' +
    '<div class="lamina">' +
    (t.has_poster
      ? '<img data-src="' + imagen.poster(t.id, 320) + '" alt="">'
      : '<span class="sin-lamina">' + esc(t.title) + '</span>') +
    (pct > 1 ? '<div class="progreso"><i style="width:' + pct.toFixed(0) + '%"></i></div>' : '') +
    '</div>' +
    '<div class="nombre' + (t.watched ? ' vista' : '') + '">' + esc(t.title) + '</div>' +
    '<div class="anyo">' + (t.year || '') + '</div>' +
    '</div>'
  );
}

const filaHtml = (titulo: string, items: Titulo[]) =>
  '<section class="fila" data-bloque><h2>' + esc(titulo) + '</h2>' +
  '<div class="carrusel" data-carrusel><div class="pista">' + items.map(tarjeta).join('') + '</div></div></section>';

/**
 * Marca las que ya tienen manejador: las rejillas grandes se van completando
 * por paginas y sin la marca cada pagina nueva volvia a enganchar un `click`
 * mas a todas las anteriores.
 */
function conectarTarjetas() {
  marco.querySelectorAll<HTMLElement>('.tarjeta:not([data-lista])').forEach((el) => {
    el.setAttribute('data-lista', '1');
    el.addEventListener('click', () => {
      // Para volver aquí mismo desde la ficha.
      if (idActual === 'portada') focoPortada = el.getAttribute('data-id');
      if (idActual === 'buscar') focoBuscar = el.getAttribute('data-id');
      void pantallaFicha(Number(el.getAttribute('data-id')));
    });
  });
}


/* ------------------------------------------------------ carga de imágenes */

let observador: IntersectionObserver | null = null;

/**
 * Una portada puede traer 180 carátulas. Cargarlas todas de golpe ahoga a la
 * tele; así solo se piden las que están a punto de verse, y el desplazamiento
 * se mantiene suave.
 */
function observarImagenes() {
  if (!('IntersectionObserver' in window)) {
    marco.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((img) => {
      img.onload = () => img.classList.add('puesta');
      img.onerror = () => img.classList.add('puesta');
      img.src = img.getAttribute('data-src') || '';
      img.removeAttribute('data-src');
    });
    return;
  }

  if (observador) observador.disconnect();
  observador = new IntersectionObserver(
    (entradas) => {
      entradas.forEach((entrada) => {
        if (!entrada.isIntersecting) return;
        const img = entrada.target as HTMLImageElement;
        const src = img.getAttribute('data-src');
        if (src) {
          // La clase se pone al cargar, no antes: si se pusiera ya, el fundido
          // correria con el hueco vacio y la caratula seguiria apareciendo de
          // golpe al final.
          img.onload = () => img.classList.add('puesta');
          img.onerror = () => img.classList.add('puesta');
          img.src = src;
          img.removeAttribute('data-src');
          // Ya estaba en la cache del navegador: sin fundido, directa, que es
          // lo que hace que volver a una biblioteca se sienta instantaneo.
          if (img.complete) img.classList.add('puesta');
        }
        observador!.unobserve(img);
      });
    },
    { rootMargin: '900px 600px' },
  );

  marco.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((img) => observador!.observe(img));
  precargar();
}

/*
 * Precarga de caratulas.
 *
 * El observador solo pide la imagen cuando esta a punto de verse, y en una
 * rejilla de 1372 titulos eso significa esperar en cada pantallazo. Aqui se
 * piden todas las de la pantalla en segundo plano, de cuatro en cuatro y
 * empezando un segundo despues de pintar, para no competir con las que se ven.
 *
 * El servidor las manda con `Cache-Control` de treinta dias, asi que basta con
 * que el navegador las haya pedido una vez; ademas se guarda la referencia a las
 * ultimas 150 `Image` para que no las descarte enseguida. Mas no: una caratula
 * de 320 px descomprimida ocupa medio mega, y la memoria de esta tele no da
 * para guardar la biblioteca entera abierta.
 */
const pedidas: Record<string, boolean> = {};
const retenidas: HTMLImageElement[] = [];
let cola: string[] = [];
let enVuelo = 0;
let arranqueCola = 0;

function siguienteDeLaCola() {
  while (enVuelo < 4 && cola.length) {
    const url = cola.shift() as string;
    if (pedidas[url]) continue;
    pedidas[url] = true;
    enVuelo++;
    const img = new Image();
    const fin = () => {
      enVuelo--;
      siguienteDeLaCola();
    };
    img.onload = fin;
    img.onerror = fin;
    img.src = url;
    retenidas.push(img);
    if (retenidas.length > 150) retenidas.shift();
  }
}

/**
 * Suelta lo que la precarga tenga cogido.
 *
 * Al empezar una pelicula: la cola seguia pidiendo caratulas de la pantalla
 * anterior mientras el video arrancaba —mas peticiones y mas imagenes que
 * descodificar justo en el peor momento— y las 150 `Image` retenidas ocupan
 * memoria de video que la tele necesita para otra cosa.
 */
function soltarPrecarga() {
  cola = [];
  window.clearTimeout(arranqueCola);
  retenidas.length = 0;
  if (observador) {
    observador.disconnect();
    observador = null;
  }
}

function precargar() {
  const urls: string[] = [];
  marco.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((img) => {
    const u = img.getAttribute('data-src');
    if (u && !pedidas[u]) urls.push(u);
  });
  // La cola se reemplaza: al cambiar de pantalla, lo de la anterior ya no sirve.
  cola = urls;
  window.clearTimeout(arranqueCola);
  arranqueCola = window.setTimeout(siguienteDeLaCola, 1000);
}

/* ------------------------------------------------------------- portada */

async function pantallaPortada(volviendo = false) {
  entrarEn('portada', () => void pantallaPortada(true));

  let datos: DatosPortada;
  const guardada = volviendo && portadaGuardada && Date.now() - portadaGuardada.cuando < VIGENCIA_PORTADA_MS ? portadaGuardada.datos : null;
  if (guardada) {
    datos = guardada;
  } else {
    pintar('inicio', '<div class="vacio">Cargando la biblioteca…</div>');
    try {
      datos = await api.portada();
      portadaGuardada = { datos, cuando: Date.now() };
    } catch (e) {
    if ((e as { status?: number }).status === 401) {
      olvidarToken();
      void pantallaConexion();
      return;
    }
    /*
     * El servidor puede estar reiniciándose: el vigilante lo levanta en menos
     * de un minuto. Antes la app se quedaba con el cartel puesto para siempre y
     * había que salir y volver a entrar; ahora vuelve a intentarlo sola.
     */
    pintar(
      'inicio',
      '<div class="vacio">No se pudo conectar con el servidor.<br>' +
        '<span class="dato" data-reintento>Reintentando…</span></div>' +
        '<div class="acciones" data-bloque><button class="boton" data-nav data-ahora>Reintentar ahora</button>' +
        '<button class="boton" data-nav data-otro-servidor>Cambiar de servidor</button></div>',
    );
    enfocar(marco.querySelector<HTMLElement>('[data-ahora]'));
    const ahora = marco.querySelector<HTMLElement>('[data-ahora]');
    if (ahora) ahora.addEventListener('click', () => void pantallaPortada());
    const otro = marco.querySelector<HTMLElement>('[data-otro-servidor]');
    if (otro) otro.addEventListener('click', () => pantallaServidor());
    window.setTimeout(() => {
      // Si ya se ha ido a otra pantalla, no se molesta a nadie.
      if (marco.querySelector('[data-reintento]')) void pantallaPortada();
    }, 6000);
    return;
    }
  }

  const heroes = datos.hero.slice(0, 6);
  let html = '';

  if (heroes.length) {
    html +=
      '<div class="heroe" data-bloque data-heroe>' +
      heroes
        .map((h, i) =>
          '<div class="heroe-fondo' + (i === 0 ? ' visible' : '') + '" data-fondo="' + i + '">' +
          (h.has_fanart ? '<img src="' + imagen.fondo(h.id, 1920) + '" alt="">' : '') +
          '</div>',
        )
        .join('') +
      '<div class="velo-izq"></div><div class="velo-abajo"></div>' +
      '<div class="heroe-texto" data-heroe-texto></div>' +
      '<div class="puntos" data-puntos>' +
      heroes.map((_, i) => '<span class="punto' + (i === 0 ? ' activo' : '') + '"></span>').join('') +
      '</div></div>';
  }

  datos.rows.forEach((fila) => {
    if (fila.items.length) html += filaHtml(fila.title, fila.items);
  });

  pintar('inicio', html);
  conectarTarjetas();

  if (heroes.length) montarHeroe(heroes);
  // Al volver, a la tarjeta en la que se estaba; si ya no está, al héroe.
  const deAntes = guardada && focoPortada ? marco.querySelector<HTMLElement>('.fila [data-id="' + focoPortada + '"]') : null;
  enfocar(deAntes || marco.querySelector<HTMLElement>('[data-heroe] [data-nav]') || enfocables()[0]);

  alPulsar((tecla) => (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE ? atrasHaciaMenu() : false));
}

/**
 * El héroe rota entre varias películas. El texto se reescribe en su sitio para
 * no rehacer los fondos, que ya están cargados y solo se cruzan con opacidad.
 */
function montarHeroe(heroes: Titulo[]) {
  let indice = 0;

  const pintarTexto = () => {
    const h = heroes[indice];
    const caja = marco.querySelector<HTMLElement>('[data-heroe-texto]');
    if (!caja) return;

    const focoPrevio = actual();
    const enfocadoAqui = !!(focoPrevio && focoPrevio.closest('[data-heroe]'));
    const eraSiguiente = !!(focoPrevio && focoPrevio.hasAttribute('data-heroe-siguiente'));

    caja.innerHTML =
      (h.has_logo
        ? '<img class="heroe-logo" src="' + imagen.logo(h.id, 520) + '" alt="">'
        : '<h1 class="heroe-titulo">' + esc(h.title) + '</h1>') +
      '<div class="heroe-meta">' +
      [h.year, h.runtime ? Math.round(h.runtime) + ' min' : '', h.library_name].filter(Boolean).join('  ·  ') +
      (h.rating ? '  ·  <span class="nota">★ ' + h.rating.toFixed(1) + '</span>' : '') +
      '</div>' +
      (h.plot ? '<div class="heroe-sinopsis">' + esc(h.plot) + '</div>' : '') +
      '<button class="boton primario" data-nav data-heroe-ver>Ver ficha</button>' +
      '<button class="boton" data-nav data-heroe-siguiente>Siguiente</button>';

    const ver = caja.querySelector<HTMLElement>('[data-heroe-ver]');
    if (ver) ver.addEventListener('click', () => void pantallaFicha(heroes[indice].id));
    const sig = caja.querySelector<HTMLElement>('[data-heroe-siguiente]');
    if (sig) sig.addEventListener('click', () => cambiar((indice + 1) % heroes.length));

    indexar();
    if (enfocadoAqui) {
      enfocar(caja.querySelector<HTMLElement>(eraSiguiente ? '[data-heroe-siguiente]' : '[data-heroe-ver]'));
    }
  };

  const cambiar = (nuevo: number) => {
    indice = nuevo;
    // El cruce de dos imágenes a pantalla completa es de lo más caro que hay
    // aquí; en modo rápido el CSS ya lo anula, esto solo evita el trabajo.
    marco.querySelectorAll<HTMLElement>('[data-fondo]').forEach((el, i) => {
      if (i === indice) el.classList.add('visible');
      else el.classList.remove('visible');
    });
    marco.querySelectorAll<HTMLElement>('[data-puntos] .punto').forEach((el, i) => {
      if (i === indice) el.classList.add('activo');
      else el.classList.remove('activo');
    });
    pintarTexto();
  };

  pintarTexto();
  window.clearInterval(temporizadorHeroe);
  // Rota siempre: pausarlo cuando el foco estaba en el héroe significaba no
  // rotar nunca, porque ahí es donde arranca el foco al abrir la portada.
  // `pintarTexto` vuelve a colocar el foco en el mismo botón tras el cambio.
  if (ajustes().heroeRotar) {
    temporizadorHeroe = window.setInterval(() => cambiar((indice + 1) % heroes.length), ajustes().heroeSegundos * 1000);
  }
}

/* ---------------------------------------------------------- rejilla común */

/** Cuantos titulos se piden de una vez. Peliculas tiene 1372. */
const PAGINA = 120;

type MasTitulos = { total: number; traer: (offset: number) => Promise<Titulo[]> };

function pantallaRejilla(
  activa: string,
  titulo: string,
  subtitulo: string,
  items: Titulo[],
  aMedias: Titulo[] = [],
  mas?: MasTitulos,
) {
  const cuerpo =
    '<div class="cabecera" data-bloque><h1>' + esc(titulo) + '</h1><p>' + esc(subtitulo) + '</p></div>' +
    (aMedias.length ? filaHtml('Seguir viendo', aMedias) : '') +
    (items.length
      ? '<div class="rejilla" data-bloque>' + items.map(tarjeta).join('') + '</div>'
      : '<div class="vacio">Aquí no hay nada todavía.</div>');

  pintar(activa, cuerpo);
  conectarTarjetas();

  // Si ya se había estado aquí, se vuelve a la misma tarjeta.
  const guardado = posiciones[activa];
  const volverA = guardado ? marco.querySelector<HTMLElement>('.rejilla .tarjeta[data-id="' + guardado.foco + '"]') : null;
  enfocar(volverA || marco.querySelector<HTMLElement>('.rejilla [data-nav]') || marco.querySelector<HTMLElement>('.opcion.activa'));

  /*
   * Carga por paginas.
   *
   * Antes se pedian 120 titulos y ahi se acababa la rejilla: «Peques» tiene 188
   * y «Películas» 1372, asi que la mitad de la biblioteca no existia para la
   * tele —de ahi que Peques terminase en «Merlín el encantado»—. Ahora, cuando
   * el foco se acerca al final de lo cargado, se pide el trozo siguiente y se
   * anade. Pintar los 1372 de golpe llenaria la pantalla de nodos que la tele
   * no mueve bien; asi el DOM crece solo hasta donde se ha llegado mirando.
   */
  const rejilla = marco.querySelector<HTMLElement>('.rejilla');
  if (!mas || !rejilla) {
    alPulsar((tecla) => (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE ? atrasHaciaMenu() : false));
    return;
  }

  let cargados = items.length;
  let cargando = false;

  const traerMas = () => {
    if (cargando || cargados >= mas.total) return;
    cargando = true;
    mas
      .traer(cargados)
      .then((nuevos) => {
        cargando = false;
        if (!nuevos.length || !rejilla.parentElement) return;
        const desde = rejilla.children.length;
        cargados += nuevos.length;
        rejilla.insertAdjacentHTML('beforeend', nuevos.map(tarjeta).join(''));
        conectarTarjetas();
        // Solo se miden las tarjetas nuevas: volver a medir las 600 anteriores
        // costaba 53 ms y se notaba como un tironcito al bajar.
        const recien: HTMLElement[] = [];
        for (let n = desde; n < rejilla.children.length; n++) recien.push(rejilla.children[n] as HTMLElement);
        indexarAdemas(recien);
        observarImagenes();
      })
      .catch(() => {
        cargando = false;
      });
  };

  // Media pagina de margen: pedir con 30 de antelacion llegaba justo y se veia
  // el hueco; con 60, la peticion (113 ms) termina antes de que se llegue.
  const MARGEN_PAGINA = 60;
  const cercaDelFinal = () => {
    const foco = actual();
    if (!foco || !rejilla.contains(foco)) return;
    const tarjetas = rejilla.children;
    for (let i = Math.max(0, tarjetas.length - MARGEN_PAGINA); i < tarjetas.length; i++) {
      if (tarjetas[i] === foco) {
        traerMas();
        return;
      }
    }
  };

  const apuntarSitio = () => {
    const foco = actual();
    if (!foco || !rejilla.contains(foco)) return;
    const id = Number(foco.getAttribute('data-id'));
    if (id) posiciones[activa] = { cargados, foco: id };
  };

  alPulsar((tecla) => {
    if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) return atrasHaciaMenu();
    // El foco lo mueve la navegacion despues de este manejador, asi que la
    // comprobacion se hace cuando ya se ha movido.
    window.setTimeout(() => {
      cercaDelFinal();
      apuntarSitio();
    }, 0);
    return false;
  });
}

async function pantallaBiblioteca(id: number, nombre: string) {
  entrarEn('lib-' + id, () => void pantallaBiblioteca(id, nombre));
  pintar('lib-' + id, '<div class="vacio">Cargando…</div>');
  try {
    // Se piden de golpe todos los que estaban cargados la última vez: volver a
    // la biblioteca debe dejarte donde estabas, no al principio.
    const guardado = posiciones['lib-' + id];
    const cuantos = Math.min(MAXIMO_RESTAURADO, Math.max(PAGINA, guardado ? guardado.cargados : 0));
    const datos = await api.titulos(id, 0, cuantos);
    // Lo que se estaba viendo de ESTA biblioteca: en Peliculas solo peliculas,
    // en Series solo series. La fila de la portada sigue englobando todo.
    const aMedias = await api.continuarEn(id).catch(() => [] as Titulo[]);
    pantallaRejilla('lib-' + id, nombre, datos.total + ' títulos', datos.items, aMedias, {
      total: datos.total,
      traer: (offset) => api.titulos(id, offset, PAGINA).then((d) => d.items),
    });
  } catch (e) {
    pintar('lib-' + id, '<div class="vacio">No se pudo cargar la biblioteca.</div>');
  }
}

async function pantallaFavoritos() {
  entrarEn('favoritos', () => void pantallaFavoritos());
  pintar('favoritos', '<div class="vacio">Cargando…</div>');
  try {
    const items = await api.favoritos();
    pantallaRejilla('favoritos', 'Favoritos', items.length + ' títulos', items);
  } catch (e) {
    pintar('favoritos', '<div class="vacio">No se pudieron cargar los favoritos.</div>');
  }
}

async function pantallaSagas() {
  entrarEn('sagas', () => void pantallaSagas());
  pintar('sagas', '<div class="vacio">Cargando…</div>');
  let sagas;
  try {
    sagas = await api.colecciones();
  } catch (e) {
    pintar('sagas', '<div class="vacio">No se pudieron cargar las sagas.</div>');
    return;
  }

  const cuerpo =
    '<div class="cabecera" data-bloque><h1>Sagas</h1><p>' + sagas.length + ' colecciones</p></div>' +
    '<div class="rejilla" data-bloque>' +
    sagas
      .map(
        (s) =>
          '<div class="tarjeta" data-nav data-saga="' + esc(s.name) + '">' +
          '<div class="lamina">' +
          (s.poster_id ? '<img data-src="' + imagen.poster(s.poster_id, 320) + '" alt="">' : '<span class="sin-lamina">' + esc(s.name) + '</span>') +
          '</div>' +
          '<div class="nombre">' + esc(s.name) + '</div>' +
          '<div class="anyo">' + s.count + ' títulos</div>' +
          '</div>',
      )
      .join('') +
    '</div>';

  pintar('sagas', cuerpo);
  marco.querySelectorAll<HTMLElement>('[data-saga]').forEach((el) => {
    el.addEventListener('click', () => {
      focoSaga = el.getAttribute('data-saga');
      void pantallaSaga(focoSaga || '');
    });
  });
  // Al volver de una saga, a su tarjeta; si no, a la primera.
  const deAntes = focoSaga ? Array.prototype.filter.call(marco.querySelectorAll<HTMLElement>('[data-saga]'), (el: HTMLElement) => el.getAttribute('data-saga') === focoSaga)[0] as HTMLElement | undefined : null;
  enfocar(deAntes || marco.querySelector<HTMLElement>('.rejilla [data-nav]'));
  alPulsar((tecla) => (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE ? atrasHaciaMenu() : false));
}

async function pantallaSaga(nombre: string) {
  entrarEn('saga-' + nombre, () => void pantallaSaga(nombre));
  pintar('sagas', '<div class="vacio">Cargando…</div>');
  try {
    const datos = await api.coleccion(nombre);
    pantallaRejilla('sagas', datos.name, datos.items.length + ' títulos, en orden cronológico', datos.items);
  } catch (e) {
    void pantallaSagas();
  }
}

/* -------------------------------------------------------------- buscador */

const TECLAS_ABC = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ0123456789'.split('');

function pantallaBuscar(inicial = '') {
  // Volver de una ficha a la búsqueda con la caja vacía obligaba a teclear el
  // título otra vez con el mando, que es justo lo que a nadie le apetece.
  let consulta = inicial;
  entrarEn('buscar', () => pantallaBuscar(consulta));
  let resultados: Titulo[] = [];
  let buscando = 0;

  const pintarTodo = () => {
    const foco = actual();
    const claveFoco = foco ? foco.getAttribute('data-tecla') || foco.getAttribute('data-id') : null;

    const cuerpo =
      '<div class="buscador" data-bloque>' +
      '<div class="consulta">' + (esc(consulta) || '<span class="cursor">Escribe un título…</span>') + '</div>' +
      '<div class="teclado">' +
      TECLAS_ABC.map((c) => '<button class="tecla" data-nav data-tecla="' + c + '">' + c + '</button>').join('') +
      '<button class="tecla ancha" data-nav data-tecla="ESPACIO">espacio</button>' +
      '<button class="tecla ancha" data-nav data-tecla="BORRAR">borrar</button>' +
      '</div>' +
      '<p class="desde-el-movil">O escríbelo en el móvil: abre Media Watch, busca y pulsa «Enviar a la tele».</p>' +
      '</div>' +
      (resultados.length
        ? '<div class="rejilla" data-bloque>' + resultados.map(tarjeta).join('') + '</div>'
        : consulta.length >= 2
          ? '<div class="vacio">Sin resultados para «' + esc(consulta) + '»</div>'
          : '');

    pintar('buscar', cuerpo);
    conectarTarjetas();

    marco.querySelectorAll<HTMLElement>('[data-tecla]').forEach((el) => {
      el.addEventListener('click', () => pulsar(el.getAttribute('data-tecla') || ''));
    });

    // Al volver de una ficha, a la tarjeta que se pulsó; si no, donde estaba
    // el foco antes de repintar; si no, la primera tecla.
    const volver = claveFoco
      ? marco.querySelector<HTMLElement>('[data-tecla="' + claveFoco + '"]') ||
        marco.querySelector<HTMLElement>('[data-id="' + claveFoco + '"]')
      : focoBuscar
        ? marco.querySelector<HTMLElement>('[data-id="' + focoBuscar + '"]')
        : null;
    focoBuscar = null;
    enfocar(volver || marco.querySelector<HTMLElement>('[data-tecla]'));
    alPulsar(manejar);
  };

  const buscar = () => {
    const propia = ++buscando;
    if (consulta.trim().length < 2) {
      resultados = [];
      pintarTodo();
      return;
    }
    api
      .buscar(consulta.trim())
      .then((r) => {
        if (propia !== buscando) return;   // llegó tarde: hay una búsqueda más nueva
        resultados = r.items;
        pintarTodo();
      })
      .catch(() => undefined);
  };

  const pulsar = (tecla: string) => {
    if (tecla === 'ESPACIO') consulta += ' ';
    else if (tecla === 'BORRAR') consulta = consulta.slice(0, -1);
    else consulta += tecla;
    buscar();
  };

  const manejar = (tecla: number) => {
    if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) {
      if (consulta) {
        consulta = consulta.slice(0, -1);
        buscar();
        return true;
      }
      return atrasHaciaMenu();
    }
    return false;
  };

  pintarTodo();
  if (consulta.length >= 2) buscar();
}

/* ----------------------------------------------------------------- ficha */

/**
 * Las notas de cada sitio, con su escala.
 *
 * IMDb y TMDb puntúan sobre 10 y los tomatómetros sobre 100: se enseña cada una
 * como la da su casa, porque convertirlas a una escala común daría números que
 * no coinciden con los que se ven en ningún sitio. Si no hay ninguna, se cae a
 * la nota suelta de siempre.
 */
function notasHtml(ficha: Ficha): string {
  const notas = ficha.ratings || [];
  if (!notas.length) {
    return ficha.rating ? '<div class="linea-nota">★ ' + ficha.rating.toFixed(1) + '</div>' : '';
  }
  return (
    '<div class="linea-nota">' +
    notas
      .map(
        (n) =>
          '<span class="nota-fuente"><b>' +
          (n.maximo === 100 ? Math.round(n.valor) + '%' : (Math.round(n.valor * 10) / 10).toFixed(1)) +
          '</b>' + esc(n.etiqueta) + '</span>',
      )
      .join('') +
    '</div>'
  );
}

async function pantallaFicha(id: number) {
  entrarEn('ficha-' + id, () => void pantallaFicha(id));
  const vengoDe = volverDesde;
  pintar('inicio', '<div class="vacio">Cargando…</div>');

  let ficha: Ficha;
  try {
    ficha = await api.ficha(id);
  } catch (e) {
    /*
     * Antes esto te echaba a la portada. Si el servidor tarda —porque está
     * ocupado, o acaba de reiniciarse— te encontrabas en el inicio sin saber
     * por qué, justo después de salir de una película. Mejor quedarse aquí y
     * ofrecer volver a intentarlo.
     */
    pintar(
      'inicio',
      '<div class="vacio">No se pudo abrir la ficha.</div>' +
        '<div class="acciones" data-bloque><button class="boton" data-nav data-reintentar>Reintentar</button>' +
        '<button class="boton" data-nav data-inicio>Ir al inicio</button></div>',
    );
    const rein = marco.querySelector<HTMLElement>('[data-reintentar]');
    if (rein) rein.addEventListener('click', () => void pantallaFicha(id));
    const ini = marco.querySelector<HTMLElement>('[data-inicio]');
    if (ini) ini.addEventListener('click', () => void pantallaPortada());
    enfocar(rein);
    alPulsar((tecla) => (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE ? (void pantallaPortada(), true) : false));
    return;
  }

  const esSerie = ficha.kind === 'show';
  const fichero = ficha.files.filter((f) => !f.episode_id)[0];
  const progreso = ficha.progress.filter((p) => p.episode_id === null)[0];
  const reanudar = ajustes().reanudar && progreso && !progreso.watched ? progreso.position : 0;

  const etiquetas: string[] = [];
  if (fichero) {
    const alto = fichero.height || 0;
    if (alto >= 1900) etiquetas.push('4K');
    else if (alto >= 1000) etiquetas.push('1080p');
    else if (alto >= 700) etiquetas.push('720p');
    if (fichero.video_codec) etiquetas.push(fichero.video_codec.toUpperCase());
    if (fichero.hdr) etiquetas.push(fichero.hdr);

    // El audio importa tanto como la resolución: saber si hay 5.1 o si la pista
    // está en tu idioma es lo que decide si vas a poder verla esta noche.
    (fichero.audio || []).slice(0, 3).forEach((a: { codec: string | null; language: string | null; channels: number | null }) => {
      const nombres: Record<string, string> = {
        ac3: 'Dolby Digital', eac3: 'Dolby Digital+', truehd: 'Dolby TrueHD',
        eac3_ddp_atmos: 'Dolby Atmos', 'eac3/atmos': 'Dolby Atmos', truehd_atmos: 'Dolby Atmos TrueHD',
        dts: 'DTS', 'dts-hd': 'DTS-HD', aac: 'AAC', flac: 'FLAC', mp3: 'MP3', opus: 'Opus',
      };
      const nombre = nombres[(a.codec || '').toLowerCase()] || (a.codec || '').toUpperCase();
      const canales = a.channels === 8 ? '7.1' : a.channels === 6 ? '5.1' : a.channels === 2 ? '2.0' : '';
      const lengua = a.language ? idioma(a.language) : '';
      const texto = [nombre, canales, lengua].filter(Boolean).join(' ');
      if (texto && etiquetas.indexOf(texto) < 0) etiquetas.push(texto);
    });

    const subs = (fichero.subtitles || []).map((x: { language: string | null }) => x.language).filter(Boolean);
    const distintos: string[] = [];
    subs.forEach((l: string | null) => { if (l && distintos.indexOf(l) < 0) distintos.push(l); });
    if (distintos.length) etiquetas.push('Subs: ' + distintos.slice(0, 3).map(idioma).join(', '));
  }

  const vista = progreso && progreso.watched === 1;
  const esFavorita = ficha.favorite === 1;
  let acciones = '';
  if (!esSerie && fichero) {
    acciones =
      '<button class="boton primario" data-nav data-reproducir>' +
      (reanudar > 0 ? 'Reanudar ' + reloj(reanudar) : 'Reproducir') + '</button>' +
      (reanudar > 0 ? '<button class="boton" data-nav data-desde-cero>Desde el principio</button>' : '') +
      '<button class="boton" data-nav data-pistas="audio">Audio</button>' +
      '<button class="boton" data-nav data-pistas="subs">Subtítulos</button>';
  }
  // «Eliminar» va el último a propósito: es lo único que no se puede deshacer,
  // y no debe quedar de paso entre los botones que se usan todos los días.
  acciones +=
    '<button class="boton" data-nav data-vista>' + (vista ? 'Marcar no vista' : 'Marcar vista') + '</button>' +
    '<button class="boton' + (esFavorita ? ' activo' : '') + '" data-nav data-favorito>' +
    (esFavorita ? 'Quitar de favoritos' : 'Añadir a favoritos') + '</button>' +
    (soyAdmin ? '<button class="boton peligro" data-nav data-borrar>Eliminar</button>' : '');

  const reparto = (ficha.cast || []).filter((c) => c.role === 'actor').slice(0, 10);

  // Duración en horas y minutos: «1h 34m» se lee de un vistazo desde el sofá,
  // «94 min» hay que traducirlo mentalmente.
  const duracion = !esSerie && ficha.runtime
    ? (ficha.runtime >= 60 ? Math.floor(ficha.runtime / 60) + 'h ' + Math.round(ficha.runtime % 60) + 'm' : Math.round(ficha.runtime) + 'm')
    : '';
  const datos = [ficha.year ? String(ficha.year) : '', duracion].filter(Boolean);
  const generos = (ficha.genres || []).slice(0, 4).join(', ');
  const direccion = (ficha.cast || []).filter((c) => c.role === 'director').map((c) => c.name).slice(0, 2).join(', ');

  /*
   * Una sola columna de texto sobre el fotograma, como en Plex: identidad,
   * datos, sinopsis y acciones bajan en el orden en que se leen. No hay cartel
   * porque el fondo ya es la imagen, y el detalle técnico se aparta a una
   * esquina: interesa antes de darle a reproducir, pero no compite con el resto.
   */
  let cuerpo =
    '<div class="ficha-fondo">' + (ficha.has_fanart ? '<img src="' + imagen.fondo(ficha.id, 1920) + '" alt="">' : '') + '</div>' +
    '<div class="ficha-velo"></div>' +
    '<div class="ficha" data-bloque>' +
    '<div class="ficha-cuerpo">' +

    (ficha.has_logo
      ? '<img class="ficha-logo" src="' + imagen.logo(ficha.id, 480) + '" alt="">'
      : '<h1 class="ficha-titulo">' + esc(ficha.title) + '</h1>') +

    (datos.length || vista
      ? '<div class="linea-datos">' +
        datos.map((d) => '<span>' + esc(d) + '</span>').join('') +
        (vista ? '<span class="chip-vista">Vista</span>' : '') +
        '</div>'
      : '') +
    (generos ? '<div class="linea-generos">' + esc(generos) + '</div>' : '') +
    notasHtml(ficha) +

    (ficha.plot ? '<div class="sinopsis">' + esc(ficha.plot) + '</div>' : '') +
    (direccion ? '<div class="direccion">Dirigida por ' + esc(direccion) + '</div>' : '') +

    // En flujo y no en posicion absoluta: a 730 px fijos acababan encima de
    // los nombres del reparto en cuanto la sinopsis tenia tres lineas.
    // Las de audio y subtítulos van en su propio hueco: se repintan al elegir
    // pista, marcando la que se va a usar.
    (etiquetas.length || fichero
      ? '<div class="tecnicas">' +
        etiquetas.filter((t) => !esEtiquetaDePista(t)).map((t) => '<span class="etiqueta-tec' + (t === '4K' || t.indexOf('HDR') === 0 ? ' destacada' : '') + '">' + esc(t) + '</span>').join('') +
        '<span data-chips-pistas>' +
        etiquetas.filter(esEtiquetaDePista).map((t) => '<span class="etiqueta-tec">' + esc(t) + '</span>').join('') +
        '</span></div>'
      : '') +

    '<div class="acciones">' + acciones + '</div>' +
    '</div>' +
    '</div>';

  // En una serie, los episodios van justo debajo de las acciones: es a lo que
  // se viene. El reparto y las relacionadas, después.
  let bloqueEpisodios = '';
  if (esSerie && ficha.episodes && ficha.episodes.length) {
    const temporadas: number[] = [];
    ficha.episodes.forEach((e) => {
      if (temporadas.indexOf(e.season) < 0) temporadas.push(e.season);
    });
    temporadas.sort((a, b) => a - b);
    const inicial = ficha.nextUp ? ficha.nextUp.season : temporadas[0];

    bloqueEpisodios =
      '<div class="episodios"><h3>Episodios</h3><div class="temporadas">' +
      temporadas
        .map(
          (n) =>
            '<button class="temporada' + (n === inicial ? ' activa' : '') + '" data-nav data-temporada="' + n + '">' +
            (n === 0 ? 'Especiales' : 'Temporada ' + n) + '</button>',
        )
        .join('') +
      '</div><div data-lista-episodios></div></div>';
  }
  cuerpo += bloqueEpisodios;

  if (reparto.length) {
    cuerpo +=
      // Misma mecanica que las filas de la portada: una pista sin saltos de
      // linea dentro de un carrusel, que se desplaza para traer al enfocado.
      // Antes el septimo actor caia a una segunda fila y se cortaba.
      // `data-bloque` es lo que permite al foco bajar hasta aqui desplazando
      // la pantalla: sin el, la fila quedaba fija y los nombres se cortaban.
      // Con la clase `fila` la navegacion lo coloca a altura fija, como a las
      // filas de la portada, en vez de medir la tarjeta: la medida se tomaba
      // antes de cargar fotos y nombres y dejaba el nombre 20 px fuera.
      '<div class="reparto fila" data-bloque><h3>Reparto</h3><div class="carrusel" data-carrusel><div class="pista">' +
      reparto
        .map(
          (p) =>
            '<div class="persona" data-nav data-persona="' + p.id + '"><div class="foto">' +
            (p.has_thumb ? '<img data-src="' + imagen.persona(p.id, 160) + '" alt="">' : '') +
            '</div><div class="nom">' + esc(p.name) + '</div>' +
            (p.character ? '<div class="pap">' + esc(p.character) + '</div>' : '') +
            '</div>',
        )
        .join('') +
      '</div></div></div>';
  }

  if (ficha.similar && ficha.similar.length) cuerpo += filaHtml('Relacionadas', ficha.similar);

  cuerpo += '</div>';
  pintar('inicio', cuerpo);

  const abrir = (fileId: number, episodeId: number | null, desde: number) =>
    pantallaReproductor(ficha, fileId, episodeId, desde);

  const bRep = marco.querySelector<HTMLElement>('[data-reproducir]');
  if (bRep && fichero) bRep.addEventListener('click', () => abrir(fichero.id, null, reanudar));
  const bCero = marco.querySelector<HTMLElement>('[data-desde-cero]');
  if (bCero && fichero) bCero.addEventListener('click', () => abrir(fichero.id, null, 0));

  const bVista = marco.querySelector<HTMLElement>('[data-vista]');
  if (bVista) {
    bVista.addEventListener('click', () => {
      api.marcarVista(ficha.id, !vista).then(() => void pantallaFicha(ficha.id)).catch(() => aviso('No se pudo guardar'));
    });
  }

  const bBorrar = marco.querySelector<HTMLElement>('[data-borrar]');
  if (bBorrar) {
    bBorrar.addEventListener('click', () => {
      confirmar(
        'Eliminar «' + ficha.title + '»',
        (esSerie ? 'Se borra la serie ENTERA con su carpeta' : 'Se borra la carpeta de la película') + ', sin papelera. No se puede deshacer.',
        () => {
          api
            .borrar(ficha.id, ficha.title)
            .then((r) => {
              aviso('Eliminada: ' + r.titulo);
              void pantallaPortada();
            })
            .catch((e) => aviso((e as Error).message || 'No se pudo eliminar'));
        },
      );
    });
  }

  const bFav = marco.querySelector<HTMLElement>('[data-favorito]');
  if (bFav) {
    bFav.addEventListener('click', () => {
      // Antes estaba fijo en `true`: solo sabía añadir, nunca quitar, y el botón
      // no cambiaba, así que parecía que no hacía nada.
      api
        .favorito(ficha.id, !esFavorita)
        .then(() => {
          aviso(esFavorita ? 'Quitada de favoritos' : 'Añadida a favoritos');
          void pantallaFicha(ficha.id);
        })
        .catch(() => aviso('No se pudo guardar'));
    });
  }

  /*
   * Las etiquetas de audio y subtítulos enseñan **lo que se va a oír y leer**:
   * la pista elegida (o la que se pondría sola) va marcada en ámbar, y si la
   * tele no la lee, se dice que se convertirá. Se pintan al abrir la ficha y
   * se repintan al elegir otra cosa en «Audio» o «Subtítulos».
   */
  const pintarChipsDePistas = (info: InfoReproduccion) => {
    const hueco = marco.querySelector<HTMLElement>('[data-chips-pistas]');
    if (!hueco || !fichero) return;
    const propia = seleccion.fileId === fichero.id;
    const iAudio = propia ? seleccion.audio : pistaInicial(info.audio);
    const iSub = propia ? seleccion.subtitulo : -1;
    const chip = (texto: string, elegida: boolean) =>
      '<span class="etiqueta-tec' + (elegida ? ' elegida' : '') + '">' + (elegida ? '\u25b6 ' : '') + esc(texto) + '</span>';
    let html = '';
    info.audio.forEach((a, i) => {
      if (i !== iAudio && i >= 3) return;
      html += chip(nombreAudio(a) + (a.compatible === false && i === iAudio ? ' \u00b7 se convertirá a DD+' : ''), i === iAudio);
    });
    const sub = iSub >= 0 ? info.subtitles[iSub] : null;
    html += chip(sub ? 'Subtítulos: ' + idioma(sub.language) + (sub.forced ? ' (forzados)' : '') : 'Sin subtítulos', !!sub);
    hueco.innerHTML = html;
  };
  if (fichero) api.pistas(fichero.id).then(pintarChipsDePistas).catch(() => undefined);

  marco.querySelectorAll<HTMLElement>('[data-pistas]').forEach((el) => {
    el.addEventListener('click', () => {
      if (fichero) void menuPistas(fichero.id, el.getAttribute('data-pistas') === 'audio' ? 'audio' : 'subs', pintarChipsDePistas);
    });
  });

  marco.querySelectorAll<HTMLElement>('[data-persona]').forEach((el) => {
    el.addEventListener('click', () => void pantallaPersona(Number(el.getAttribute('data-persona')), ficha.id));
  });

  if (esSerie && ficha.episodes) {
    const pintarEpisodios = (temporada: number) => {
      const caja = marco.querySelector<HTMLElement>('[data-lista-episodios]');
      if (!caja) return;
      const deLaTemporada = ficha.episodes!.filter((e) => e.season === temporada && e.file_id);

      caja.innerHTML = deLaTemporada
        .map(
          (e) =>
            '<div class="episodio" data-nav data-file="' + e.file_id + '" data-ep="' + e.id + '">' +
            '<span class="num">T' + e.season + 'E' + e.episode + '</span>' + esc(e.title || '') + '</div>',
        )
        .join('');

      caja.querySelectorAll<HTMLElement>('.episodio').forEach((el) => {
        el.addEventListener('click', () => {
          const epId = Number(el.getAttribute('data-ep'));
          const p = ficha.progress.filter((x) => x.episode_id === epId)[0];
          abrir(Number(el.getAttribute('data-file')), epId, p && !p.watched ? p.position : 0);
        });
      });

      marco.querySelectorAll<HTMLElement>('[data-temporada]').forEach((el) => {
        if (Number(el.getAttribute('data-temporada')) === temporada) el.classList.add('activa');
        else el.classList.remove('activa');
      });
      indexar();
    };

    marco.querySelectorAll<HTMLElement>('[data-temporada]').forEach((el) => {
      el.addEventListener('click', () => pintarEpisodios(Number(el.getAttribute('data-temporada'))));
    });
    pintarEpisodios(ficha.nextUp ? ficha.nextUp.season : Number(marco.querySelector<HTMLElement>('[data-temporada]')!.getAttribute('data-temporada')));
  }

  /*
   * El foco empieza en «Reproducir» (o «Reanudar»); en una serie, en el
   * episodio que toca ver. Antes apuntaba a una clase que no existía y caía
   * en la primera cosa navegable de la página: el «Inicio» del menú.
   */
  const episodioQueToca = ficha.nextUp
    ? marco.querySelector<HTMLElement>('[data-ep="' + ficha.nextUp.id + '"]')
    : null;
  enfocar(
    (esSerie ? episodioQueToca || marco.querySelector<HTMLElement>('[data-lista-episodios] [data-nav]') : null) ||
      marco.querySelector<HTMLElement>('.acciones [data-nav]') ||
      marco.querySelector<HTMLElement>('.ficha [data-nav]'),
  );
  alPulsar((tecla) => {
    if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) {
      // A la pantalla de la que se vino, con su sitio; solo si no hay de dónde,
      // a la portada.
      if (vengoDe) vengoDe();
      else void pantallaPortada();
      return true;
    }
    return false;
  });
}


/* ---------------------------------------------------- pistas y personas */

/**
 * Selección de audio y subtítulos. Se guarda por fichero y el reproductor la
 * aplica sobre AVPlay, que enumera sus propias pistas en el orden del fichero.
 */
export const seleccion: { fileId: number; audio: number; subtitulo: number; audioId?: number; convertir: boolean } =
  { fileId: 0, audio: 0, subtitulo: -1, convertir: false };

type PistaInfo = { id: number; codec: string; language: string | null; channels: number | null; default?: boolean; compatible?: boolean; atmos?: boolean };

const esAtmos = (a: PistaInfo) => a.atmos === true || /atmos|joc/i.test(a.codec);

/**
 * Que pista de audio se pone al empezar, si nadie ha elegido a mano.
 *
 * AVPlay reproduce la primera del contenedor y no mira la marca `default`
 * (Samsung no documenta que la respete). En 81 peliculas de la biblioteca la
 * pista Atmos es la inglesa, en segunda posicion, asi que hay que decidirlo
 * aqui: idioma preferido primero; dentro del idioma, Atmos antes que 5.1 a
 * secas; y si asi se prefiere, Atmos aunque sea en otro idioma. Las pistas que
 * la tele no decodifica solo se cogen si no hay otra.
 */
function pistaInicial(audios: PistaInfo[]): number {
  if (audios.length === 0) return 0;
  const aj = ajustes();
  const idioma = (aj.idiomaAudio || 'spa').toLowerCase();
  const puntua = (a: PistaInfo) =>
    (a.compatible === false ? -100 : 0) +
    ((a.language || '').toLowerCase() === idioma ? 10 : 0) +
    (esAtmos(a) ? (aj.preferirAtmos ? 20 : 5) : 0) +
    (a.default ? 1 : 0);
  let mejor = 0;
  for (let i = 1; i < audios.length; i++) if (puntua(audios[i]) > puntua(audios[mejor])) mejor = i;
  return mejor;
}

/** Pregunta antes de algo irreversible. «Volver» del mando cancela. */
function confirmar(titulo: string, detalle: string, alAceptar: () => void) {
  const capa = document.createElement('div');
  capa.className = 'capa';
  capa.innerHTML =
    '<div class="panel"><h3>' + esc(titulo) + '</h3><p class="dato">' + esc(detalle) + '</p>' +
    '<button class="linea" data-nav data-cancelar>Cancelar</button>' +
    '<button class="linea peligro" data-nav data-aceptar>Sí, eliminar</button></div>';
  marco.appendChild(capa);
  indexar();
  const anterior = actual();
  // El mando vuelve a quien lo tenía, no a la portada: cancelar un borrado y
  // pulsar Volver te sacaba al inicio desde cualquier sitio.
  const teclasAntes = manejadorActual();
  const cerrar = () => {
    if (capa.parentElement) capa.parentElement.removeChild(capa);
    indexar();
    enfocar(anterior);
    alPulsar(teclasAntes);
  };
  const bCancelar = capa.querySelector<HTMLElement>('[data-cancelar]');
  const bAceptar = capa.querySelector<HTMLElement>('[data-aceptar]');
  if (bCancelar) bCancelar.addEventListener('click', cerrar);
  if (bAceptar) bAceptar.addEventListener('click', () => { cerrar(); alAceptar(); });
  enfocar(bCancelar);
  alPulsar((tecla) => { if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) { cerrar(); return true; } return false; });
}

/** Las etiquetas de la ficha que hablan de pistas, para pintarlas aparte. */
function esEtiquetaDePista(t: string): boolean {
  return t.indexOf('Subs:') === 0 || /^(Dolby|DTS|AAC|FLAC|MP3|Opus|PCM|TRUEHD|EAC3|AC3)/i.test(t);
}

async function menuPistas(fileId: number, tipo: 'audio' | 'subs', alCambiar?: (info: InfoReproduccion) => void) {
  let info: InfoReproduccion;
  try {
    info = await api.pistas(fileId);
  } catch (e) {
    // El servidor explica por que (p. ej. el fichero ya no esta); si no, generico.
    const mensaje = e && (e as Error).message && (e as Error).message.indexOf('Error ') !== 0 ? (e as Error).message : 'No se pudieron leer las pistas';
    aviso(mensaje);
    return;
  }

  if (seleccion.fileId !== fileId) {
    seleccion.fileId = fileId;
    seleccion.audio = 0;
    seleccion.subtitulo = -1;
  }

  const opciones =
    tipo === 'audio'
      ? info.audio.map((a, i) => ({
          i,
          texto:
            idioma(a.language) + ' · ' +
            (esAtmos(a) ? 'Dolby Atmos' : a.codec.toUpperCase()) +
            (a.channels === 6 ? ' 5.1' : a.channels === 8 ? ' 7.1' : '') +
            (a.compatible === false ? ' · la tele no la lee: se convertirá a DD+' : ''),
        }))
      : [{ i: -1, texto: 'Desactivados' }].concat(
          info.subtitles.map((sb, i) => ({ i, texto: idioma(sb.language) + (sb.forced ? ' (forzados)' : '') })),
        );

  const elegida = tipo === 'audio' ? seleccion.audio : seleccion.subtitulo;

  const capa = document.createElement('div');
  capa.className = 'capa';
  capa.innerHTML =
    '<div class="panel"><h3>' + (tipo === 'audio' ? 'Pista de audio' : 'Subtítulos') + '</h3>' +
    opciones
      .map(
        (o) =>
          '<button class="linea' + (o.i === elegida ? ' elegida' : '') + '" data-nav data-elegir="' + o.i + '">' +
          esc(o.texto) + '</button>',
      )
      .join('') +
    '</div>';
  marco.appendChild(capa);
  indexar();

  const anterior = actual();
  const teclasAntes = manejadorActual();
  const cerrar = () => {
    if (capa.parentElement) capa.parentElement.removeChild(capa);
    indexar();
    enfocar(anterior);
    alPulsar(teclasAntes);
  };

  capa.querySelectorAll<HTMLElement>('[data-elegir]').forEach((el) => {
    el.addEventListener('click', () => {
      const v = Number(el.getAttribute('data-elegir'));
      if (tipo === 'audio') {
        seleccion.audio = v;
        const pista = info.audio[v];
        seleccion.audioId = pista ? pista.id : undefined;
        seleccion.convertir = !!pista && pista.compatible === false;
      } else seleccion.subtitulo = v;
      cerrar();
      // Sin cartel: la línea elegida ya se queda marcada en amarillo, y el
      // aviso tapaba la pantalla 4,5 s para decir lo que ya se ve.
      if (alCambiar) alCambiar(info);
    });
  });

  enfocar(capa.querySelector<HTMLElement>('[data-nav]'));
  alPulsar((tecla) => {
    if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) {
      cerrar();
      return true;
    }
    return false;
  });
}

async function pantallaPersona(id: number, volverA?: number) {
  entrarEn('persona-' + id, () => void pantallaPersona(id, volverA));
  pintar('inicio', '<div class="vacio">Cargando…</div>');
  let persona;
  try {
    persona = await api.persona(id);
  } catch (e) {
    aviso('No se pudo abrir la ficha de esa persona');
    return;
  }

  const d = persona.detalle;
  const anyos = (fecha: string | null | undefined) => (fecha ? fecha.slice(0, 4) : '');
  const vida = d && d.birthday ? anyos(d.birthday) + (d.deathday ? ' – ' + anyos(d.deathday) : '') : '';
  const datos = [vida, d && d.birthplace ? d.birthplace : ''].filter(Boolean).join('  ·  ');

  // La foto de TMDb suele ser más reciente que la que quedó guardada al
  // scrapear la película, que es de la que se queja todo el mundo en Plex.
  const foto = d && d.profile ? d.profile : persona.has_thumb ? imagen.persona(id, 300) : '';

  const cuerpo =
    '<div class="persona-ficha" data-bloque>' +
    '<div class="persona-foto">' + (foto ? '<img src="' + esc(foto) + '" alt="">' : '') + '</div>' +
    '<div class="persona-datos">' +
    '<h1>' + esc(persona.name) + '</h1>' +
    (datos ? '<p class="persona-vida">' + esc(datos) + '</p>' : '') +
    (d && d.biography ? '<div class="persona-bio">' + esc(d.biography) + '</div>' : '') +
    '<p class="persona-cuenta">' + persona.credits.length + ' títulos en tu biblioteca</p>' +
    '</div></div>' +
    '<div class="rejilla" data-bloque>' + persona.credits.map(tarjeta).join('') + '</div>';

  pintar('inicio', cuerpo);
  conectarTarjetas();
  enfocar(marco.querySelector<HTMLElement>('.rejilla [data-nav]'));
  // Volver debe devolverte a la película desde la que entraste, no al inicio.
  alPulsar((tecla) => {
    if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) {
      if (volverA) void pantallaFicha(volverA);
      else void pantallaPortada();
      return true;
    }
    return false;
  });
}

/* ------------------------------------------------------------ reproductor */

/** Peso legible, para la pantalla de información. */
function peso(bytes: number): string {
  if (!bytes) return '—';
  const gb = bytes / 1073741824;
  return gb >= 1 ? gb.toFixed(2) + ' GB' : Math.round(bytes / 1048576) + ' MB';
}

/** ffprobe devuelve «matroska,webm»; en pantalla basta con «MKV». */
function nombreContenedor(c: string | undefined): string {
  const primero = (c || '').split(',')[0];
  if (primero === 'matroska') return 'MKV';
  if (primero === 'mov' || primero === 'mp4') return 'MP4';
  return primero.toUpperCase();
}

function nombreAudio(a: PistaInfo): string {
  const canales = a.channels === 8 ? ' 7.1' : a.channels === 6 ? ' 5.1' : a.channels === 2 ? ' 2.0' : '';
  return idioma(a.language) + ' · ' + (esAtmos(a) ? 'Dolby Atmos' : (a.codec || '').toUpperCase()) + canales;
}

type OpcionLista = { valor: number; texto: string; nota?: string };

/**
 * Lista de opciones con su propio teclado. Quien la abre decide a dónde se
 * vuelve al cerrarla, porque el reproductor no quiere lo mismo que la ficha.
 */
function menuLista(
  titulo: string,
  opciones: OpcionLista[],
  elegida: number,
  alElegir: (valor: number) => void,
  alCerrar: () => void,
) {
  const capa = document.createElement('div');
  capa.className = 'capa';
  capa.innerHTML =
    '<div class="panel"><h3>' + esc(titulo) + '</h3>' +
    opciones
      .map(
        (o) =>
          '<button class="linea' + (o.valor === elegida ? ' elegida' : '') + '">' +
          esc(o.texto) +
          (o.nota ? '<span class="nota-linea">' + esc(o.nota) + '</span>' : '') +
          '</button>',
      )
      .join('') +
    '</div>';
  marco.appendChild(capa);

  const lineas: HTMLElement[] = [];
  capa.querySelectorAll<HTMLElement>('.linea').forEach((el) => lineas.push(el));
  let i = 0;
  for (let n = 0; n < opciones.length; n++) if (opciones[n].valor === elegida) i = n;

  const pintarFoco = () => {
    for (let n = 0; n < lineas.length; n++) {
      if (n === i) lineas[n].classList.add('enfocado');
      else lineas[n].classList.remove('enfocado');
    }
  };
  pintarFoco();

  const cerrar = () => {
    if (capa.parentElement) capa.parentElement.removeChild(capa);
    alCerrar();
  };

  alPulsar((tecla) => {
    if (tecla === TECLA.ABAJO) { i = Math.min(lineas.length - 1, i + 1); pintarFoco(); return true; }
    if (tecla === TECLA.ARRIBA) { i = Math.max(0, i - 1); pintarFoco(); return true; }
    if (tecla === TECLA.ENTRAR) { const v = opciones[i].valor; cerrar(); alElegir(v); return true; }
    if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) { cerrar(); return true; }
    // Dentro del menú no se escapa ninguna tecla: si no, el reproductor de
    // detrás se pondría a saltar mientras se elige el audio.
    return true;
  });
}

/** Lo que el panel de controles deja libre a cada lado; igual que su `padding`. */
const MARGEN_OSD = 110;
/** Las miniaturas son de 160 px: en una pantalla de 1920 hay que agrandarlas. */
const ESCALA_PREVIA = 2;

/**
 * Qué pone el botón de saltar.
 *
 * Los créditos tienen dos finales distintos: si detrás queda metraje, es una
 * escena post-créditos y saltar lleva justo ahí —que es lo que la gente quiere,
 * no perdérsela ni tragarse cinco minutos de rótulos—; si no queda nada, saltar
 * es dar por terminado y pasar al siguiente episodio.
 */
const NOMBRE_TRAMO: Record<string, string> = { intro: 'Saltar cabecera', credits: 'Saltar créditos' };
/** Metraje que tiene que quedar tras los créditos para llamarlo escena final. */
const MINIMO_POSTCREDITOS = 20;

function pantallaReproductor(ficha: Ficha, fileId: number, episodeId: number | null, desde: number) {
  window.clearInterval(temporizadorHeroe);
  alPulsar(null);
  // Deja pasar el plano de vídeo, que está por debajo de la página.
  document.body.classList.add('viendo');
  soltarPrecarga();

  const aj = ajustes();
  const fichero = ficha.files.filter((f) => f.id === fileId)[0];
  const duracionFichero = (fichero && fichero.duration) || 0;
  const ep = episodeId !== null && ficha.episodes ? ficha.episodes.filter((e) => e.id === episodeId)[0] : undefined;
  const cabeceraEp = ep ? 'T' + ep.season + 'E' + ep.episode + (ep.title ? ' · ' + ep.title : '') : '';

  marco.innerHTML =
    '<div class="reproductor">' +
    '<div class="lienzo-video" data-video></div>' +
    '<div class="osd" data-osd>' +
    // El disco va dentro del OSD, justo encima del título: aparece y se va con
    // los controles, y en pausa se queda con ellos. Quieto: girando distraía
    // y arriba a la derecha tapaba la pantalla de información.
    (ficha.has_discart ? '<img class="disco" alt="" src="' + imagen.disco(ficha.id, 600) + '">' : '') +
    '<div class="osd-titulo">' + esc(ficha.title) + '</div>' +
    (cabeceraEp ? '<div class="osd-episodio">' + esc(cabeceraEp) + '</div>' : '') +
    '<div class="previa" data-previa><i data-previa-foto></i><span data-previa-hora>0:00</span></div>' +
    '<div class="barra-tiempo" data-barra><i data-progreso></i><b data-marca></b></div>' +
    '<div class="tiempos"><span data-actual>0:00</span><span class="osd-fin" data-fin></span>' +
    '<span class="osd-salto" data-salto></span><span data-total>--:--</span></div>' +
    '<div class="osd-botones" data-botones></div>' +
    '<div class="ayuda">Abajo, los controles · ◀ ▶ saltan · Enter pausa · Volver sale</div>' +
    '</div>' +
    // Detrás del OSD a propósito: así la regla `~` del CSS puede subirlos
    // cuando aparecen los controles, y además quedan por encima del degradado.
    '<div class="subtitulos-tv" data-subtitulos></div>' +
    '<button class="salto-tramo" data-tramo></button>' +
    '<div class="info-repro" data-info></div>' +
    '<div class="cargando" data-cargando>Cargando…</div>' +
    '</div>';

  const lienzo = marco.querySelector<HTMLElement>('[data-video]')!;
  const osd = marco.querySelector<HTMLElement>('[data-osd]')!;
  const cargando = marco.querySelector<HTMLElement>('[data-cargando]')!;
  const barraCaja = marco.querySelector<HTMLElement>('[data-barra]')!;
  const barra = marco.querySelector<HTMLElement>('[data-progreso]')!;
  const marca = marco.querySelector<HTMLElement>('[data-marca]')!;
  const tActual = marco.querySelector<HTMLElement>('[data-actual]')!;
  const tTotal = marco.querySelector<HTMLElement>('[data-total]')!;
  const tSalto = marco.querySelector<HTMLElement>('[data-salto]')!;
  const tFin = marco.querySelector<HTMLElement>('[data-fin]')!;
  const capaSubs = marco.querySelector<HTMLElement>('[data-subtitulos]')!;
  const panelInfo = marco.querySelector<HTMLElement>('[data-info]')!;
  const cajaBotones = marco.querySelector<HTMLElement>('[data-botones]')!;
  const previa = marco.querySelector<HTMLElement>('[data-previa]')!;
  const previaFoto = marco.querySelector<HTMLElement>('[data-previa-foto]')!;
  const previaHora = marco.querySelector<HTMLElement>('[data-previa-hora]')!;
  const botonTramo = marco.querySelector<HTMLElement>('[data-tramo]')!;
  let botones: HTMLElement[] = [];

  capaSubs.className = 'subtitulos-tv sub-' + aj.tamanoSubtitulos + (aj.fondoSubtitulos === 'caja' ? ' con-caja' : '');

  let enBotones = false;
  let iBoton = 1;
  let ocultarEn = 0;
  let ultimoGuardado = 0;
  let destinoSalto: number | null = null;
  let temporizadorSalto = 0;
  let temporizadorSub = 0;
  let infoServidor: InfoReproduccion | null = null;
  let infoVisible = false;
  let ultimaInfo = 0;
  let audioOrdinal = 0;
  let subOrdinal = -1;
  let audioId: number | undefined;
  let convertir = false;
  let modoAudio = aj.modoAudio;
  let retardoSubs = aj.retardoSubtitulos;
  let cerrado = false;
  let tira: Tira | null = null;
  let reintentoTira = 0;
  /** Cortes del flujo que se han intentado recuperar, y cuándo fue el último. */
  let reintentos = 0;
  let ultimoReintento = 0;
  /** Tramo que se está ofreciendo saltar ahora mismo, y si tiene el foco. */
  let tramoActivo: RangoSalto | null = null;
  let enTramo = false;
  const tramosSaltados: Record<string, boolean> = {};

  /** El audio se está reprocesando: el flujo va por tubería de ffmpeg. */
  /*
   * Cuándo la película llega por tubería (ffmpeg) en vez de como fichero:
   * si hay que convertir el audio, si se pide modo noche o voces claras, y
   * también si la pista elegida no es la primera del contenedor: AVPlay
   * cambia de pista con `setSelectTrack` pero deja el audio descuadrado del
   * vídeo, así que el servidor manda la película con esa pista sola, copiada.
   */
  const porTuberia = () => convertir || modoAudio !== 'normal' || audioOrdinal > 0;

  /*
   * Saltar volviendo a pedir la película cortada, en vez de buscar dentro.
   *
   * Medido en la tele: AVPlay no sabe buscar en un MKV servido por HTTP
   * progresivo —`seekTo` contesta `InvalidValuesError` y encima deja la
   * reproducción clavada—, así que en AVPlay todo salto es una reapertura.
   * En el navegador (para desarrollar) sí se puede buscar dentro y se hace,
   * que es instantáneo.
   */
  const saltaReabriendo = () => porTuberia() || reproductor.usaNativo;

  /** Lleva a un punto, por el camino que funcione en este aparato. */
  const llevarA = (segundos: number) => {
    if (saltaReabriendo()) {
      abrirFlujo(segundos);
      return;
    }
    if (!reproductor.irA(segundos)) {
      aviso('No se pudo saltar: ' + (reproductor.fallo || 'la tele lo rechaza'));
    }
  };

  const total = () => reproductor.duracion() || duracionFichero;

  const pintarTiempos = (segundos: number) => {
    const t = total();
    barra.style.width = t ? Math.min(100, (segundos / t) * 100) + '%' : '0%';
    tActual.textContent = reloj(segundos);
    tTotal.textContent = t ? '-' + reloj(Math.max(0, t - segundos)) : '--:--';
    /*
     * En pausa no se repinta —el reloj del reproductor deja de avisar— así que
     * la hora se queda con la de antes de pausar y se corrige sola al seguir.
     * Es lo que hace Plex y es lo razonable: mientras está parado no hay una
     * hora de fin que valga.
     */
    tFin.textContent = t && ajustes().horaDeFin ? 'Termina a las ' + horaDeFin(Math.max(0, t - segundos)) : '';
  };

  const mostrar = () => {
    osd.classList.add('visible');
    // Cinco segundos y se va todo, disco incluido; en pausa se queda (el
    // reloj del reproductor no avisa y esto no se vuelve a evaluar).
    ocultarEn = Date.now() + 5000;
  };

  const pintarFocoBotones = () => {
    for (let n = 0; n < botones.length; n++) {
      if (enBotones && n === iBoton) botones[n].classList.add('enfocado');
      else botones[n].classList.remove('enfocado');
    }
  };

  const refrescarPlay = () => {
    const b = cajaBotones.querySelector<HTMLElement>('[data-accion="play"]');
    if (b) b.textContent = reproductor.reproduciendo() ? 'Pausa' : 'Reproducir';
  };

  /** «Capítulos» solo aparece si el fichero los trae; por eso se reconstruye. */
  const construirBotones = () => {
    const lista = [
      { accion: 'atras', texto: '\u25c0\u25c0' },
      { accion: 'play', texto: reproductor.reproduciendo() ? 'Pausa' : 'Reproducir' },
      { accion: 'alante', texto: '\u25b6\u25b6' },
      { accion: 'audio', texto: 'Audio' },
      { accion: 'subs', texto: 'Subtítulos' },
    ];
    if (infoServidor && infoServidor.chapters && infoServidor.chapters.length > 1) {
      lista.push({ accion: 'capitulos', texto: 'Capítulos' });
    }
    lista.push({ accion: 'info', texto: 'Información' });

    cajaBotones.innerHTML = lista
      .map((b) => '<button class="boton-osd" data-accion="' + b.accion + '">' + b.texto + '</button>')
      .join('');
    botones = [];
    cajaBotones.querySelectorAll<HTMLElement>('[data-accion]').forEach((el) => {
      botones.push(el);
      el.addEventListener('click', () => accionar(el.getAttribute('data-accion')));
    });
    if (iBoton >= botones.length) iBoton = botones.length - 1;
    pintarFocoBotones();
  };

  /** Rayitas en la barra donde empieza cada capítulo, como en un disco. */
  const pintarCapitulos = () => {
    const t = total();
    if (!infoServidor || !infoServidor.chapters || infoServidor.chapters.length < 2 || !t) return;
    barraCaja.querySelectorAll('u').forEach((u) => u.parentElement && u.parentElement.removeChild(u));
    let html = '';
    for (const c of infoServidor.chapters) {
      if (c.start <= 0 || c.start >= t) continue;
      html += '<u style="left:' + ((c.start / t) * 100).toFixed(3) + '%"></u>';
    }
    barraCaja.insertAdjacentHTML('beforeend', html);
  };

  /* --------------------------------------------------- vista previa del salto */

  /**
   * Miniatura del punto al que vas a caer.
   *
   * La tira la fabrica el servidor una vez por fichero (solo fotogramas clave,
   * unas 1400 miniaturas de 160 px en hojas de 10x10). Si todavía no está,
   * contesta 202 y se vuelve a preguntar cada medio minuto: la primera vez que
   * se ve una película tarda un rato en tenerla.
   */
  const pedirTira = () => {
    if (cerrado || tira) return;
    api
      .tira(fileId)
      .then((r) => {
        if ((r as Tira).times && (r as Tira).times.length) tira = r as Tira;
        else if (!cerrado && reintentoTira < 20) {
          reintentoTira++;
          window.setTimeout(pedirTira, 30000);
        }
      })
      .catch(() => undefined);
  };

  /** La miniatura más cercana a ese segundo; los tiempos no vienen ordenados. */
  const miniaturaPara = (segundos: number): number => {
    const t = tira as Tira;
    let mejor = 0;
    let distancia = Infinity;
    for (let n = 0; n < t.times.length; n++) {
      const d = t.times[n] > segundos ? t.times[n] - segundos : segundos - t.times[n];
      if (d < distancia) {
        distancia = d;
        mejor = n;
      }
    }
    return mejor;
  };

  const mostrarPrevia = (segundos: number, porcentaje: number) => {
    if (!tira) return;
    const t = tira;
    const n = miniaturaPara(segundos);
    const porHoja = t.columns * t.rows;
    const hoja = Math.floor(n / porHoja);
    const dentro = n % porHoja;
    const columna = dentro % t.columns;
    const fila = Math.floor(dentro / t.columns);

    const ancho = t.tileWidth * ESCALA_PREVIA;
    const alto = t.tileHeight * ESCALA_PREVIA;
    previaFoto.style.width = ancho + 'px';
    previaFoto.style.height = alto + 'px';
    previaFoto.style.backgroundImage = 'url(' + imagen.tira(fileId, hoja) + ')';
    previaFoto.style.backgroundSize = t.columns * ancho + 'px ' + t.rows * alto + 'px';
    previaFoto.style.backgroundPosition = -columna * ancho + 'px ' + -fila * alto + 'px';
    previaHora.textContent = reloj(segundos);

    // El centro de la miniatura sigue a la marca, sin salirse de los márgenes
    // del panel: pegada al borde se veía cortada.
    const anchoUtil = 1920 - MARGEN_OSD * 2;
    const centro = MARGEN_OSD + (porcentaje / 100) * anchoUtil;
    const media = (t.tileWidth * ESCALA_PREVIA) / 2;
    previa.style.left = Math.round(Math.max(MARGEN_OSD, Math.min(1920 - MARGEN_OSD - media * 2, centro - media))) + 'px';
    previa.style.display = 'block';
  };

  const esconderPrevia = () => {
    previa.style.display = 'none';
  };

  /* ------------------------------------------------------------- el flujo */

  const abrirFlujo = (desdeSegundos: number) => {
    // El servidor recorta con `-ss` y copia las pistas: el flujo empieza en ese
    // segundo y su reloj interno vuelve a cero, de ahí el desfase.
    const desfase = saltaReabriendo() && desdeSegundos > 1 ? Math.floor(desdeSegundos) : 0;
    reproductor.cerrar();
    lienzo.innerHTML = '';
    cargando.style.display = 'block';
    capaSubs.innerHTML = '';
    reproductor.abrir(
      urlReproduccion(fileId, porTuberia() ? audioId : undefined, desfase, modoAudio),
      lienzo,
      desdeSegundos,
      duracionFichero,
      { audio: porTuberia() ? 0 : audioOrdinal, subtitulo: subOrdinal },
      desfase,
    );
    window.setTimeout(() => {
      refrescarPlay();
      if (retardoSubs) reproductor.retardoSubtitulos(retardoSubs);
    }, 1500);
  };

  /* ---------------------------------------------------- cabecera y créditos */

  /**
   * Botón de saltar cabecera o créditos.
   *
   * Aparece solo dentro del tramo detectado, se lleva el foco —como en Netflix,
   * que es donde la gente ha aprendido el gesto— y se quita en cuanto se pulsa
   * cualquier flecha, para no estorbar a quien no quiere saltar.
   */
  const revisarTramo = (segundos: number) => {
    if (!aj.saltarCabecera || !infoServidor || !infoServidor.skip || !infoServidor.skip.length) return;
    let dentro: RangoSalto | null = null;
    for (const r of infoServidor.skip) {
      if (segundos >= r.start_s && segundos < r.end_s - 1 && !tramosSaltados[r.kind + r.start_s]) dentro = r;
    }
    if (dentro === tramoActivo) return;
    tramoActivo = dentro;
    if (!dentro) {
      botonTramo.classList.remove('visible', 'enfocado');
      enTramo = false;
      return;
    }
    botonTramo.textContent = hayEscenaFinal(dentro) ? 'Ver escena final' : NOMBRE_TRAMO[dentro.kind] || 'Saltar';
    botonTramo.classList.add('visible', 'enfocado');
    enTramo = true;
  };

  /** ¿Queda película después de este tramo? Solo tiene sentido en los créditos. */
  const hayEscenaFinal = (tramo: RangoSalto) =>
    tramo.kind === 'credits' && total() > 0 && total() - tramo.end_s > MINIMO_POSTCREDITOS;

  const saltarTramo = () => {
    if (!tramoActivo) return;
    const tramo = tramoActivo;
    tramosSaltados[tramo.kind + tramo.start_s] = true;
    tramoActivo = null;
    enTramo = false;
    botonTramo.classList.remove('visible', 'enfocado');

    // Créditos sin nada detrás: saltarlos es terminar, no ir a los últimos
    // segundos de rótulos para que el vídeo acabe solo dos segundos después.
    if (tramo.kind === 'credits' && !hayEscenaFinal(tramo)) {
      void api
        .progreso({ itemId: ficha.id, episodeId, position: total(), duration: total(), watched: true })
        .catch(() => undefined);
      alTerminar();
      return;
    }
    llevarA(tramo.end_s);
  };

  const reproductor = new Reproductor({
    onTiempo: (segundos, duracion) => {
      if (destinoSalto === null) pintarTiempos(segundos);
      const t = duracion || duracionFichero;
      revisarTramo(segundos);

      // Si lleva un minuto largo yendo bien, los cortes de antes ya no cuentan.
      if (reintentos && Date.now() - ultimoReintento > 60000) reintentos = 0;

      if (Date.now() - ultimoGuardado > 15000 && segundos > 5) {
        ultimoGuardado = Date.now();
        void api.progreso({ itemId: ficha.id, episodeId, position: segundos, duration: t || undefined }).catch(() => undefined);
      }
      // La pantalla de informacion se repinta cada dos segundos, no cada uno:
      // rehacerla obliga a preguntarle las pistas a AVPlay, y es una llamada
      // nativa que no hace falta repetir mientras solo cambia el reloj.
      if (infoVisible && Date.now() - ultimaInfo > 2000) {
        ultimaInfo = Date.now();
        pintarInfo();
      }
      if (osd.classList.contains('visible') && !enBotones && Date.now() > ocultarEn) osd.classList.remove('visible');
    },
    onBuffer: (esperando) => {
      cargando.style.display = esperando ? 'block' : 'none';
    },
    onFin: () => {
      void api
        .progreso({ itemId: ficha.id, episodeId, position: duracionFichero, duration: duracionFichero, watched: true })
        .catch(() => undefined);
      alTerminar();
    },
    onError: (mensaje) => {
      cargando.style.display = 'none';
      /*
       * Un corte no tiene por qué acabar la película.
       *
       * El flujo se puede caer sin que el fichero tenga nada malo: el servidor
       * se reinicia solo si el vigilante lo ve caído, el disco de 12 TB tarda
       * en despertar, la tubería de ffmpeg muere si se cambia de modo de
       * audio. Antes eso era un aviso y a la ficha. Ahora se vuelve a pedir la
       * película donde iba, hasta tres veces y con margen entre intentos: si
       * lo que está roto es el fichero, los tres fallan seguidos y entonces sí
       * se avisa y se para.
       */
      if (cerrado) return;
      const ahora = Date.now();
      if (reintentos < 3 && ahora - ultimoReintento > 8000) {
        reintentos++;
        ultimoReintento = ahora;
        const donde = reproductor.tiempo();
        aviso('Se ha cortado; recuperando…');
        window.setTimeout(() => { if (!cerrado) abrirFlujo(donde); }, 1500);
        return;
      }
      aviso(mensaje);
    },
    onSubtitulo: (texto) => {
      window.clearTimeout(temporizadorSub);
      // AVPlay entrega el texto del MKV tal cual, con las etiquetas de estilo
      // de ASS y sus saltos de línea propios. Los subtítulos los pinta la
      // aplicación: el reproductor no dibuja ninguno, y por eso antes elegirlos
      // no se notaba.
      const limpio = texto.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').trim();
      if (!limpio) {
        capaSubs.innerHTML = '';
        return;
      }
      capaSubs.innerHTML = limpio
        .split('\n')
        .map((l) => '<span>' + esc(l) + '</span>')
        .join('');
      // Red de seguridad: si no llega el siguiente cambio, el texto no se queda
      // clavado en pantalla el resto de la película.
      temporizadorSub = window.setTimeout(() => { capaSubs.innerHTML = ''; }, 12000);
    },
  });
  // Para el salvapantallas: necesita saber si hay algo en pausa ahora mismo,
  // y esta es la única instancia viva mientras dura la película.
  reproductorActivo = reproductor;

  /* --------------------------------------------------------------- saltos */

  const aplicarSalto = () => {
    if (destinoSalto === null) return;
    const objetivo = destinoSalto;
    destinoSalto = null;
    marca.style.display = 'none';
    tSalto.textContent = '';
    esconderPrevia();
    llevarA(objetivo);
  };

  /**
   * Los saltos se acumulan y se aplican de una vez.
   *
   * Cada búsqueda real obliga a AVPlay a rellenar el búfer otra vez —un par de
   * segundos por pulsación—, así que pulsar cinco veces seguidas significaba
   * cinco parones. Ahora se va moviendo la marca por la barra y, cuando se deja
   * de pulsar, se salta una sola vez. Es lo que hacen Plex y Netflix.
   */
  const saltar = (delta: number) => {
    const t = total();
    const base = destinoSalto === null ? reproductor.tiempo() : destinoSalto;
    // Si el salto se hace reabriendo, se puede ir a cualquier punto del fichero.
    // Solo cuando se busca DENTRO del flujo hay suelo: el trozo que se está
    // recibiendo empieza donde empieza. Con el suelo puesto siempre, rebobinar
    // después de un salto no pasaba del punto de corte: de 2:43 se iba a 2:36
    // en vez de a 2:13.
    const suelo = saltaReabriendo() ? 0 : reproductor.inicioDelFlujo;
    destinoSalto = Math.max(suelo, Math.min(t > 3 ? t - 3 : t, base + delta));

    const diferencia = destinoSalto - reproductor.tiempo();
    tSalto.textContent = (diferencia >= 0 ? '+' : '−') + reloj(Math.abs(diferencia));
    tActual.textContent = reloj(destinoSalto);
    // La hora de fin también, mientras se elige el salto: saltar diez minutos
    // adelante y ver que se termina diez minutos antes es media gracia de esto.
    if (t && ajustes().horaDeFin) tFin.textContent = 'Termina a las ' + horaDeFin(Math.max(0, t - destinoSalto));
    if (t) {
      marca.style.left = Math.min(100, (destinoSalto / t) * 100) + '%';
      marca.style.display = 'block';
    }
    if (t) mostrarPrevia(destinoSalto, (destinoSalto / t) * 100);
    mostrar();
    window.clearTimeout(temporizadorSalto);
    temporizadorSalto = window.setTimeout(aplicarSalto, 600);
  };

  /* ------------------------------------------------------------- pantalla */

  /*
   * Avisos del administrador mientras se ve algo: un mensaje en pantalla, o
   * «para», que devuelve a la ficha. Cada cinco segundos; el sondeo general de
   * fuera del reproductor no entra aquí (mira `viendo`), así que este es el
   * único que hay mientras dura la película.
   */
  const temporizadorAvisos = window.setInterval(() => {
    if (cerrado) { window.clearInterval(temporizadorAvisos); return; }
    api
      .avisos()
      .then((r) => {
        if (r.mensaje) aviso('Mensaje: ' + r.mensaje);
        if (r.parar) { aviso('El administrador ha parado la reproducción'); salir(); }
      })
      .catch(() => undefined);
  }, 5000);

  const salir = () => {
    if (cerrado) return;
    cerrado = true;
    reproductorActivo = null;
    window.clearInterval(temporizadorAvisos);
    window.clearTimeout(temporizadorSalto);
    window.clearTimeout(temporizadorSub);
    const t = reproductor.tiempo();
    if (t > 5) {
      void api.progreso({ itemId: ficha.id, episodeId, position: t, duration: total() || undefined }).catch(() => undefined);
    }
    reproductor.cerrar();
    void pantallaFicha(ficha.id);
  };

  /** El siguiente episodio con fichero, en orden de temporada y número. */
  const siguienteEpisodio = () => {
    if (!ep || !ficha.episodes) return undefined;
    const conFichero = ficha.episodes.filter((e) => e.file_id);
    conFichero.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
    for (let n = 0; n < conFichero.length - 1; n++) if (conFichero[n].id === ep.id) return conFichero[n + 1];
    return undefined;
  };

  /**
   * Al acabar un episodio, el siguiente solo. Es la petición que más se repite
   * en los foros de Plex y Jellyfin, y con cuenta atrás para poder pararla.
   */
  const alTerminar = () => {
    // Se acabó: que no siga preguntando por la tira de miniaturas cada medio
    // minuto durante los diez minutos siguientes con la pantalla ya cambiada.
    cerrado = true;
    reproductorActivo = null;
    const sig = siguienteEpisodio();
    if (!sig || !sig.file_id) {
      reproductor.cerrar();
      void pantallaFicha(ficha.id);
      return;
    }
    reproductor.cerrar();
    lienzo.innerHTML = '';
    osd.classList.remove('visible');

    let quedan = 10;
    const capa = document.createElement('div');
    capa.className = 'capa';
    capa.innerHTML =
      '<div class="panel"><h3>Siguiente episodio</h3>' +
      '<p class="dato">T' + sig.season + 'E' + sig.episode + (sig.title ? ' · ' + esc(sig.title) : '') + '</p>' +
      '<button class="linea enfocado" data-ver>Ver ahora <span class="nota-linea" data-cuenta>empieza en ' + quedan + ' s</span></button>' +
      '<button class="linea" data-no>Volver a la ficha</button></div>';
    marco.appendChild(capa);

    let i = 0;
    const lineas: HTMLElement[] = [];
    capa.querySelectorAll<HTMLElement>('.linea').forEach((el) => lineas.push(el));
    const pintarFoco = () => lineas.forEach((el, n) => (n === i ? el.classList.add('enfocado') : el.classList.remove('enfocado')));
    const cuenta = capa.querySelector<HTMLElement>('[data-cuenta]')!;

    const parar = () => {
      window.clearInterval(reloj10);
      if (capa.parentElement) capa.parentElement.removeChild(capa);
    };
    const ver = () => {
      parar();
      pantallaReproductor(ficha, sig.file_id as number, sig.id, 0);
    };
    const reloj10 = window.setInterval(() => {
      quedan--;
      cuenta.textContent = 'empieza en ' + quedan + ' s';
      if (quedan <= 0) ver();
    }, 1000);

    alPulsar((tecla) => {
      if (tecla === TECLA.ABAJO || tecla === TECLA.ARRIBA) {
        window.clearInterval(reloj10);
        cuenta.textContent = '';
        i = tecla === TECLA.ABAJO ? Math.min(1, i + 1) : Math.max(0, i - 1);
        pintarFoco();
        return true;
      }
      if (tecla === TECLA.ENTRAR) {
        if (i === 0) ver();
        else { parar(); void pantallaFicha(ficha.id); }
        return true;
      }
      if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE || tecla === TECLA.PARAR) {
        parar();
        void pantallaFicha(ficha.id);
        return true;
      }
      return true;
    });
  };

  /* ---------------------------------------------------------- información */

  const filaInfo = (etiqueta: string, valor: string) =>
    '<div class="fila-info"><span>' + esc(etiqueta) + '</span><b>' + esc(valor) + '</b></div>';

  const NOMBRE_MODO: Record<string, string> = {
    normal: 'Normal (la pista original, intacta)',
    night: 'Nocturno: menos golpes, voces al mismo nivel',
    dialogue: 'Voces claras: mezcla a estéreo subiendo el centro',
  };

  function pintarInfo() {
    const inf = infoServidor;
    const v = inf && inf.video ? inf.video : null;
    const pistaAudio = inf && inf.audio[audioOrdinal] ? inf.audio[audioOrdinal] : undefined;
    const subs = reproductor.pistasNativas('TEXT');

    panelInfo.innerHTML =
      '<h3>Reproducción</h3>' +
      filaInfo(
        'Modo',
        modoAudio !== 'normal'
          ? 'Audio reprocesado a DD+ · vídeo sin tocar'
          : convertir
            ? 'Audio convertido a DD+ 5.1 · vídeo sin tocar'
            : 'Directo: el fichero original, sin transcodificar',
      ) +
      filaInfo(
        'Fichero',
        (inf ? nombreContenedor(inf.container) : '') +
          (inf && inf.size ? ' · ' + peso(inf.size) : '') +
          (inf && inf.bitrate ? ' · ' + Math.round(inf.bitrate / 1000000) + ' Mb/s' : ''),
      ) +
      filaInfo(
        'Vídeo',
        v
          ? (v.codec || '').toUpperCase() + ' · ' + v.width + '×' + v.height +
            ' · ' + (Math.round(v.fps * 1000) / 1000) + ' fps' + (v.hdr ? ' · ' + v.hdr : '')
          : '—',
      ) +
      filaInfo(
        'Audio',
        pistaAudio
          ? nombreAudio(pistaAudio) + (porTuberia() ? ' → reprocesado' : ' → tal cual a la barra')
          : '—',
      ) +
      filaInfo('Escucha', NOMBRE_MODO[modoAudio]) +
      filaInfo(
        'Subtítulos',
        subOrdinal < 0
          ? 'Apagados'
          : (subs[subOrdinal] && subs[subOrdinal].idioma ? idioma(subs[subOrdinal].idioma) : 'Pista ' + (subOrdinal + 1)) +
            ' · del propio fichero, sin quemar' +
            (retardoSubs ? ' · desfase ' + (retardoSubs / 1000).toFixed(1) + ' s' : ''),
      ) +
      (inf && inf.chapters && inf.chapters.length > 1 ? filaInfo('Capítulos', String(inf.chapters.length)) : '') +
      filaInfo('Estado', reproductor.estado() + ' · ' + reloj(reproductor.tiempo()) + ' de ' + reloj(total())) +
      filaInfo('Servidor', servidor().replace(/^https?:\/\//, '')) +
      (reproductor.fallo ? filaInfo('Último aviso', reproductor.fallo) : '');
  }

  const alternarInfo = () => {
    infoVisible = !infoVisible;
    panelInfo.style.display = infoVisible ? 'block' : 'none';
    if (infoVisible) pintarInfo();
  };

  /* ------------------------------------------------------------ las pistas */

  const menuAudio = () => {
    if (!infoServidor || !infoServidor.audio.length) {
      aviso('Todavía no se han leído las pistas');
      return;
    }
    const opciones: OpcionLista[] = infoServidor.audio.map((a, n) => ({
      valor: n,
      texto: nombreAudio(a),
      nota: a.compatible === false ? 'la tele no la lee: el servidor la convierte a DD+ 5.1' : undefined,
    }));
    // Los modos de escucha van detrás de las pistas, con números negativos para
    // no chocar con los ordinales.
    opciones.push({ valor: -10, texto: 'Escucha: normal' + (modoAudio === 'normal' ? ' ✓' : ''), nota: 'la pista llega intacta; el Atmos sigue siendo Atmos' });
    opciones.push({ valor: -11, texto: 'Escucha: volumen nocturno' + (modoAudio === 'night' ? ' ✓' : ''), nota: 'comprime los golpes; recodifica a DD+ y se pierde el Atmos' });
    opciones.push({ valor: -12, texto: 'Escucha: voces claras' + (modoAudio === 'dialogue' ? ' ✓' : ''), nota: 'estéreo con el canal central subido; se pierde el multicanal' });

    menuLista('Pista de audio', opciones, audioOrdinal, cambiarAudio, () => alPulsar(manejarTeclas));
  };

  function cambiarAudio(n: number) {
    const inf = infoServidor;
    if (!inf) return;

    if (n <= -10) {
      const nuevo = n === -11 ? 'night' : n === -12 ? 'dialogue' : 'normal';
      if (nuevo === modoAudio) return;
      modoAudio = nuevo as 'normal' | 'night' | 'dialogue';
      guardarAjustes({ modoAudio: modoAudio });
      abrirFlujo(reproductor.tiempo());
      aviso(modoAudio === 'normal' ? 'Audio original' : modoAudio === 'night' ? 'Volumen nocturno' : 'Voces claras');
      return;
    }

    const pista = inf.audio[n];
    const necesitaConvertir = !!pista && pista.compatible === false;
    const antes = porTuberia();
    audioOrdinal = n;
    audioId = pista ? pista.id : undefined;
    convertir = necesitaConvertir;
    seleccion.fileId = fileId;
    seleccion.audio = n;
    seleccion.audioId = audioId;
    seleccion.convertir = necesitaConvertir;

    // Volver a la primera pista es el fichero en crudo; cualquier otra, o una
    // que hay que convertir, es otro flujo del servidor (ver `porTuberia`).
    if (porTuberia() || antes) {
      abrirFlujo(reproductor.tiempo());
      aviso(necesitaConvertir ? 'Convirtiendo el audio a DD+ 5.1…' : 'Cambiando de pista…');
      return;
    }
    if (reproductor.elegirAudio(n)) aviso('Audio: ' + nombreAudio(pista));
    else abrirFlujo(reproductor.tiempo());
  }

  const menuSubtitulos = () => {
    const nativas = reproductor.pistasNativas('TEXT');
    const delServidor = infoServidor ? infoServidor.subtitles.filter((x) => x.source !== 'external') : [];

    /*
     * Se ofrece lo que la tele puede elegir de verdad, no lo que trae el
     * fichero. Medido en un MKV con cuatro pistas de subtítulos: AVPlay expone
     * una sola. Listando las cuatro salían dos «Inglés» y dos «Español» y tres
     * de ellas no hacían nada.
     */
    const cuantas = reproductor.usaNativo ? nativas.length : delServidor.length;
    const opciones: OpcionLista[] = [{ valor: -1, texto: 'Desactivados' }];
    for (let n = 0; n < cuantas; n++) {
      const info = delServidor[n];
      const lang = (info && info.language) || (nativas[n] && nativas[n].idioma) || '';
      // El título del propio fichero («Castellano [Completos] SRT») dice más
      // que el idioma a secas, que se repite entre pistas.
      opciones.push({
        valor: n,
        texto: (info && info.title) || idioma(lang) + (info && info.forced ? ' (forzados)' : ''),
      });
    }
    if (delServidor.length > cuantas) {
      opciones.push({
        valor: -4,
        texto: 'La tele solo abre ' + cuantas + ' de las ' + delServidor.length + ' pistas del fichero',
        nota: 'es cosa de AVPlay, no del servidor',
      });
    }
    opciones.push({
      valor: -3,
      texto: 'Ajustar el desfase…',
      nota: retardoSubs ? 'ahora: ' + (retardoSubs / 1000).toFixed(1) + ' s' : 'ahora: sincronizados',
    });
    if (infoServidor && infoServidor.subtitles.some((x) => x.source === 'external')) {
      opciones.push({ valor: -2, texto: 'Hay subtítulos en fichero aparte', nota: 'en la tele solo valen los que van dentro del vídeo' });
    }
    menuLista('Subtítulos', opciones, subOrdinal, cambiarSubtitulo, () => alPulsar(manejarTeclas));
  };

  function cambiarSubtitulo(n: number) {
    if (n === -4) return;
    if (n === -2) {
      aviso('Los subtítulos en fichero aparte todavía no se pueden en la tele');
      return;
    }
    if (n === -3) {
      panelDesfase();
      return;
    }
    subOrdinal = n;
    seleccion.fileId = fileId;
    seleccion.subtitulo = n;
    capaSubs.innerHTML = '';
    if (reproductor.elegirSubtitulo(n)) aviso(n < 0 ? 'Subtítulos apagados' : 'Subtítulos puestos');
    else aviso('No se pudo cambiar: ' + (reproductor.fallo || 'la tele lo rechaza'));
  }

  /**
   * Desfase de los subtítulos, con las flechas y en caliente.
   *
   * Se aplica en cada pulsación en vez de al aceptar: así se ve enseguida si va
   * bien, que es la única manera de acertar con esto.
   */
  function panelDesfase() {
    const capa = document.createElement('div');
    capa.className = 'capa';
    capa.innerHTML =
      '<div class="panel"><h3>Desfase de los subtítulos</h3>' +
      '<p class="dato">Si van adelantados, súbelo; si van con retraso, bájalo.</p>' +
      '<div class="desfase">◀ <b data-valor>0,0 s</b> ▶</div>' +
      '<p class="pista-ayuda">Enter lo deja puesto para toda la casa · Volver lo deja solo para esta película</p></div>';
    marco.appendChild(capa);
    const etiqueta = capa.querySelector<HTMLElement>('[data-valor]')!;
    const pintarValor = () => {
      // Dos decimales porque el paso es de 250 ms: con uno solo, «+0,25» salía
      // como «+0,3» y parecía que el número no cuadraba con las pulsaciones.
      const segundos = Math.abs(retardoSubs / 1000);
      const texto = retardoSubs % 1000 === 0 ? segundos.toFixed(1) : segundos.toFixed(2);
      etiqueta.textContent = (retardoSubs >= 0 ? '+' : '−') + texto.replace('.', ',') + ' s';
    };
    pintarValor();

    let avisadoSinSoporte = false;
    const mover = (paso: number) => {
      retardoSubs = Math.max(-10000, Math.min(10000, retardoSubs + paso));
      pintarValor();
      if (!reproductor.retardoSubtitulos(retardoSubs) && !avisadoSinSoporte) {
        avisadoSinSoporte = true;
        aviso('Esta tele no deja mover los subtítulos');
      }
    };
    const cerrar = () => {
      if (capa.parentElement) capa.parentElement.removeChild(capa);
      alPulsar(manejarTeclas);
    };

    alPulsar((tecla) => {
      if (tecla === TECLA.DERECHA) { mover(250); return true; }
      if (tecla === TECLA.IZQUIERDA) { mover(-250); return true; }
      if (tecla === TECLA.ENTRAR) { guardarAjustes({ retardoSubtitulos: retardoSubs }); aviso('Desfase guardado'); cerrar(); return true; }
      if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) { cerrar(); return true; }
      return true;
    });
  }

  const menuCapitulos = () => {
    const caps = infoServidor && infoServidor.chapters ? infoServidor.chapters : [];
    if (caps.length < 2) {
      aviso('Este fichero no trae capítulos');
      return;
    }
    const ahora = reproductor.tiempo();
    let actualN = 0;
    for (let n = 0; n < caps.length; n++) if (ahora >= caps[n].start) actualN = n;
    const opciones: OpcionLista[] = caps.map((c, n) => ({ valor: n, texto: c.title, nota: reloj(c.start) }));
    menuLista(
      'Capítulos',
      opciones,
      actualN,
      (n) => llevarA(caps[n].start),
      () => alPulsar(manejarTeclas),
    );
  };

  /* -------------------------------------------------------------- teclado */

  const accionar = (accion: string | null) => {
    if (accion === 'atras') saltar(-aj.saltoCorto);
    else if (accion === 'alante') saltar(aj.saltoLargo);
    else if (accion === 'play') { reproductor.alternarPausa(); refrescarPlay(); mostrar(); }
    else if (accion === 'audio') menuAudio();
    else if (accion === 'subs') menuSubtitulos();
    else if (accion === 'capitulos') menuCapitulos();
    else if (accion === 'info') alternarInfo();
  };

  /** Cualquier flecha aparta el botón de saltar: quien navega no quiere saltar. */
  const soltarTramo = () => {
    if (!enTramo) return;
    enTramo = false;
    botonTramo.classList.remove('enfocado');
  };

  function manejarTeclas(tecla: number): boolean {
    // Las teclas propias del mando funcionan siempre, con los controles a la
    // vista o sin ellos.
    if (tecla === TECLA.PARAR) { salir(); return true; }
    if (tecla === TECLA.REPRODUCIR) { reproductor.reproducir(); refrescarPlay(); mostrar(); return true; }
    if (tecla === TECLA.PAUSA) { reproductor.pausar(); refrescarPlay(); mostrar(); return true; }
    if (tecla === TECLA.PLAY_PAUSA) { reproductor.alternarPausa(); refrescarPlay(); mostrar(); return true; }
    if (tecla === TECLA.AVANZAR) { soltarTramo(); saltar(aj.saltoLargo); return true; }
    if (tecla === TECLA.RETROCEDER) { soltarTramo(); saltar(-aj.saltoCorto); return true; }
    if (tecla === TECLA.INFO) { alternarInfo(); mostrar(); return true; }

    if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) {
      if (infoVisible) { alternarInfo(); return true; }
      if (enTramo) { soltarTramo(); return true; }
      if (enBotones) { enBotones = false; pintarFocoBotones(); mostrar(); return true; }
      salir();
      return true;
    }

    // El botón de saltar cabecera tiene prioridad mientras esté enfocado.
    if (enTramo && tecla === TECLA.ENTRAR) { saltarTramo(); return true; }

    if (enBotones) {
      if (tecla === TECLA.DERECHA) { iBoton = Math.min(botones.length - 1, iBoton + 1); pintarFocoBotones(); mostrar(); return true; }
      if (tecla === TECLA.IZQUIERDA) { iBoton = Math.max(0, iBoton - 1); pintarFocoBotones(); mostrar(); return true; }
      if (tecla === TECLA.ARRIBA) { enBotones = false; pintarFocoBotones(); mostrar(); return true; }
      if (tecla === TECLA.ENTRAR) { accionar(botones[iBoton].getAttribute('data-accion')); return true; }
      mostrar();
      return true;
    }

    if (tecla === TECLA.DERECHA) { soltarTramo(); saltar(aj.saltoLargo); return true; }
    if (tecla === TECLA.IZQUIERDA) { soltarTramo(); saltar(-aj.saltoCorto); return true; }
    if (tecla === TECLA.ABAJO) { soltarTramo(); enBotones = true; pintarFocoBotones(); mostrar(); return true; }
    if (tecla === TECLA.ENTRAR) { reproductor.alternarPausa(); refrescarPlay(); mostrar(); return true; }
    mostrar();
    return true;
  }

  /* --------------------------------------------------------------- arranque */

  botonTramo.addEventListener('click', saltarTramo);
  pedirTira();
  construirBotones();
  pintarTiempos(desde);
  mostrar();
  alPulsar(manejarTeclas);

  /*
   * Si hay elección manual para este fichero, se respeta. Si no, se consultan
   * las pistas y se decide la inicial con la preferencia de idioma y Atmos. En
   * ambos casos: si la pista no la lee la tele, el servidor convierte solo el
   * audio y en ese flujo la pista es la única, la primera.
   */
  api
    .pistas(fileId)
    .then((info) => {
      infoServidor = info;
      if (seleccion.fileId === fileId) {
        audioOrdinal = seleccion.audio;
        subOrdinal = seleccion.subtitulo;
        audioId = seleccion.audioId;
        convertir = seleccion.convertir;
      } else {
        audioOrdinal = pistaInicial(info.audio);
        const pista = info.audio[audioOrdinal];
        audioId = pista ? pista.id : undefined;
        convertir = !!pista && pista.compatible === false;
        subOrdinal = -1;
      }
      construirBotones();
      pintarCapitulos();
      abrirFlujo(desde);
    })
    .catch(() => {
      // Sin la lista de pistas se reproduce igual: la tele coge la primera.
      abrirFlujo(desde);
    });
}

/* -------------------------------------------------------------- ajustes */

function grupo(titulo: string, ayuda: string, cuerpo: string): string {
  return (
    '<div class="grupo"><h2>' + esc(titulo) + '</h2>' +
    (ayuda ? '<p class="pista-ayuda">' + esc(ayuda) + '</p>' : '') +
    cuerpo + '</div>'
  );
}

type Opcion = { valor: string | number; texto: string };

function elecciones(campo: string, opciones: Opcion[], valorActual: string | number): string {
  return (
    '<div class="opciones">' +
    opciones
      .map(function (o: Opcion) {
        return (
          '<button class="eleccion' + (o.valor === valorActual ? ' activa' : '') + '" data-nav ' +
          'data-campo="' + campo + '" data-valor="' + o.valor + '">' + esc(o.texto) + '</button>'
        );
      })
      .join('') +
    '</div>'
  );
}

function pantallaAjustes() {
  const a = ajustes();

  const cuerpo =
    '<div class="ajustes" data-bloque>' +
    '<h1 class="titulo-pantalla">Ajustes</h1>' +

    grupo(
      'Rendimiento',
      'Medido en esta tele: con todos los efectos va a 60 fotogramas por segundo y ninguno se pasa de 18 ms, así que no hace falta quitarle nada. Los otros dos modos están por si algún día la biblioteca crece mucho más.',
      elecciones('rendimiento', [
        { valor: 'completo', texto: 'Todos los efectos' },
        { valor: 'medio', texto: 'Equilibrado' },
        { valor: 'rapido', texto: 'Máxima fluidez' },
      ], a.rendimiento),
    ) +

    grupo('Portada', 'El destacado de arriba va cambiando de película solo.',
      elecciones('heroeRotar', [{ valor: 'si', texto: 'Rotar' }, { valor: 'no', texto: 'Fijo' }], a.heroeRotar ? 'si' : 'no') +
      elecciones('heroeSegundos', [6, 9, 12, 20].map(function (n: number) { return { valor: n, texto: n + ' s' }; }), a.heroeSegundos),
    ) +

    grupo('Reproducción', 'Cuánto salta cada flecha, si retomas donde lo dejaste y si se enseña a qué hora termina.',
      elecciones('reanudar', [{ valor: 'si', texto: 'Reanudar' }, { valor: 'no', texto: 'Empezar de cero' }], a.reanudar ? 'si' : 'no') +
      elecciones('horaDeFin', [{ valor: 'si', texto: 'Termina a las…' }, { valor: 'no', texto: 'Solo lo que queda' }], a.horaDeFin ? 'si' : 'no') +
      elecciones('saltoCorto', [10, 15, 30].map(function (n: number) { return { valor: n, texto: 'Atrás ' + n + ' s' }; }), a.saltoCorto) +
      elecciones('saltoLargo', [30, 60, 120].map(function (n: number) { return { valor: n, texto: 'Adelante ' + n + ' s' }; }), a.saltoLargo),
    ) +

    grupo('Audio', 'Qué pista se pone al empezar. Una pista Dolby Atmos va intacta a la barra; solo se convierte lo que la tele no lee (DTS, TrueHD, FLAC).',
      elecciones('idiomaAudio', [
        { valor: 'spa', texto: 'Español' }, { valor: 'eng', texto: 'Inglés' }, { valor: 'cat', texto: 'Catalán' },
        { valor: 'fre', texto: 'Francés' }, { valor: 'ger', texto: 'Alemán' }, { valor: 'jpn', texto: 'Japonés' },
      ], a.idiomaAudio) +
      elecciones('preferirAtmos', [
        { valor: 'no', texto: 'Idioma primero' }, { valor: 'si', texto: 'Atmos aunque sea en otro idioma' },
      ], a.preferirAtmos ? 'si' : 'no'),
    ) +

    grupo('Subtítulos', 'Los pinta la aplicación a partir de los que van dentro del vídeo: nunca se queman.',
      elecciones('tamanoSubtitulos', [
        { valor: 80, texto: 'Pequeños' }, { valor: 100, texto: 'Normales' },
        { valor: 125, texto: 'Grandes' }, { valor: 150, texto: 'Enormes' },
      ], a.tamanoSubtitulos) +
      elecciones('fondoSubtitulos', [
        { valor: 'sombra', texto: 'Con sombra' }, { valor: 'caja', texto: 'Sobre caja negra' },
      ], a.fondoSubtitulos),
    ) +

    grupo(
      'Cómo suena',
      'Lo normal deja la pista intacta y la barra recibe el Atmos tal cual. Los otros dos modos obligan a recodificar el audio a DD+, así que se pierde el Atmos: úsalos solo cuando hagan falta.',
      elecciones('modoAudio', [
        { valor: 'normal', texto: 'Normal' },
        { valor: 'night', texto: 'Volumen nocturno' },
        { valor: 'dialogue', texto: 'Voces claras' },
      ], a.modoAudio),
    ) +

    grupo(
      'Miniaturas de la barra',
      'La vista previa al saltar. Se fabrica una vez por película (unos tres minutos cada una, solo fotogramas clave) y se guarda. Por defecto solo prepara lo que estás viendo y lo recién añadido; hacerlas todas serían días de máquina.',
      '<p class="dato" data-estado-miniaturas>…</p>' +
      '<button class="boton" data-nav data-miniaturas>Preparar las que voy a ver</button>' +
      '<button class="boton" data-nav data-miniaturas-todo>Toda la biblioteca</button>' +
      '<button class="boton" data-nav data-parar-miniaturas>Parar</button>',
    ) +

    grupo(
      'Notas',
      'Las de IMDb, Rotten Tomatoes y TheMovieDb salen de los propios ficheros de la biblioteca. Lo que falte se puede pedir a OMDb, que devuelve IMDb y Rotten Tomatoes de una vez. Los ficheros siempre mandan: esto solo rellena huecos.',
      '<p class="dato" data-estado-notas>…</p>' +
      '<button class="boton" data-nav data-notas>Rellenar las que faltan</button>' +
      '<button class="boton" data-nav data-parar-notas>Parar</button>',
    ) +

    grupo(
      'Cabeceras y créditos',
      'La cabecera es el único tramo de audio que se repite igual en todos los episodios de una temporada, y así se encuentra. Analizarla cuesta un rato de máquina por serie, y se puede parar.',
      elecciones('saltarCabecera', [{ valor: 'si', texto: 'Ofrecer saltar' }, { valor: 'no', texto: 'No ofrecer' }], a.saltarCabecera ? 'si' : 'no') +
      '<p class="dato" data-estado-cabeceras>…</p>' +
      '<button class="boton" data-nav data-cabeceras>Buscar cabeceras en las series nuevas</button>' +
      '<button class="boton" data-nav data-parar-cabeceras>Parar la búsqueda</button>',
    ) +

    grupo(
      'Salvapantallas',
      'Fondos de la biblioteca, a pantalla completa. En pausa el margen es mayor a propósito: seguramente te has levantado un momento, no que te hayas ido. «Apagado» lo quita del todo.',
      elecciones('salvaMenu', [
        { valor: 0, texto: 'En el menú: apagado' }, { valor: 1, texto: 'En el menú: 1 min' },
        { valor: 2, texto: 'En el menú: 2 min' }, { valor: 5, texto: 'En el menú: 5 min' },
      ], a.salvaMenu) +
      elecciones('salvaPausa', [
        { valor: 0, texto: 'En pausa: apagado' }, { valor: 3, texto: 'En pausa: 3 min' },
        { valor: 5, texto: 'En pausa: 5 min' }, { valor: 10, texto: 'En pausa: 10 min' },
      ], a.salvaPausa),
    ) +

    grupo('Biblioteca', 'El servidor la revisa sola cada 24 h. Si acabas de añadir algo, pídelo aquí.',
      '<button class="boton" data-nav data-escanear>Actualizar biblioteca ahora</button>') +

    grupo('Menú', 'Cambia el orden de las secciones o esconde las que no uses.',
      '<button class="boton" data-nav data-reordenar>Reordenar el menú</button>') +

    grupo('Servidor', '',
      '<p class="dato">' + esc(servidor()) + '</p>' +
      '<button class="boton" data-nav data-servidor>Cambiar servidor</button>' +
      '<button class="boton" data-nav data-desemparejar>Desemparejar esta tele</button>') +

    grupo('Acerca de', '',
      '<p class="dato">Media Watch para Samsung Tizen · ' + bibliotecas.length + ' bibliotecas</p>') +

    '</div>';

  pintar('ajustes', cuerpo);

  marco.querySelectorAll<HTMLElement>('[data-campo]').forEach(function (el: HTMLElement) {
    el.addEventListener('click', function () {
      const campo = el.getAttribute('data-campo') || '';
      const valor = el.getAttribute('data-valor') || '';
      if (campo === 'rendimiento') guardarAjustes({ rendimiento: valor as Rendimiento });
      else if (campo === 'heroeRotar') guardarAjustes({ heroeRotar: valor === 'si' });
      else if (campo === 'reanudar') guardarAjustes({ reanudar: valor === 'si' });
      else if (campo === 'heroeSegundos') guardarAjustes({ heroeSegundos: Number(valor) });
      else if (campo === 'saltoCorto') guardarAjustes({ saltoCorto: Number(valor) });
      else if (campo === 'saltoLargo') guardarAjustes({ saltoLargo: Number(valor) });
      else if (campo === 'salvaMenu') guardarAjustes({ salvaMenu: Number(valor) });
      else if (campo === 'salvaPausa') guardarAjustes({ salvaPausa: Number(valor) });
      else if (campo === 'idiomaAudio') guardarAjustes({ idiomaAudio: String(valor) });
      else if (campo === 'preferirAtmos') guardarAjustes({ preferirAtmos: valor === 'si' });
      else if (campo === 'tamanoSubtitulos') guardarAjustes({ tamanoSubtitulos: Number(valor) });
      else if (campo === 'fondoSubtitulos') guardarAjustes({ fondoSubtitulos: valor === 'caja' ? 'caja' : 'sombra' });
      else if (campo === 'modoAudio') guardarAjustes({ modoAudio: valor as 'normal' | 'night' | 'dialogue' });
      else if (campo === 'saltarCabecera') guardarAjustes({ saltarCabecera: valor === 'si' });
      else if (campo === 'horaDeFin') guardarAjustes({ horaDeFin: valor === 'si' });
      pantallaAjustes();
    });
  });

  /*
   * Estado de la busqueda de cabeceras. Se refresca solo mientras se mire esta
   * pantalla: es un trabajo de horas y hay que poder ver por donde va.
   */
  const estadoCabeceras = marco.querySelector<HTMLElement>('[data-estado-cabeceras]');
  const mirarCabeceras = () => {
    if (!estadoCabeceras || !estadoCabeceras.parentElement) return;
    api
      .estadoCabeceras()
      .then((r) => {
        if (!estadoCabeceras.parentElement) return;
        const j = r.job;
        // `total` solo lo rellena el recorrido de toda la biblioteca; analizar
        // una serie suelta deja «0 de 0», que no dice nada.
        const cuantas = j.total ? ' · ' + j.hechas + ' de ' + j.total + ' series' : '';
        estadoCabeceras.textContent = j.running
          ? 'Analizando ' + j.showTitle + (j.season ? ' · temporada ' + j.season : '') + cuantas +
            ' · ' + j.found + ' tramos encontrados'
          : j.found
            ? 'Última pasada: ' + j.found + ' tramos' + (j.total ? ' en ' + j.hechas + ' series' : '')
            : 'Parada';
        if (j.running) window.setTimeout(mirarCabeceras, 5000);
      })
      .catch(() => {
        if (estadoCabeceras.parentElement) estadoCabeceras.textContent = 'No se pudo consultar';
      });
  };
  mirarCabeceras();

  const estadoNotas = marco.querySelector<HTMLElement>('[data-estado-notas]');
  const mirarNotas = () => {
    if (!estadoNotas || !estadoNotas.parentElement) return;
    api
      .estadoOmdb()
      .then((r) => {
        if (!estadoNotas.parentElement) return;
        const l = r.lote;
        estadoNotas.textContent = !r.configurada
          ? 'Falta la clave de OMDb'
          : l.running
            ? 'Consultando ' + l.actual + ' · ' + l.hechos + ' de ' + l.total + ' · ' + l.anadidas + ' notas nuevas'
            : l.total
              ? 'Última tanda: ' + l.anadidas + ' notas nuevas en ' + l.hechos + ' títulos' + (l.error ? ' · ' + l.error : '')
              : 'Parada';
        if (l.running) window.setTimeout(mirarNotas, 5000);
      })
      .catch(() => {
        if (estadoNotas.parentElement) estadoNotas.textContent = 'No se pudo consultar';
      });
  };
  mirarNotas();

  const bNotas = marco.querySelector<HTMLElement>('[data-notas]');
  if (bNotas) bNotas.addEventListener('click', () => {
    api.notasOmdb()
      .then((r) => { aviso(r.total ? 'Consultando ' + r.total + ' títulos…' : 'No falta ninguna'); mirarNotas(); })
      .catch((e) => aviso((e as Error).message || 'No se pudo lanzar'));
  });
  const bPararNotas = marco.querySelector<HTMLElement>('[data-parar-notas]');
  if (bPararNotas) bPararNotas.addEventListener('click', () => {
    api.pararOmdb()
      .then((r) => { aviso(r.parando ? 'Parando…' : 'No había nada en marcha'); mirarNotas(); })
      .catch(() => aviso('No se pudo parar'));
  });

  const estadoMiniaturas = marco.querySelector<HTMLElement>('[data-estado-miniaturas]');
  const mirarMiniaturas = () => {
    if (!estadoMiniaturas || !estadoMiniaturas.parentElement) return;
    api
      .estadoMiniaturas()
      .then((r) => {
        if (!estadoMiniaturas.parentElement) return;
        const l = r.lote;
        estadoMiniaturas.textContent = l.running
          ? 'Preparando ' + l.actual + ' · ' + (l.hechas + l.fallos) + ' de ' + l.total
          : l.total
            ? 'Última tanda: ' + l.hechas + ' hechas' + (l.fallos ? ', ' + l.fallos + ' fallidas' : '')
            : 'Parada';
        if (l.running) window.setTimeout(mirarMiniaturas, 5000);
      })
      .catch(() => {
        if (estadoMiniaturas.parentElement) estadoMiniaturas.textContent = 'No se pudo consultar';
      });
  };
  mirarMiniaturas();

  const lanzarMiniaturas = (todo: boolean) => {
    api
      .miniaturas(todo)
      .then((r) => {
        aviso(r.total ? 'Preparando ' + r.total + ' películas…' : 'No falta ninguna');
        mirarMiniaturas();
      })
      .catch((e) => aviso((e as Error).message || 'No se pudo lanzar'));
  };
  const bMini = marco.querySelector<HTMLElement>('[data-miniaturas]');
  if (bMini) bMini.addEventListener('click', () => lanzarMiniaturas(false));
  const bMiniTodo = marco.querySelector<HTMLElement>('[data-miniaturas-todo]');
  if (bMiniTodo) bMiniTodo.addEventListener('click', () => lanzarMiniaturas(true));
  const bMiniParar = marco.querySelector<HTMLElement>('[data-parar-miniaturas]');
  if (bMiniParar) bMiniParar.addEventListener('click', () => {
    api.pararMiniaturas()
      .then((r) => { aviso(r.parando ? 'Se para al acabar la que está en curso' : 'No había nada en marcha'); mirarMiniaturas(); })
      .catch(() => aviso('No se pudo parar'));
  });

  const bCabeceras = marco.querySelector<HTMLElement>('[data-cabeceras]');
  if (bCabeceras) bCabeceras.addEventListener('click', () => {
    api
      .detectarCabeceras()
      .then((r) => { aviso('Analizando ' + r.total + ' series… puede tardar horas'); mirarCabeceras(); })
      .catch((e) => aviso((e as Error).message || 'No se pudo lanzar'));
  });
  const bParar = marco.querySelector<HTMLElement>('[data-parar-cabeceras]');
  if (bParar) bParar.addEventListener('click', () => {
    api
      .pararCabeceras()
      .then((r) => { aviso(r.parando ? 'Se parará al acabar la temporada en curso' : 'No había nada en marcha'); mirarCabeceras(); })
      .catch(() => aviso('No se pudo parar'));
  });

  const bEscanear = marco.querySelector<HTMLElement>('[data-escanear]');
  if (bEscanear) bEscanear.addEventListener('click', () => {
    api.escanear()
      .then((r) => aviso(r.started ? 'Actualizando la biblioteca… tarda medio minuto' : r.reason || 'Ya está en marcha'))
      .catch(() => aviso('No se pudo pedir la actualización'));
  });
  const r = marco.querySelector<HTMLElement>('[data-reordenar]');
  if (r) r.addEventListener('click', function () { pantallaOrdenMenu(); });
  const sv = marco.querySelector<HTMLElement>('[data-servidor]');
  if (sv) sv.addEventListener('click', function () { pantallaServidor(); });
  const de = marco.querySelector<HTMLElement>('[data-desemparejar]');
  if (de) {
    de.addEventListener('click', function () {
      olvidarToken();
      void pantallaConexion();
    });
  }

  enfocar(marco.querySelector<HTMLElement>('.ajustes [data-nav]'));
  alPulsar(function (tecla: number) {
    return tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE ? atrasHaciaMenu() : false;
  });
}

/** Reordenar y esconder secciones del menú, con el mando. */
function pantallaOrdenMenu() {
  /** Qué botón (subir/bajar/esconder + clave) tenía el foco antes de repintar, para volver a él. */
  let focoDespues: string | null = null;
  const dibujar = function (): void {
    const a = ajustes();
    const todas = destinosBase();
    const orden = a.ordenMenu.length ? a.ordenMenu : todas.map(function (d: Destino) { return d.clave; });
    const ordenadas = todas.slice().sort(function (x: Destino, y: Destino) {
      const ix = orden.indexOf(x.clave);
      const iy = orden.indexOf(y.clave);
      return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy);
    });

    const filas = ordenadas
      .map(function (d: Destino, i: number) {
        const oculta = a.ocultos.indexOf(d.clave) >= 0;
        const hueco = '<span class="mini invisible">-</span>';
        return (
          '<div class="orden-fila' + (oculta ? ' oculta' : '') + '">' +
          '<span class="nom-menu">' + esc(d.etiqueta) + '</span>' +
          (i > 0 ? '<button class="mini" data-nav data-subir="' + d.clave + '">Subir</button>' : hueco) +
          (i < ordenadas.length - 1 ? '<button class="mini" data-nav data-bajar="' + d.clave + '">Bajar</button>' : hueco) +
          '<button class="mini" data-nav data-ocultar="' + d.clave + '">' + (oculta ? 'Mostrar' : 'Esconder') + '</button>' +
          '</div>'
        );
      })
      .join('');

    pintar('ajustes',
      '<div class="ajustes" data-bloque>' +
      '<h1 class="titulo-pantalla">Orden del menú</h1>' +
      '<p class="pista-ayuda" style="margin-bottom:26px">Sube o baja cada sección, o escóndela si no la usas.</p>' +
      filas +
      '<div style="margin-top:26px">' +
      '<button class="boton" data-nav data-restablecer>Restablecer</button>' +
      '<button class="boton primario" data-nav data-listo>Listo</button></div></div>');

    const mover = function (clave: string, paso: number) {
      const claves = ordenadas.map(function (d: Destino) { return d.clave; });
      const i = claves.indexOf(clave);
      const j = i + paso;
      if (i < 0 || j < 0 || j >= claves.length) return;
      claves[i] = claves[j];
      claves[j] = clave;
      guardarAjustes({ ordenMenu: claves });
      // El foco sigue en el mismo botón de la misma sección, ya en su sitio
      // nuevo; si ese botón ya no existe (llegó al borde), en el contrario.
      focoDespues = (paso < 0 ? 'subir' : 'bajar') + ':' + clave;
      dibujar();
    };

    marco.querySelectorAll<HTMLElement>('[data-subir]').forEach(function (el: HTMLElement) {
      el.addEventListener('click', function () { mover(el.getAttribute('data-subir') || '', -1); });
    });
    marco.querySelectorAll<HTMLElement>('[data-bajar]').forEach(function (el: HTMLElement) {
      el.addEventListener('click', function () { mover(el.getAttribute('data-bajar') || '', 1); });
    });
    marco.querySelectorAll<HTMLElement>('[data-ocultar]').forEach(function (el: HTMLElement) {
      el.addEventListener('click', function () {
        const clave = el.getAttribute('data-ocultar') || '';
        const ocultos = ajustes().ocultos.slice();
        const i = ocultos.indexOf(clave);
        if (i >= 0) ocultos.splice(i, 1);
        else ocultos.push(clave);
        guardarAjustes({ ocultos: ocultos });
        focoDespues = 'ocultar:' + clave;
        dibujar();
      });
    });

    const rest = marco.querySelector<HTMLElement>('[data-restablecer]');
    if (rest) rest.addEventListener('click', function () { guardarAjustes({ ordenMenu: [], ocultos: [] }); dibujar(); });
    const listo = marco.querySelector<HTMLElement>('[data-listo]');
    if (listo) listo.addEventListener('click', function () { pantallaAjustes(); });

    let volver: HTMLElement | null = null;
    if (focoDespues) {
      const partes = focoDespues.split(':');
      const clave = partes.slice(1).join(':');
      const otro = partes[0] === 'subir' ? 'bajar' : 'subir';
      volver =
        marco.querySelector<HTMLElement>('[data-' + partes[0] + '="' + clave + '"]') ||
        marco.querySelector<HTMLElement>('[data-' + otro + '="' + clave + '"]') ||
        marco.querySelector<HTMLElement>('[data-ocultar="' + clave + '"]');
      focoDespues = null;
    }
    enfocar(volver || marco.querySelector<HTMLElement>('.ajustes [data-nav]'));
    alPulsar(function (tecla: number) {
      if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) { pantallaAjustes(); return true; }
      return false;
    });
  };

  dibujar();
}

/* ------------------------------------------------------------- conexión */

function pantallaSimple(contenido: string) {
  window.clearInterval(temporizadorHeroe);
  marco.innerHTML = '<div class="marco"><div class="centrado"><div class="interior">' + contenido + '</div></div></div>';
  indexar();
}

async function pantallaConexion() {
  const dibujar = (codigo: string | null, estado: string, url?: string) => {
    pantallaSimple(
      '<h1 class="marca">Media Watch</h1>' +
        (codigo
          ? '<p class="sub">Apunta con la cámara del móvil a este código.<br>Se empareja solo, no hay que escribir nada.</p>' +
            (url ? '<div class="qr"><img src="' + esc(imagen.qr(url)) + '" alt=""></div>' : '') +
            '<p class="sub" style="margin-top:22px;font-size:22px">O escribe <b>' + codigo + '</b> en Ajustes → Biblioteca → Emparejar televisión</p>'
          : '<p class="sub">' + esc(estado) + '</p>') +
        '<div><button class="boton primario" data-nav data-reintentar>Reintentar</button>' +
        '<button class="boton" data-nav data-cambiar>Cambiar servidor</button></div>' +
        '<p class="pie">Servidor: ' + esc(servidor()) + '</p>',
    );
    const r = marco.querySelector<HTMLElement>('[data-reintentar]');
    if (r) r.addEventListener('click', () => void pantallaConexion());
    const c = marco.querySelector<HTMLElement>('[data-cambiar]');
    if (c) c.addEventListener('click', () => pantallaServidor());
    enfocar(enfocables()[0]);
    alPulsar(null);
  };

  dibujar(null, 'Conectando…');

  try {
    const inicio = await api.iniciarEmparejado();
    dibujar(inicio.code, '', inicio.url);

    const desde = Date.now();
    const sondear = async () => {
      if (Date.now() - desde > inicio.expiresInSeconds * 1000) {
        dibujar(null, 'El código ha caducado. Pulsa Reintentar para generar otro.');
        return;
      }
      try {
        const estado = await api.comprobarEmparejado(inicio.code);
        if (estado.paired && estado.token) {
          guardarToken(estado.token);
          void arrancar();
          return;
        }
      } catch (e) {
        /* aún sin emparejar */
      }
      setTimeout(() => void sondear(), 2000);
    };
    setTimeout(() => void sondear(), 2000);
  } catch (e) {
    dibujar(null, 'No se encuentra el servidor. Comprueba que el HTPC está encendido.');
  }
}

function pantallaServidor() {
  let valor = servidor().replace('http://', '');

  const dibujar = () => {
    pantallaSimple(
      '<h1 class="marca">Dirección del servidor</h1>' +
        '<p class="sub">Usa los números del mando. El botón de volver borra.</p>' +
        '<div class="entrada">http://' + esc(valor) + '</div>' +
        '<div><button class="boton primario" data-nav data-guardar>Guardar</button></div>',
    );
    const g = marco.querySelector<HTMLElement>('[data-guardar]');
    if (g) {
      g.addEventListener('click', () => {
        guardarServidor('http://' + valor);
        void arrancar();
      });
    }
    enfocar(enfocables()[0]);
  };

  alPulsar((tecla) => {
    if (tecla >= 48 && tecla <= 57) { valor += String(tecla - 48); dibujar(); return true; }
    if (tecla === 190 || tecla === 110) { valor += '.'; dibujar(); return true; }
    if (tecla === 186 || tecla === 59) { valor += ':'; dibujar(); return true; }
    if (tecla === TECLA.ATRAS || tecla === TECLA.ESCAPE) { valor = valor.slice(0, -1); dibujar(); return true; }
    return false;
  });

  dibujar();
}

/* -------------------------------------------------------------- arranque */

/*
 * El móvil como mando.
 *
 * Cada dos segundos se pregunta al servidor si el móvil ha mandado algo, desde
 * cualquier pantalla: un texto para buscar —escribir «El halcón maltés» con
 * las flechas son cuarenta pulsaciones— o «ver esto en la tele», que arranca
 * el reproductor donde el móvil lo dejó. Es lo que hace Chromecast, pero con
 * esta aplicación de receptor, que es lo que tiene una Samsung sin Google Cast.
 *
 * Mientras se ve algo no se pregunta: el servidor guarda la orden dos minutos
 * y se recoge al salir del reproductor. Si el servidor no contesta no pasa
 * nada y no se avisa: esto es un añadido.
 */
function escucharAlMovil() {
  window.setInterval(() => {
    if (!token() || document.body.classList.contains('viendo')) return;
    api
      .mando()
      .then((r) => {
        if (r.reproducir) {
          const o = r.reproducir;
          aviso('Desde el móvil: reproduciendo…');
          api
            .ficha(o.itemId)
            .then((ficha) => pantallaReproductor(ficha, o.fileId, o.episodeId, o.position))
            .catch(() => aviso('No se pudo abrir lo que mandó el móvil'));
          return;
        }
        if (r.buscar) {
          aviso('Desde el móvil: «' + r.buscar + '»');
          pantallaBuscar(r.buscar);
        }
      })
      .catch(() => undefined);
  }, 2000);
}

async function arrancar() {
  if (!token()) {
    void pantallaConexion();
    return;
  }
  try {
    bibliotecas = await api.bibliotecas();
  } catch (e) {
    bibliotecas = [];
  }
  // Solo el administrador borra: a los demás no se les enseña el botón.
  api.yo().then((u) => { soyAdmin = u.is_admin === 1; }).catch(() => undefined);
  void pantallaPortada();
  escucharAlMovil();
}

/* ------------------------------------------------------- salvapantallas */

/*
 * Fondos de la biblioteca, en pausa o en el menú, con tiempos distintos a
 * propósito: en pausa alguien se ha levantado un momento, así que el margen
 * por defecto es mayor (5 min) que en el menú (2 min), donde no hay nada que
 * perder por entrar antes. Nunca en otra pantalla —rejilla, ficha, buscar—
 * porque ahí sí hay algo que mirar de verdad.
 *
 * Los fondos son los que ya trajo la portada (`portadaGuardada`): no hace
 * falta pedirle nada nuevo al servidor, y con 1.802 títulos con fanart en la
 * biblioteca, lo que ya está cargado en memoria (héroe + todas las filas) da
 * de sobra para no repetir en una sesión larga.
 */
let capaSalva: HTMLElement | null = null;
let cicloSalva = 0;
let ultimaActividad = Date.now();
let fondosSalva: { id: number; title: string }[] = [];
let indiceSalva = -1;
let ladoASalva = true;
const INTERVALO_SALVA_MS = 14_000;

function fondosParaSalva(): { id: number; title: string }[] {
  if (!portadaGuardada) return [];
  const vistos = new Set<number>();
  const salida: { id: number; title: string }[] = [];
  const candidatos = portadaGuardada.datos.hero.concat(...portadaGuardada.datos.rows.map((r) => r.items));
  for (const t of candidatos) {
    if (t.has_fanart && !vistos.has(t.id)) {
      vistos.add(t.id);
      salida.push({ id: t.id, title: t.title });
    }
  }
  // Al azar, no el orden de la portada: si no, cada sesión larga ve la misma secuencia.
  for (let i = salida.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [salida[i], salida[j]] = [salida[j], salida[i]];
  }
  return salida;
}

/** Cambia al siguiente fondo con un cruce suave; el que entra hace un zoom lento. */
function avanzarSalva() {
  if (!capaSalva || !fondosSalva.length) return;
  indiceSalva = (indiceSalva + 1) % fondosSalva.length;
  const t = fondosSalva[indiceSalva];
  const entra = capaSalva.querySelector<HTMLImageElement>(ladoASalva ? '[data-salva-a]' : '[data-salva-b]')!;
  const sale = capaSalva.querySelector<HTMLImageElement>(ladoASalva ? '[data-salva-b]' : '[data-salva-a]')!;
  const titulo = capaSalva.querySelector<HTMLElement>('[data-salva-titulo]')!;
  ladoASalva = !ladoASalva;
  entra.classList.remove('activa');
  entra.onload = () => {
    void entra.offsetWidth; // reinicia la animación de zoom del CSS
    entra.classList.add('activa');
    sale.classList.remove('activa');
    titulo.textContent = t.title;
  };
  entra.src = imagen.fondo(t.id, 1920);
}

function mostrarSalvapantallas() {
  if (capaSalva) return;
  fondosSalva = fondosParaSalva();
  if (fondosSalva.length < 2) return; // recién arrancado, sin portada cargada todavía
  indiceSalva = -1;
  ladoASalva = true;
  const div = document.createElement('div');
  div.className = 'salva';
  div.innerHTML =
    '<img class="salva-img" data-salva-a alt="">' +
    '<img class="salva-img" data-salva-b alt="">' +
    '<div class="salva-velo"></div>' +
    '<div class="salva-titulo" data-salva-titulo></div>';
  document.body.appendChild(div);
  capaSalva = div;
  avanzarSalva();
  cicloSalva = window.setInterval(avanzarSalva, INTERVALO_SALVA_MS);
}

function ocultarSalvapantallas() {
  if (!capaSalva) return;
  window.clearInterval(cicloSalva);
  capaSalva.remove();
  capaSalva = null;
}

// Captura, no burbuja: así se adelanta a cualquier pantalla y, si el
// salvapantallas está encendido, se traga la tecla entera — la que lo quita
// no debe además activar el botón que tuviera el foco debajo.
document.addEventListener('keydown', (e) => {
  ultimaActividad = Date.now();
  if (capaSalva) {
    e.preventDefault();
    e.stopImmediatePropagation();
    ocultarSalvapantallas();
  }
}, true);

window.setInterval(() => {
  if (capaSalva) return;
  const aj = ajustes();
  const inactivoMin = (Date.now() - ultimaActividad) / 60_000;
  const enPausa = reproductorActivo !== null && reproductorActivo.estado() === 'PAUSED';
  const enMenu = !enPausa && idActual === 'portada' && !document.body.classList.contains('viendo');
  if (enPausa && aj.salvaPausa > 0 && inactivoMin >= aj.salvaPausa) mostrarSalvapantallas();
  else if (enMenu && aj.salvaMenu > 0 && inactivoMin >= aj.salvaMenu) mostrarSalvapantallas();
}, 5_000);

cargarAjustes();
iniciarNavegacion();

/*
 * En una tele no hay consola que abrir. Un fallo suelto se traduce en que algo
 * deja de responder sin decir nada, y desde el sofa no hay manera de saber si
 * se ha roto la aplicacion, el servidor o la red. Estos dos avisos convierten
 * ese silencio en una linea en pantalla, que es lo unico que hace falta para
 * saber por donde mirar.
 */
avisarDeFallos((mensaje) => aviso('Fallo al pulsar: ' + mensaje));
window.addEventListener('error', (e) => {
  const donde = e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : '';
  aviso('Fallo: ' + (e.message || 'desconocido') + donde);
});
window.addEventListener('unhandledrejection', (e) => {
  const razon = (e as PromiseRejectionEvent).reason;
  aviso('Fallo sin atender: ' + ((razon && (razon as Error).message) || String(razon)));
});

// El menú se abre y cierra según dónde esté el foco; la navegación ya lo ha
// movido cuando llega este manejador, porque se registró antes.
document.addEventListener('keydown', () => setTimeout(ajustarMenu, 0));

void arrancar();
