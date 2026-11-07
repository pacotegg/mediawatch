# Media Watch

[![Licencia: GPL v3](https://img.shields.io/badge/Licencia-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![Clientes](https://img.shields.io/badge/Clientes-Web%20%7C%20Windows%20%7C%20Linux%20%7C%20Samsung%20Smart%20TV%20%7C%20Android-orange.svg)](#aplicaciones-cliente-y-compilaci%C3%B3n)
[![App de Escritorio](https://img.shields.io/badge/App%20Escritorio-v0.6.0%20(Win%20%7C%20Linux)-0078D6.svg?logo=windows&logoColor=white)](https://github.com/pacotegg/mediawatch/releases/tag/escritorio-v0.6.0)
[![App Android](https://img.shields.io/badge/App%20Android-v3.93-3DDC84.svg?logo=android&logoColor=white)](https://github.com/pacotegg/mediawatch/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Invtame%20a%20un%20caf-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/pacotegg)

[English](README.md) · [Español](README.es.md)

> ☕ **¿Te gusta el proyecto?** Si quieres apoyar el desarrollo continuo y ayudarme a mantenerlo, puedes [invitarme a un café en Ko-fi](https://ko-fi.com/pacotegg) o usar el botón **Sponsor** de arriba.

Creé Media Watch para el HTPC de mi salón porque quería un servidor de streaming rápido, visualmente cuidado y sin complicaciones que ofreciera una auténtica experiencia de cine en casa — sin telemetría, sin cuentas en la nube ni muros de pago.

Lee la biblioteca directamente desde tus discos duros o carpetas, indexa los metadatos y carátulas locales, y sirve el contenido a tu tele, móvil, tablet o navegador. Si el reproductor soporta el archivo original, hace **Direct Play directo** sin tocar el vídeo y con un consumo de CPU casi nulo. Si hace falta transcodificar (subtítulos quemados, reducción de bitrate fuera de casa o codecs incompatibles), aprovecha la aceleración por hardware de tu tarjeta gráfica.

> 💡 **¿Buscas instaladores listos para usar?**  
> - 💻 **Cliente de Escritorio (Windows y Linux)**: Descarga el reproductor nativo de alto rendimiento con Direct Play por GPU, HDR nativo y audio passthrough: **[Instalador Windows (.exe)](https://github.com/pacotegg/mediawatch/releases/tag/escritorio-v0.6.0)** · **[Linux AppImage y .deb](https://github.com/pacotegg/mediawatch/releases/tag/escritorio-v0.6.0)**  
> - 📱 **Móvil y Cast**: Descarga el APK de Android desde **[Releases](https://github.com/pacotegg/mediawatch/releases)** o desde la página `/instalar.html` de tu servidor.  
> - 🖥️ **Servidor de Escritorio Autónomo**: Echa un vistazo a **[MediaWatch Server](https://github.com/pacotegg/MediaWatch-Server)** si buscas un paquete de servidor todo en uno con icono en la bandeja del sistema, descarga automática de metadatos desde TMDb por nombre de archivo (sin necesidad de archivos `.nfo`) y emparejamiento con móvil mediante código QR. Este repositorio (`pacotegg/mediawatch`) es el motor central.

---

## Licencia GNU General Public License v3.0

Media Watch es software libre y de código abierto: puedes redistribuirlo y/o modificarlo bajo los términos de la **GNU General Public License versión 3.0 (GPLv3)** publicada por la Free Software Foundation. Consulta [LICENSE](LICENSE) para ver los términos completos.

---

## Capturas y Aspecto Visual

### Cliente Web (React 19 + Tailwind CSS)

| Portada Interactiva y Tráiler de Fondo | Ficha Técnica y Steelbook 3D |
|:---:|:---:|
| ![Web Home](docs/screenshots/web/web-home.webp) | ![Web Detail](docs/screenshots/web/web-detail.webp) |
| *Banner principal con tráiler ambiente, carrusel de continuar viendo y sagas* | *Badges de pistas, notas Rotten Tomatoes/IMDb, disco 3D y extras nativos 16:9* |

| Catálogo de Pósteres | Estadísticas de Uso |
|:---:|:---:|
| ![Web Library](docs/screenshots/web/web-library.webp) | ![Web Stats](docs/screenshots/web/web-stats.webp) |
| *Búsqueda rápida por metadatos, filtros y cuadrícula fluida* | *Estadísticas de reproducción, actividad por horas y dispositivos* |

---

### Samsung Smart TV (Tizen)

| Pantalla Principal en Gran Formato | Menú Lateral Personalizable |
|:---:|:---:|
| ![Smart TV Home](docs/screenshots/tv/tv-home.webp) | ![Smart TV Menu](docs/screenshots/tv/tv-menu.webp) |
| *Navegación espacial a 60 FPS con la cruceta del mando a distancia* | *Reordenación de secciones agarrando y soltando para priorizar tus bibliotecas* |

| Cuadrícula de Biblioteca en TV | HUD de Reproducción Nativo (AVPlay) |
|:---:|:---:|
| ![Smart TV Library](docs/screenshots/tv/tv-library.webp) | ![Smart TV Player HUD](docs/screenshots/tv/tv-player-hud.webp) |
| *Navegación fluida por catálogo en la tele* | *Línea de tiempo con miniaturas trickplay, ajuste de desfase de subtítulos y audio* |

---

### Android (Móviles, Tablets y Google Cast)

| Portada Móvil | Ficha y Descargas Locales |
|:---:|:---:|
| ![Android Home](docs/screenshots/android/android-home.webp) | ![Android Detail](docs/screenshots/android/android-detail.webp) |
| *Interfaz Jetpack Compose con reanudación rápida* | *Perfiles de descarga, selector de pistas de audio y visor de tráilers* |

| Menú Desplegable Reordenable | Ajustes de la Aplicación |
|:---:|:---:|
| ![Android Drawer](docs/screenshots/android/android-drawer.webp) | ![Android Settings](docs/screenshots/android/android-settings.webp) |
| *Organización de secciones arrastrando y soltando* | *Ajuste de bitrate máximo, modos de sonido e idioma de la app* |

---

### Cliente de Escritorio (Windows y Linux — Electron + mpv)

Reproductor de escritorio dedicado, desarrollado para Direct Play bit a bit, decodificación por hardware en GPU y sonido de cine sin pérdidas, sin transcodificar nada en el servidor:

- **Direct Play 100% en crudo**: Reproduce 4K HEVC Main 10, AV1, VP9, VC-1, DTS, DTS-HD MA, Dolby TrueHD, Dolby Atmos, FLAC y subtítulos gráficos (PGS, ASS/SSA) de forma nativa mediante mpv integrado (`raw=1`).
- **Aceleración por GPU dedicada**: Aprovecha la decodificación por hardware (Intel Arc QSV, NVIDIA NVDEC, AMD D3D11VA y VA-API en Linux) con 0% de uso de CPU.
- **Motor moderno libplacebo (`gpu-next`)**: Cadena swapchain nativa BT.2020 PQ para HDR en Windows 11 y mapeo de tonos spline de alta precisión en pantallas SDR.
- **Modos de sonido audiófilo**: PCM estándar, Audio Raw / Exclusivo (WASAPI bit-perfect) y Passthrough HDMI (Bitstreaming a receptores AV o barras de sonido).
- **Integración con el sistema**: Teclas multimedia globales del teclado, HUD transparente sin marco sobre el vídeo, miniaturas trickplay y encadenado automático de episodios.

---

## Requisitos de Hardware

Uno de los pilares del diseño ha sido la ligereza: exprimir el hardware sin necesidad de montar un servidor costoso.

### 1. Modo Direct Play (Reproducción directa en red local)
Si tu tele, móvil o PC soporta el formato nativo del vídeo (MKV o MP4 con H.264, HEVC, AV1, AAC, AC3, EAC3, TrueHD...):
- **CPU**: Cualquier procesador x86-64 de 64 bits (Intel Celeron J4125/N5105, Intel N100, o cualquier Core i3/i5 de sobremesa antiguo).
- **RAM**: **2 GB mínimo** (el proceso del servidor Node.js / Fastify consume apenas entre 120 y 200 MB de memoria).
- **Almacenamiento**: ~300 MB para el ejecutable + 2 a 4 GB para carátulas locales, miniaturas y la base de datos SQLite.
- **Red**: Cable Ethernet Gigabit o Wi-Fi de 5 GHz recomendado para remuxes 4K de alto bitrate (50–90 Mbps).

### 2. Transcodificación en tiempo real por Hardware (GPU)
Cuando hace falta convertir el vídeo al vuelo (subtítulos incrustados, menor bitrate fuera de casa o codecs incompatibles):
- **Intel (Recomendado / mayor eficiencia y calidad)**:
  - Procesadores Intel Core de 7ª generación (Kaby Lake, 2017+) o posterior con gráfica integrada **Intel UHD / HD 600+**. Procesadores económicos como el **Intel N100 / N95 / N200** transcodifican 4K HDR a 1080p con soltura mediante **Quick Sync (QSV)**.
  - Tarjetas gráficas dedicadas **Intel Arc** (A310, A380, A750, A770).
- **NVIDIA**:
  - GeForce **GTX 1050 o superior**, GTX 1650/1660, o cualquier tarjeta de la serie **RTX (20xx/30xx/40xx/50xx)** con chip NVENC.
- **AMD**:
  - APUs Ryzen con gráficos integrados Vega / RDNA, o tarjetas dedicadas Radeon RX serie 400 o superior (codificador AMF).
- **RAM**: **4 GB o más**.

### 3. Transcodificación por Software (Solo CPU, sin gráfica)
- **CPU**: Procesador de mínimo 4 núcleos y 8 hilos para transcodificar 1080p en tiempo real.  
  *(Aviso sincero: transcodificar 4K HDR por CPU pura pondrá todos los núcleos al 100% y dará tirones; para 4K se recomienda siempre aceleración por GPU).*

---

## Transcodificación por Hardware: H.264 y HEVC / x265

Media Watch incluye aceleración por hardware para codificar tanto en **H.264 (AVC)** como en **HEVC (H.265)**:

| Motor de Hardware | Codificador H.264 | Codificador HEVC (x265) | Mapeo de Tonos HDR |
|---|---|---|---|
| **Intel Quick Sync (QSV)** | `h264_qsv` | `hevc_qsv` (nativo 10 bits HDR) | `vpp_qsv` (tonemap en GPU) |
| **NVIDIA NVENC** | `h264_nvenc` | `hevc_nvenc` | Escala y tonemap por GPU |
| **AMD AMF** | `h264_amf` | `hevc_amf` | Escala por GPU |
| **CPU (Software)** | `libx264` | `libx265` | Tonemap por software |

### Elegir entre H.264 y HEVC en Ajustes:
- **H.264 (Por defecto)**: Compatibilidad universal total. Cualquier navegador (Firefox en Linux/Windows, navegadores Chromium sin licencias HEVC, ordenadores antiguos) lo reproduce al instante sin pantallas negras.
- **HEVC / H.265**: Ahorra entre un 40% y un 50% de ancho de banda con la misma calidad visual y mantiene el color HDR de 10 bits por hardware. Recomendado si los clientes principales son la app de Android, la app de la tele Samsung, el cliente de escritorio o navegadores con decodificación HEVC activa en el SO (Edge, Safari, Chrome con decodificadores de Windows).
- Puedes cambiarlo en cualquier momento desde **Ajustes &rarr; Transcodificación &rarr; Códec de transcodificación**.

---

## Soporte y Requisitos en Linux

Media Watch funciona perfectamente en distribuciones Linux (Ubuntu, Debian, Fedora, Arch, etc.). Al alojarlo en Linux:

### 1. App de Escritorio Autónoma (mediante MediaWatch Server)
- **AppImage**: Ejecutable directo sin instalación.
  - *Requisito en distribuciones modernas (Ubuntu 22.04+, Debian 12, Fedora)*: asegurarse de tener instalado FUSE 2:
    ```bash
    sudo apt install libfuse2
    ```
- **Paquete DEB**: Instalación nativa para Debian, Ubuntu y Linux Mint:
  ```bash
  sudo dpkg -i mediawatch-server_*_amd64.deb
  ```

### 2. Aceleración por Hardware en Linux
- **Intel QSV / VAAPI**:
  - Instala el controlador de medios non-free:
    ```bash
    sudo apt install intel-media-va-driver-non-free vainfo
    ```
  - Comprueba que tu usuario tiene permisos en el dispositivo de renderizado:
    ```bash
    sudo usermod -aG render,video $USER
    ```
  - Comprueba con `vainfo` que aparecen los puntos de entrada `VAProfileH264...` y `VAProfileHEVC...`.
- **NVIDIA NVENC**:
  - Instala los controladores oficiales propietarios (`nvidia-driver-xxx`). Comprueba con `nvidia-smi`.

---

## Características Principales

- **Catalogación 100% Local Sin Dependencia de la Nube**:
  - Escaneo ultrarrápido de miles de películas y series directamente desde archivos `.nfo`, pósteres y fondos locales.
  - Sagas y colecciones ordenadas cronológicamente de forma local.
  - Enriquecimiento bajo demanda desde TMDb/OMDb solo cuando tú lo pides.
- **Streaming Adaptativo y Transcodificación Inteligente**:
  - *Direct Play*: Envío del archivo original con 0% de uso de CPU.
  - *Direct Stream / Remux*: Copia directa de la pista de vídeo y conversión al vuelo solo del audio cuando el cliente lo requiere.
  - *Aceleración por GPU*: Compatible con Intel Quick Sync, NVIDIA NVENC, AMD AMF o software en CPU. Códecs H.264 y HEVC seleccionables.
  - *Línea de tiempo con Trickplay*: Generación de miniaturas para previsualizar el punto exacto al avanzar o retroceder.
- **Reproductor Nativo de Escritorio (Windows y Linux)**:
  - Basado en Electron y un motor nativo incrustado de `mpv` con Direct Play en crudo (`raw=1`), sin transcodificar nada en el servidor.
  - Decodificación acelerada por hardware aprovechando la GPU dedicada (Intel Arc QSV, NVIDIA NVDEC, AMD D3D11VA y VA-API en Linux).
  - Renderizado moderno con `libplacebo` (`gpu-next`), HDR nativo en Windows (cadena swapchain BT.2020 PQ) y mapeo de tonos spline en pantallas SDR.
  - Tres modos de audio audiófilos: PCM estándar, Audio Raw / Exclusivo (WASAPI bit-perfect directo) y Passthrough HDMI (Bitstreaming a receptores AV / barras).
  - Integración fluida: teclas multimedia globales del teclado, HUD transparente sin marco, miniaturas trickplay y encadenado automático de episodios.
- **Watchlist y Experiencia de Visionado**:
  - Lista de seguimiento (Watchlist) sincronizada por perfil entre Web, Smart TV, Android y Escritorio.
  - Siguiente episodio automático con cuenta atrás.
  - Temporizador de apagado (Sleep Timer) para Smart TVs.
  - Logos de productoras y estudios en alta definición conservando sus colores originales.
- **Material Extra y Escenas Eliminadas Nativas**:
  - Filas panorámicas 16:9 integradas en la ficha (*Detrás de las cámaras*, *Tomas falsas*, *Escenas eliminadas*, *Entrevistas*).
  - Descarga automática opcional de extras y tráilers oficiales vía TMDb y `yt-dlp`.
  - Tráiler ambiente flotante en la cabecera principal con desvanecimiento de sonido.
- **Subtítulos Inteligentes y Sincronización Acústica**:
  - Búsqueda multilingüe en tiempo real en OpenSubtitles y SubSource.
  - Sincronización acústica automática calculando la correlación cruzada contra el canal de diálogo.
  - Ajuste fino de desfase (-50 ms / +50 ms) directamente desde el mando o reproductor.
  - Transcripción local por IA con Whisper para títulos que no tengan subtítulos.
  - OCR al vuelo para convertir subtítulos gráficos PGS a WebVTT en Smart TVs.
- **Optimización Acústica y Modo Nocturno**:
  - *Claridad de Diálogos*: Realce inteligente de la banda de frecuencias vocales.
  - *Modo Noche*: Compresión de rango dinámico para no despertar a nadie con explosiones.
- **Edición para Coleccionistas 3D**:
  - Steelbook 3D interactivo con disco extraíble y visor de carátula en alta definición.
- **Aplicación Dedicada para Samsung Smart TV (Tizen)**:
  - Navegación espacial ortogonal fluida con la cruceta del mando a distancia.
  - Menú lateral reorganizable agarrando y soltando (`[OK]` para coger y soltar).
  - Detección acústica de intros y temas de series mediante huella digital Chromaprint.
- **Interfaz Multilingüe**:
  - Inglés y Español disponibles en Web, Smart TV, Android y Escritorio.

---

## Estructura del Proyecto

| Directorio | Componente | Stack |
|---|---|---|
| `server/` | Servidor API REST y motor de streaming | Node.js + TypeScript (Fastify) + SQLite (`node:sqlite`) |
| `web/` | Cliente Web | React 19 + Vite 6 + Tailwind CSS 4 + Motion |
| `tv/` | Cliente Smart TV (Samsung Tizen) | TypeScript plano + ES2016 IIFE + AVPlay nativo |
| `android/` | App Android (Móviles / Tablets / Cast) | Kotlin + Jetpack Compose + Media3 (ExoPlayer) + Google Cast |
| `desktop/` | Cliente de Escritorio (Windows y Linux) | Electron 44 + mpv incrustado + decodificación GPU (QSV / D3D11 / VA-API) |
| `data/` | Datos locales de ejecución (no en git) | Base de datos SQLite, caché de arte, miniaturas trickplay |

---

## Cómo Arrancar desde el Código Fuente

### 1. Clonar el repositorio
```bash
git clone https://github.com/pacotegg/mediawatch.git
cd mediawatch
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configuración inicial
Crea el fichero `data/config.json` con tus carpetas de películas y series:
```json
{
  "port": 8730,
  "libraries": [
    { "name": "Películas", "path": "D:\\Media\\Peliculas", "kind": "movie" },
    { "name": "Series", "path": "D:\\Media\\Series", "kind": "show" }
  ],
  "ffmpeg": "ffmpeg",
  "ffprobe": "ffprobe",
  "python": "python"
}
```

### 4. Escanear la biblioteca
```bash
npm run scan
```

### 5. Iniciar el servidor
```bash
npm start
```
Accede desde tu red local en `http://<ip-de-tu-servidor>:8730` o localmente en `http://localhost:8730`.

---

## Aplicaciones Cliente y Compilación

### Web y Smart TV
```bash
npm run build
```
Compila los paquetes estáticos a `web/dist/` (servidos directamente por el backend) y `tv/dist/`.

### Cliente de Escritorio (Windows y Linux)
```bash
cd desktop
npm install
npm run build      # Compilar TypeScript y preparar recursos
npm run dist       # Empaquetar instalador de Windows (.exe NSIS con mpv fijado)
npm run dist:linux # Empaquetar Linux (.AppImage y .deb)
```
El instalador generado quedará en `desktop/release/`. Los instaladores listos para usar también se pueden descargar desde [Releases](https://github.com/pacotegg/mediawatch/releases) y desde la página `/instalar.html` del servidor.

### Samsung Smart TV (Tizen)
Empaqueta e instala el paquete `.wgt` en tu televisión Samsung usando Docker:
```bash
MSYS_NO_PATHCONV=1 docker run --rm --network host -v "${PWD}/tv:/app" \
  --entrypoint sh ghcr.io/georift/install-jellyfin-tizen:latest -c '
export PATH=$PATH:/tizen-studio/tools:/tizen-studio/tools/ide/bin
sdb connect <TV_IP>:26101
TELE=$(sdb devices | grep -v "List of" | awk "{print \$3}" | head -1)
mkdir -p /build && cp -r /app/dist/* /build/ && cd /build
tizen build-web -- /build >/dev/null 2>&1
tizen package -t wgt -s dev -- /build/.buildResult
mv "/build/.buildResult/Media Watch.wgt" "/build/.buildResult/MediaWatch.wgt" 2>/dev/null || true
tizen install -n MediaWatch.wgt -t "$TELE" -- /build/.buildResult
'
```

### App Android
```bash
cd android
./gradlew :app:assembleRelease
```
El APK compilado se generará en `android/app/build/outputs/apk/release/`.

---

## Apoya el proyecto

Si disfrutas de Media Watch y quieres echarme una mano con el desarrollo continuo, puedes [invitarme a un café en Ko-fi](https://ko-fi.com/pacotegg). ¡Cualquier aportación se agradece un montón!

---

## Licencia

Media Watch está publicado bajo la licencia **GNU General Public License v3.0**. Consulta el fichero [LICENSE](LICENSE) para más detalles.
