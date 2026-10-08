# Plan: app de Media Watch para televisores LG (webOS)

**Estado (08/10/2026): NO EMPEZADO.** Solo hay valoración. Nadie ha tocado una LG ni escrito código de webOS.
Escrito para que otro agente (Gemini, Claude) pueda continuar sin reconstruir el contexto.

Convenciones de este documento: **[V]** = verificado leyendo la fuente que se cita (fecha 08/10/2026);
**[C]** = comprobado en el código de este repositorio; **[H]** = hipótesis, hay que comprobarla en una LG real.
Los tamaños (S/M/L) son estimaciones mías, sin medir. El repo es público: no escribir aquí el dominio
ni IPs públicas del dueño, ni tokens.

## 1. Qué se quiere y por qué

El dueño quiere que «Ver en la tele» (y, en general, la app de la tele) funcione también en teles LG.
Hoy solo hay cliente de tele para Samsung (Tizen) y para Android TV / Google TV. Las LG usan webOS y
no tienen cliente.

## 2. Cómo funciona hoy «Ver en la tele» [C]

Es un buzón en el servidor, no Cast:

1. La app Android (`android/.../ui/Ficha.kt:92` → `Api.verEnLaTele`, `datos/Api.kt:247`) hace
   `POST /api/mando/reproducir` con `{fileId, itemId, episodeId, position}`.
2. `server/src/routes/mando.ts` lo guarda en memoria, **una orden por usuario** (no por aparato), y caduca a los 120 s.
3. La app de la tele pregunta a `GET /api/mando?tele=1` (`tv/src/api.ts:273`). El servidor devuelve
   `{buscar, reproducir, mensaje, parar}`; las órdenes `buscar` y `reproducir` solo se entregan con `?tele=1`
   y **se entregan una sola vez**. La tele abre el reproductor en esa posición.
4. Requisitos: mismo perfil en móvil y tele, y la app de la tele **abierta en primer plano** (Tizen suspende
   la red de las apps en segundo plano).

La parte de servidor es genérica: **cualquier cliente que pregunte con `?tele=1` es un receptor válido**.
Hoy el único receptor es la app de Tizen. La app de Android en modo tele (`android/.../tele/`) llama a
`/api/mando` **sin** `?tele=1`, así que no recibe órdenes de reproducir.

## 3. Qué hay que cambiar: lo que es de Samsung en `tv/` [C]

La app de la tele es TypeScript/CSS planos, 6.353 líneas (`main.ts` 4.582, `nav.ts` 609, `player.ts` 476,
`api.ts` 433, `ajustes.ts` 167, `plataformas.ts` 86). Compila a `es2016`, salida `iife` (`tv/vite.config.ts`).
Lo dependiente de Samsung es poco:

| Qué | Dónde | Qué hacer en webOS |
|---|---|---|
| Reproductor `AVPlay` (`webapis.avplay`), pistas con `setSelectTrack`, subtítulos con `onsubtitlechange`/`setSilentSubtitle` (18 usos en 2 ficheros) | `tv/src/player.ts` (el acceso está en `avplay()`, líneas 69-71) | Segunda implementación con `<video>` HTML5. Es el grueso del trabajo. |
| Teclas: `ATRAS: 10009` (Samsung); resto de códigos en `TECLA` | `tv/src/nav.ts:19-34` | Back de LG = `461` [V]. Comprobar el resto de teclas multimedia en una LG real. |
| Registro de teclas multimedia `tizen.tvinputdevice` | `tv/src/nav.ts:587` | Probablemente no hace falta en webOS [H]. |
| Lanzar otras apps (Prime, etc.) con `tizen.application` | `tv/src/plataformas.ts` (86 líneas) | Ver §4: en webOS exige el id de la app destino, que normalmente no es público. Probablemente se desactiva en LG. |
| Versión de plataforma | `tv/src/main.ts:84` | `webOSTV.js` / Luna `getSystemInfo`. |
| Manifiesto Tizen y política de seguridad (`http:` solo, privilegios avplay, tvinputdevice, application.launch) | `tv/public/config.xml` | Se sustituye por `appinfo.json` de webOS. |
| Perfil `samsung2021` y petición `raw=1` | `tv/src/api.ts` (constante `PERFIL`, `…/stream?raw=1&perfil=…` ~línea 423) | Perfil propio para LG (§5). |

Servidor relevante: `server/src/routes/play.ts` — `PERFILES` (línea 207) y perfiles por lista
`lista:aac,ac3,...` (líneas 216-229); `info` (329), `stream` (402) y HLS: `hls/master.m3u8` (693),
`hls/:calidad.m3u8` (711), segmentos `.ts` (725); subtítulos WebVTT (763). El servidor ya convierte lo que
el cliente no lee (a DD+ 5.1 si el cliente lee AC3/EAC3, a AAC estéreo si no) copiando el vídeo.

## 4. Hechos sobre webOS [V]

Fuentes: documentación oficial de LG (`webostv.developer.lge.com`), leída el 08/10/2026.

**Motor web por año** (`/develop/specifications/web-api-and-web-engine`): webOS 6.x (2021) Chromium 79;
webOS 22 (2022) 87; 23 (2023) 94; 24 (2024) 108; 25 (2025) 120; 26 (2026) 132; 5.x (2020) Chromium 68.
El código actual (es2016) cabe en todos desde 2020.

**Formatos de audio y vídeo, webOS 24** (`/develop/specifications/video-audio-240`; hay una página por versión:
`video-audio-60` (2021), `-220`, `-230`, `-250`, `-260`, sin leer):
- `.mkv`: vídeo MPEG-2, MPEG-4, H.264, VP8, VP9, HEVC, AV1; audio Dolby Digital, Dolby Digital Plus, AAC,
  PCM, Opus, MP3 y, **solo en modelos concretos**, DTS / DTS-HD / DTS:X. TrueHD y FLAC (en vídeo) no aparecen.
- Modelos Ultra HD (3840×2160): la tabla garantiza `.mkv .mp4 .ts` con H.264/HEVC y **Dolby Digital, DD+ o AAC**.
- Tasas máximas: HEVC 4K 60 Mbps, H.264 4K 50 Mbps, 1080p 40 Mbps. Una película por encima necesita
  remux/transcodificación en servidor.
- Subtítulos de la tabla: **WebVTT** (el servidor ya los sirve así a Android). PGS/ASS no aparecen.
- «Algunos vídeos no listados no pueden reproducirse»: hay que probar con ficheros reales.

**Streaming** (`/develop/specifications/streaming-protocol-drm`): HLS soportado en el aparato. No se soporta
velocidad de reproducción distinta de 1.0 ni avance/retroceso rápido por velocidad (solo `seek`). Audio y
vídeo deben tener la misma duración de segmento. `EXT-X-MEDIA` de tipo VIDEO no se soporta; otras etiquetas
no soportadas: `EXT-X-PROGRAM-DATE-TIME`, `EXT-X-I-FRAMES-ONLY`, `EXT-X-INDEPENDENT-SEGMENTS`,
`EXT-X-DISCONTINUITY` salvo PTS. HTTP/2 desde webOS 5.0.

**Instalar sin tienda** (`/develop/getting-started/developer-mode-app`): cuenta gratuita de LG Developer;
instalar la app «Developer Mode» desde LG Content Store; iniciar sesión en ella y activar el modo (la tele
reinicia); en el PC, CLI de webOS: `ares-setup-device` (puerto 9922, usuario `prisoner`), botón «Key Server»
en la tele y `ares-novacom --device <tele> --getkey` con la clave de 6 caracteres que muestra la pantalla,
`ares-device --system-info --device <tele>`; luego `ares-package` y `ares-install`. **El modo desarrollador se
desactiva al agotarse la sesión o tras 10 reinicios sin red, y entonces se desinstalan las apps instaladas
así.** Un mensaje del foro de LG dice que la sesión máxima es de 1000 h y que se renueva con
`ares-launch com.palmdts.devmode -p extend=true -d <tele>`: **[H]**, sin confirmar en documentación oficial.
La herramienta antigua «webOS TV CLI» dejó de tener soporte en marzo de 2024; usar «webOS CLI».

**Mando** (`/develop/guides/back-button`, `/develop/guides/magic-remote`): Back = keyCode `461`; mirar siempre
`keyCode` porque `key` puede salir `"Unidentified"`. El Magic Remote tiene modo puntero y modo de 5 direcciones
(pulsar una flecha pasa a 5 direcciones); LG exige que toda app soporte 5 direcciones. Las teclas numéricas no
llegan a las apps. Un botón Exit de algunos mandos cierra la app sin avisarla.

**Lanzar otras apps** (`/develop/references/application-manager`): `luna://com.webos.applicationManager`,
método `launch` con el `id` de la app destino. Los ids normalmente no son públicos, así que solo vale para apps
propias o de socios. Probablemente «abrir Prime/Movistar+ desde la ficha» no se podrá en LG.

**Pistas de audio en `<video>`** (foro de LG, hilos «Video multi audio», «multi audio swapping»): `video.audioTracks`
existe desde webOS 3.0; hay informes de que cambiar `enabled` no cambia el audio o congela el vídeo con HLS.
**[H] sin resolver.**

## 5. Decisiones de diseño propuestas

1. **Abstraer el reproductor.** Extraer de `player.ts` una interfaz (`abrir`, `pausa`, `saltar`, `pistas de audio`,
   `pistas de subtítulos`, `tiempo`, `onEnd`, `onError`) con dos implementaciones: `AvplayReproductor` (Samsung,
   lo que hay hoy, sin cambiar su comportamiento) y `Html5Reproductor` (LG). La elección por plataforma en el arranque
   (`window.webapis` → Samsung; `window.webOS` / `webOSTV.js` → LG).
2. **Dos caminos de vídeo para LG, probar el A primero:**
   - **A. Fichero original** (`raw=1`) en `<video src>`. Mantiene HEVC/HDR10 y el audio sin tocar. La tabla de LG
     lista MKV, pero **[H]** falta comprobar que el `<video>` de una app web lo acepte por URL con peticiones de rango
     y que `seek` funcione.
   - **B. HLS del servidor** (`hls/master.m3u8`): nativo en webOS. El servidor transcodifica o remuxa, y hay que
     comprobar que su salida respeta las restricciones de LG de §4 (misma duración de segmento de audio y vídeo, sin
     `EXT-X-MEDIA` de vídeo).
3. **Perfil del servidor.** Añadir un perfil `lg` (o que la app mande `lista:` con los códecs que **verifique** en la tele)
   en `play.ts`. Empezar conservador: **AAC, AC3 y EAC3** son los que LG garantiza en 4K [V]; DTS solo en modelos concretos.
4. **Teclas y navegación.** Reutilizar `nav.ts` (navegación espacial propia por teclado) y añadir la tecla 461. No hace
   falta soportar el modo puntero para la primera versión, pero **no debe romperse**: comprobar qué pasa si el usuario
   mueve el Magic Remote [H].
5. **Subtítulos:** WebVTT con `<track>` (el servidor ya los sirve). Los PGS ya se convierten por OCR a texto.
6. **Mando («Ver en la tele»):** reutilizar tal cual la lógica de `?tele=1`; es JavaScript plano.
7. **Empaquetado:** `appinfo.json` + el mismo `dist/` de Vite. Compilar a `es2016` sigue valiendo.

## 6. Plan por fases

| Fase | Qué | Tamaño | Se da por buena cuando |
|---|---|---|---|
| 0. Viabilidad | Una LG con modo desarrollador y una app mínima que cargue una URL del servidor y reproduzca: un MKV HEVC por camino A, y el mismo título por camino B (HLS). Probar: seek, pista de audio, subtítulo WebVTT, DD+/Atmos en passthrough, HDR10, un 4K de ≥60 Mbps. | S | Hay un cuadro «funciona / no funciona» por cada prueba, con el modelo y la versión de webOS. **Si el camino A y el B fallan en audio o seek, parar y replantear.** |
| 1. Abstracción | Interfaz de reproductor y adaptador Samsung sin cambios de comportamiento. | M | La app de Samsung se comporta igual (probar en la QN93A, con aviso al dueño antes de relanzar). |
| 2. Reproductor webOS | `Html5Reproductor` y plataforma (teclas, versión). | M | Se ve una película entera en la LG, con salto, audio y subtítulos. |
| 3. Navegación y pantallas | Recorrer todas las pantallas con mando de 5 direcciones; revisar el modo puntero. | M | Sin foco perdido ni callejones. |
| 4. Servidor | Perfil `lg`, ajustes de HLS si hacen falta. | S | `curl` a `info`/`hls` desde el perfil da lo esperado; pruebas aisladas (ver §8). |
| 5. Mando | Probar «Ver en la tele» desde el móvil hasta la LG. | S | La orden llega y arranca en el segundo indicado. |
| 6. Empaquetado y entrega | `ares-package`, instalación, documento de instalación para el dueño. Decidir distribución (§7). | S | Se instala en una LG limpia siguiendo solo el documento. |

## 7. Riesgos y límites

- **Distribución:** sin publicar en la tienda de LG (no investigado: requisitos, revisión), cada tele necesita cuenta de
  desarrollador y modo desarrollador, y la instalación **se pierde cuando caduca la sesión** [V]. Eso la hace poco
  práctica para teles de otras personas. Valorar la tienda o aceptar el mantenimiento.
- **Teles en otra casa:** el emparejado de la tele solo funciona desde la red de casa (`server/src/routes/auth.ts`
  líneas 510, 557 y 600 devuelven 403 si la petición llega por el proxy o desde una IP no local), y un perfil sin PIN no
  entra desde fuera (`auth.ts:302`). La app de Samsung además solo habla HTTP (política de `config.xml`). En webOS habría
  que decidir cómo emparejar. Opciones: un puente temporal con Tailscale desde un portátil durante la visita, o una
  ventana de emparejado remoto abierta por el administrador (cambio de seguridad: decide el dueño).
- **Subida del internet de casa:** la app de la tele pide el fichero original; un 4K de 60-80 Mbps puede no caber. Sin medir.
- **DTS y TrueHD** no se garantizan en LG: el servidor tendría que convertirlos (ya lo hace a DD+).
- **Sin emulador fiable para el audio:** el emulador de webOS no soporta DRM y su fidelidad de formatos no está
  verificada; probar en una tele real.
- **Si no merece la pena:** una LG puede usar la web en su navegador, o un Chromecast / Google TV, que la app Android
  ya soporta. Son alternativas sin trabajo nuevo.

## 8. Cómo trabajar sin romper nada (reglas del repo)

- Leer `GEMINI.md` / `CLAUDE.md` antes de tocar nada; las reglas de publicación del APK y del barrido de datos
  sensibles antes de cada push están ahí. **El repo es público: nada de dominio, IP pública, tokens ni claves.**
- Probar el servidor con una instancia aislada (copia de `data/copias/*.db`, otro puerto, `host: 127.0.0.1`), no con
  el servidor real. Reiniciar el servidor real corta lo que se esté viendo: avisar antes.
- Instalar o relanzar la app en la tele del salón (Samsung) interrumpe lo que se vea: preguntar antes.
- `node --check` no basta para un `.ts`: cargar el módulo o arrancar la instancia.
- Antes de afirmar un hecho técnico, comprobarlo contra la fuente (documentación de LG, el fichero real). Lo que
  no se haya comprobado, marcarlo como hipótesis.

## 9. Preguntas abiertas para el dueño

1. ¿Qué LG es (modelo y año, o versión de webOS en Ajustes → General → Información del televisor)? Decide el motor
   web, los códecs y si DTS está disponible.
2. ¿Está en tu casa o en otra? Cambia el emparejado y el ancho de banda (§7).
3. ¿Cuántas teles LG, y quién las usaría? Decide si compensa la tienda de LG o basta el modo desarrollador.
4. ¿Qué importa más: 4K HDR y Atmos sin tocar (camino A), o que funcione en cualquier fichero (camino B)?
5. ¿Hace falta «abrir Prime/Movistar+» desde la ficha en la LG, sabiendo que probablemente no se podrá?

## 10. Primer paso concreto

Hacer la **fase 0** con la LG del dueño: crear la cuenta de LG Developer, instalar «Developer Mode» en la tele, y con un
`appinfo.json` mínimo y una página que reproduzca (a) `GET /api/play/<id>/stream?raw=1&perfil=…` y (b)
`GET /api/play/<id>/hls/master.m3u8` desde un servidor aislado. Rellenar el cuadro de resultados en este mismo
fichero antes de escribir una sola línea de la abstracción.
