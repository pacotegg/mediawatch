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
| 1 | Servidor configurable por entorno (datos, binarios, bibliotecas vacías) | Arranca con otra carpeta de datos |
| 2 | Escáner por nombre + TMDb sobre una biblioteca de prueba desordenada | % identificado, % dudoso |
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

