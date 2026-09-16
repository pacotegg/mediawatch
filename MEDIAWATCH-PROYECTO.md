# Media Watch (antes TvWatch / Cineteca) — dosier completo del proyecto

Estado a **16 de septiembre de 2026**. Este documento es la memoria entera del
proyecto para alimentar el proyecto de Claude: qué es, cómo está montado, cada
carpeta y fichero, cómo se arranca, compila e instala, la cronología desde el
primer día, el estado del git, las trampas ya pagadas y las reglas de trabajo
del usuario. Todo lo que hay aquí sale del código, de los README, de las
memorias de sesión y de los transcritos de las conversaciones.

---

## 1. Qué es

**Media Watch** es un servidor de películas y series propio, al estilo de
Plex/Jellyfin/Infuse, escrito **desde cero** (el usuario rechazó instalar
Jellyfin: quería «una app que funcione como yo quiera»). Corre en el HTPC de
casa (`C:\tvwatch`), lee la biblioteca que ya está catalogada por
tinyMediaManager en `E:\`, y la sirve a tres clientes:

| Cliente | Carpeta | Tecnología | Dónde corre |
|---|---|---|---|
| **Web** | `web/` | React 19 + Vite + Tailwind 4 + motion | Cualquier navegador; PWA instalable |
| **Tele** | `tv/` | TypeScript plano + CSS plano, ES2016/iife | Samsung QN93A (Tizen 6.0 ≈ Chrome 76), reproductor nativo AVPlay |
| **Android** | `android/` | Kotlin + Jetpack Compose + Media3/ExoPlayer + Cast SDK | Móvil (Android 8+, pensado para 13+). Versión actual **3.7** |

Nombres: empezó como **Cineteca** (04/09), se renombró a **TvWatch** (05/09) y a
**Media Watch** (16/09). El código y el paquete Android siguen llamándose
`tvwatch`/`casa.tvwatch`, y el id de la app de Tizen sigue siendo
`Cineteca01.Cineteca` **a propósito**: cambiarlo instalaría una segunda app en la tele.

Cifras de la biblioteca (BD real, 16/09): **1.834 títulos** (1.735 películas, 99
series), 3.808 episodios, **5.566 ficheros de vídeo**, 61.983 personas, 1,32
millones de frases de diálogo indexadas, 9 bibliotecas.

### Lo que la distingue de Plex/Jellyfin (resumen de lo construido)

- **La biblioteca no se scrapea: se lee.** Los `.nfo`, carátulas, logos, fondos
  y fotos de reparto de tinyMediaManager ya están en disco. Escaneo completo en
  ~30 s, sin internet. TMDb/fanart.tv/TVDB/OMDb solo rellenan huecos, y el
  scraper **nunca escribe sin confirmación** (propone con nivel de confianza).
- **Reproducción directa siempre que se pueda**: directa → remux (solo audio) →
  transcodificación por GPU (Intel QSV, `h264_qsv`, ~6× tiempo real). El
  cliente dice qué decodifica de verdad (perfil `samsung2021`, `MediaCodecList`
  en Android, `canPlayType` en web).
- **La tele recibe el fichero crudo** (`?raw=1`): AVPlay decodifica MKV/HEVC/AC3/DD+
  por hardware, el DD+ JOC (Atmos) pasa por eARC a la barra Hisense sin tocarlo.
- **HLS con bitrate adaptativo** para fuera de casa; **calidad a mano** en Android
  (Original / 1080p·8 / 720p·4 / 480p·2 / 360p·1 Mb/s, recordada aparte para casa y fuera).
- **Búsqueda por frase de diálogo** (FTS5 sin tildes) que arranca la película en esa frase.
- **Saltar cabeceras y créditos** por huellas acústicas (chromaprint) entre episodios.
- **Subtítulos**: búsqueda por hash con verificación de sincronía contra el
  audio (reusa `subsfetch.py` del pipeline), resincronización automática por
  correlación, desfase manual de audio y subtítulos, **transcripción por IA**
  (faster-whisper) solo para ficheros sin subtítulos.
- **Modo noche / diálogos realzados** al bajar 5.1 a estéreo (medidos +7,7 y +13,2 dB).
- **Miniaturas de la barra** (trickplay) por fotogramas clave, tiempos del propio ffmpeg.
- **Sagas** desde el `<set>` del NFO (117 colecciones), fichas de persona con
  biografía, notas de IMDb/Rotten Tomatoes/TMDb/TVDB (OMDb), detector de copias
  malas, estadísticas tipo Tautulli, identificación de anime (Kitsu) y
  renumeración de episodios con previsualización.
- **Multiusuario con PIN** (mín. 6 cifras), emparejado de la tele por código/QR,
  acceso desde internet por Caddy + DuckDNS, la app cambia sola de dirección.
- **Pestaña «Actividad»** (admin): quién está conectado, qué ve, mensaje, parar.
- **El móvil como mando de la tele**: buscar tecleando en el móvil (en vivo) y
  «Ver en la tele» (la app de Tizen recoge la orden y reproduce).
- **Disc art** (carátula redonda) en el reproductor, con los controles.

---

## 2. Entorno físico y de red

| Qué | Valor |
|---|---|
| HTPC | Windows 11 Pro, Intel con QSV (Arc/iGPU), 16 hilos; sesión **sin** privilegios de administrador |
| IP HTPC | `192.168.31.16` (la `172.30.32.1` es de WSL, no sirve) |
| Puerto del servidor | **8730** (`http://192.168.31.16:8730`) |
| Tele | Samsung **QE65QN93AATXXC** (QN93A, 2021), Tizen 6.0, IP `192.168.31.117`, sdb puerto `26101` |
| Barra de sonido | Hisense AX5125H (5.1.2, Atmos) por eARC; salida de la tele en «sin procesar» |
| Biblioteca | `E:\` — HDD 12 TB (caja TerraMas TDAS, disco 3). El sistema va en SSD |
| Temporales de transcodificación | `G:\CinetecaTmp` (clave `transcodeDir`) |
| Acceso externo | `https://tv.micasa.duckdns.org` → Caddy (`C:\Caddy\Caddyfile`, tarea programada «Caddy - proxy inverso Jellyfin», corre como SYSTEM) → `127.0.0.1:8730`. IP pública `x.x.x.x`. Jellyfin en `https://micasa.duckdns.org` |
| Tailscale | activo, HTPC = `100.x.x.x` (Plex no lo necesita; Media Watch tampoco ya) |
| Ancho de banda | subida **246 Mb/s**, bajada 494 → no hace falta transcodificar para ver desde fuera |
| Docker Desktop | se usa para instalar en la tele (imagen `ghcr.io/georift/install-jellyfin-tizen`). Se cuelga por sockets AF_UNIX huérfanos: `C:/scripts/WinKlean/docker-arreglar-sockets.ps1` |
| Otros servidores en el mismo equipo | Plex y Jellyfin (clave API Jellyfin en transcritos) — se usaron para migrar el historial de visionado |
| Pipeline de codificación | `C:\scripts` (independiente; comparte `E:\`; reescribe películas en su sitio, por eso la caché de sondeo caduca por tamaño+fecha). Se reutiliza `subsfetch.py` |

Herramientas de compilación:

| Herramienta | Ruta |
|---|---|
| Node 26 (ejecuta TypeScript nativo) | en PATH del usuario (no en el entorno de logon: por eso `config.ts` busca rutas absolutas) |
| ffmpeg/ffprobe | `C:/Users/HTPC/AppData/Local/Microsoft/WinGet/Links`, `C:/ffmpeg/bin` |
| Python 3.14 | `C:/Users/HTPC/AppData/Local/Programs/Python/Python314` (faster-whisper, chromaprint, scripts) |
| JDK 17 | `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot` |
| Android SDK | `C:\android-sdk` (plataforma 35, build-tools 35.0.0, emulador AVD `tvwatch`: Pixel 6, Android 15, x86_64) |
| Gradle 8.10.2 | `C:\gradle\gradle-8.10.2` |
| Tizen CLI / sdb | dentro del contenedor Docker (no hay Tizen Studio instalado) |

---

## 3. Estructura de carpetas y ficheros

Raíz `C:\tvwatch` (monorepo npm con workspaces `server`, `web`, `tv`; `android` va aparte con Gradle).

```
C:\tvwatch
├── package.json               workspaces + scripts: dev, start, build, scan, build:tv
├── package-lock.json
├── README.md                  README general (qué es, reproducción, ajustes, atajos)
├── MEDIAWATCH-PROYECTO.md     este dosier
├── vigilar-servidor.ps1       vigilante: arranca/reinicia el servidor cada minuto (carpeta Inicio)
├── .gitignore                 node_modules, data/, dist, .wgt, .apk, build de Android, local.properties
├── .claude/launch.json        arranque del servidor para la vista previa (node server/src/index.ts, puerto 8730)
├── data/                      (NO en git) BD, config, arte, cachés, logs
├── server/                    API Fastify (Node 26 + TypeScript sin compilar)
├── web/                       cliente web React
├── tv/                        cliente Tizen
└── android/                   cliente Android nativo
```

### 3.1 `data/` (no versionado; 3,9 GB)

| Fichero/carpeta | Qué es |
|---|---|
| `config.json` | Configuración: puerto, bibliotecas, rutas de herramientas, `hwaccel`, `transcodeQuality`, `tonemap`, `tmdbApiKey`, `tmdbLanguage`, `omdbApiKey`, `publicUrl`, `fanartApiKey`, `tvdbApiKey`. **Las claves viven aquí y solo aquí** |
| `tvwatch.db` (+ `-wal`, `-shm`) | SQLite (150 MB), WAL |
| `artwork/<itemId>/` | Imágenes bajadas (póster, fondo, logo, apaisada, disco) — 1.546 carpetas, 1,7 GB. Nunca se escribe en `E:\` |
| `artwork/personas/<id>.jpg` | Fotos de reparto bajadas de TMDb |
| `cache/` | Miniaturas redimensionadas (1,9 GB) |
| `trickplay/` | Tiras de fotogramas para la barra (129 MB) |
| `copias/` | Copias de seguridad de la BD (`tvwatch-2026-09-13-17-34-39.db`) |
| `server.log`, `server.err`, `vigilante.log`, `completar-arte.log`, `completar-personas.log` | Registros |

Bibliotecas configuradas (todas en `E:\`): Películas, Animación (`Pelis Animacion`),
Peques, Documentales (`Docupelis`), Conciertos, Monólogos → tipo `movie`; Series,
Docuseries, Series Peques → tipo `show`.

### 3.2 `server/`

`server/package.json` (deps: fastify, @fastify/static, @fastify/cookie,
fast-xml-parser, qrcode; scripts `start`, `dev`, `scan`, `arte`, `personas`).
Node ejecuta `src/index.ts` directamente: **no hay paso de compilación**.

| Fichero | Líneas | Qué hace |
|---|---|---|
| `src/index.ts` | 227 | Arranque Fastify; CORS (el preflight **con `return`**); gancho global de autenticación (solo abiertas `/api/users`, `/api/auth/*`, `/api/qr.svg`); `trustProxy` acotado a localhost; `uncaughtException`/`unhandledRejection` capturados; escaneo automático cada 24 h y a los 20 s de arrancar; sirve `web/dist` y `/tv/`; `CINETECA_LOG=1` registra peticiones; registra todas las rutas |
| `src/config.ts` | 142 | Lee `data/config.json`; localiza ffmpeg/ffprobe/python por rutas absolutas (el entorno de logon no tiene PATH); `DATA_DIR` |
| `src/db.ts` | 368 | Esquema y migraciones (`ALTER TABLE` idempotentes); `DatabaseSync` con `timeout: 10000` (CLI y servidor a la vez); `normalize()` (sin tildes) |
| `src/media/transcode.ts` | 323 | `planPlayback()`: directa / remux / transcodificar según `ClientCaps` (códecs, `maxHeight`, `maxHeightHevc`, `hevc10`, `maxKbps`); ffmpeg QSV (`vpp_qsv=format=nv12`, tonemap HDR), VBR con `-b:v/-maxrate/-bufsize` (ICQ ignora `-maxrate`), `+delay_moov` para AC3 en fMP4, downmix con canal central por índice (`c2`), modo noche (`acompressor`+`alimiter level=false`), `adelay`/`atrim` para desfases, sesiones con `sesion` (aparato) |
| `src/media/hls.ts` | 342 | HLS VOD con escalera de calidades, segmentación exacta por GOP (`-g`/`-forced_idr`, h264_qsv ignora `-force_key_frames`), `surround=1` (AC3/DD+ copiados o DD+ 5.1 para Chromecast), caché de segmentos |
| `src/media/probe.ts` | 234 | ffprobe con caché por tamaño+fecha; `duracionFiable()` (descarta duraciones imposibles); detecta Atmos en `profile`; pistas de audio/subs |
| `src/media/capabilities.ts` | 238 | Detección de hardware codificando **ficheros reales** de la biblioteca (no sintéticos): qué codificador, tonemap, velocidad |
| `src/media/trickplay.ts` | 332 | Tiras de miniaturas por fotogramas clave; tiempos de `showinfo`; lote con `ocupado` |
| `src/media/intros.ts` | 217 | Detección de cabeceras/créditos por chromaprint (`scripts/intros.py`) |
| `src/media/resync.ts` | 101 | Resincronía de subtítulos contra el audio (`scripts/resync.py`, correlación) |
| `src/media/transcribe.ts` | 195 | Cola de transcripción Whisper (`scripts/transcribe.py`), solo ficheros sin subtítulos, idioma de la pista |
| `src/media/images.ts` | 73 | Miniaturas con ffmpeg, cola limitada |
| `src/media/omdb.ts` | 141 | Rellena notas IMDb/RT/TMDb/TVDB que faltan (sobre todo series) |
| `src/media/calidad.ts` | 166 | Detector de copias malas (bitrate/resolución/códec) |
| `src/media/estadisticas.ts` | 175 | Estadísticas: biblioteca, actividad, problemas |
| `src/media/historial.ts` | 94 | Tabla `playbacks` (una fila por visionado, con `sesion`) |
| `src/media/descargas.ts` | 210 | Copias ligeras para ver sin conexión (web; en Android descartado) |
| `src/media/ocupado.ts` | 46 | «Hay alguien viendo»: los lotes no compiten con el disco de 12 TB |
| `src/media/avisos.ts` | 40 | Colas por sesión de mensaje/parar del administrador |
| `src/routes/auth.ts` | 400 | Login por PIN (`^\d{6,}$`), sesiones (bearer, `?token=`, cookie), emparejado de aparatos (`/device/start|claim|poll`, QR), `sesionDe()`, caducidad con `strftime` ISO, freno de fuerza bruta (5 fallos → 15 min), reglas «desde fuera» por `X-Forwarded-*`, UA `okhttp` = Android |
| `src/routes/library.ts` | 634 | Bibliotecas, portada, títulos (orden, género, `unwatched`), ficha, sagas, personas, favoritos, visto, progreso (upsert con `IS` por el NULL), «continuar» global y por biblioteca, similares, borrado de carpeta (solo admin, confirmando el título, solo dentro de una biblioteca), `discart`, `has_discart` |
| `src/routes/play.ts` | 729 | `/info` (plan), `/stream` (directo/remux/pipe, `?raw=1`, `?t=N` corte con `-c copy` para AVPlay, perfil `samsung2021` → DD+ 5.1), HLS, subtítulos WebVTT (`?desde=` desplaza tiempos), desfases, resync, trickplay, sesiones, `cortarAparato()` |
| `src/routes/enrich.ts` | 130 | Scraper TMDb: candidatos con confianza, aplicar, descartar (admin), buscar por título, `arte` (elegir póster/fondo/logo/apaisada/disco) |
| `src/routes/subtitles.ts` | 164 | Buscar/descargar (`subsfetch.py`), transcribir, faltantes |
| `src/routes/preferences.ts` | 131 | Preferencias por usuario y ajustes del servidor |
| `src/routes/anime.ts` | 138 | Identificar anime (Kitsu/MAL/AniList) y renumerar con plan previo |
| `src/routes/mando.ts` | 113 | El móvil como mando: `POST /mando/buscar`, `POST /mando/reproducir`, `GET /mando` (`?tele=1` para que solo la tele consuma órdenes) + avisos |
| `src/routes/actividad.ts` | 109 | Pestaña Actividad (admin): lista, mensaje, parar, cerrar sesión |
| `src/routes/descargas.ts` | 73 | Entrega con rangos |
| `src/scanner/scan.ts` | 506 | Recorre bibliotecas, lee NFO y arte del disco, `rescanItem()`, respeta `arte_fijado` |
| `src/scanner/nfo.ts` | 245 | Parser de NFO de tinyMediaManager (fast-xml-parser) |
| `src/scanner/tmdb.ts` | 447 | Propuestas, imágenes (merge con fanart.tv), `descargar()`, ids externos |
| `src/scanner/fanart.ts` | 396 | fanart.tv: rellenar y sustituir logos/apaisadas en otros idiomas; discart (prefiere Blu-ray); firmas 32×32 con ffmpeg (distancia <12 = misma imagen); `arte_revisado` 30 días |
| `src/scanner/tvdb.ts` | 86 | TheTVDB v4: segunda fuente de logos con idioma |
| `src/scanner/people.ts` | 89 | Biografía/foto de una persona por `tmdb_id` guardado |
| `src/scanner/personas.ts` | 119 | Créditos por título → fotos e ids de todo el reparto (`personas_revisadas`) |
| `src/scanner/dialogue.ts` | 271 | Índice FTS5 de subtítulos (UTF-8 y UTF-16 con BOM), en segundo plano, con progreso |
| `src/scanner/anime.ts` | 384 | Fuentes de anime (Kitsu en `kitsu.app`; AniList y Jikan caídas) |
| `src/scanner/numeracion.ts` | 239 | Renumerar episodios (1..243 → temporadas) |
| `src/cli/scan.ts` | 31 | `npm run scan` |
| `src/cli/index-dialogue.ts` | 18 | Indexar diálogos desde consola |
| `src/cli/completar-arte.ts` | 43 | `npm run arte` (`--sustituir`, `--forzar`) — pasada en lote de fanart.tv/TVDB/TMDb |
| `src/cli/completar-personas.ts` | 24 | `npm run personas` |
| `scripts/intros.py` | | Huellas chromaprint entre episodios |
| `scripts/resync.py` | | Correlación subtítulo/audio |
| `scripts/transcribe.py` | | faster-whisper (CPU, int8, 14 hilos; small ≈ 10× tiempo real, medium ≈ 1×) |

**Tablas de la BD**: `libraries`, `items`, `item_ratings`, `episodes`,
`media_files`, `audio_tracks`, `sub_tracks`, `genres`, `item_genres`, `people`,
`people_details`, `item_people`, `users`, `sessions`, `progress`, `sub_offsets`,
`preferences`, `favorites`, `playbacks`, `descargas`, `skip_ranges` (cabeceras/créditos),
`dialogue_files` y la virtual FTS5 `dialogue` (creadas en `scanner/dialogue.ts`).
Columnas añadidas por migración que importan: `items.arte_fijado`, `tvdb_id`,
`discart`, `arte_revisado`, `personas_revisadas`; `playbacks.sesion`;
`people_details.tmdb_id`; índice único parcial en `progress` para `episode_id IS NULL`.

**Rutas de la API** (todas bajo `/api`, todas autenticadas salvo las de entrada):
`auth/login|logout|device/start|device/claim|device/poll|dispositivos`, `users`,
`users/:id/pin`, `me`, `servidor`, `qr.svg`, `libraries`, `libraries/:id/continuar`,
`home`, `items`, `items/:id`, `items/:id/favorite|watched`, `DELETE items/:id`,
`collections`, `collections/:name`, `genres`, `favorites`, `people/:id`,
`people/:id/thumb`, `episodes/:id/thumb|skip`, `search`, `search/dialogue`,
`progress`, `preferences`, `server-settings`, `play/:fileId/info|stream|subtitle/:trackId|offsets|resync|trickplay|hls/*`,
`subtitles/*`, `enrich/*`, `anime/*`, `numeracion/*`, `omdb/*`, `skip/*`,
`trickplay/*`, `dialogue/*`, `capabilities`, `calidad`, `estadisticas`, `stats`,
`scan`, `scan/stream`, `sessions`, `descargas`, `mando`, `mando/buscar|reproducir`,
`actividad`, `actividad/:sesion/mensaje|parar`.

### 3.3 `web/`

React 19 + Vite 6 + Tailwind v4 + `motion` + `@tanstack/react-query` + `hls.js`;
fuente Inter variable. `npm run build` deja `web/dist`, que sirve el servidor.

| Fichero | Qué es |
|---|---|
| `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json` | Proyecto Vite |
| `public/manifest.webmanifest`, `sw.js`, `icon-512.png`, `apple-touch-icon.png` | PWA «Media Watch» (icono nuevo) |
| `src/main.tsx`, `src/App.tsx` | Arranque, rutas perezosas, proveedor de preferencias |
| `src/styles.css` | Tailwind + utilidades (`layer-promote`, shimmer, cue de subtítulos) |
| `src/lib/api.ts` (620) | Cliente de la API (`request()` pone `Content-Type` cuando hay cuerpo), tipos, `img.*` (incl. `discart`), actividad, mando |
| `src/lib/preferences.tsx` | Preferencias (calidad, HLS, subtítulos, saltos…) |
| `src/lib/format.ts`, `tint.ts`, `vtt.ts` | Formato de tiempos, color dominante, desplazar VTT |
| `src/pages/Home.tsx`, `Library.tsx`, `Detail.tsx` (629), `Person.tsx`, `Search.tsx`, `Favorites.tsx`, `Collections.tsx` | Navegación de la biblioteca |
| `src/pages/Player.tsx` (823) | Reproductor: directo/pipe/HLS, pistas, desfases (`G`/`H`), miniaturas al pasar por la barra, saltar cabecera/créditos, capítulos, avisos del admin cada 5 s, disc art encima de la barra |
| `src/pages/Settings.tsx` (592) | Ajustes: reproducción, biblioteca (escanear, emparejar tele, PIN), análisis, **Actividad** (admin) |
| `src/pages/Login.tsx`, `Pair.tsx` | Perfiles con PIN; destino del QR de la tele |
| `src/pages/Estadisticas.tsx`, `Descargas.tsx` | Tautulli-lite; descargas |
| `src/components/Sidebar.tsx` | Menú lateral estilo Plex, colapsable, reordenable |
| `src/components/Hero.tsx`, `Row.tsx`, `PosterCard.tsx`, `Controls.tsx` | Portada, filas, carátulas (sin `motion` a propósito), controles |
| `src/components/MetadataReview.tsx`, `SelectorDeArte.tsx`, `AnimeFixer.tsx`, `NumeracionFixer.tsx`, `AnalysisPanels.tsx`, `Actividad.tsx` | Revisión de metadatos con confianza, elegir arte (póster/fondo/logo/apaisada), anime, renumerar, paneles de análisis (diálogos con barra de progreso, miniaturas, cabeceras, OMDb…), actividad |

### 3.4 `tv/` (Tizen)

| Fichero | Qué es |
|---|---|
| `vite.config.ts` | Plugin Tizen: quita `crossorigin`, `type="module"` → `defer`, enlaza `app.css`; `target es2016`, `iife`, `cssTarget chrome76` |
| `index.html`, `tsconfig.json`, `package.json` | Proyecto |
| `public/config.xml` | `<name>Media Watch</name>`, id `Cineteca01.Cineteca`, privilegios internet/avplay/tv.inputdevice, **CSP explícita** (`style-src 'unsafe-inline'`) |
| `public/icon.png` | Icono |
| `public/app.css` | Todo el CSS (lienzo fijo 1920×1080, paleta, `will-change` en láminas, OSD, `.osd .disco`, chips `.etiqueta-tec.elegida`) |
| `src/main.ts` (2.970) | Todas las pantallas: conexión/emparejado, portada (héroe rotatorio), bibliotecas, ficha (chips de pistas marcando la elegida), persona, sagas, buscar (recibe texto del móvil), favoritos, ajustes (orden del menú, rendimiento, hora de fin…), reproductor (OSD 5 s, capítulos, saltar tramo, info, avisos, disco), `escucharAlMovil()` cada 2 s |
| `src/nav.ts` (352) | Navegación espacial: geometría cacheada (`offsetLeft/Top`), lienzo con `transform`, vertical por posición visible, aislamiento del menú |
| `src/player.ts` (468) | AVPlay: `raw=1`, `?t=N` para saltar, orden `play()` → pistas → seek, `setSilentSubtitle`, subtítulos pintados por la app, DD+ pasa en crudo |
| `src/api.ts` (299) | Cliente con token en cabecera y en URL de imágenes/vídeo; `mando(?tele=1)`, `avisos`, `yo` |
| `src/ajustes.ts` (144) | Preferencias locales de la tele (`rendimiento: 'rapido'` por defecto), migración `recolocarAjustes()` |
| `inspect.mjs` | Cliente del inspector remoto (CDP) para probar sin mirar la tele |
| `Cineteca.wgt` | Paquete antiguo (05/09). Los actuales se generan dentro del contenedor |

### 3.5 `android/` (Media Watch)

`app/build.gradle.kts`: `compileSdk 35`, `minSdk 26`, **`versionCode 10`,
`versionName "3.7"`**; deps: Compose (Material3, navigation 2.8.4), Coil 2.7,
Media3 1.5.0 (exoplayer, ui, session), OkHttp 4.12, kotlinx-serialization,
AppCompat 1.7, mediarouter 1.7, play-services-cast-framework 21.5.0.
Firmada con la clave de depuración a propósito (estable en este equipo).

| Fichero | Qué es |
|---|---|
| `AndroidManifest.xml` | Label «Media Watch», `Principal` (AppCompat, tema Cast), `ReproduccionService` (foreground media playback), `ControlDeCast`, permisos red/notificaciones, `red.xml` (cleartext en casa), banner |
| `Principal.kt` (457) | `AppCompatActivity`, `CastContext`, `ModalNavigationDrawer` + `NavHost` (portada, biblioteca, ficha, persona, buscar, favoritas, sagas, saga, reproductor, conexión), `BackHandler` del cajón **después** del drawer, `reproducir()` → Cast o reproductor |
| `ReproduccionService.kt` | `MediaSessionService` con ExoPlayer (Bearer, foco de audio, carátula en la notificación) |
| `Cast.kt` | Chromecast: HLS con token, `surround=1` opcional, subtítulos WebVTT, `ExpandedControllerActivity`, botón de ruta |
| `datos/Api.kt` (533) | Cliente OkHttp de la API, modelos |
| `datos/Servidor.kt` | Casa vs fuera: prueba la local 700 ms, cae a `publicUrl`, cachea 30 s |
| `datos/Ajustes.kt` | Servidor, sesión, calidad casa/fuera, `castCincoUno`, `esAdmin`; dominios ⇒ https |
| `datos/Calidad.kt` | Escalera de calidades |
| `datos/Capacidades.kt` | `MediaCodecList` → `perfil=lista:...&hevc=1&maxHeightHevc=...&maxKbps` |
| `datos/Cache.kt` | Última respuesta y destacado, para volver sin recargar |
| `ui/Portada.kt` | Héroe con `HorizontalPager`, aleatorio entre películas y series, 8 s, arrastrable |
| `ui/Biblioteca.kt` | Rejilla paginada, orden (A–Z, Recientes, Año, Nota, Al azar), Sin ver, Género |
| `ui/Ficha.kt` | Ficha con temporadas, reparto, «Ver en la tele», imágenes (admin) |
| `ui/Reproductor.kt` (1.119) | Reproductor: `MediaController`, controles propios (5 s), saltos con debounce 450 ms, vigilante 20 s, pistas y calidad, subtítulos WebVTT `?desde=`, episodio siguiente con cuenta atrás, avisos del admin, disco quieto sobre la barra |
| `ui/Buscar.kt` | Títulos/personas/frases; «Enviar a la tele» y modo «Tecleando en la tele» (500 ms) |
| `ui/Menu.kt` | Cajón: Inicio, Buscar, Favoritas, Sagas, bibliotecas, perfil, «Chromecast: sonido 5.1», cambiar perfil/servidor, versión al pie |
| `ui/Sagas.kt`, `Persona.kt`, `Favoritas.kt`, `SelectorDeArte.kt`, `Conexion.kt`, `Comunes.kt`, `Tema.kt` | Resto de pantallas, selector de arte (+Apaisada), conexión/emparejado, componentes y tema (paleta del icono: fondo `#09090C`, realce ámbar) |
| `res/mipmap-*`, `mipmap-anydpi-v26/ic_launcher.xml` | Icono adaptativo generado del JPEG de Gemini (`scratchpad/icono.py`) |
| `MediaWatch-3.7.apk` | APK entregado (última versión). `TvWatch.apk` es la 1.x |

---

## 4. Cómo se arranca, compila e instala

```bash
# Servidor (queda en http://localhost:8730; lo vigila vigilar-servidor.ps1 desde Inicio, ~45 s en volver)
cd /c/tvwatch && npm start

# Desarrollo con recarga (servidor + web)
npm run dev

# Web y tele
npm run build            # web/dist y tv/dist
cd tv && npm run build   # solo tele

# Escáner, arte, personas, diálogos
npm run scan
cd server && npm run arte -- --sustituir
cd server && npm run personas
```

**Android** (release, entregada como `MediaWatch-<ver>.apk`; subir `versionCode` y `versionName` antes):

```bash
cd /c/tvwatch/android && JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot" /c/gradle/gradle-8.10.2/bin/gradle.bat --no-daemon :app:assembleRelease
```

**Tele** (empaquetar+firmar+instalar en la misma ejecución; `--network host` obligatorio; perfil `dev` de la imagen; renombrar el `.wgt` porque el espacio de «Media Watch» rompe la instalación):

```bash
docker info >/dev/null 2>&1 || pwsh -NoProfile -ExecutionPolicy Bypass -File C:/scripts/WinKlean/docker-arreglar-sockets.ps1
MSYS_NO_PATHCONV=1 docker run --rm --network host -v "C:/tvwatch/tv:/app" --entrypoint sh ghcr.io/georift/install-jellyfin-tizen:latest -c '
export PATH=$PATH:/tizen-studio/tools:/tizen-studio/tools/ide/bin
sdb connect 192.168.31.117 >/dev/null 2>&1
TELE=$(sdb devices | grep -v "List of" | awk "{print \$3}" | head -1)
mkdir -p /build && cp -r /app/dist/* /build/ && cd /build
tizen build-web -- /build >/dev/null 2>&1
tizen package -t wgt -s dev -- /build/.buildResult
mv "/build/.buildResult/Media Watch.wgt" "/build/.buildResult/MediaWatch.wgt"
tizen install -n MediaWatch.wgt -t "$TELE" -- /build/.buildResult
sdb shell 0 was_kill Cineteca01.Cineteca   # cerrar la app para que la tele vuelva a su entrada
'
```

Probar la tele sin verla: `sdb shell 0 debug Cineteca01.Cineteca` → inspector CDP
en `http://192.168.31.117:PUERTO/json` (sin `sdb forward`); `Runtime.evaluate`
funciona, `Page.captureScreenshot` **no**. Emulador Android: skill `probar-app-android`.

Acceso externo: Caddy lo reinicia el usuario (`Stop-Process -Name caddy -Force; Start-ScheduledTask -TaskName 'Caddy - proxy inverso Jellyfin'`).
Para otro perfil desde fuera: crear el perfil con PIN (≥6 cifras) en casa; en
la app pone `tv.micasa.duckdns.org` (la app lo trata como https), elige el
perfil y el PIN; una sesión abierta ya funciona desde cualquier sitio. El
perfil «Casa» (admin) no tiene PIN y **no puede entrar desde fuera** a propósito.

---

## 5. Cronología del proyecto

### 04/09/2026 — nace Cineteca
- Petición inicial: «una app estilo plex/jellyfin, servidor de películas con ffmpeg
  (o lo mejor para mi hardware), para mí y otras personas… lo bueno de jellyfin
  que es open source y no depende de servidores externos». Decisiones: app propia
  desde cero, independiente del pipeline de `C:\scripts`, solo red local por ahora,
  interfaz inspirada en **Infuse** (después menú lateral estilo Plex).
- Stack elegido: Node 26 + TypeScript sin compilar + `node:sqlite` + Fastify; React + Vite.
- Escáner de NFO (31 s la biblioteca entera), reproducción directa/remux/transcode
  con QSV (6,1× tiempo real), detección de hardware con ficheros reales,
  ajustes que hacen algo de verdad, scraper TMDb que propone y no escribe,
  corrección por película, buscador de subtítulos con verificación.
- El usuario pegó la lista de «lo que más pide la gente» y eligió: sagas y
  miniaturas; luego resync de subtítulos, modo noche/diálogos, búsqueda por
  frase, saltar cabeceras/créditos, subtítulos por IA, desfase manual. Clave TMDb.

### 05/09 — la tele y el nombre TvWatch
- Subtítulos por IA solo para ficheros sin subtítulos, fiables antes que rápidos.
- Cliente Tizen: yo dije que no se podía instalar sin Tizen Studio; el usuario
  recordó que ya lo había hecho por Docker → skill `instalar-app-tizen`. Pantalla
  negra por tres causas (crossorigin, sin defer, CSP descartando estilos en línea).
- Fotos de la tele: menú que no aparecía, carátulas cortadas, scroll a tirones,
  héroe estático, aro de foco lento… → geometría cacheada, lienzo con transform,
  sin sombras, modo «rápido». «Si hay que sacrificar algo en lo visual, hazlo».
- Renombrado a **TvWatch** con icono del usuario; menú reordenable; icono al
  contraer; fichas de actor con biografía; rediseño de ficha (meta en negrita
  sobre la sinopsis, etiquetas debajo). Carpeta movida a `C:\tvwatch`.

### 06/09
- Ficha rediseñada a partir de captura de Plex (una columna, logo, géneros,
  sinopsis, director, botones, reparto redondo). Instalación en la tele.
- Auditoría contra apps comerciales; anime (Kitsu; AniList/Jikan caídas),
  renumeración de episodios, estadísticas, PWA + descargas, **HLS adaptativo**,
  investigación de Dolby Vision (97 de 100 ficheros DV son perfil 8.1 → HDR10 en
  la Samsung) y robustez de red.

### 07/09
- Favoritos/visto rotos en la web → **bug de NULL en clave única** de `progress`
  (20 filas por película). Memoria `sqlite-null-en-claves-unicas`.
- «Hazlo, no me pidas permiso»: autenticación global (todo `/api` exige sesión),
  a prueba de caídas, arranque automático (vigilante, la sesión no es admin),
  detector de copias malas. Skills y memorias guardadas.

### 08/09
- La web se quedaba en «quién está viendo» / imágenes que no cargaban → arreglos
  de carga y fluidez de la web.

### 13/09
- «No abre la app en la tv» → rutas absolutas de ffprobe (el logon no tiene PATH);
  «no puede leer las pistas» arreglado. Migración del historial de **Plex** a
  Jellyfin y TvWatch (clave API de Jellyfin).
- Perfil de audio de la tele: DD+ JOC (Atmos) sin tocar por eARC, DTS/TrueHD/FLAC
  → DD+ 5.1 con vídeo copiado; SRT del MKV no se queman. Investigación de la
  marca `default` de pista (AVPlay reproduce la primera; orden `play()` → pistas).
- Seguir viendo global y por biblioteca; botón **Eliminar** rojo con confirmación
  (carpeta entera, también series), escaneo cada 24 h + botón; **«Nada de borrado
  automático»**; relacionadas por género; reparto en fila.
- Reproductor de la tele: no se podía avanzar (AVPlay no busca en HTTP progresivo
  → `?t=N` con `-c copy`), controles play/stop/FF/RW, pistas, info de reproducción.
  Bibliotecas truncadas (Peques acababa en «Merlín») y precarga de carátulas.

### 14/09
- Docker al iniciar sesión (script de sockets). Puntos 2, 4, 6, 7: saltar
  cabeceras/créditos con botón (y escena poscréditos), desfase y tamaño de
  subtítulos, capítulos, normalización de volumen. Miniaturas y cabeceras en lote.
- Pantalla negra con audio en la tele → **el vídeo va por debajo de la página**:
  fondos transparentes (`body.viendo`). Fila de botones seguida con Eliminar al final.
- Máxima calidad y fluidez «como Apple TV»; notas de IMDb/RT/TMDb/TVDB por **OMDb**
  (clave del usuario). Judder en Plex mientras trabajaba → parar todo lo pesado.

### 15/09
- Continuar reproducción salía al home → arreglado. Revisión anticipando fallos;
  hora de fin en el OSD; buscar desde el móvil (`/api/mando`).
- **App Android**: primera versión (WebView/PWA) rechazada («es basura») → app
  nativa por fases (Kotlin/Compose, Android 13+): fase 1 (API, portada,
  bibliotecas, fichas), fase 2 (ExoPlayer, progreso, pistas, saltar cabecera),
  fase 3 (buscar, menú, favoritas). Emulador montado; skill `probar-app-android`.
- **Acceso desde fuera**: Caddy + DuckDNS (`tv.micasa.duckdns.org`), reglas
  «desde fuera» por cabeceras del proxy, PIN elegido por el usuario, doble
  dirección automática en la app (`/api/servidor`). Skill `acceso-externo-tvwatch`.
- Editar metadatos como Plex: **selector de arte** (póster/fondo/logo) web y app;
  el escáner pisaba lo elegido → `arte_fijado`. Sesión paralela: intento de que
  tinyMediaManager scrapee logos en español/inglés por CLI (fanart.tv).
- Revisión estética «profesional, estilo Apple, con identidad propia».

### 16/09 — Media Watch
- Android: menú hamburguesa, flecha atrás en el reproductor, comparativa con
  Plex/Jellyfin/Infuse; indexado de diálogos «no hacía nada» → contador
  corregido, barra de progreso, en segundo plano, SRT UTF-16 (1,32 M frases).
  iOS: no hay app; se explica PWA/Infuse-like como opción.
- Orden elegido «9, 1…5, 7, 8» (6 = PiP descartado): calidad a mano, sesión de
  medios/pantalla de bloqueo, subtítulos al transcodificar, episodio siguiente,
  orden y filtros, sagas, Chromecast (subtítulos WebVTT + 5.1 con `surround=1`),
  fotos de reparto en buscar.
- Saltos que se atragantaban y barra difícil de coger → debounce, vigilante,
  controles propios; Chromecast no ve la Samsung (no es receptor Cast) → **«Ver
  en la tele»** con la app de Tizen como receptor. Limpieza/optimización general.
- Prompt para Gemini → icono nuevo integrado; **renombrado a Media Watch**
  (Android, `config.xml`, web, servidor).
- Héroe del móvil rotando al azar entre películas y series, arrastrable.
- Claves de **fanart.tv, TMDb y TVDB**: pasada en lote **por script** (no UI, el
  usuario lo corrigió): 1.439 discos, 384 apaisadas, 16 logos, 13 sustituidos;
  el disco sí se muestra en web/TV/Android. Personas: 60.258 identificadas,
  3.884 fotos (`npm run personas`).
- **Cada APK con versión nueva** (3.1, 3.2… / 4.0); explicación de acceso para
  otros perfiles; otros perfiles no borran; **PIN mínimo 6 cifras**; pestaña
  **Actividad** (admin) con mensaje/parar.
- Revisión completa de la app de la tele por el inspector (harness CDP, medido
  210 ms de parón por tecla → 90 ms quitando sombras); bugs: navegación vertical
  al mismo índice → por posición visible; parpadeo de la barra de progreso →
  capa propia; escribir búsquedas desde el móvil en vivo.
- Chips de audio/subtítulos marcando la pista elegida; Ajustes bajo Favoritos (5
  fijos, luego bibliotecas); foco que se queda al reordenar; fotos/biografías por id.
- Disc art: con los controles (5 s) y en pausa; luego **quieto y encima del
  título/barra** en los tres clientes (TV instalada y cerrada; APK **3.7**).
- Este dosier.

---

## 6. Git

- Repositorio en `C:\tvwatch` (un único repo para servidor, web, tele y Android).
- **Un solo commit**: `737dede` (16/09/2026) «Commit inicial: Media Watch
  (servidor, web, Tizen y Android)».
- **Cambios sin commitear** (16/09 noche, tras el commit): Android
  (`build.gradle.kts` 3.7, `Api.kt`, `Buscar.kt`, `Reproductor.kt`), servidor
  (`package.json`, `db.ts`, `index.ts`, `historial.ts`, `transcode.ts`, `auth.ts`,
  `library.ts`, `mando.ts`, `play.ts`, `people.ts` y nuevos `cli/completar-personas.ts`,
  `media/avisos.ts`, `routes/actividad.ts`, `scanner/personas.ts`), tele
  (`app.css`, `ajustes.ts`, `api.ts`, `main.ts`, `nav.ts`, `player.ts`), web
  (`lib/api.ts`, `Player.tsx`, `Settings.tsx`, `styles.css`, nuevo
  `components/Actividad.tsx`). Corresponden a: actividad/avisos, PIN de 6 cifras,
  sesiones con strftime, escritura en vivo desde el móvil, chips de pistas,
  Ajustes bajo Favoritos, personas por id, disco quieto, versión 3.7.
- `.gitignore`: `node_modules/`, `data/` (claves, BD, arte, cachés), `web/dist/`,
  `tv/dist/`, `tv/*.wgt`, `android/app/build/`, `android/.gradle/`,
  `android/local.properties`, `*.apk`, `__pycache__/`.
- Atribución de commits acordada: terminar con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Sugerencia pendiente: hacer un segundo commit con lo anterior («Actividad, PIN
  de 6 cifras, disco quieto, Media Watch 3.7»).

---

## 7. Trampas ya pagadas (no se ven leyendo el código)

Servidor / SQLite
- **Dos NULL no son iguales en SQLite**: `ON CONFLICT` sobre clave con columna
  nulable no salta → filas duplicadas. Usar `UPDATE … WHERE col IS ?` + insert si
  `changes === 0`, e índice único parcial.
- `COALESCE` no protege del cero; un 0 desde el cliente pisó 107 duraciones.
- `datetime('now')` (espacio) no se compara con ISO (`T`): usar
  `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- Un `spawn` sin `on('error')` tumba el servidor entero (había siete).
- Node 26 ejecuta TS: una comilla invertida suelta en una plantilla rompe el arranque.
- El preflight CORS necesita `return reply.code(204).send()`; sin `return`, con el
  gancho de autenticación detrás, la petición se colgaba (solo lo notaba la tele).
- El entorno de logon no tiene PATH → rutas absolutas de ffmpeg/ffprobe/python.
- h264_qsv ignora `-force_key_frames` (usar `-g`/`-forced_idr`) y `-global_quality`
  ignora `-maxrate` (usar VBR con `-b:v`). AC3 copiado a fMP4 necesita `+delay_moov`.
- HEVC Main10 → h264_qsv necesita `vpp_qsv=format=nv12`. `aresample=async=1`
  deshace los desfases deliberados. `alimiter` necesita `level=false`.
- El índice del contenedor miente sobre fotogramas clave (1489 vs 1391 reales):
  tiempos de trickplay desde `showinfo`.
- Detección de hardware con vídeo sintético miente (48× vs 3,9× real).
- El escáner pisaba el arte elegido a mano → `arte_fijado`. `findArt` con comodín
  vacío elegía el banner de «Magnolia». El arte se llama como la *release*, no como el vídeo.
- Contadores que restan tablas distintas mienten (1.307 «pendientes» eran 33).
  Trabajo síncrono largo en `queueMicrotask` bloquea Fastify.
- SRT UTF-16 con BOM: mirar los dos primeros bytes antes de decodificar.
- Los idiomas de fanart.tv no son fiables: comparar firmas con candidatas
  es/en/neutras antes de sustituir.
- CLI y servidor a la vez → `database is locked`: `DatabaseSync(..., {timeout: 10000})`.
- En la web, `request()` sin `Content-Type` → 400 mudo (pasó dos veces).

Tele (Tizen / AVPlay)
- Samsung no tiene Dolby Vision (usa HDR10/HDR10+); 2021 no decodifica DTS/TrueHD/FLAC.
- AVPlay reproduce la **primera** pista; `seekTo`/`setSelectTrack` antes de
  `play()` clavan el reproductor; no busca en MKV por HTTP progresivo → `?t=N`.
- Solo expone una pista de texto; audio sin idioma (los nombres los pone el servidor).
- **El vídeo se pinta por debajo de la página**: `html`/`body`/reproductor transparentes.
- AVPlay no dibuja subtítulos: la app los pinta; `setSilentSubtitle(true)` para apagar.
- CSP descarta estilos en línea; `crossorigin` y falta de `defer` dejan la pantalla negra.
- App en segundo plano = todo `fetch` colgado (`document.visibilityState === 'hidden'`).
- `<img>` no manda cabeceras: token en la URL. Sombras en 190 carátulas = 210 ms por tecla.
- El `.wgt` con espacio en el nombre no se instala; `-t` es el nombre del dispositivo, no la IP.
- Mezclar Docker con y sin `--network host` deja la sesión sdb atada.

Android
- El `BackHandler` que gana es el último compuesto (el del cajón va después del drawer).
- Por tubería ExoPlayer no sabe la duración → controles propios.
- Encadenar episodios navegando a la misma ruta rompe: estado dentro de la pantalla.
- `adb shell input text` corta en el primer espacio. Créditos duplicados → `distinctBy`.
- La QN93A no es receptor de Google Cast: «Ver en la tele» por `/api/mando`.

Herramientas de la sesión
- El Bash de Claude estropea comillas invertidas en heredocs → escribir scripts
  con Write y ejecutarlos. `node -e` destroza comillas en Windows → `.mjs`.
- Docker Desktop en bucle por sockets huérfanos → script `docker-arreglar-sockets.ps1`.
- La app Claude «archivo en uso» → servicio `CoworkVMService` (`Restart-Service CoworkVMService -Force`).

---

## 8. Reglas de trabajo del usuario (feedback acumulado)

- **Medir en vez de suponer**: ejecutar contra la biblioteca real y enseñar la cifra.
- **Avisar mientras se trabaja**: en tandas largas, decir qué se hace y qué va saliendo
  («no veo movimiento», «ni siquiera contestas» fueron quejas).
- **No pedir permiso para lo ya acordado** («hazlo, no me pidas permiso»), pero
  **no instalar ni relanzar en la tele mientras la está viendo**: él avisa cuando está libre.
- **Nada de borrado automático.** Eliminar solo a mano, en rojo, con confirmación, solo admin.
- **Nunca tocar las carpetas de la biblioteca** (`E:\`): el arte va a `data/artwork/`.
- **El PIN lo elige él**, nunca yo. Restaurar los datos de usuario tocados en pruebas.
- **Mirar las skills y el historial antes de decir «no se puede»** (lo de Docker/Tizen).
- **Trabajos por lotes = script en segundo plano**, no botones en la web/app (lo de fanart).
- **Cada APK entregado con número nuevo** (`MediaWatch-<ver>.apk`; 3.x menor, 4.0 mayor),
  versión visible al pie del menú.
- Estética: fluida por encima de bonita; «profesional, estilo Apple, con identidad propia».
- Los controles del reproductor se ocultan a los **5 s**; en pausa se quedan.
- Las claves de API se guardan en `data/config.json` y no se registran en logs.

---

## 9. Estado actual, pendientes y descartes

**Instalado/entregado a 16/09 noche**: servidor con todo lo anterior en marcha
(vigilante), web compilada y servida, tele con la última compilación (disco
quieto encima del título) instalada y cerrada, `MediaWatch-3.7.apk` entregado.

**Descartado por el usuario**: descargas sin conexión en Android, ventana
flotante (PiP), «Ver en la tele» dentro de la propia app de la tele, indexar
frases desde la UI del móvil.

**Sin probar con aparato real**: Chromecast (el emulador no ve ninguno).

**Ideas y cabos sueltos**:
- Segundo commit con los cambios pendientes.
- iOS/iPad: sin app nativa; la web como PWA es la vía (Safari sin HEVC por
  pipe en algunos casos; pendiente de evaluar Infuse-like).
- 23.005 personas sin foto en ninguna fuente.
- Descargas para la web existen pero no se usan mucho; revisar si se mantienen.
- Notas OMDb: cuota diaria limitada, se rellena por tandas.

---

## 10. Claves, credenciales y dónde viven

No se copian aquí. Todas están en `C:\tvwatch\data\config.json` (fuera de git):
`tmdbApiKey`, `omdbApiKey`, `fanartApiKey`, `tvdbApiKey`, `publicUrl`. La clave
de Jellyfin usada para migrar el historial y las claves aparecen en los
transcritos de sesión de `~/.claude/projects/C--cineteca/`. El perfil «Casa» es
admin sin PIN (solo entra desde casa). La tele se empareja por código/QR y guarda
su propio token.

---

## 11. Memorias y skills de Claude relacionadas

En `C:\Users\HTPC\.claude\projects\C--cineteca\memory\`: `tvwatch-servidor-media`,
`cliente-tizen-qn93a`, `clientes-y-acceso-tvwatch`, `gotchas-tvwatch`,
`sqlite-null-en-claves-unicas`, `fuentes-anime-tvwatch`,
`como-trabaja-el-usuario-tvwatch`, `mirar-las-skills-antes-de-decir-que-no`,
`versionado-app-android`, `servicio-coworkvmservice-bloqueo-claude`.

Skills en `C:\Users\HTPC\.claude\skills\`: `instalar-app-tizen`,
`probar-app-android`, `acceso-externo-tvwatch`, `auditar-tvwatch`,
`editar-webpanel-sin-romperlo`, `operacion-en-lote-biblioteca`, y las del
pipeline (`arc-qsv-facts`, `verificar-transcodificacion-en-lote`, etc.).

Sesiones de Claude Code (transcritos): `6493aa07…` (la principal, 04–16/09),
`0271855e…` (tinyMediaManager/fanart por CLI, 15/09), `be01bbce…` (bloqueo de la
app Claude e instalación en la tele, 15–16/09).
