# TvWatch para Android

Cliente nativo: Kotlin y Jetpack Compose. No es una web envuelta — la primera
versión lo fue y no valía: no se podía reproducir en condiciones, ni descargar,
ni usar los controles de la pantalla de bloqueo, y se notaba a la legua.

## Por fases

| Fase | Qué entra | Estado |
|---|---|---|
| 1 | Cliente de la API, conexión y perfiles, portada, bibliotecas en rejilla con paginación, ficha de película y de serie con temporadas y reparto | **hecha** |
| 2 | Reproductor con Media3/ExoPlayer: reproducción directa de MKV/HEVC/EAC3, reanudar, guardar progreso, pistas de audio y subtítulos, saltar cabecera | **hecha** |
| 3 | Buscar (títulos, personas y frases, con «enviar a la tele»), menú lateral, favoritas | **hecha** |
| 4 | Calidad a mano, reproductor en servicio de medios (pantalla apagada, controles en el bloqueo), subtítulos al transcodificar, episodio siguiente, controles propios, orden y filtros, sagas, fichas de persona, Chromecast | **hecha** |
| — | Descargas sin conexión, ventana flotante | descartadas por ahora |

## Lo que hay dentro del reproductor

- **Vive en `ReproduccionService`** (`MediaSessionService`), no en la pantalla.
  La pantalla se conecta con un `MediaController`. Es lo que hace que siga
  sonando con la pantalla apagada y que el sistema pinte los controles en el
  bloqueo, la notificación y los auriculares.
- **Controles propios en Compose**, no los de `PlayerView`: cuando el vídeo sale
  por tubería (recodificado o con el audio convertido) ExoPlayer no sabe cuánto
  dura y su barra se queda muerta. Los nuestros saben la duración por el
  servidor y en qué segundo empezó la tubería, y saltar reabre desde ahí.
- **Calidad a mano** (`datos/Calidad.kt`): Original, 1080p·8, 720p·4, 480p·2,
  360p·1 Mb/s. Se recuerda una para casa y otra para fuera. El servidor recibe
  `maxKbps` y `maxHeight` y solo recodifica si el fichero supera alguno.
- **Subtítulos también recodificando**: se cargan aparte como WebVTT
  (`/subtitle/<id>.vtt?desde=N`), con los tiempos restados para cuadrar con
  una tubería que empieza a mitad. En crudo se añaden solo los .srt externos.
- **Episodio siguiente**: al acabar, cinco segundos de cuenta atrás y sigue;
  «Saltar créditos» pasa a ser «Siguiente episodio». Se cambia de episodio con
  estado dentro de la misma pantalla, sin navegar: navegando, la pantalla vieja
  se deshacía después de que la nueva arrancara y le paraba el reproductor.
- **Chromecast** (`Cast.kt`): receptor por defecto de Google alimentado con el
  HLS del servidor y el token en la URL. Los subtítulos van como pistas WebVTT
  aparte y se eligen en la pantalla de control. El sonido es AAC estéreo salvo
  que se active «Chromecast: sonido 5.1» en el menú: entonces el servidor manda
  AC3/DD+ tal cual (`surround=1`, con Atmos si lo trae) o convierte a DD+ 5.1,
  y el Chromecast lo pasa por HDMI. No está probado con un Chromecast real: el
  emulador no ve ninguno. La Samsung del salón **no es receptor de Google
  Cast**; para ella está «Ver en la tele» (pastilla en la ficha, o mantener
  pulsado un episodio): `POST /api/mando/reproducir`, y la aplicación de la
  tele lo recoge y arranca el reproductor.
- **Saltar por tubería** espera medio segundo de calma antes de reabrir (tres
  «+30» seguidos eran tres ffmpeg), conserva el último fotograma mientras llega
  el nuevo, y si en veinte segundos no llega vídeo reintenta una vez y luego
  lo dice con un botón de reintentar.

## Cómo decide si transcodificar

Lo que más trabajo dio, y no se ve:

1. La aplicación le pregunta a **su propio** `MediaCodecList` qué descodifica: los
   códecs, hasta qué altura, y si tiene el perfil **Main 10** de HEVC. Dos
   móviles de la misma marca no traen lo mismo; el AC3 y el DD+ van con licencia
   y muchos fabricantes no la pagan.
2. Eso viaja al servidor como `perfil=lista:aac,mp3,...&hevc=1&maxHeightHevc=1080`.
3. El servidor decide: fichero tal cual, solo el audio convertido, o recodificar.
   Cuando toca convertir el audio, ahora mira a quién se lo manda: **DD+ 5.1 a la
   tele** (que lo pasa por eARC a la barra) y **AAC estéreo al móvil**, que no
   entiende DD+ y además va a unos auriculares.
4. Y aun así hay una red de seguridad: si el decodificador rechaza el fichero, se
   vuelve a pedir recodificado en vez de dejar una pantalla negra.

Medido en el emulador con *Vaiana* (HEVC Main10 4K HDR10, `hvc1.2.4.L150.90`):
tiene decodificador de HEVC y dice que llega a 4K, pero rechaza el perfil de 10
bits. Sin el paso 1 esto arrancaba, fallaba y se quedaba en negro.

## Probarla

Hay un emulador creado en este equipo, así que no hace falta un móvil para ver
si algo se rompe:

```bash
/c/android-sdk/emulator/emulator.exe -avd tvwatch -no-window -no-audio -gpu swiftshader_indirect
/c/android-sdk/platform-tools/adb.exe install -r app/build/outputs/apk/debug/app-debug.apk
/c/android-sdk/platform-tools/adb.exe shell am start -n casa.tvwatch/.Principal
/c/android-sdk/platform-tools/adb.exe exec-out screencap -p > pantalla.png
```

Desde el emulador, el servidor de este ordenador es `10.0.2.2:8730`; desde un
móvil de verdad, la IP del HTPC.

## Compilar

| Cosa | Dónde |
|---|---|
| JDK 17 | `C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot` |
| SDK de Android | `C:\android-sdk` (plataforma 35, build-tools 35.0.0, emulador) |
| Gradle 8.10.2 | `C:\gradle\gradle-8.10.2` |

```bash
cd /c/tvwatch/android
JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot" \
  /c/gradle/gradle-8.10.2/bin/gradle.bat --no-daemon :app:assembleRelease
```

Firmada con la clave de depuración a propósito: esto no va a ninguna tienda y
esa clave es estable en este equipo, así que una versión nueva se instala encima
de la anterior sin desinstalar ni perder la sesión.

## Cómo está montada

- `datos/Api.kt` — modelos y llamadas. `ignoreUnknownKeys` no es pereza: permite
  añadir campos en el servidor sin que la aplicación ya instalada deje de
  arrancar.
- `datos/Ajustes.kt` — lo único que se guarda en el teléfono: la dirección del
  servidor y la sesión. El progreso, lo visto y las preferencias viven en el
  servidor, que es lo que permite empezar algo en la tele y seguirlo en el sofá.
- `ui/` — una pantalla por fichero, todas en Compose.
- `Principal.kt` — una sola actividad con navegación de Compose, que es lo que
  hace que el botón Atrás del sistema funcione sin escribir nada.

La sesión se consigue con el mismo `POST /api/auth/login` de la web: el servidor
la devuelve en una cookie, y el valor de esa cookie **es** el token que acepta
la cabecera `Authorization`. Así no hizo falta tocar el servidor ni pasar por el
emparejado con código, que está pensado para aparatos sin teclado.
