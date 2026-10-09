/**
 * Abrir la app de una plataforma desde la tele.
 *
 * Los identificadores de las apps de Samsung circulan en listas de terceros y
 * cambian entre modelos y países, así que **no se codifican aquí**: se piden a
 * la propia tele con `getAppsInfo()` y se busca por nombre, que es lo que
 * recomienda la documentación de Tizen. Si la app no está instalada no se
 * ofrece el botón, en vez de lanzar un identificador inventado que falla en
 * silencio.
 *
 * Saltar al título exacto no se intenta: los enlaces profundos de Prime,
 * Movistar+ y Apple TV+ no están documentados y fallan según la versión. Se
 * abre la app y se busca desde ella.
 *
 * Requiere el privilegio `http://tizen.org/privilege/application.launch` en el
 * config.xml; sin él, `launchAppControl` lanza excepción.
 */

type AppInfo = { id: string; name: string };
type TizenApp = {
  getAppsInfo?: (ok: (apps: AppInfo[]) => void, err?: (e: Error) => void) => void;
  launch?: (id: string, ok?: () => void, err?: (e: Error) => void) => void;
};

const tizenApp = (): TizenApp | null => {
  const w = window as unknown as { tizen?: { application?: TizenApp } };
  return w.tizen && w.tizen.application ? w.tizen.application : null;
};

/** Palabras que identifican cada app en su nombre, en minúsculas. */
const NOMBRES: Record<string, string[]> = {
  movistar: ['movistar'],
  prime: ['prime video', 'amazon prime', 'primevideo'],
  apple: ['apple tv', 'appletv'],
  netflix: ['netflix'],
  disney: ['disney'],
  hbomax: ['hbo max', 'hbomax'],
  skyshowtime: ['skyshowtime'],
  filmin: ['filmin'],
  atresplayer: ['atresplayer', 'atres player'],
  rtve: ['rtve'],
  rakuten: ['rakuten'],
  crunchyroll: ['crunchyroll'],
  mubi: ['mubi'],
};

let listado: AppInfo[] | null = null;
let pedido = false;

/** Se pide una vez por sesión; la tele tarda un momento en contestar. */
export function cargarAppsInstaladas(): void {
  const app = tizenApp();
  if (pedido || !app || !app.getAppsInfo) return;
  pedido = true;
  try {
    app.getAppsInfo(
      (apps) => { listado = apps; },
      () => { listado = []; },
    );
  } catch (e) {
    listado = [];
  }
}

/** El id instalado de esa plataforma, o null si no está (o aún no se sabe). */
export function idDeApp(clave: string): string | null {
  if (!listado) return null;
  const claves = NOMBRES[clave];
  if (!claves) return null;
  for (const a of listado) {
    const n = (a.name || '').toLowerCase();
    /*
     * La QN93A trae duplicados de marcador de posición junto a los buenos:
     * `org.tizen.primevideo-dummy` al lado de `org.tizen.primevideo`, y
     * `com.samsung.tv.aria-dummy` al lado de `com.samsung.tv.aria-video`.
     * Tienen el MISMO nombre, así que sin descartarlos por el id se abriría
     * uno vacío según el orden en que la tele devuelva la lista.
     */
    if (/-dummy$/.test(a.id || '')) continue;
    for (const c of claves) if (n.indexOf(c) >= 0) return a.id;
  }
  return null;
}

/** Abre la app. Devuelve false si no se pudo (no instalada, sin privilegio). */
export function abrirApp(clave: string): boolean {
  const app = tizenApp();
  const id = idDeApp(clave);
  if (!app || !app.launch || !id) return false;
  try {
    app.launch(id);
    return true;
  } catch (e) {
    return false;
  }
}
