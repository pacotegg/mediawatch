# Media Watch

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![Plataformas](https://img.shields.io/badge/Clientes-Web%20%7C%20Samsung%20Smart%20TV%20%7C%20Android-orange.svg)](#clientes)

Servidor de películas y series propio, al estilo de Plex/Jellyfin/Infuse pero sin depender de ningún servicio externo. Diseñado para ejecutarse en tu propio equipo, mini PC o servidor doméstico sin depender de la nube ni telemetría externa.

Lee directamente tu biblioteca catalogada en la unidad o carpetas donde esté el contenido propio (p. ej. mediante tinyMediaManager con metadatos `.nfo` y arte gráfico local), sirviendo el vídeo por la red local y transcodificando solo cuando el dispositivo cliente no puede reproducir el fichero tal cual.

---

## Licencia GNU General Public License v3.0

Este proyecto es software libre: puedes redistribuirlo y/o modificarlo bajo los términos de la **GNU General Public License versión 3.0 (GPLv3)** tal como la publica la Free Software Foundation.

Consulta el archivo [LICENSE](LICENSE) para obtener los términos completos y condiciones legales de la licencia GNU GPL v3.0.

---

## Características Principales

- **Catalogación 100% Local (Zero-Cloud)**:
  - Escaneo ultrarrápido de la biblioteca a partir de archivos `.nfo`, pósters, fanarts y fondos locales (miles de títulos indexados en segundos).
  - Sagas y colecciones cinematográficas automáticas ordenadas cronológicamente sin llamadas a servicios de terceros.
  - Enriquecimiento opcional asistido con TMDb/OMDb solo cuando se solicita (sin sobrescrituras automáticas).
- **Streaming Adaptativo y Rendimiento**:
  - *Direct Play*: transmisión nativa directa sin recodificar (coste de CPU cero).
  - *Direct Stream / Remux*: copia el flujo de vídeo y recodifica únicamente el audio si el cliente no soporta el formato sonoro.
  - *Transcodificación Hardware*: aceleración por GPU (Intel QSV, NVIDIA NVENC o VAAPI) con alto rendimiento en tiempo real.
  - *Trickplay*: tiras de miniaturas para la barra de progreso generadas rápidamente por fotogramas clave.
- **Material Adicional y Extras Nativos**:
  - Fila 16:9 de extras integrada directamente en la ficha del título (*Cómo se hizo*, *Featurettes*, *Escenas eliminadas*, *Entrevistas*, *Tomas falsas*, *Cortometrajes*).
  - Descarga asistida de vídeos oficiales de producción y entrevistas desde TMDb a la biblioteca con `yt-dlp`.
  - Tráiler automático en la portada (Hero) con atenuación suave y control flotante de sonido.
- **Subtítulos Inteligentes y Sincronía Acústica**:
  - Búsqueda multilingüe en tiempo real (Español e Inglés) consultando OpenSubtitles y SubSource con comparativa de releases y puntuaciones.
  - Sincronía acústica automática mediante correlación cruzada contra el canal central de audio.
  - HUD flotante de retardo y desfase en vivo desde el reproductor sin oscurecer la imagen.
  - Transcripción local por IA con Whisper para audios sin subtítulos.
  - OCR al vuelo de subtítulos en mapas de bits (PGS) a WebVTT en Smart TV.
- **Acústica y Modo Noche**:
  - *Realce de Diálogos*: realce acústico inteligente del canal central para máxima inteligibilidad vocal.
  - *Modo Noche*: compresión de rango dinámico para nivelar diálogos y reducir estruendos de explosiones y efectos sin saturar.
- **Coleccionismo Físico (Estuche 3D interactivo)**:
  - Estuche Steelbook con disco extraíble en perspectiva tridimensional y visor a pantalla completa en alta definición.
- **Smart TV (Samsung Tizen)**:
  - Navegación espacial D-pad ortogonal fluida con mando a distancia.
  - Reordenación interactiva del menú lateral "Grab & Drop" (OK para enganchar y mover).
  - Detección automática y salto de intros/cabeceras por huella acústica chromaprint y detección de créditos de películas.

---

## Estructura del Proyecto

| Directorio | Componente | Stack Tecnológico |
|---|---|---|
| `server/` | Servidor API REST y Streaming | Node.js + TypeScript (Fastify) + SQLite (`node:sqlite`) |
| `web/` | Cliente Web | React 19 + Vite 6 + Tailwind CSS 4 + Motion |
| `tv/` | Cliente Smart TV (Samsung Tizen) | TypeScript plano + ES2016 IIFE + AVPlay nativo |
| `android/` | App Móvil / Tablet / Cast | Kotlin + Jetpack Compose + Media3 (ExoPlayer) + Cast SDK |
| `data/` | Datos locales (no versionado) | Base de datos SQLite, arte gráfico generado y cachés |

---

## Requisitos Previos

1. **Node.js**: Versión 22 o superior (Node 26 soporta ejecución directa de TypeScript sin compilar).
2. **FFmpeg & FFprobe**: Con soporte para códecs habituales (H.264, HEVC) y aceleración por GPU (QSV, VAAPI o NVENC).
3. **Python 3.10+**: Para utilidades de sincronización acústica de subtítulos (`subtitles_api.py`, `subsfetch.py`).
4. **yt-dlp**: Opcional, para la descarga asistida de extras oficiales a disco.

---

## Instalación y Puesta en Marcha

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
Crea el archivo `data/config.json` con la configuración de tu entorno, indicando las carpetas o unidades donde tengas alojado tu contenido multimedia:
```json
{
  "port": 8730,
  "libraries": [
    { "name": "Películas", "path": "D:\\TuContenido\\Peliculas", "kind": "movie" },
    { "name": "Series", "path": "D:\\TuContenido\\Series", "kind": "show" }
  ],
  "ffmpeg": "ffmpeg",
  "ffprobe": "ffprobe",
  "python": "python"
}
```
> **Nota**: Los campos `ffmpeg` y `ffprobe` pueden apuntar directamente al comando en el `PATH` o a una ruta absoluta específica de tu sistema.

### 4. Escaneo de la biblioteca
Para indexar tus títulos y metadatos locales:
```bash
npm run scan
```

### 5. Iniciar el servidor
```bash
npm start
```
El servidor estará accesible en:
- Local: `http://localhost:8730`
- Red doméstica: `http://<ip-de-tu-equipo>:8730`

Para desarrollo con recarga en caliente (servidor + web):
```bash
npm run dev
```

---

## Compilación de Clientes

### Web y Smart TV
```bash
npm run build
```
Genera los bundles estáticos en `web/dist/` (que el servidor sirve automáticamente) y `tv/dist/`.

### Smart TV (Samsung Tizen)
El empaquetado y firma del `.wgt` para televisores Samsung Tizen se realiza mediante el contenedor Docker oficial:
```bash
MSYS_NO_PATHCONV=1 docker run --rm --network host -v "${PWD}/tv:/app" \
  --entrypoint sh ghcr.io/georift/install-jellyfin-tizen:latest -c '
export PATH=$PATH:/tizen-studio/tools:/tizen-studio/tools/ide/bin
sdb connect <IP_DE_LA_TELE>:26101
TELE=$(sdb devices | grep -v "List of" | awk "{print \$3}" | head -1)
mkdir -p /build && cp -r /app/dist/* /build/ && cd /build
tizen build-web -- /build >/dev/null 2>&1
tizen package -t wgt -s dev -- /build/.buildResult
mv "/build/.buildResult/Media Watch.wgt" "/build/.buildResult/MediaWatch.wgt" 2>/dev/null || true
tizen install -n MediaWatch.wgt -t "$TELE" -- /build/.buildResult
'
```

### Android
```bash
cd android
./gradlew :app:assembleRelease
```
El APK generado se ubica en `android/app/build/outputs/apk/release/`.

---

## Guía de Uso y Atajos

### Atajos de Teclado (Reproductor Web)

| Tecla | Acción |
|---|---|
| `Espacio` / `K` | Reproducir / Pausa |
| `←` / `→` | Salto corto (10–15 s configurable) |
| `Mayús` + `←` / `→` | Salto largo (60 s) |
| `↑` / `↓` | Control de volumen |
| `F` | Alternar pantalla completa |
| `M` | Silenciar / Activar sonido |
| `G` / `H` | Ajustar retardo de subtítulos (-50 ms / +50 ms) |
| `C` | Alternar subtítulos |
| `Esc` | Salir del reproductor |
| `/` | Buscar (fuera del reproductor) |

### Control con Mando en Smart TV (Tizen)

- **Cruceta D-Pad (`▲ / ▼ / ◄ / ►`)**: Navegación espacial ortogonal directa entre tarjetas, carruseles y secciones.
- **`[ENTER / OK]`**: Abrir ficha, reproducir o pausar.
- **Personalización de Menú ("Grab & Drop")**: En Ajustes → *Personalizar menú*, pulsa `[OK]` sobre cualquier sección para engancharla (resalte ámbar brillante), desplázala arriba o abajo con `[▲ / ▼]` y vuelve a pulsar `[OK]` para soltarla. Pulsa `[►]` para alternar mostrar/ocultar.
- **`[ATRÁS]`**: Retroceder a la pantalla previa o salir del menú.

---

## Licencia

Media Watch está licenciado como software libre bajo los términos de la **GNU General Public License v3.0**. Consulta el archivo [LICENSE](LICENSE) para más detalles.
