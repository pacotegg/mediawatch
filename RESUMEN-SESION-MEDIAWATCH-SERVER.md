# Resumen de la sesión: MediaWatch Server

Rama: `ccr-6804d5c1-660t6m` · 8 commits · 22 ficheros modificados · sin PR.

Objetivo: una app de servidor propio para que amigos y familiares tengan su MediaWatch.
Estado: **diseño completo y servidor adaptado**. Falta la app de escritorio y el instalador.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Público | Amigos y familia por ahora |
| Plataforma | Solo Windows (Linux, más adelante) |
| Biblioteca | Sin tinyMediaManager: el escáner identifica por el nombre |
| Contenedor | Electron |
| Nombre | MediaWatch Server |
| Repositorio | Repo aparte, con este repo como submódulo de git fijado a una versión |
| Actualizaciones | Automáticas desde el repo |
| Instalador | Sin firma; se explica a los usuarios el aviso de SmartScreen |
| Clientes | Web (PWA) y Android; iOS por la web instalada; Cast desde el móvil |
| Acceso externo | A elección del usuario |
| Identificación automática | Solo en modo portable |
| Sin clasificación por edades | Se avisa al administrador |
| Aviso de instalación | Convención de nombres con año y mini tutorial |

## Lo hecho

### 1. Documento de diseño (`DISENO-SERVIDOR-PROPIO.md`)
- Arquitectura, auditoría de rutas fijas, mediciones, plan por hitos, estructura del repo nuevo, aviso de instalación y mini tutorial en borrador.
- Las rutas de la máquina del propietario están concentradas en `config.ts`. Los 25 scripts de mantenimiento son del propietario y no entran en la app.
- El servidor lanza ffmpeg en 8 sitios y Python en 1.

### 2. Hito 1: servidor configurable por entorno
- Variables: `MEDIAWATCH_DATA_DIR`, `_HOST`, `_PORT`, `_FFMPEG`, `_FFPROBE`, `_PYTHON`, `_TMP_DIR`, `_SUBSFETCH`. Sin ellas, el comportamiento es el del HTPC original.
- Los valores de entorno no se guardan en `config.json`.
- Fallo corregido: con una base de datos nueva el servidor se caía porque un índice se creaba antes que su tabla.
- Prueba: arranca con datos vacíos y devuelve `setupNeeded: true`.

### 3. Hito 2: escáner sin NFO
- Medición inicial (biblioteca sintética de 9 títulos): solo 3 de 9 salían limpios; el reescaneo borraba todo lo identificado; los episodios se llamaban como el fichero.
- `scanner/nombres.ts`: limpia nombres de release y extrae el año.
- `items.meta_origen = 'tmdb'`: el escaneo respeta lo identificado (título, año, sinopsis, nota, clasificación, géneros, reparto, episodios).
- `scanner/identificar.ts`: identificación automática con coincidencia segura (título igual y año ±1; sin año, un único resultado con ese título). Lo dudoso queda para revisión y no se reintenta hasta 30 días después.
- Clasificación por edades pedida a TMDb para España (`ES:12`).
- `scanner/episodios-tmdb.ts`: título, sinopsis, fecha, duración, nota y miniatura de cada episodio.
- Rutas de administrador: `GET /api/identificar/estado`, `POST /api/identificar/ejecutar`, `POST /api/identificar/clasificacion`.
- Resultado en la biblioteca sintética: 9/9 títulos limpios (antes 3/9), 8 identificados y 1 dudoso, todo sobrevive al reescaneo.
- Con NFO no cambia nada (comprobado con un `movie.nfo` de prueba).

### 4. Otros fallos encontrados y corregidos
- Las bibliotecas con id 3 y 9 se trataban como infantiles (son las del propietario); en una instalación nueva son bibliotecas cualquiera.
- El primer administrador podía crearse sin PIN y quien llegara antes se quedaba con el servidor. Ahora el PIN es obligatorio en modo portable.

### 5. Interfaz de administrador
- `web/src/components/Identificacion.tsx`, en Ajustes → Metadatos, solo para administradores y solo en MediaWatch Server.
- Contadores, botón «Identificar ahora» y lista «Sin clasificación por edades» con selector.
- Probada en un navegador real (Guardar fija `ES:12` y la fila desaparece). La web compila.

### 6. Pruebas automáticas
- 25 casos con `node --test`: limpieza de nombres, coincidencia segura y clasificación por edades.

## Pendiente o sin verificar
- **Repo `mediawatch-server`**: GitHub rechaza crearlo (`403 Resource not accessible by integration`, intentado dos veces). Hay que crearlo a mano, vacío y privado, y avisar. Sin él no hay hito 3 (envoltorio Electron, asistente, bandeja, instalador).
- **API real de TMDb**: todas las pruebas usan respuestas simuladas. Sin comprobar `append_to_response` con `release_dates` y `content_ratings`, ni que la certificación llegue donde la documentación indica.
- **HTPC y Windows**: nada probado ahí, ni con Node 26 (todo se probó en Linux con Node 22.22).
- **Servidor actual del propietario**: la petición de ficha a TMDb ahora pide datos extra. Si TMDb los rechazara, afectaría a la revisión manual; mirar `data/server.err` tras reiniciar.
- **Acierto real**: el 8 de 9 es de una biblioteca sintética. Hace falta una lista de nombres reales (sin datos personales).
- **iOS y Cast**: no medido. Android lleva el SDK de Cast; en iOS no se sabe qué opciones hay.
- **Licencias y tutorial**: binarios a empaquetar (ffmpeg y otros) y herramientas del tutorial (tinyMediaManager, MediaElch, FileBot) sin comprobar en precio, licencia ni estado actual.

## Cómo probarlo (PowerShell 7, sin ejecutar en Windows por mi parte)

Biblioteca de prueba en `C:\mw-biblioteca-prueba` (no usar `E:\`):

```powershell
$raiz = 'C:\mw-biblioteca-prueba'
$ficheros = @(
  'Peliculas\Blade Runner (1982)\Blade Runner (1982).mkv',
  'Peliculas\Blade Runner 2049 (2017)\Blade Runner 2049 (2017).mkv',
  'Peliculas\The.Matrix.1999.1080p.BluRay.x264-GROUP\The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv',
  'Peliculas\Amelie 2001 [1080p]\amelie.mkv',
  'Peliculas\Alien Resurrection (1997) [BluRay]\video.mkv',
  'Peliculas\Inception.2010.720p.BluRay\Inception.2010.720p.BluRay.mkv',
  'Peliculas\El_laberinto_del_fauno_2006_DVDRip_spa\El_laberinto_del_fauno_2006_DVDRip_spa.avi',
  'Peliculas\Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.H.265-GRP\Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.H.265-GRP.mkv',
  'Peliculas\1917 (2019)\1917 (2019).mkv',
  'Peliculas\Dune\Dune.mkv',
  'Peliculas\Pelicula inventada xyz123 (2020)\Pelicula inventada xyz123 (2020).mkv',
  'Peliculas\Heat.1995.720p.BluRay.mkv',
  'Series\Breaking Bad (2008)\Season 01\Breaking.Bad.S01E01.720p.mkv',
  'Series\Breaking Bad (2008)\Season 01\Breaking.Bad.S01E02.720p.mkv',
  'Series\Friends (1994)\Season 01\Friends - 1x05 - The One.mkv',
  'Series\Stranger.Things.2016.1080p\Season 1\Stranger.Things.S01E01.mkv',
  'Series\The.Office.US.2005.720p\S02E03.mkv'
)
foreach ($f in $ficheros) {
  $ruta = Join-Path $raiz $f
  New-Item -ItemType Directory -Path (Split-Path $ruta) -Force | Out-Null
  $fs = [System.IO.File]::Create($ruta)
  $fs.SetLength(6MB)
  $fs.Close()
}
```

Arranque de prueba en una copia aparte, puerto 8799 (ffmpeg no hace falta definirlo: `config.ts` lo busca en las rutas conocidas):

```powershell
git clone --branch ccr-6804d5c1-660t6m https://github.com/pacotegg/mediawatch.git C:\mw-prueba
Set-Location C:\mw-prueba
npm ci
npm run build --workspace web

New-Item -ItemType Directory -Path C:\mw-datos -Force | Out-Null
@{ libraries = @(
    @{ name = 'Películas'; path = 'C:\mw-biblioteca-prueba\Peliculas'; kind = 'movie' },
    @{ name = 'Series';    path = 'C:\mw-biblioteca-prueba\Series';    kind = 'show'  }
) } | ConvertTo-Json -Depth 5 | Set-Content -Path C:\mw-datos\config.json -Encoding utf8

$env:MEDIAWATCH_DATA_DIR = 'C:\mw-datos'
$env:MEDIAWATCH_PORT     = '8799'
npm start
```

Después: abrir `http://localhost:8799`, crear el administrador con un PIN elegido por ti, pegar la clave de TMDb en Ajustes → Metadatos y pulsar «Identificar ahora».

Predicción (no medida): se identifican Blade Runner, Blade Runner 2049, The Matrix, Amélie, Alien, Origen, El laberinto del fauno, Dune: Parte Dos, 1917, Heat, Breaking Bad, Friends y Stranger Things. Quedan dudosos `Dune` (sin año, hay dos), `Pelicula inventada xyz123` (sin resultados) y `The Office US` (TMDb la llama «The Office»).

## No tocado
`E:\`, el HTPC, la tele, `C:\tvwatch` y cualquier PR.

## Siguiente paso
Crear el repo vacío y privado `mediawatch-server` en https://github.com/new (sin README, `.gitignore` ni licencia) y avisar para seguir con el hito 3.
