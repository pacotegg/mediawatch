# Plan: Mejoras Premium y Funciones Exclusivas de Media Watch

**Fecha**: 11/10/2026  
**Objetivo**: Análisis comparativo de Media Watch frente a las principales plataformas de streaming comerciales (Netflix, Apple TV+, Amazon Prime Video) y gestores multimedia avanzados (Plex Pass, Emby Premiere, Infuse Pro). Identificar mejoras que eleven la experiencia a un estándar de lujo ("premium") y funcionalidades exclusivas que ninguna otra plataforma ofrece.

---

## 1. Dónde estamos hoy (Base técnica consolidada)

Media Watch cuenta ya con ventajas arquitectónicas que superan a clientes habituales de Plex/Jellyfin:
- **Reproducción directa por hardware nativo**: MKV, HEVC, AC3 y DD+ (Dolby Atmos JOC) directos sin transcodificación innecesaria vía AVPlay (Tizen) y ExoPlayer (Android).
- **Subtítulos PGS con OCR bajo demanda**: Conversión de mapas de bits PGS a WebVTT nativo (`PgsToSrt` + Tesseract) sin quemar subtítulos en vídeo ni gastar CPU en transcodificaciones de vídeo 4K.
- **Persistencia inteligente de pistas**: Recuerda audio y subtítulos por título y usuario, heredando elecciones entre episodios de series.
- **Discart coleccionista**: Soporte para arte de discos físicos CD/Blu-ray en OSD y biblioteca.
- **«Ver en la tele» bidireccional**: Envío instantáneo de móvil a Smart TV vía socket del servidor (`/api/mando`).
- **Integración de plataformas**: Mapeo de películas a suscripciones reales del usuario (Movistar+, Prime, Apple TV+, Filmin) con apertura de su app nativa.

---

## 2. Mejoras Premium inspiradas en Netflix, Apple TV+, Prime Video e Infuse

### 2.1. Música de cabecera / Theme Music en la ficha (Estilo Plex / Apple TV)
- **Qué es**: Al abrir la ficha de una serie o película, suena en bucle sutil (15–20% de volumen) la melodía o sintonía emblemática del título, con fundido de entrada (fade-in) y de salida (fade-out) al navegar o reproducir.
- **Por qué**: Es el detalle visual y sonoro que más eleva la sensación de producto acabado en Plex y Apple TV+.
- **Implementación técnica**:
  - Servidor: Ruta `GET /api/items/:id/theme` que sirva `theme.mp3` si existe en la carpeta (tinyMediaManager lo descarga) o lo obtenga de TelevisionTunes / TMDb.
  - Clientes: Elemento de audio en segundo plano en Web y TV que se pause al salir o darle al Play.

### 2.2. Hero interactivo con previsualización / Tráiler mudo (Estilo Netflix)
- **Qué es**: En la portada, tras 3–4 segundos de reposo en el título destacado ("héroe"), la imagen estática se funde con un teaser de vídeo o tráiler mudo en bucle con viñeta cinematográfica.
- **Por qué**: Llena la pantalla de dinamismo en salas de estar y ayuda a decidir qué ver sin tener que entrar en la ficha.
- **Implementación técnica**:
  - En Web/Android: `<video>` mudo optimizado con baja resolución (720p) consumiendo el stream del tráiler.
  - En Tizen: En la tele conviene limitar esto a pase de diapositivas suave (Ken Burns) de fanarts para no despertar decodificadores de AVPlay en la portada.

### 2.3. Capítulos visuales interactivos con miniaturas (Estilo Infuse / Apple TV+)
- **Qué es**: En pausa o al pulsar abajo en el reproductor, se despliega una barra horizontal con las tarjetas de cada capítulo: miniatura real del fotograma (extraída del strip de trickplay), título ("Apertura", "El atraco", "Desenlace") y minutaje.
- **Por qué**: Infuse y Apple TV+ hacen que saltar a una escena sea intuitivo y visual, superando a las simples listas de texto.
- **Implementación técnica**:
  - Aprovechar los strips WebP de `api.trickplay(fileId)` ya implementados en el servidor, calculando la posición de corte según la marca de tiempo de cada capítulo del MKV.

### 2.4. Menú de audio nocturno y realce de diálogos en caliente (Estilo Apple TV "Enhance Dialogue")
- **Qué es**: Acceso directo desde el OSD de reproducción para alternar entre:
  - *Directo / Cinemático*: Pista multicanal 5.1/7.1 Atmos sin alterar.
  - *Nocturno*: Compresión de rango dinámico para evitar explosiones estridentes.
  - *Realce de voces*: Acento en frecuencias vocales (+2.5 dB) para entender diálogos en películas con mezclas complejas.
- **Implementación técnica**:
  - Ya soportado en el servidor vía flags `&audiomode=night` y `&audiomode=dialogue`. Falta añadir el selector rápido de un solo toque en los mandos de TV y Android.

### 2.5. Modo maratón inteligente sin cortes (Binge-Watching Seamless)
- **Qué es**: Al encadenar episodios de una serie, saltar automáticamente tanto la recapitulación inicial ("Previously on...") como la intro del nuevo episodio, comenzando directamente en la acción.
- **Implementación técnica**:
  - Leer los rangos detectados de `api.skipRanges(episodeId)` y hacer `t = rango.intro.hasta` en el salto inicial.

---

### 3. Funcionalidades exclusivas que NINGUNA plataforma comercial ofrece

### 3.1. Estuche 3D interactivo con "Discart" extraíble (Exclusiva MediaWatch)
- **Concepto**: Rendir homenaje a las ediciones coleccionista en soporte físico. En la ficha de la película o serie, además de ver el cartel plano, poder ver el estuche (Blu-ray / 4K Ultra HD / Steelbook) y la serigrafía real del disco CD/Blu-ray extrayéndose y girando.
- **Por qué nadie lo tiene**: Las plataformas comerciales venden streaming desmaterializado; no valoran el arte físico de las ediciones coleccionista.
- **Implementación**: Modelo CSS 3D plano (ligero y sin WebGL pesado) en Web y TV utilizando `poster` y `discart`.

### 3.2. Búsqueda exacta por frase de diálogo en toda la biblioteca (Whisper Speech-to-Text)
- **Concepto**: "¿En qué película decía aquel personaje: *'Houston, tenemos un problema'* o *'Hasta la vista, baby'*?"
- **Por qué nadie lo tiene**: Ningún Netflix ni Plex permite buscar en tu almacenamiento local por palabras habladas dentro del vídeo.
- **Implementación**:
  - El pipeline del HTPC ya cuenta con Whisper y extracción de subtítulos. Indexar los ficheros `.vtt` / `.srt` en SQLite FTS5 (Full-Text Search) con marcas de tiempo exactas.
  - Al buscar una frase en el buscador global, devuelve la película y el botón directo "Saltar a este diálogo".

### 3.3. Puente hacia apps oficiales ("¿Dónde verla si no la tienes descargada?")
- **Concepto**: Si buscas una película que no está en el disco `E:\`, el servidor consulta la base de datos de plataformas del usuario e indica: *"No está en tu disco, pero la tienes incluida en tu suscripción de Movistar+ / Prime Video"*, con un botón que abre directamente la app oficial de la Smart TV en esa película.
- **Por qué nadie lo tiene**: Plex o Jellyfin ignoran lo que no tienes en disco. MediaWatch integra tu colección local con tu catálogo por streaming.

### 3.4. Comparador de calidad en pantalla ("BDRip 4K vs Remux vs MicroHD")
- **Concepto**: En títulos con más de un fichero o al valorar una recodificación, mostrar insignias técnicas reales con telemetría:
  - Bitrate medio de vídeo medido.
  - Espacio de color (HDR10, HDR10+, Dolby Vision).
  - Códec de audio (TrueHD Atmos, DTS-HD MA vs DD+).
  - Comparativa de calidad lado a lado o conmutador de fichero sin perder el segundo de reproducción.

### 3.5. Mando a distancia virtual bidireccional desde el móvil
- **Concepto**: Al tener la app Android abierta, poder usar el móvil como mando táctil y teclado físico para la Smart TV (flechas, enter, play/pause, y escritura en búsquedas) aprovechando la conexión de `/api/mando`.

---

## 4. Tabla de priorización y esfuerzo estimado

| Funcionalidad | Categoría | Clientes afectados | Esfuerzo | Impacto visual / usuario |
|---|---|---|---|---|
| **Theme Music en Ficha** | Premium | Web, TV, Android | S (pequeño) | Muy alto (inmersión inmediata) |
| **Capítulos visuales con trickplay** | Premium | Web, TV, Android | M (medio) | Muy alto (experiencia Infuse/Apple TV) |
| **Realce de voces / Nocturno en OSD** | Calidad de vida | TV, Web, Android | S (pequeño) | Alto (comodidad de escucha en salón) |
| **Mando táctil/teclado en móvil para TV**| Exclusiva | Android + TV | M (medio) | Alto (soluciona escribir en la tele) |
| **Búsqueda por diálogo FTS5** | Exclusiva | Servidor + Buscador | M (medio) | Diferenciador absoluto |
| **Estuche coleccionista 3D con Discart**| Exclusiva | Web, TV | S (pequeño) | Estético / coleccionista |
| **Binge-Watching seamless (auto-skip)** | Premium | Web, TV, Android | S (pequeño) | Alto para series |
