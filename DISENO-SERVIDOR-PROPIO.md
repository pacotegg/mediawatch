# Media Watch Server — diseño de la app de servidor propio

Estado: **borrador de diseño, 08/10/2026. Nada implementado. Hito 0 (auditoría) cerrado.**

## 1. Objetivo y alcance

Una app de escritorio para que cualquiera (por ahora amigos y familiares) tenga su propio
servidor Media Watch en su ordenador, con sus películas y series, sin tocar la terminal.

Decisiones tomadas:

| Tema | Decisión |
|---|---|
| Público | Cualquiera; de momento amigos y familia |
| Plataforma | Solo Windows. Linux, más adelante |
| Biblioteca | **Sin tinyMediaManager**: el escáner debe identificar y catalogar por su cuenta |
| Contenedor | Electron |
| Nombre | **MediaWatch Server** |
| Repositorio | **Repo adicional**, separado de este monorepo |
| Actualizaciones | **Automáticas** cuando haya versión nueva en el repo |
| Clientes para amigos | **Web (PWA) y Android**; en iOS, la web instalada; para ver en tele, Cast desde el móvil |
| Acceso externo | A elección del usuario (Tailscale, dominio propio, ninguno) |

## 2. Qué se reutiliza y qué cambia

El servidor actual (`server/`, Fastify + `node:sqlite`) y los tres clientes se reutilizan.
La app de escritorio es un envoltorio más un asistente. No se reescribe el servidor.

### 2.1 Auditoría de rutas fijas (solo lectura, 08/10)

Las rutas de máquina están **concentradas, no dispersas**:

- `server/src/config.ts:56-64`: nueve bibliotecas por defecto en `E:\...`.
- `server/src/config.ts:82-91`: rutas de ffmpeg y Python (`C:/Users/HTPC/...`, `C:/Python314`...).
- `server/src/config.ts:109`: `transcodeDir` cae a `G:\TvWatchTmp` si existe `G:\`.
- `server/src/cli/plex-sync.ts:44-46`: ruta de Plex del propietario (CLI de migración, no entra en la app).
- `server/src/config.ts:7`: `DATA_DIR = ROOT/data` (relativo a la carpeta del proyecto).

### 2.1.b Resultado del hito 0 (completa, solo lectura)

| Zona | Ficheros con rutas fijas | Veredicto |
|---|---|---|
| `server/src` | 5: `config.ts`, `index.ts`, `scanner/scan.ts`, `media/trailers.ts`, `cli/plex-sync.ts` | Pocos. Hay que mirar uno a uno `index.ts`, `scan.ts` y `trailers.ts` (la búsqueda marcó coincidencias que no he leído; pueden ser comentarios) |
| `server/scripts` | 25 `.py`/`.mjs`, casi todos con `C:\tvwatch\data`, `C:\scripts\webpanel\subsfetch.py`, `C:\Media\...`, MKVToolNix | Son herramientas de mantenimiento del propietario en lote: **no entran en la app**. No se tocan |
| Scripts que **sí** invoca el servidor | `intros.py`, `resync.py`, `transcribe.py` (los dos primeros con `FFMPEG` fijo en `C:\Users\HTPC\...`), `cargar_generos_imdb.py`, `creditos_pelicula.py` | Hay que pasarles la ruta de ffmpeg por argumento o variable de entorno. Los dos últimos no los he abierto |
| `web/src` | 2: `SelectorDeArte.tsx`, `Settings.tsx` | A leer; pueden ser solo textos de ayuda |
| `tv/src` | 2: `api.ts`, `main.ts` | A leer; la tele no está en el alcance inicial |
| `android` | Solo textos de ejemplo (`192.168.1.20`) y lógica de dirección | Sin rutas del propietario. La app ya acepta IP o dominio y cambia sola de dirección |

Binarios externos lanzados desde `server/src`: `ffmpeg` (8 sitios) y Python (1). Dependencias npm del servidor:
`fastify`, `@fastify/static`, `@fastify/cookie`, `fast-xml-parser`, `qrcode`. Son JavaScript puro, sin módulos nativos,
lo que simplifica empaquetar con Electron (`node:sqlite` viene con Node).

Hechos útiles para la decisión de clientes: la web ya es una PWA (`manifest.webmanifest`, `sw.js`,
`apple-touch-icon.png` y metaetiquetas `apple-mobile-web-app-*` en `web/index.html`), así que en iOS
se instala con «Añadir a pantalla de inicio». **No he comprobado** que el Cast desde la web funcione en
iOS (iOS no ofrece la API de Cast de Chrome); Android sí lleva el SDK de Cast, según el dosier. Habrá que
medirlo antes de prometérselo a nadie con iPhone; alternativa a estudiar: AirPlay.

### 2.2 Cambios necesarios en el servidor

1. **Config por usuario**: `DATA_DIR` pasa a una carpeta de datos del usuario (p. ej.
   `%APPDATA%\MediaWatch`), inyectada por la app al lanzar el servidor.
2. **Sin rutas del propietario**: ffmpeg/ffprobe/Python vienen empaquetados y la app pasa
   su ruta; se eliminan las listas de `config.ts:82-91` del camino de producción.
3. **Bibliotecas vacías por defecto**: las crea el asistente.
4. **Escáner sin NFO** (ver §3). Es el cambio grande.
5. **Primer arranque**: sin perfil «Casa» admin sin PIN; el asistente crea el admin y su PIN
   (lo elige el usuario, nunca se fija uno).
6. **Claves de API**: las del propietario NO se distribuyen (ver §5).

## 3. Escáner sin tinyMediaManager

Hoy el escáner *lee* NFO y arte que ya existen (~30 s, sin internet). Sin tMM hay que
*identificar*. Propuesta por fases, cada una útil por sí sola:

1. **Leer NFO si existen** (comportamiento actual): quien ya use tMM, Kodi o similar sigue igual.
2. **Parsear nombre de fichero/carpeta**: título, año, `SxxExx`. Formatos habituales
   (`Titulo (2019).mkv`, `Serie/Season 02/Serie - S02E05.mkv`).
3. **Identificar contra TMDb** con ese título+año, dar un nivel de confianza y guardar el
   `tmdb_id`. El flujo de propuestas con confianza ya existe en `scanner/tmdb.ts` y `routes/enrich.ts`.
4. **Descargar metadatos y arte** (póster, fondo, logo) a la carpeta de datos del usuario,
   **no a su carpeta de películas** (no escribir en la biblioteca del usuario por defecto).
5. **Casos dudosos a una cola de revisión** en la interfaz, en vez de adivinar.

Riesgo principal: la calidad de la identificación con nombres desordenados. Medir con una
biblioteca real y desordenada antes de prometer nada. Dependencia: exige una clave TMDb.

### 3.1 Medición del escáner actual sin NFO (08/10, hito 2, antes de tocar código)

Biblioteca **sintética** de 9 títulos con nombres desordenados (ficheros dispersos de 6 MB, sin NFO), escaneada en modo portable.
No es una biblioteca real: sirve para localizar fallos, no para dar un porcentaje fiable.

| Qué | Resultado |
|---|---|
| Títulos limpios a la primera | **3 de 9** (`Blade Runner (1982)`, `Friends (1994)`, `Breaking Bad`). Solo entiende la forma `Título (AAAA)` |
| Con basura en el título | `The.Matrix.1999.1080p.BluRay.x264-GROUP`, `Amelie 2001 [1080p]`, `Alien Resurrection (1997) [BluRay]`, `El_laberinto_del_fauno_2006_DVDRip_spa`, `Inception.2010.720p.BluRay`, `The.Office.US.2005.720p`. Año sin detectar en todos ellos |
| Episodios | `SxxExx` y `1x05` se detectan bien. El título del episodio es el nombre del fichero (`Breaking.Bad.S01E01.720p`, `S02E03`) |
| **Reescaneo tras aplicar TMDb** | Con `plot`, `rating`, `tmdb_id` y `mpaa` puestos a mano, **un escaneo los dejó todos a NULL**. Además `saveGenresAndPeople` borra géneros y reparto en cada pasada si no hay NFO (lectura de código, `scan.ts:340-343`) |
| Perfil infantil | `parseRatingCategoria` devuelve `'18'` cuando `mpaa` es nulo (`db.ts`, lectura de código). Sin NFO, **todo cuenta como +18** y un perfil infantil no vería nada |

### 3.2 Lo que ya existe y se reutiliza

`parseTitleYear`, `tituloDeSuelto` (vídeos sueltos en la raíz), `episodeNumbers`, `numeroDelantero`, la detección de temporadas, y en `tmdb.ts`
`search()`, `details()`, `scoreMatch()` (`strong`/`weak`), `buildCandidates()`, `candidateForItem()` y `applyProposal()` (escribe en `data/artwork/<id>/`, no en la biblioteca).
Hoy todo pasa por una **revisión manual** que propone y espera confirmación.

### 3.3 Cambios propuestos para el hito 2

Todo condicionado a **modo portable** o a «sin NFO»: con NFO el escáner se comporta exactamente como ahora.

1. **Limpiar el nombre**: nuevo `limpiarNombre()` que quita etiquetas de resolución, fuente, códec, grupo, idiomas y corchetes, cambia `.` y `_` por espacios y extrae el año `19xx/20xx`. Se aplica a carpeta y a fichero, y cae al nombre del fichero si la carpeta no informa (`CD1`, `Movies`).
2. **No perder lo identificado**: el `upsert` y el borrado de géneros y reparto respetan lo guardado cuando el escaneo no trae NFO. Hace falta una columna que marque «metadatos de TMDb» (p. ej. `items.meta_origen`) para saber qué se puede reescribir. Es el cambio más delicado y el primero a hacer.
3. **Identificación automática**: tras escanear, los títulos sin `tmdb_id` pasan a una cola en segundo plano (respetando el límite de TMDb). Coincidencia `strong` (título y año) → se aplica sola, **solo en `data/`**; el resto → cola de revisión con alternativas. Decisión que debes tomar: en tu servidor la regla es «nunca escribir sin confirmar»; aquí lo que se escribe es la BD y el arte propios, no los ficheros del usuario. Propongo automático **solo en modo portable**.
4. **Clasificación por edades**: pedir la certificación a TMDb (`release_dates` en películas, `content_ratings` en series) para el país del idioma configurado (`ES`), y guardarla en `mpaa`. Sin certificación → decidir si se trata como +18 (seguro) o se avisa al administrador.
5. **Series**: títulos, sinopsis, fecha y miniatura de cada episodio desde TMDb (hoy `temporadasDeSerie` solo cuenta episodios). Entradas por temporada: una llamada por temporada.
6. **Reparto y fotos**: ya existe `personas.ts` a partir de `tmdb_id`; comprobar que sigue funcionando sin NFO.
7. **Medición con una biblioteca real**: la sintética no basta. Pedir al usuario (o a un amigo) una lista de nombres de carpetas/ficheros reales, sin datos personales, para medir el % identificado.

Limitación que no puedo salvar desde aquí: esta sesión no puede llamar a TMDb (sin clave ni acceso verificado), así que los puntos 3 a 5 solo
se podrán probar contra TMDb real en la máquina del propietario con su clave.

### 3.4 Estado del hito 2 (08/10)

Decisiones del usuario: identificación **automática solo en modo portable** (el HTPC sigue con la regla de confirmar); un título sin clasificación por edades **avisa al administrador**; durante la instalación se **avisa de la convención de nombres** (§10).

Implementado (todo bajo modo portable o «sin NFO»; con NFO nada cambia, comprobado con un `movie.nfo` de prueba):

| Pieza | Dónde |
|---|---|
| Limpieza de nombres de release (`The.Matrix.1999.1080p…` → «The Matrix», 1999) | `scanner/nombres.ts` |
| `items.meta_origen = 'tmdb'`: el escaneo respeta título, año, sinopsis, nota, clasificación, géneros y reparto | `scanner/scan.ts`, `db.ts` |
| Coincidencia segura (título igual y año ±1; sin año, un único resultado con ese título) y aplicación automática; lo dudoso se queda para la revisión manual y no se reintenta hasta 30 días después | `scanner/identificar.ts` |
| Clasificación por edades del país del idioma (`ES:12`…) desde TMDb | `scanner/tmdb.ts` (`certificacionDe`) |
| Episodios (título, sinopsis, fecha, duración, nota, miniatura) y protección frente al reescaneo | `scanner/episodios-tmdb.ts`, `scan.ts` |
| Rutas de administrador: `GET /api/identificar/estado`, `POST /api/identificar/ejecutar`, `POST /api/identificar/clasificacion` | `routes/identificar.ts` |
| Se lanza sola tras cada escaneo en modo portable | `index.ts` |
| La confirmación manual (`/api/enrich/apply`) también deja el título identificado en modo portable | `routes/enrich.ts` |

Correcciones que salieron de la medición: (1) el reescaneo borraba todo lo de TMDb; (2) `parseRatingCategoria` trataba como infantiles las bibliotecas con id 3 y 9 (son las del propietario), que en una instalación nueva son bibliotecas cualquiera.

Sin clasificación, un título cuenta como +18 (invisible para perfiles infantiles) **hasta que el administrador la ponga**: es lo seguro, y por eso el aviso es obligatorio.

**Pendiente / sin verificar:**
- **API real de TMDb**: las pruebas usan respuestas simuladas con la forma de la documentación. Sin comprobar: que `append_to_response=images,external_ids,release_dates` (películas) y `…,content_ratings` (series) lo acepte tal cual, y que la certificación aparezca donde se supone. Probar con una clave real antes de dar el hito por cerrado.
- ~~Interfaz del aviso~~ **Hecha (08/10)**: `web/src/components/Identificacion.tsx`, dentro de Ajustes → Metadatos (solo administrador y solo en MediaWatch Server): contadores, «Identificar ahora» y lista «Sin clasificación por edades» con selector. Probada en un navegador real contra el servidor con datos de prueba (el botón Guardar fija `ES:12` y la fila desaparece). El aviso por título dudoso es un contador y un texto, no una notificación emergente.
- **Biblioteca real desordenada** para medir el % de acierto (la actual es sintética).
- Las series de TMDb pueden numerar distinto que los ficheros; no se corrige aquí (existe `numeracion.ts`).

## 4. App de escritorio (Electron)

- **Proceso principal**: arranca el servidor Node como proceso hijo, lo vigila, lo reinicia
  si cae (sustituye a `vigilar-servidor.ps1`). Todo `spawn` con `on('error')`.
- **Bandeja del sistema**: estado, abrir panel, reiniciar, salir, arrancar con Windows.
- **Asistente de primer uso**: (1) carpetas de películas y series, (2) crear admin + PIN,
  (3) clave TMDb (con enlace a cómo obtenerla), (4) acceso desde fuera: sí/no.
- **Panel**: URL local, QR para emparejar móvil y tele, progreso del escaneo, espacio usado.
- **Instalador**: un `.exe` con Node, ffmpeg y el servidor dentro. Sin pasos manuales.
- **Actualizaciones**: pendiente de decidir (§7).

## 5. Puntos delicados

- **Claves de API**: cada usuario pone la suya (TMDb es gratuita). No incluir las del propietario.
- **Licencias**: ffmpeg y demás binarios redistribuidos tienen condiciones (p. ej. GPL/LGPL
  según la compilación). **No comprobado todavía**; revisar antes de repartir el instalador.
- **Aspectos de IA y OCR** (Whisper, Tesseract, PgsToSrt, chromaprint): opcionales y fuera de
  la primera versión; pesan mucho.
- **Transcodificación**: hoy afinada para Intel QSV. En la primera versión: reproducción
  directa y remux siempre; transcodificar solo si se detecta aceleración, y por CPU como
  alternativa lenta o desactivada. Hay que **medir** en un equipo sin QSV.
- **Seguridad**: el servidor escuchará en la red local. Con acceso desde fuera hay que
  exigir PIN a todos y no exponer nada sin sesión (ya hay freno de fuerza bruta en `auth.ts`).

## 6. Acceso desde fuera de casa

Elegir **una** vía recomendada por defecto (a decidir con el uso): Tailscale (sin abrir
puertos, la más simple para amigos) o proxy inverso con dominio propio (más trabajo para el
usuario). La infraestructura actual (Caddy + DuckDNS) es del propietario y no se empaqueta.

### 2.1.c Cierre del hito 0 (08/10, solo lectura)

**Los 7 ficheros pendientes, leídos:**
- `server/src/index.ts`, `scanner/scan.ts`, `media/trailers.ts`: solo **comentarios**. Sin cambios de código.
- `scripts/cargar_generos_imdb.py`: `C:\tvwatch\data\...` fijo. `scripts/resync.py`: `SUBSFETCH = C:\scripts\webpanel\subsfetch.py` fijo.
  `resync.py` lo invoca el servidor, así que hay que dar una ruta configurable o desactivar esa función. `subsfetch.py` es del pipeline del propietario y **no se redistribuye**.
- `web/src/pages/Settings.tsx:189`: mensaje «No se encuentra subsfetch.py en C:\scripts\webpanel». Hay que ocultar ese bloque si la función no está.
- `web/src/components/SelectorDeArte.tsx:239`: texto de ayuda que nombra «el propio HTPC». Solo redacción.
- `tv/src/api.ts:8`: `SERVIDOR_POR_DEFECTO = 'http://192.168.31.16:8730'`. La tele queda **fuera del alcance** inicial.

**Primer arranque** (`server/src/routes/auth.ts`): ya existe. `GET /api/users` devuelve `setupNeeded: true` si no hay usuarios,
y `POST /api/users` convierte en **administrador** al primero que se crea. No hay perfil «Casa» sembrado en el código: es dato de tu BD.
Dos consecuencias para el asistente:
1. El PIN es opcional en la API (`pin ? hash : null`). El asistente debe **exigirlo** para el admin.
2. Quien llegue primero a `POST /api/users` es el admin. El asistente debe crear el admin **antes** de abrir el servidor a la red
   (escuchar en 127.0.0.1 durante la configuración), o cualquiera de la red local podría adueñarse del servidor.

**Android contra un servidor ajeno:** el APK **no lleva ninguna dirección propia embebida**: el usuario escribe IP o dominio
(`Conexion.kt`), y `Ajustes.kt` ya distingue IP de dominio y añade `http://` o `https://`. `res/xml/red.xml` permite HTTP en claro
de forma general, justo porque la dirección la elige el usuario. Conclusión: debería conectarse a cualquier MediaWatch Server
**sin recompilar**. No lo he podido probar en ejecución desde aquí (hace falta un APK y un servidor reales); queda como prueba del hito 3.

**Node dentro de Electron — sin verificar:** el servidor usa `node:sqlite` y el dosier dice Node 26. El entorno de esta sesión tiene Node 22.22, así que
no he podido comprobar nada ahí. Depende de la versión de Node que lleve cada versión de Electron. Recomiendo no apoyarse en ello:
empaquetar un `node.exe` propio (versión fijada) y lanzarlo como proceso hijo, en lugar de ejecutar el servidor dentro de Electron.
Medirlo en el hito 3.

## 7. Decisiones cerradas y preguntas abiertas

Cerradas (08/10): actualizaciones automáticas; clientes web y Android, iOS por PWA y Cast desde el móvil;
acceso externo a elección del usuario; repo adicional; nombre «MediaWatch Server».

Abiertas:
1. ~~Firma~~ **Cerrada**: sin firma, app sin ánimo de lucro; se explica a los usuarios el aviso de SmartScreen. Comprobar que `electron-updater` actualiza bien un instalador sin firmar (hito 4).
2. **Clientes**: Android analizado en §2.1.c (debería funcionar sin recompilar; falta la prueba real). La web va servida por el propio servidor.
3. **iOS y Cast**: medir qué opciones reales hay (§2.1.b).
4. ~~Código compartido~~ **Cerrada: submódulo de git**. Ver §9.
5. **Licencias** de lo que se empaqueta (§5).

## 8. Plan por hitos (propuesto)

| Hito | Contenido | Cómo se valida |
|---|---|---|
| 0 | ✅ Auditoría de rutas fijas, dependencias y cliente Android (§2.1.b y §2.1.c) | Lista con cifras |
| 1 | ✅ (08/10) Servidor configurable por entorno (datos, binarios, bibliotecas vacías). Variables `MEDIAWATCH_DATA_DIR/HOST/PORT/FFMPEG/FFPROBE/PYTHON/TMP_DIR/SUBSFETCH`; sin ellas, comportamiento anterior. Corregido un fallo de primer arranque en `db.ts` (índice creado antes que su tabla) | Probado en Linux con Node 22.22 y datos vacíos: arranca y `setupNeeded: true`. **Sin probar** en el HTPC/Windows ni con Node 26 |
| 2 | ✅ (08/10) Escáner por nombre + TMDb: puntos 1–5 de §3.3 implementados y probados **con TMDb simulado** (ver §3.4). Falta probar contra la API real y la interfaz del aviso | Biblioteca sintética: 9/9 títulos limpios (antes 3/9), 8/9 identificados, 1 dudoso a revisión, y el reescaneo no borra lo identificado. 25 tests (`node --test`) |
| 3 | Envoltorio Electron (hijo, bandeja, asistente) en máquina limpia | Instalar y ver una película |
| 4 | Instalador y prueba con un amigo | Instalación sin ayuda |

## 9. Estructura del repo nuevo (submódulo de git)

Recomendación: el repo nuevo (`mediawatch-server`) contiene el envoltorio Electron y trae este repo como submódulo **fijado a una etiqueta**:

```
mediawatch-server/
├── app/            Electron: proceso principal, bandeja, asistente, actualizador
├── core/           submódulo -> pacotegg/mediawatch @ v<ver>   (server/ y web/)
├── runtime/        node.exe fijado, ffmpeg/ffprobe (se descargan en la compilación, no se versionan)
└── .github/        compilación del instalador y release
```

Por qué: el servidor y la web siguen teniendo **un único origen** (este repo), sin copias que se desincronicen, y cada versión del instalador
fija exactamente qué versión del servidor lleva. Los cambios del hito 1 (config por entorno, sin rutas fijas) se hacen **aquí**, en este repo, y se
publican con una etiqueta; el repo nuevo solo avanza el puntero.

Limitaciones a tener en cuenta:
- El submódulo incluye también `android/` y `tv/` (código, no binarios). Se puede ignorar al compilar; no pesa en el instalador.
- Quien clone el repo nuevo debe usar `git clone --recurse-submodules`.
- La web (`web/dist`) se **compila en la integración continua** del repo nuevo, no se versiona.
- Los cambios en `core/` hechos desde el repo nuevo no deben hacerse: se hacen en este repo y se sube el puntero.

## 10. Aviso de instalación y mini tutorial de nombres

### 10.1 Texto del aviso en el asistente (borrador)

> **Antes de añadir tus carpetas: cómo poner los nombres**
>
> MediaWatch Server reconoce tus películas y series por el **nombre**. Para que encuentre bien la carátula, la sinopsis y los episodios, ponles
> el nombre **y el año** así:
>
> ```
> Películas\Blade Runner (1982)\Blade Runner (1982).mkv
> Series\Breaking Bad (2008)\Season 01\Breaking Bad - S01E01.mkv
> ```
>
> Si los nombres ya vienen como `Pelicula.2019.1080p.BluRay.x264-GRUPO`, el servidor intenta limpiarlos, pero acertará menos.
> Para renombrar muchas de golpe puedes usar un **gestor de biblioteca** (ver el tutorial). Lo que no se reconozca con seguridad
> quedará pendiente para que lo revises tú, y nunca se borra ni se renombra nada de tus carpetas.
>
> [Ver tutorial]  [Entendido, continuar]

### 10.2 Mini tutorial (borrador)

1. **Convención**: una carpeta por película con el nombre y el año; para series, una carpeta por serie con subcarpetas `Season 01`, `Season 02` y ficheros `Serie - S01E01.mkv`.
2. **Herramientas para renombrar en lote** (a revisar: precio, licencia y estado de cada una antes de publicarlo):
   - **tinyMediaManager**: es el que usa el propietario; renombra y genera `.nfo` y carátulas, que MediaWatch Server lee directamente.
   - **MediaElch**: alternativa de código abierto que también renombra y genera `.nfo`.
   - **FileBot**: renombrado muy potente; comprobar condiciones de uso.
   - Radarr/Sonarr: solo si ya los usan para descargar; no hace falta instalarlos para esto.
3. **Qué hacer con lo que no se reconoce**: pantalla de administrador → «Pendientes de revisión» → elegir la coincidencia correcta de la lista que propone TMDb.
4. **Clasificación por edades**: si TMDb no la tiene para España, el administrador la ve en «Sin clasificar» y la elige; mientras tanto el título solo lo ven los perfiles adultos.
5. **Clave de TMDb**: gratuita, hay que registrarse en themoviedb.org y pedirla en Ajustes de la cuenta → API. Sin clave no hay identificación automática.

Las capturas y los pasos concretos de cada herramienta se escribirán al llegar al hito 3, comprobándolos con la versión vigente en ese momento (aquí no los he verificado).

## 11. Estado del hito 3 (08/10)

- **Repo `mediawatch-server`**: intento de crearlo desde la sesión rechazado por GitHub (`403 Resource not accessible by integration`): la integración no puede crear repositorios. Hay que crearlo a mano (vacío) y añadirlo a la sesión.
- **Servidor**: en modo portable, el primer perfil (administrador) **exige PIN** (`routes/auth.ts`); sin PIN → 400. Probado: sin PIN y con PIN corto se rechazan, con PIN de 6 cifras se crea.

