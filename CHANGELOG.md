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

## 3.86 — 29/10/2026

- Caja de coleccionista: sin «TVWATCH ARCHIVE», con el año junto al título; reparto, género y estudio en dos líneas si hace falta; el audio con Atmos aparece primero y los subtítulos van del mismo color. Chips más bajos y más aire sobre la pestaña de abajo.
- Los extras se ven a pantalla completa y en horizontal, como la película.

## 3.85 — 28/10/2026

- «Instalar» en el aviso de versión nueva descarga la versión y abre el instalador desde la propia app, también en Google TV, que no tiene navegador. La primera vez Android pide permitir instalar desde Media Watch.
- El texto que se manda a la tele desde el mando ya no falla si lleva una barra invertida o un salto de línea. Con la tele actualizada, las teclas del mando llegan al momento y ya no se pierde ninguna al pulsar seguido.
- En la ficha, «Producida por» va centrado y los logos de los estudios uno al lado de otro a todo el ancho, también sin el estuche 3D.
- El estuche 3D de la ficha sube hasta la altura del título, sin dejar hueco a su lado.
- La app ocupa la mitad: de 16,5 a 7,5 MB.

## 3.84 — 28/10/2026

- «Actualizar biblioteca» enseña por dónde va el escaneo («Escaneando Películas: 340 de 1400») y avisa al terminar con cuántos títulos ha visto; también si lo lanzó otro aparato.
- «Quién está viendo» permite cerrar la sesión de un aparato (tendrá que volver a entrar con el PIN), marca cuál es el tuyo y en Ajustes dice cuántos aparatos reproducen ahora.

## 3.83 — 28/10/2026

- Los administradores tienen en Ajustes «Quién está viendo»: qué ve cada aparato, por dónde va, si el servidor lo transcodifica, y pueden mandarle un mensaje o parar lo que ve.
- Nueva opción «Actualizar biblioteca» en Ajustes para administradores: escanea toda la biblioteca o solo una carpeta, sin tener que ir a la web.

## 3.82 — 26/10/2026

- Los administradores pueden editar los datos de una película desde su ficha (Editar → Editar datos): título, sinopsis, géneros, saga, año, estudio y más. El escáner respeta lo que cambies y se puede deshacer.
- Las películas de una misma saga salen juntas y por año de estreno en las listas ordenadas por título (Alien, Aliens, Alien³…).
- La duración de cada película sale de su fichero (El Conjuro dejó de poner 3h 43m).

## 3.81 — 26/10/2026

- Las carátulas, fondos, logos y discos se actualizan al momento cuando se cambian desde el editor de metadatos (antes se seguía viendo la imagen vieja hasta un mes).
- Los logos de estudio salen sin el margen vacío que traían muchos de ellos.
- En las bibliotecas de series ya funciona el filtro de calidad, y «solo no vistos» deja las series a medias.

## 3.80 — 22/10/2026

- Calidad original fuera de casa: añadida la opción «Original» al selector de calidad fuera de casa (datos móviles) en los ajustes, permitiendo reproducción directa sin límite de bitrate o recodificación forzada a 1080p.

## 3.79 — 22/10/2026

- Bibliotecas con pestañas «Recomendado» y «Biblioteca»: al estilo Plex en Android y Google TV / Android TV, con filas de continuar viendo en esa biblioteca, añadido recientemente y mejor valoradas.
- Rejilla adaptativa perfeccionada: ajuste del tamaño mínimo de carátulas a 100 dp para garantizar 3 columnas en móviles con fuentes o pantallas aumentadas (como Pixel) sin agrandar excesivamente los pósteres.
- Estuche 3D interactivo con discart activado por defecto en la ficha.

## 3.78 — 22/10/2026

- Sincronización labial en transcodificación: resuelto el desfase de casi 3 segundos de audio al pausar, reanudar o avanzar en vídeos transcodificados por hardware.
- Arranque instantáneo: eliminada la predescarga en paralelo de todas las pistas de subtítulos incrustadas al iniciar o buscar, evitando colas de extracción en el servidor y pantallas de carga prolongadas.

## 3.77 — 22/10/2026

- Compatibilidad en tabletas: los vídeos en HEVC de 10 bits se recodifican automáticamente por hardware en aparatos sin decodificador para 10 bits, evitando tirones y desincronización de audio tras pausar o saltar.
- Rendimiento y estabilidad: activado `largeHeap` para blindar la memoria frente a recolecciones de basura en tabletas y dispositivos con 2–3 GB de RAM durante el búfer de reproducción.
- Detección precisa de hardware: ignorados los decodificadores software del sistema para HEVC, VP9 y AV1, garantizando que el servidor transcodifique cuando el chip no tiene aceleración física.

## 3.76 — 21/10/2026

- Edición coleccionista: el disco ya no gira sin parar; da un giro corto al abrir la caja y se queda recto, en su sitio.
- Fichas y caja coleccionista: el audio sale con su nombre limpio («Dolby Digital Plus Atmos 5.1», «Dolby TrueHD Atmos 7.1», «DTS-HD Master Audio»…) en lugar del identificador interno, y sin repetir pistas iguales.

## 3.75 — 21/10/2026

- Series con especiales: la ficha se abre siempre en la Temporada 1 (antes podía abrirse en los especiales). La pestaña «★ Especiales» sigue saliendo la primera, ahora destacada en ámbar y con un aro fino.

## 3.74 — 19/10/2026

- Administradores: nuevo botón «Reiniciar el servidor con aviso» en Ajustes. Avisa a todos los aparatos («Mantenimiento en curso, volvemos en un minuto») y lo reinicia, ahora o cuando nadie esté viendo nada, sin tener que estar delante del ordenador. Se puede cancelar.
- Ficha: salen los logos de todos los estudios, de dos en dos y con «Producida por», no solo el primero.

## 3.73 — 19/10/2026

- Logo del estudio en la ficha: los que son negros (EON, United Artists, Columbia…) ya no se pierden sobre el fondo oscuro; los de color se ven con su color. Además, los logos tienen ahora más resolución.
- En tablet, el botón «Reproducir» ya no ocupa todo el ancho de la pantalla.

## 3.72 — 19/10/2026

- La 3.71 se cerraba al abrir cualquier ficha (Android rechazaba el código del reproductor tal como salía compilado). Corregido: trae todo lo de la 3.71 (el progreso vuelve a guardarse, modo maratón y reloj al encadenar episodios).

## 3.71 — 19/10/2026

- Reproductor: la app vuelve a guardar por dónde vas. Desde el 11/10 el progreso no llegaba al servidor (ni el «Continuar viendo», ni el «visto» al acabar un episodio); ahora se guarda cada 15 s, al salir y al pasar al siguiente.
- Modo maratón de vuelta: al encadenar episodios de una serie salta solo la cabecera y el resumen. Ya no salta nada al abrir un episodio a mano ni al reanudar. Se activa y desactiva en Ajustes.
- Al pasar al siguiente episodio, el tiempo de la barra empezaba con el del episodio anterior. Corregido.

## 3.70 — 19/10/2026

- Edición coleccionista 3D (móvil y Google TV): el disco ya no se ve girar con la caja cerrada. Se queda quieto mientras la tapa lo cubre y se asienta cuando la tapa pasa de la mitad.
- Edición coleccionista 3D: la tapa se abre más despacio y con un pequeño rebote al final, y la inclinación con el dedo o el mando es más suave.
- Edición coleccionista 3D: abierta ya no está quieta. La caja flota y el disco gira despacio bajo un reflejo fijo.

## 3.69 — 18/10/2026

- Logos de estudio en alta resolución: presencia del logotipo oficial de la productora optimizado bajo la carátula y en el libreto interior.
- Edición coleccionista 3D: libreto interior con eslogan oficial de la obra, ficha ampliada a 6 actores y estudio de producción.
- Transición fluida y aviso de edad: sincronización de metadatos de clasificación por edades y motivos de calificación.

## 3.68 — 18/10/2026

- Eliminación de saltos forzados de cabecera: las cabeceras se ofrecen ahora siempre de forma opcional mediante el botón interactivo sin saltos automáticos no deseados.
- Arreglo de arranques y reanudación: umbral mínimo de 45 segundos para reanudar el progreso, evitando cortes prematuros al iniciar reproducción.

## 3.67 — 17/10/2026

- Marcas de capítulos en la barra de reproducción: división visual de alta visibilidad para identificar cada escena en la línea de tiempo.
- Enriquecimiento automático de capítulos para películas: soporte para esquemas con nombres reales de escenas desde ChapterDB.
- Acceso directo a capítulos en Smart TV: pulsar abajo desde los controles del reproductor abre directamente el selector de capítulos con miniaturas.

## 3.66 — 17/10/2026

- Historial de versiones: acceso al registro completo de cambios y novedades de la aplicación desde Ajustes.
- Buscador mejorado: películas y series se muestran siempre en primer lugar, personas a continuación y frases al pie, con tolerancia a búsquedas inexactas y erratas.

## 3.65 — 17/10/2026

- Marcado de episodios vistos: al encadenar automáticamente con el siguiente episodio, se preserva el estado de visto si el metraje superaba el 88 % de la duración.
- Pantalla completa y controles táctiles en web móvil: soporte de pantalla completa en iOS Safari (WebKit) y alternancia de controles con toque en pantalla sin pausar involuntariamente el vídeo.

## 3.64 — 17/10/2026

- Acciones directas por episodio en series: botones compactos para marcar visto/no visto, «En la tele» para enviar a la Smart TV y descarga local.
- Siguiente episodio estilo Netflix/Plex: tarjeta visual flotante con miniatura 16:9, cuenta atrás y salto instantáneo o descartar y seguir con los créditos.
- Seguridad en red: la aplicación confía exclusivamente en certificados del sistema operativo para conexiones remotas.
- Búsqueda de subtítulos: soporte para consultas prolongadas sin cierres prematuros de conexión.

## 3.63 — 16/10/2026

- Siguiente episodio estilo Netflix/Plex (Android, TV y Web): tarjeta visual flotante con miniatura 16:9 del siguiente episodio, cuenta atrás de 12 segundos y botones para ver ahora o descartar y seguir viendo los créditos.
- Marcadores de créditos desde capítulos: detección automática de créditos a partir de la estructura de capítulos de archivo (MKV/MP4) con nivel de confianza.
- Sincronización comunitaria con IntroDB y SkipDB: integración y afinado de tramos de introducción y créditos en series y películas.

## 3.62 — 16/10/2026

- Edición coleccionista 3D (móvil): con la caja cerrada se veía el disco en vez de la carátula, porque la tapa quedaba pintada detrás de la bandeja. Ahora la tapa va por delante y se ve girar al abrirla.
- Edición coleccionista 3D (móvil): el libreto decía «AUDIO: HEVC» (el códec de vídeo) cuando aún no estaba cargada la información de reproducción. Ahora sale el audio real del fichero, por ejemplo «TrueHD Atmos 7.1».
- Edición coleccionista 3D (Google TV): el visor se rehace con la misma apertura que el móvil —tapa de dos caras que gira sobre la bisagra, libreto con dirección, reparto, sinopsis y ficha técnica, disco que gira hasta pararse recto— y su tamaño sale de la pantalla (antes se salía por abajo a 1080p).
- Estuche de Google TV: el destello de la carátula se dibuja sin recomponer todo el estuche en cada fotograma.
- Buscar y bajar subtítulos de internet (administradores): esperan lo que espera el servidor (hasta 90 s y 2 min) en vez de darse por fallidos a los 25 s y no decir nada.
- Seguridad: la app solo confía en los certificados del sistema, no en los que instale el usuario.

## 3.61 — 16/10/2026

- Edición coleccionista 3D: apertura real tipo libro/bisagra con perspectiva física en 3D, sin deslizamiento plano.
- Libreto interior enriquecido y de alto contraste: texto nítido y legible con dirección, reparto completo, sinopsis, badges técnicos (resolución, HDR, códec) y detalle real de pistas de audio y subtítulos.
- Estuche en cabecera: carátula 3D integrada junto al año, calificación y datos técnicos para acceso inmediato.

## 3.60 — 16/10/2026

- Edición coleccionista 3D: efecto cinemático con acercamiento y apertura real de la caja desde cerrada hasta abierta, con el disco girando en el interior hasta pararse recto.
- Pantalla completa y apaisado: tamaño reactivo que aprovecha al máximo la pantalla en vertical y en modo apaisado / horizontal.

## 3.59 — 15/10/2026

- Edición coleccionista 3D: nueva transición animada de apertura de caja. Con un clic se despliega la portada en 3D mientras el disco gira desacelerando elásticamente hasta clavarse en 0°, mostrando el libreto interior con ficha técnica y libreto físico.
- Ficha: estuche 3D reubicado en la cabecera superior junto a los datos técnicos para mayor visibilidad sin tener que bajar.

## 3.58 — 15/10/2026

- Reproductor: botón «Saltar resumen» para el «Anteriormente en…» del principio de los episodios (en las series donde se ha detectado). En modo maratón se salta solo, como la cabecera.
- Cuando algo no se puede reproducir (por ejemplo, se ha acabado el tiempo de hoy de un perfil, o el título no está disponible para ese perfil), la app dice el motivo en vez de «El servidor respondió 403».

## 3.57 — 15/10/2026

- Reproductor: imagen sobre imagen. Al salir de la app con una película en marcha, sigue viéndose en una ventanita (Android 8 o más; en una tele no).
- Buscar y descargar subtítulos de internet es cosa del administrador: se guardan para todos los perfiles y gastan el cupo diario de descargas. Los demás perfiles ya no ven la opción.

## 3.56 — 13/10/2026

- Seguridad: la app ya no entra en la copia de seguridad automática de Android, así que la sesión iniciada no viaja a la nube ni se restaura en otro móvil. Al cambiar de móvil hay que volver a conectar y elegir perfil.

## 3.55 — 13/10/2026

- Reproductor: al abrir el ajuste de sincronía de subtítulos en vivo, la reproducción se pausa automáticamente y los controles se ocultan para ver la imagen limpia y aplicar el desfase en tiempo real.

## 3.54 — 12/10/2026

- Soporte multi-idioma (i18n): interfaz en inglés por defecto para nuevas instalaciones y selector directo entre inglés y español en Ajustes (Experiencia y Presentación). Las instalaciones existentes mantienen su idioma preferido.

## 3.53 — 12/10/2026

- Búsqueda y descarga directa de subtítulos desde la app y la tele: descarga online multifuente (SubSource y OpenSubtitles con comprobación de correlación cruzada contra el audio) y guardado automático en el servidor sin tocar la biblioteca en disco.
- Persistencia de desfase y sincronía de subtítulos: cualquier ajuste de retardo (±ms) se guarda en la base de datos del servidor y se reutiliza automáticamente en futuras reproducciones en Android, Google TV, Smart TV y Web.
- Corrección de navegación espacial D-pad en Smart TV: salto limpio y directo desde el último botón de acciones a la carátula 3D, y retorno directo a los botones de acción sin desviarse al reparto.

## 3.52 — 12/10/2026

- Estuche 3D y disco completamente recto a 0° en Android, Google TV, Smart TV y Web: orientación cuadrada y nivelada en todo momento para máxima legibilidad de títulos y personajes.
- Desplazamiento ampliado del disco: extracción holgada y destacada al lado de la carátula sin recortes ni colisiones.
- Visor «Edición Coleccionista» en móvil: Steelbook abierto interactivo con carátula, lomo bisagra, bandeja con disco completo, inclinación 3D táctil y especificaciones técnicas.

## 3.51 — 11/10/2026

- Estuche 3D interactivo en TV y Google TV: disco estático a 0° siempre derecho y legible (sin voltearse de cabeza) con destello holográfico iridiscente.
- Navegación espacial D-pad en Smart TV y Google TV: salto directo a la carátula 3D desde la fila de acciones con realce y deslizamiento dinámico.
- Visor «Edición Coleccionista» a pantalla completa: apertura inmersiva tipo Steelbook con carátula en alta definición, disco gigante en bandeja e inclinación 3D en tiempo real con las flechas del mando.

## 3.50 — 11/10/2026

- Estuche 3D interactivo coleccionista: escaparate 3D de alta definición, rotación táctil libre en tiempo real, disco extraíble holgado sin cortes en pantalla y distinción 4K UHD / Blu-ray.
- Borrado y edición de metadatos para administradores: botones dedicados de «Editar» y «Eliminar» (en rojo con diálogo de confirmación de seguridad) en Android, Google TV y Web.
- Paridad en Google TV: integración del estuche 3D panorámico en ficha y herramientas de administración directa.

## 3.49 — 11/10/2026

- Hora de fin en el reproductor: muestra la hora estimada a la que terminará la reproducción en tiempo real («Termina a las HH:MM»), recalculada al pausar o avanzar.
- Descarga automatizada de sintonías: soporte integrado de temas de cabecera musicales para títulos de la biblioteca (Plex CDN y ThemerrDB) guardados en servidor.

## 3.48 — 11/10/2026

- Modo Maratón: salto automático configurable de intros y cabeceras en series.
- Música de cabecera: reproducción ambiental sutil de la banda sonora al abrir la ficha de una película o serie (desactivable en Ajustes).
- Modos de audio dinámicos y capítulos visuales: selector en caliente en el reproductor (Normal, Modo noche y Realce de diálogos) junto a navegación por capítulos con miniaturas.
- Estuche 3D interactivo: visualización de la caja física en 3D con disco extraíble (4K UHD, Blu-ray, DVD) animado según el formato original del título.
- Mando virtual para Smart TV: control remoto interactivo con cruceta direccional y envío de texto directo desde la app Android a la tele del salón.
- Búsqueda por diálogo: localización de películas y episodios por frases exactas habladas en sus subtítulos con salto al segundo exacto.
- Desplazamiento en Héroe: navegación táctil fluida hacia delante y atrás en el carrusel de portada.

## 3.47 — 10/10/2026

- Sagas y colecciones completas en la ficha: carrusel interactivo con las películas de la misma saga (en orden cronológico) para saltar de una a otra al instante.
- Títulos similares: recomendaciones directas de películas y series relacionadas por género y temática debajo del reparto.
- Dirección interactiva: el nombre del director en la ficha ahora es pulsable para explorar directamente toda su filmografía en la biblioteca.
- Detección precisa de 4K y 1080p: soporte de resoluciones panorámicas/cinemascope (2.39:1 / 21:9) en las etiquetas técnicas de calidad.
- Disponible en móvil y en la interfaz adaptada para Google TV.

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
