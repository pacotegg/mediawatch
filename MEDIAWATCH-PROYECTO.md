# Media Watch (antes TvWatch / Cineteca) — dosier completo del proyecto

Estado a **21 de septiembre de 2026** (auditoría completa: bugs corregidos,
mantenimiento al estilo Plex añadido). Este documento es la memoria entera del
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
- **Mantenimiento al estilo Plex** (21/09): copia de seguridad diaria de la BD
  con rotación, limpieza semanal de caché de imágenes sin usar y de carpetas de
  miniaturas huérfanas, y «optimizar base de datos» (VACUUM) a un clic desde
  Ajustes → Servidor.

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
| `cache/images/` | Miniaturas redimensionadas, clave = hash de ruta+mtime+tamaño+ancho (1,9 GB, 63.613 ficheros a 21/09). Sin límite hasta el 21/09: purga semanal por antigüedad desde `media/images.ts` |
| `trickplay/` | Tiras de fotogramas para la barra (129 MB). Carpetas huérfanas (fichero ya retirado) se limpian solas cada semana desde `media/trickplay.ts` |
| `copias/` | Copias de seguridad de la BD, una diaria, `VACUUM INTO` (consistente con WAL abierto), rotando a las 14 más recientes desde el 21/09 (`db.ts`) |
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
| `src/index.ts` | 261 | Arranque Fastify; CORS (el preflight **con `return`**); gancho global de autenticación (solo abiertas `/api/users`, `/api/auth/*`, `/api/qr.svg`); `trustProxy` acotado a localhost; `uncaughtException`/`unhandledRejection` capturados; escaneo automático cada 24 h y a los 20 s de arrancar; **mantenimiento semanal** (huérfanos de trickplay + caché de imágenes) y **copia de seguridad diaria** (21/09); sirve `web/dist` y `/tv/`; `CINETECA_LOG=1` registra peticiones; registra todas las rutas |
| `src/config.ts` | 142 | Lee `data/config.json`; localiza ffmpeg/ffprobe/python por rutas absolutas (el entorno de logon no tiene PATH); `DATA_DIR` |
| `src/db.ts` | 416 | Esquema y migraciones (`ALTER TABLE` idempotentes); `DatabaseSync` con `timeout: 10000` (CLI y servidor a la vez); `normalize()` (sin tildes); (21/09) `backupBaseDeDatos()` (`VACUUM INTO`, rota a 14), `optimizarBaseDeDatos()` (VACUUM+ANALYZE, bloqueante, solo a mano), `tamanoBaseDeDatos()` |
| `src/media/transcode.ts` | 323 | `planPlayback()`: directa / remux / transcodificar según `ClientCaps` (códecs, `maxHeight`, `maxHeightHevc`, `hevc10`, `maxKbps`); ffmpeg QSV (`vpp_qsv=format=nv12`, tonemap HDR), VBR con `-b:v/-maxrate/-bufsize` (ICQ ignora `-maxrate`), `+delay_moov` para AC3 en fMP4, downmix con canal central por índice (`c2`), modo noche (`acompressor`+`alimiter level=false`), `adelay`/`atrim` para desfases, sesiones con `sesion` (aparato) |
| `src/media/hls.ts` | 355 | HLS VOD con escalera de calidades, segmentación exacta por GOP (`-g`/`-forced_idr`, h264_qsv ignora `-force_key_frames`), `surround=1` (AC3/DD+ copiados o DD+ 5.1 para Chromecast), caché de segmentos; (21/09) cada sesión guarda el `dispositivo` que la pidió y `cerrarSesionesDe()` corta las de un aparato — antes «parar» en Actividad no tocaba el ffmpeg de HLS |
| `src/media/probe.ts` | 237 | ffprobe con caché por tamaño+fecha; `duracionFiable()` (descarta duraciones imposibles); detecta Atmos en `profile`; pistas de audio/subs; (21/09) el `UPDATE` del re-sondeo protege `video_codec`/`width`/`height` con `COALESCE`, no solo `hdr` — si ffprobe fallaba a mitad, borraba codec/resolución ya buenos |
| `src/media/capabilities.ts` | 238 | Detección de hardware codificando **ficheros reales** de la biblioteca (no sintéticos): qué codificador, tonemap, velocidad |
| `src/media/trickplay.ts` | 362 | Tiras de miniaturas por fotogramas clave; tiempos de `showinfo`; lote con `ocupado`; (21/09) `limpiarHuerfanas()` borra carpetas de un fichero que ya no existe en `media_files` |
| `src/media/intros.ts` | 217 | Detección de cabeceras/créditos por chromaprint (`scripts/intros.py`) |
| `src/media/resync.ts` | 101 | Resincronía de subtítulos contra el audio (`scripts/resync.py`, correlación) |
| `src/media/transcribe.ts` | 195 | Cola de transcripción Whisper (`scripts/transcribe.py`), solo ficheros sin subtítulos, idioma de la pista |
| `src/media/images.ts` | 112 | Miniaturas con ffmpeg, cola limitada; (21/09) toca el `mtime` en cada acierto de caché y `limpiarCache()` purga lo que lleva 45 días sin pedirse — la clave por hash dejaba huérfana la miniatura vieja en cada cambio de carátula, sin límite |
| `src/media/omdb.ts` | 141 | Rellena notas IMDb/RT/TMDb/TVDB que faltan (sobre todo series) |
| `src/media/calidad.ts` | 166 | Detector de copias malas (bitrate/resolución/códec) |
| `src/media/estadisticas.ts` | 175 | Estadísticas: biblioteca, actividad, problemas |
| `src/media/historial.ts` | 94 | Tabla `playbacks` (una fila por visionado, con `sesion`) |
| `src/media/descargas.ts` | 210 | Copias ligeras para ver sin conexión (web; en Android descartado) |
| `src/media/ocupado.ts` | 46 | «Hay alguien viendo»: los lotes no compiten con el disco de 12 TB |
| `src/media/avisos.ts` | 40 | Colas por sesión de mensaje/parar del administrador |
| `src/routes/auth.ts` | 400 | Login por PIN (`^\d{6,}$`), sesiones (bearer, `?token=`, cookie), emparejado de aparatos (`/device/start|claim|poll`, QR), `sesionDe()`, caducidad con `strftime` ISO, freno de fuerza bruta (5 fallos → 15 min), reglas «desde fuera» por `X-Forwarded-*`, UA `okhttp` = Android |
| `src/routes/library.ts` | 634 | Bibliotecas, portada, títulos (orden, género, `unwatched`), ficha, sagas, personas, favoritos, visto, progreso (upsert con `IS` por el NULL), «continuar» global y por biblioteca, similares, borrado de carpeta (solo admin, confirmando el título, solo dentro de una biblioteca), `discart`, `has_discart` |
| `src/routes/play.ts` | 766 | `/info` (plan), `/stream` (directo/remux/pipe, `?raw=1`, `?t=N` corte con `-c copy` para AVPlay, perfil `samsung2021` → DD+ 5.1), HLS, subtítulos WebVTT (`?desde=` desplaza tiempos), desfases, resync, trickplay, sesiones, `cortarAparato()` (21/09: ahora también corta HLS); (21/09) el subtítulo externo comprueba `file_id`, antes se podía leer el de otro título adivinando el id |
| `src/routes/mantenimiento.ts` | 94 | **Nuevo (21/09)**: `/api/mantenimiento/estado\|limpiar\|optimizar\|copia`, solo admin — tamaños de caché/trickplay/BD, disparar la limpieza, el VACUUM o una copia de seguridad a mano |
| `src/routes/enrich.ts` | 130 | Scraper TMDb: candidatos con confianza, aplicar, descartar (admin), buscar por título, `arte` (elegir póster/fondo/logo/apaisada/disco) |
| `src/routes/subtitles.ts` | 164 | Buscar/descargar (`subsfetch.py`), transcribir, faltantes |
| `src/routes/preferences.ts` | 131 | Preferencias por usuario y ajustes del servidor |
| `src/routes/anime.ts` | 138 | Identificar anime (Kitsu/MAL/AniList) y renumerar con plan previo |
| `src/routes/mando.ts` | 113 | El móvil como mando: `POST /mando/buscar`, `POST /mando/reproducir`, `GET /mando` (`?tele=1` para que solo la tele consuma órdenes) + avisos |
| `src/routes/actividad.ts` | 109 | Pestaña Actividad (admin): lista, mensaje, parar, cerrar sesión |
| `src/routes/descargas.ts` | 73 | Entrega con rangos |
| `src/scanner/scan.ts` | 510 | Recorre bibliotecas, lee NFO y arte del disco, `rescanItem()`, respeta `arte_fijado`; (21/09) la numeración de reserva de episodios (sin `SxxExx` en el nombre) se reinicia por temporada, antes seguía contando desde la temporada anterior |
| `src/scanner/nfo.ts` | 245 | Parser de NFO de tinyMediaManager (fast-xml-parser) |
| `src/scanner/tmdb.ts` | 447 | Propuestas, imágenes (merge con fanart.tv), `descargar()`, ids externos |
| `src/scanner/fanart.ts` | 409 | fanart.tv: rellenar y sustituir logos/apaisadas en otros idiomas; discart (prefiere Blu-ray); firmas 32×32 con ffmpeg (distancia <12 = misma imagen); `arte_revisado` 30 días; (21/09) `firma()` tiene timeout de 15 s (una imagen colgada paraba toda la pasada sin avisar) y la carpeta `_tmp` de comparación se borra al terminar |
| `src/scanner/tvdb.ts` | 86 | TheTVDB v4: segunda fuente de logos con idioma |
| `src/scanner/people.ts` | 93 | Biografía/foto de una persona por `tmdb_id` guardado; (21/09) una biografía vacía (`''`, marca a propósito de «ya comprobado, sin bio») se trataba como *falsy* y volvía a preguntar a TMDb en cada visita a la ficha |
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
`actividad`, `actividad/:sesion/mensaje|parar`, `mantenimiento/estado|limpiar|optimizar|copia` (21/09, solo admin).

### 3.3 `web/`

React 19 + Vite 6 + Tailwind v4 + `motion` + `@tanstack/react-query` + `hls.js`;
fuente Inter variable. `npm run build` deja `web/dist`, que sirve el servidor.

| Fichero | Qué es |
|---|---|
| `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json` | Proyecto Vite |
| `public/manifest.webmanifest`, `sw.js`, `icon-512.png`, `apple-touch-icon.png` | PWA «Media Watch» (icono nuevo) |
| `src/main.tsx`, `src/App.tsx` | Arranque, rutas perezosas, proveedor de preferencias |
| `src/styles.css` | Tailwind + utilidades (`layer-promote`, shimmer, cue de subtítulos) |
| `src/lib/api.ts` (634) | Cliente de la API (`request()` pone `Content-Type` cuando hay cuerpo), tipos, `img.*` (incl. `discart`), actividad, mando; (21/09) `post()` tenía la misma cabecera fija sin cuerpo — rompía `logout()`, `scan()`, `applyCapabilities()`, `stopTranscribe()` con 400 mudo, arreglado; nuevas `mantenimientoEstado/Limpiar/Optimizar/Copia` |
| `src/lib/preferences.tsx` | Preferencias (calidad, HLS, subtítulos, saltos…) |
| `src/lib/format.ts`, `tint.ts`, `vtt.ts` | Formato de tiempos, color dominante, desplazar VTT |
| `src/pages/Home.tsx`, `Library.tsx`, `Detail.tsx` (629), `Person.tsx`, `Search.tsx`, `Favorites.tsx`, `Collections.tsx` | Navegación de la biblioteca |
| `src/pages/Player.tsx` (823) | Reproductor: directo/pipe/HLS, pistas, desfases (`G`/`H`), miniaturas al pasar por la barra, saltar cabecera/créditos, capítulos, avisos del admin cada 5 s, disc art encima de la barra |
| `src/pages/Settings.tsx` (661) | Ajustes: reproducción, biblioteca (escanear, emparejar tele, PIN), análisis, **Actividad** (admin); (21/09) panel **Mantenimiento** en Servidor: tamaños de BD/caché/miniaturas, vaciar caché y huérfanos, copia de seguridad, optimizar BD |
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

#### Rehacer `app/libs/lib-decoder-ffmpeg-release.aar` (22/09)

Ese AAR **va versionado en git** porque no está en Maven: es la extensión de
FFmpeg de media3 compilada a mano, y es lo que permite que un móvil sin licencia
Dolby descodifique AC3, DD+, TrueHD y DTS por su cuenta. Sin él el servidor tiene
que convertir el audio y la reproducción vuelve al modo tubería.

Solo hay que rehacerlo si se sube la versión de media3 (tienen que coincidir).
Requisitos: WSL con `build-essential` y `unzip` (el `sudo apt` lo lanza el
usuario, pide contraseña), y en Windows `ndk;26.1.10909125` (**r26b**, la que
pide la documentación) y `cmake;3.22.1` por `sdkmanager`.

```bash
# 1. En WSL: clonar, bajar el NDK de Linux y compilar (~2m30s, los 4 ABIs)
mkdir -p ~/mw && cd ~/mw
git clone --depth 1 --branch release/6.0 https://github.com/FFmpeg/FFmpeg.git ffmpeg
git clone --depth 1 --branch 1.5.0 https://github.com/androidx/media.git media3
curl -fL -o ndk.zip https://dl.google.com/android/repository/android-ndk-r26b-linux.zip
unzip -q ndk.zip -d ndk
cd ~/mw/media3/libraries/decoder_ffmpeg/src/main/jni && ln -s ~/mw/ffmpeg ffmpeg
./build_ffmpeg.sh ~/mw/media3/libraries/decoder_ffmpeg/src/main ~/mw/ndk/android-ndk-r26b \
  linux-x86_64 21 ac3 eac3 truehd dca flac alac
```

El script oficial compila **los cuatro ABIs** y no deja elegir; se deja así porque
el `x86_64` es el que permite probarlo en el emulador. Luego se copia media3 a
`C:\media3` (sin `.git` y **sin el enlace `jni/ffmpeg`**, que un enlace de WSL no
le sirve a Windows: allí se recrea como carpeta real con los `*.h` de ffmpeg y
`android-libs/`), se pone `local.properties` con `sdk.dir=C:/android-sdk` y:

```bash
cd /c/media3 && JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot" ./gradlew.bat :lib-decoder-ffmpeg:assembleRelease --no-daemon
cp /c/media3/libraries/decoder_ffmpeg/buildout/outputs/aar/lib-decoder-ffmpeg-release.aar /c/tvwatch/android/app/libs/
```

Comprobaciones que **no hay que saltarse**, porque el AAR se genera igual de
grande aunque CMake no haya corrido y entonces no descodifica nada:

```bash
# los decodificadores tienen que estar DENTRO de la librería
llvm-nm --defined-only .../android-libs/arm64-v8a/libavcodec.a | grep -oE "ff_[a-z0-9]+_decoder" | sort -u
# y el .so dentro del APK
unzip -l MediaWatch-<ver>.apk | grep libffmpegJNI
# y en el móvil, al reproducir:  logcat | grep -i ffmpeg
#   -> "DefaultRenderersFactory: Loaded FfmpegAudioRenderer"
```

`Capacidades.kt` **no** declara esos códecs a mano: se los pregunta a
`FfmpegLibrary.supportsFormat(...)`, que mira si el decodificador está compilado
de verdad. Si un día el `.so` no viaja en el APK, la app deja de declararlos sola
y el servidor vuelve a convertir el audio, en vez de dejarte sin sonido.

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

### 21/09 — auditoría completa y mantenimiento al estilo Plex
- Petición: revisión entera de servidor, APK y app de la tele — bugs, limpieza
  de código, opciones, y qué más se puede implementar tipo Plex.
- Tres agentes en paralelo (rutas, scanner/media, Android+Tizen) más revisión
  propia de `db.ts`/`index.ts` y de `data/server.err` (el log, no solo el código).
- **8 bugs de servidor corregidos**: 2 duraciones corruptas en la BD (una por
  desbordamiento de 32 bits); `probe.ts` podía borrar codec/resolución con NULL
  en un re-sondeo fallido; numeración de reserva de episodios por serie en vez
  de por temporada; biografía vacía tratada como *falsy* (repreguntaba a TMDb
  siempre); `fanart.ts` sin timeout (podía colgar toda la pasada) y sin limpiar
  su temporal; **logout/escanear/aplicar capacidades/parar transcripción
  fallaban con 400** desde la web (el ayudante `post()` mandaba
  `Content-Type: application/json` con cuerpo vacío); subtítulo externo sin
  comprobar el fichero al que pertenece; «parar» en Actividad no cortaba la
  sesión HLS de ese aparato.
- Descartada como falsa alarma una supuesta carrera en guardar progreso:
  `node:sqlite` es síncrono, no hay hueco para que se entrelace sin un `await` real.
- Queda **un fichero con los timestamps rotos de verdad** (no solo en la BD):
  `Historias de la cripta` S06E03 (`media_files.id = 2912`), 18 h según el
  último paquete de ffprobe. Solo se arregla remuxeando el archivo real, así
  que se dejó pendiente de decisión del usuario.
- **Mantenimiento nuevo**: copia de seguridad diaria (`VACUUM INTO`, rota a
  14), limpieza semanal de caché de imágenes (63.613 ficheros, 1,8 GB, sin
  límite hasta ahora) y de trickplay huérfano, «optimizar BD» (VACUUM) a mano.
  Todo probado en el servidor real, no solo leído: login, los tres botones, y
  el servidor siguiendo vivo después de un VACUUM de 8,3 s.
- Android y Tizen revisados a fondo: **sin bugs ni TODOs pendientes**. Como no
  cambió nada en su código, no se tocó el APK ni se instaló nada en la tele.
- Deuda técnica identificada y **dejada sin tocar** por bajo valor frente al
  riesgo: `if (!user.is_admin)` repetido en ~30 sitios, parseo de `Range`
  duplicado en `play.ts`/`descargas.ts`.
- Servidor reiniciado (vigilante) y web reconstruida con todos los cambios;
  memoria de Claude (`gotchas-tvwatch`, `tvwatch-servidor-media`) actualizada.

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
- En la web, `request()` sin `Content-Type` → 400 mudo (pasó dos veces, y una
  tercera dentro del propio ayudante `post()`: mirar `data/server.err`, no solo
  el código, para encontrar este patrón — el mismo mensaje repetido muchas
  veces es la pista).
- Un `COALESCE` que protege una sola columna del `UPDATE` (p. ej. `hdr`) no
  protege a las demás (`video_codec`, `width`, `height`) si no se repite en cada una.
- Una cadena vacía guardada a propósito como marca («ya comprobado») es *falsy*
  en JS: comprobar `!== null`, no la verdad del valor.
- Una caché con clave por hash de contenido (ruta+mtime+tamaño) no tiene
  «huérfanos que se puedan enumerar» de forma directa: hay que tocar el
  `mtime` en cada acierto y purgar por antigüedad, no por referencia.
- Antes de "arreglar" una carrera reportada en código con `node:sqlite`
  (`DatabaseSync`, síncrono): comprobar si hay algún `await` real entre las dos
  operaciones. Sin él, no puede entrelazarse aunque lleguen casi a la vez.

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

**Instalado/entregado a 21/09**: servidor con todo lo anterior en marcha
(vigilante, reiniciado tras la auditoría), web compilada y servida con el
panel de Mantenimiento, tele con la última compilación (disco quieto encima
del título) instalada y cerrada, `MediaWatch-3.7.apk` entregado — **sin
cambios en Android/Tizen esta vuelta**, porque la auditoría no encontró nada
que corregir en ninguno de los dos.

**Descartado por el usuario**: descargas sin conexión en Android, ventana
flotante (PiP), «Ver en la tele» dentro de la propia app de la tele, indexar
frases desde la UI del móvil.

**Sin probar con aparato real**: Chromecast (el emulador no ve ninguno).

**Pendiente de decisión del usuario (21/09)**: `media_files.id = 2912`
(Historias de la cripta, S06E03) tiene los timestamps internos rotos de
verdad; solo se arregla remuxeando el fichero real en `E:\`, y eso no se toca
sin permiso explícito.

**Ideas y cabos sueltos**:
- Segundo commit con los cambios pendientes (incluidos los del 21/09: no hay
  ningún commit hecho esta vuelta, solo se modificaron ficheros en disco).
- iOS/iPad: sin app nativa; la web como PWA es la vía (Safari sin HEVC por
  pipe en algunos casos; pendiente de evaluar Infuse-like).
- 23.005 personas sin foto en ninguna fuente.
- Descargas para la web existen pero no se usan mucho; revisar si se mantienen.
- Notas OMDb: cuota diaria limitada, se rellena por tandas.
- Limpieza cosmética identificada y aplazada: `if (!user.is_admin)` repetido
  en ~30 sitios (un `requireAdmin()` único lo evitaría), parseo de `Range`
  duplicado entre `play.ts` y `descargas.ts`.
- Ideas de valor para Android/Tizen sin implementar (no pedidas explícitamente,
  a valorar): notificaciones de episodios nuevos, control parental real por
  clasificación de edad (hoy solo hay PIN de acceso a perfil, no filtrado de
  contenido).

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
