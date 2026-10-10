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

## 3.46 — 10/10/2026

- Respuesta táctil física (háptica): respuesta de vibración sutil al desenganchar y mover elementos al reordenar el menú.
- Mayor fluidez de scroll en bibliotecas grandes: claves fijas de memoria y disco en Coil para un reciclaje instantáneo de carátulas sin parpadeos.
- Acabado visual unificado: radio de esquinas a 14 dp en todas las carátulas (móvil y Google TV) con filete antirreflejo para títulos con fondos oscuros.

## 3.45 — 10/10/2026

- Título en español en la ficha: en películas con logotipo gráfico se muestra su título en español justo sobre el año y duración, tanto en móvil como en Google TV.
- Subtítulos en Cast más claros: la lista de pistas muestra el nombre descriptivo del subtítulo (p. ej. comentarios, forzados, versión) además del idioma para distinguirlos de un vistazo.

## 3.44 — 09/10/2026

- Cast: si le das al icono de Cast con la película ya en marcha en el móvil, ahora la manda a la tele desde donde va (antes conectaba y no enviaba nada).
- Cast: si la tele no acepta el vídeo, la app lo dice y deja el motivo en el informe técnico.

## 3.43 — 09/10/2026

- «Mis plataformas»: en Plataformas, la pestaña «＋ Plataformas» lista todas las que hay en España (Netflix, Disney+, HBO Max, SkyShowtime, Filmin…). Al pulsar una, se abre su aplicación; con «Conectar» marcas las que tienes contratadas y los títulos dirán «también en…» solo de las tuyas.

## 3.42 — 09/10/2026

- «Reanudar» ahora dice también cuánto falta de película, además de por dónde se quedó.

## 3.41 — 09/10/2026

- El destacado de la portada cambia con un fundido en vez de deslizarse: ya no se ven dos películas a medias con los textos cortados. También se cambia arrastrando de lado a lado.

## 3.40 — 09/10/2026

- Reordenar el menú: ahora se puede arrastrar una entrada varios puestos de una vez y por todo el menú (se desplaza solo al llegar al borde).
- El destacado de la portada: «Buscar» queda fijo y la imagen ya no se sale de su tarjeta al cambiar de destacado.

## 3.39 — 09/10/2026

- Reordenar el menú arrastrando: deja pulsada una entrada del menú lateral y arrástrala arriba o abajo; aparece un ojo en cada una para esconderla o mostrarla, y «Listo» sale. Ya no hay opción aparte en Ajustes.

## 3.38 — 09/10/2026

- Audio y subtítulos también en la ficha de las series: lo que elijas vale, por idioma, para todos sus episodios (en el reproductor y en Cast).
- Reordenar el menú (secciones y bibliotecas); el orden también vale para los atajos de la portada.

## 3.37 — 09/10/2026

- La ficha sigue el estilo de la app de la tele: solo «Reproducir» lleva texto; el resto son iconos con su nombre debajo.
- Audio y subtítulos se eligen desde la ficha antes de reproducir, y la elección pasa al reproductor y a Cast.
- El idioma de audio preferido (Ajustes → «Idioma de audio») ahora se aplica de verdad: por defecto, español si existe.
- Cast: nuevo botón de audio en el control ampliado, junto al de subtítulos.

## 3.36 — 08/10/2026
- Arreglo de un fallo que dejaba la portada en blanco y cerraba la app al entrar solo desde fuera de casa con el dominio.
- Si el servidor no responde, la portada lo dice con la dirección a la que intenta conectar y deja de esperar.
- Informes técnicos opcionales (Ajustes): la app envía al servidor errores y tiempos de conexión, sin contraseñas ni lo que ves, para poder arreglar fallos.

## 3.35 — 08/10/2026
- Selección limpia de subtítulos: desactivados por defecto; se eligen únicamente desde la ficha o en reproducción.
- Soporte completo para subtítulos PGS con OCR y subtítulos externos/internos sincronizados.

## 3.34 — 07/10/2026
- Robustez de red y peticiones: reintentos automáticos transparentes y recuperación ante microcortes o reinicios de servidor.
- Navegación espacial corregida en televisor: los desplazamientos arriba/abajo mantienen la alineación vertical sin saltos laterales.

## 3.33 — 07/10/2026
- Salto y rebobinado rápido en Google Cast: respuesta inmediata al avanzar o retroceder metraje en televisores.
- Historial ampliado de novedades: la ventana inicial muestra los cambios de las 3 últimas versiones por si se saltaron actualizaciones.

## 3.32 — 07/10/2026
- Corrección de Google Cast: autodetección estándar de segmentos HLS sin sobreescritura de formato en el cliente.
- Respaldo estéreo automático (AAC) en listas HLS con sonido 5.1 para receptores Cast web en televisores.

## 3.31 — 07/10/2026
- Interfaz adaptada a Google TV y Android TV con navegación completa por mando a distancia.
- Barra lateral cinemática desplegable con iconos vectoriales temáticos para cada biblioteca.
- Nuevos iconos vectoriales en Canvas y destacados dinámicos con zoom suave Ken Burns también en la app móvil.
- Compatibilidad con procesadores de 32 bits (armeabi-v7a) en televisores TCL y Android TV.
- Corrección de Google Cast a televisores: emisión segura por HTTPS y soporte de segmentos MPEG-TS.

## 3.30 — 07/10/2026
- Aviso de versión nueva al abrir la app, con sus novedades y un botón para instalarla.
- «Más tarde» no vuelve a avisar de esa versión, solo de la siguiente.

## 3.29 — 07/10/2026
- Botón «Tráiler» en la ficha: se abre en YouTube, en castellano si lo hay en buena calidad.
- Reseñas en castellano de SensaCine, de prensa y de espectadores, además de las de TMDb en inglés.
- Las críticas de prensa dicen quién las firma y dónde leerlas enteras.
- El PIN admite hasta 12 cifras y, en casa, entra solo al teclear la última.

## 3.28 — 06/10/2026
- El reproductor de descargas ya tiene controles: play/pausa, −10 y +30, y barra con el tiempo.
- Doble toque a los lados del vídeo en una descarga: salta 10 s atrás o adelante.
- Pistas de audio, subtítulos y tamaño de pantalla también al ver una descarga.

## 3.27 — 06/10/2026
- Subtítulos apagados por defecto en los tres clientes: se eligen a mano.
- El reproductor de descargas ya oculta el título a los 5 s y no oscurece la imagen.
- El nombre del fichero descargado se muestra limpio, sin guiones bajos ni perfil.

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
