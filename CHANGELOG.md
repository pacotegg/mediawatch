# Changelog

Historial de **Media Watch**. La versión que se numera es la de la app Android;
el servidor, la web y la tele se despliegan a la vez y no llevan número propio.

Cada sección `## <versión> — <fecha>` es la que muestra la app la primera vez que
se abre esa versión. Al escribir una versión nueva, mantener ese formato: la app
lee las líneas que empiezan por `- ` dentro de la sección de su `versionName`.

## 3.25 — 05/10/2026
- Descargas unificadas: se oculta la copia del servidor si ya está descargada en el móvil.
- Borrado automático de la copia temporal en el servidor tras descargar al teléfono.
- Bloqueo de descargas duplicadas si el archivo ya existe en el dispositivo.

## 3.24 — 05/10/2026
- Modo sin conexión en Android: pantalla de aviso con acceso directo a tus descargas locales cuando no hay red.
- Reproductor local sin conexión: reproducción directa de archivos MP4 y MKV en el móvil con ExoPlayer.
- Rediseño de cuadros de diálogo e interfaz con nuevos iconos vectoriales.

## 3.23 — 05/10/2026
- Varias versiones de una misma película: se elige cuál ver.
- Perfiles infantiles.
- Salvapantallas infantil.
- Web adaptada a móviles y iOS.

## 3.22 — 05/10/2026
- Descargas configurables, con calidad al estilo Plex (Baja, Móvil, HD 720p, Full HD 1080p, Original).
- Descargas en Android mediante DownloadManager.

## 3.18–3.21 — 30/09/2026
- Rejilla de la tele con cabecera fija, más filas, abecedario continuo y más episodios.
- Episodios presentados como cajas con miniatura y carátulas de rejilla a 8 columnas.
- Carátulas de Seguir Viendo más grandes (de 110x165 a 150x225).
- Escáner optimizado para no pisar duraciones medidas y detección rápida de créditos.

## 3.17 — 30/09/2026
- Menú Plataformas: catálogo de Movistar+, Prime Video y Apple TV+.
- Enlace directo al título desde fuera de la app (deep linking).
- Respaldo de datos en TMDb cuando falta información.

## 3.15–3.16 — 29/09/2026
- Títulos presentables para vídeos sueltos en el escáner.
- Reorganización de bibliotecas y géneros de IMDb en las 5 secciones.

## 3.14 — 29/09/2026
- Extras de cada título, en los tres clientes.
- Los subtítulos dejan de quedarse en pantalla.

## 3.13 — 26/09/2026
- Encaje de vídeo en el reproductor.
- Reanudar la reproducción donde se dejó.
- Ficha rediseñada.

## 3.9–3.12 — 22/09/2026 – 26/09/2026
- Subtítulos: comparación con los incrustados, desfase ajustable durante la reproducción y extracción.
- Escaneo por lotes que no bloquea el servidor.
- Personas: biografía, IMDb y TVDB.
- Salvapantallas en la tele (menú y pausa).
- Mantenimiento desde Ajustes: cachés, copia de seguridad y optimización VACUUM.

## 3.8 — 22/09/2026
- Los saltos en el reproductor ya no se atascan.
- Dolby (AC3, DD+), TrueHD y DTS se decodifican dentro de la app con el módulo nativo FFmpeg.

## 3.3–3.6 — 16/09/2026 – 22/09/2026
- Escritura en vivo en la tele desde el buscador del móvil.
- Ajuste de latido de reproductor y cierres de sesión HLS automáticos.
- Mejoras de rendimiento en la rejilla de portadas de la app Android.

## 3.7 — 16/09/2026
- Pestaña Actividad para el administrador.
- PIN de seis cifras para los perfiles.
- Arte en forma de disco, fijo encima del título y de la barra.

## 3.2 — 16/09/2026
- Primera versión nativa para Android (Kotlin y Compose): portada, bibliotecas,
  fichas, reproductor, búsqueda, favoritas y Chromecast.

## Servidor, web y tele (sin versión propia)

### 26/09/2026
- Subtítulos: comparación con los incrustados, desfase ajustable, búsqueda de los que faltan.
- Escaneo por lotes que no bloquea el servidor.
- Personas: biografía, IMDb y TVDB.
- Mantenimiento desde Ajustes: cachés, copia de seguridad y optimizar la base.
- Salvapantallas en la tele.

### 29/09/2026
- Extras en los tres clientes.
- Géneros de IMDb en las cinco bibliotecas.

### 30/09/2026
- Títulos presentables para los vídeos sueltos.
- Abecedario y rejilla nueva en la tele, con episodios con miniatura.
