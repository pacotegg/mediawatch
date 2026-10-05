# Changelog

Historial de **Media Watch**. La versión que se numera es la de la app Android;
el servidor, la web y la tele se despliegan a la vez y no llevan número propio.

Cada sección `## <versión> — <fecha>` es la que muestra la app la primera vez que
se abre esa versión. Al escribir una versión nueva, mantener ese formato: la app
lee las líneas que empiezan por `- ` dentro de la sección de su `versionName`.

Solo se escribe lo que sale de un commit o del dosier. Las versiones sin registro
(3.3–3.6, 3.9–3.12, 3.15–3.16, 3.18–3.21 y 3.24) no tienen sección: ningún commit
ni el dosier dice qué traían. Los commits que caen entre dos versiones se recogen
al final, en bloques por intervalo, sin asignarlos a un número.

## 3.26 — 05/10/2026
- Doble toque a los lados del vídeo: salta 10 s atrás o adelante, con aviso en pantalla.

## 3.25 — 05/10/2026
- Descargas unificadas: se oculta la copia del servidor si ya está descargada en el móvil.
- Bloqueo de descargas duplicadas si el archivo ya existe en el dispositivo.
- Borrado automático de la copia temporal en el servidor tras descargar al teléfono.
- Modo sin conexión: reproduce las descargas guardadas en el móvil sin red.

## 3.23 — 05/10/2026
- Varias versiones de una misma película: se elige cuál ver.
- Perfiles infantiles.
- Salvapantallas infantil.
- Web adaptada a móviles y iOS.

## 3.22 — 05/10/2026
- Descargas configurables, con calidad al estilo Plex: Baja (360p), Móvil (480p), HD (720p), Full HD (1080p) u Original.
- Descargas en Android mediante DownloadManager.

## 3.17 — 30/09/2026
- Menú Plataformas: catálogo de Movistar+, Prime Video y Apple TV+.
- Enlace directo al título desde fuera de la app.
- Respaldo de datos en TMDb cuando falta información.

## 3.14 — 29/09/2026
- Extras de cada título, en los tres clientes.
- Los subtítulos dejan de quedarse en pantalla.

## 3.13 — 26/09/2026
- Encaje de vídeo en el reproductor.
- Reanudar la reproducción donde se dejó.
- Ficha rediseñada.

## 3.8 — 22/09/2026
- Los saltos en el reproductor ya no se atascan.
- Dolby (AC3, DD+), TrueHD y DTS se decodifican dentro de la app con el módulo nativo FFmpeg.

## 3.7 — 16/09/2026
- Pestaña Actividad para el administrador.
- PIN de seis cifras para los perfiles.
- Arte en forma de disco, fijo encima del título y de la barra.
- Escritura en vivo desde el móvil hacia la tele.

## 3.2 — 16/09/2026
- Primera versión nativa para Android (Kotlin y Compose): portada, bibliotecas,
  fichas, reproductor, búsqueda, favoritas y Chromecast.
- Recogido del dosier del proyecto; no hay commit con esa versión.

## Entre 3.8 y 3.13 (22/09 – 26/09, sin número propio)
- Subtítulos: comparación con los incrustados, desfase ajustable y reescritura de los externos desincronizados.
- Escaneo por lotes que no bloquea el servidor.
- Personas: biografía, IMDb y TVDB.
- Mantenimiento desde Ajustes: cachés, copia de seguridad y optimizar la base.
- Salvapantallas en la tele, en el menú y en pausa.
- Acceso desde fuera: se cierran las acciones destructivas y se valida el QR.
- Servidor: latido, peticiones en vuelo y cierre de flujos parados.

## Entre 3.14 y 3.17 (29/09 – 30/09, sin número propio)
- Títulos presentables para los vídeos sueltos.
- Géneros de IMDb en las cinco bibliotecas.

## Entre 3.17 y 3.22 (30/09, sin número propio)
- Rejilla de la tele con cabecera fija, más filas, abecedario continuo y más episodios.
- Episodios como cajas con miniatura y carátulas de la rejilla a 8 columnas.
- Carátulas de Seguir viendo más grandes (de 110x165 a 150x225).
- El escáner no pisa una duración medida ni la del .nfo.
- Créditos de películas: un fichero sin índice de saltos falla en 45 s, no en 20 min.
