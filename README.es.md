# Media Watch

[![Licencia: GPL v3](https://img.shields.io/badge/Licencia-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![Clientes](https://img.shields.io/badge/Clientes-Web%20%7C%20Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Samsung%20Smart%20TV%20%7C%20Android-orange.svg)](#aplicaciones-cliente-y-compilaci%C3%B3n)
[![App de Escritorio](https://img.shields.io/badge/App%20Escritorio-v0.6.1%20(Win%20%7C%20macOS%20%7C%20Linux)-0078D6.svg?logo=windows&logoColor=white)](https://github.com/pacotegg/mediawatch/releases)
[![App Android](https://img.shields.io/badge/App%20Android-v3.93-3DDC84.svg?logo=android&logoColor=white)](https://github.com/pacotegg/mediawatch/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Invtame%20a%20un%20caf-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/pacotegg)

[English](README.md) · [Español](README.es.md)

> ☕ **¿Te gusta el proyecto?** Si quieres apoyar el desarrollo continuo y ayudarme a mantenerlo, puedes [invitarme a un café en Ko-fi](https://ko-fi.com/pacotegg) o usar el botón **Sponsor** de arriba.

Creé Media Watch para el HTPC de mi salón porque quería un servidor de streaming rápido, visualmente cuidado y sin complicaciones que ofreciera una auténtica experiencia de cine en casa — sin telemetría, sin cuentas en la nube ni muros de pago.

Lee la biblioteca directamente desde tus discos duros o carpetas, indexa los metadatos y carátulas locales, y sirve el contenido a tu tele, móvil, tablet o navegador. Si el reproductor soporta el archivo original, hace **Direct Play directo** sin tocar el vídeo y con un consumo de CPU casi nulo. Si hace falta transcodificar (subtítulos quemados, reducción de bitrate fuera de casa o codecs incompatibles), aprovecha la aceleración por hardware de tu tarjeta gráfica.

> 💡 **¿Buscas instaladores listos para usar?**  
> - 💻 **Cliente de Escritorio (Windows, macOS y Linux)**: Descarga el reproductor nativo de alto rendimiento con Direct Play por GPU, HDR nativo y audio passthrough: **[Instalador Windows (.exe)](https://github.com/pacotegg/mediawatch/releases/tag/escritorio-v0.6.1)** · **[Instalador macOS (.dmg)](https://github.com/pacotegg/mediawatch/releases/tag/escritorio-v0.6.1)** · **[Linux AppImage y .deb](https://github.com/pacotegg/mediawatch/releases/tag/escritorio-v0.6.1)**  
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

### Cliente de Escritorio (Windows, macOS y Linux — Electron + mpv)

Reproductor de escritorio dedicado, desarrollado para Direct Play bit a bit, decodificación por hardware en GPU y sonido de cine sin pérdidas, sin transcodificar nada en el servidor:

- **Direct Play 100% en crudo**: Reproduce 4K HEVC Main 10, AV1, VP9, VC-1, DTS, DTS-HD MA, Dolby TrueHD, Dolby Atmos, FLAC y subtítulos gráficos (PGS, ASS/SSA) de forma nativa mediante mpv integrado (`raw=1`).
- **Aceleración por GPU dedicada**: Aprovecha la decodificación por hardware (Intel Arc QSV, NVIDIA NVDEC, AMD D3D11VA, Apple Silicon VideoToolbox y VA-API en Linux) con 0% de uso de CPU.
- **Motor moderno libplacebo (`gpu-next`)**: Cadena swapchain nativa BT.2020 PQ para HDR en Windows 11, Apple Liquid Retina XDR / EDR en macOS y mapeo de tonos spline de alta precisión en pantallas SDR.
- **Modos de sonido audiófilo**: PCM estándar, Audio Raw / Exclusivo (WASAPI y CoreAudio bit-perfect) y Passthrough HDMI (Bitstreaming a receptores AV o barras de sonido).
- **Integración con el sistema**: Teclas multimedia globales del teclado, HUD transparente sin marco sobre el vídeo (Windows/Linux) o ventana nativa Metal (macOS), miniaturas trickplay y encadenado automático de episodios.

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
  - Cualquier procesador Intel con gráfica integrada UHD / Iris Xe desde la 7ª generación (Kaby Lake) en adelante mediante **Intel Quick Sync Video (QSV)**.
  - Para decodificación y transcodificación AV1 por hardware: gráficos Intel Arc (A380, A750, A770 o GPUs móviles Arc como A730M) o procesadores Intel Core Ultra (Meteor Lake / Arrow Lake).
- **NVIDIA**: Soporte para **NVENC / NVDEC** (arquitecturas Turing, Ampere, Ada Lovelace o Blackwell).
- **AMD**: Soporte para **AMF / VA-API** en Linux y Windows.

---

## Arquitectura y Características Principales

- **Base de Datos Ultrarrápida en SQLite**:
  - Utiliza el motor nativo de alto rendimiento `node:sqlite` con modo WAL (*Write-Ahead Logging*).
  - Tiempos de respuesta de la API por debajo de 5 ms para búsquedas instantáneas y filtrado dinámico.
- **Transmisión Adaptativa y Transcodificación de Alto Rendimiento**:
  - *Direct Play*: Envío en crudo del flujo original con 0% de uso de CPU.
  - *Direct Stream / Remux*: Remuxeo al vuelo cambiando el contenedor o convirtiendo únicamente el audio cuando el cliente lo requiere.
  - *Aceleración por GPU*: Transcodificación acelerada por hardware (Intel QSV, NVIDIA NVENC, AMD AMF o software como respaldo).
  - *Trickplay Scrubbing*: Generación rápida de tiras de miniaturas para la barra de progreso.
- **Reproductor Nativo de Escritorio (Windows, macOS y Linux)**:
  - Construido con Electron y un motor nativo `mpv` embebido con reproducción Direct Play (`raw=1`), eliminando cualquier transcodificación en el servidor.
  - Aceleración por hardware dedicada (Intel Arc QSV, NVIDIA NVDEC, AMD D3D11VA, Apple Silicon VideoToolbox y Linux VA-API).
  - Pipeline de renderizado moderno con `libplacebo` (`gpu-next`), HDR nativo y mapeo de tonos spline de alta precisión en pantallas SDR.
  - Opciones de sonido audiófilo: PCM estándar, Audio Raw / Exclusivo (WASAPI y CoreAudio bit-perfect) y Passthrough HDMI (Bitstreaming a receptores AV).
  - Integración completa con el sistema: atajos de teclado multimedia globales, HUD transparente sobre el vídeo, miniaturas de barra y encadenado de episodios.
- **Mi Lista y Progreso Compartido**:
  - Lista de seguimiento unificada por perfil sincronizada entre Web, Smart TV, Android y Escritorio.
  - Autoreproducción inteligente del siguiente episodio con cuenta atrás.
  - Temporizador de apagado (*Sleep Timer*) para ver contenidos en la cama.
  - Logotipos de estudios de producción en alta definición respetando colores corporativos.
- **Extras y Contenido Especial Integrado**:
  - Filas panorámicas 16:9 integradas en la ficha (*Detrás de las cámaras*, *Tomas falsas*, *Escenas eliminadas*, *Entrevistas*).
  - Descarga opcional automatizada de extras y tráileres oficiales mediante TMDb y `yt-dlp`.
  - Tráiler flotante en la portada con fundido suave de audio.
- **Subtítulos Inteligentes y Sincronización Acústica**:
  - Búsqueda en tiempo real de subtítulos en español e inglés en OpenSubtitles y SubSource.
  - Sincronización acústica automática calculando la correlación cruzada contra la pista de diálogo central.
  - Ajuste manual interactivo del desfase de subtítulos con vista previa en directo.
  - Transcripción local mediante IA (Whisper) para archivos sin subtítulos disponibles.
  - OCR al vuelo convirtiendo subtítulos gráficos PGS de Blu-ray a WebVTT para Smart TVs.
- **Modos de Escucha Nocturna y Optimización Acústica**:
  - *Claridad de Diálogos*: Realce de frecuencias vocales en el canal central para entender cada palabra sin subir el volumen general.
  - *Modo Noche*: Compresión de rango dinámico para equilibrar susurros y explosiones estruendosas.
- **Empaquetado Coleccionista Steelbook 3D**:
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
| `desktop/` | Cliente de Escritorio (Windows, macOS y Linux) | Electron 44 + mpv incrustado + decodificación GPU (QSV / D3D11 / VideoToolbox / VA-API) |
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

### Cliente de Escritorio (Windows, macOS y Linux)
```bash
cd desktop
npm install
npm run build      # Compilar TypeScript y preparar recursos
npm run dist       # Empaquetar instalador de Windows (.exe NSIS con mpv fijado)
npm run dist:linux # Empaquetar Linux (.AppImage y .deb)
npm run dist:mac   # Empaquetar instalador Universal para macOS (.dmg y .zip)
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
