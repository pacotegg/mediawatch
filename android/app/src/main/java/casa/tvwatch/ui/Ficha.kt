package casa.tvwatch.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import android.widget.Toast
import casa.tvwatch.datos.Progreso
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import kotlinx.coroutines.delay
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.zIndex
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.Spring
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.AudioDeFichero
import casa.tvwatch.datos.PistaAudio
import casa.tvwatch.datos.EleccionDePistas
import casa.tvwatch.datos.InfoReproduccion
import casa.tvwatch.datos.Pistas
import casa.tvwatch.datos.AppsDePlataforma
import casa.tvwatch.datos.PlataformaTitulo
import casa.tvwatch.datos.Extra
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Episodio
import casa.tvwatch.datos.Ficha
import casa.tvwatch.datos.Resena
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * La ficha de una película o una serie.
 *
 * Una sola columna sobre el fotograma: identidad, datos, sinopsis y acciones en
 * el orden en que se leen. No hay cartel porque el fondo ya es la imagen.
 *
 * Las etiquetas técnicas (4K, HEVC, HDR10, el audio) van en su propia línea y
 * no encima del fotograma: en una pantalla estrecha se comían las notas de
 * IMDb, que es el fallo que tenía la web.
 */
@Composable
fun PantallaFicha(
  itemId: Int,
  alReproducir: (fileId: Int, episodioId: Int?, desde: Double) -> Unit,
  alCambiarImagenes: (kind: String, titulo: String, anio: Int?) -> Unit,
  alPerderSesion: () -> Unit,
  alAbrirPersona: (Int) -> Unit = {},
  alAbrirFicha: (Int) -> Unit = {},
  alVolver: () -> Unit = {},
) {
  val contexto = LocalContext.current
  val ambitoTele = rememberCoroutineScope()
  fun mandarALaTele(fileId: Int, episodioId: Int?, desde: Double) {
    ambitoTele.launch {
      val texto = try {
        withContext(Dispatchers.IO) { Api.verEnLaTele(fileId, itemId, episodioId, desde) }
        "Enviado a la tele. Si está en el reproductor, lo recoge al salir."
      } catch (e: Exception) {
        "No se pudo enviar: " + (e.message ?: "sin respuesta")
      }
      Toast.makeText(contexto, texto, Toast.LENGTH_LONG).show()
    }
  }
  var ficha by remember(itemId) { mutableStateOf<Ficha?>(null) }
  var fallo by remember(itemId) { mutableStateOf("") }
  var intento by remember(itemId) { mutableStateOf(0) }
  var temporada by remember(itemId) { mutableStateOf<Int?>(null) }
  var sinopsisAbierta by remember(itemId) { mutableStateOf(false) }
  var dialogoBorrar by remember(itemId) { mutableStateOf(false) }
  var dialogoEditar by remember(itemId) { mutableStateOf(false) }
  var mostrarColeccionista by remember(itemId) { mutableStateOf(false) }
  var borrando by remember(itemId) { mutableStateOf(false) }
  /*
   * Favorito y visto se pintan al instante y se mandan después. Esperar a que
   * conteste el servidor para que la estrella cambie de color hace que la
   * aplicación parezca lenta aunque tarde 30 ms; si falla, se deshace.
   */
  var esFavorita by remember(itemId) { mutableStateOf(false) }
  var estaVista by remember(itemId) { mutableStateOf(false) }
  // Los extras se piden aparte para no retrasar la ficha, que es lo que se mira.
  var extras by remember(itemId) { mutableStateOf<List<Extra>>(emptyList()) }
  var extraViendo by remember(itemId) { mutableStateOf<Extra?>(null) }
  var resenas by remember(itemId) { mutableStateOf<List<Resena>>(emptyList()) }
  /*
   * Dónde verlo fuera de casa. Solo informa y abre la app de la plataforma: van
   * cifradas y no se pueden reproducir aquí. También aparte, para no retrasar la
   * ficha por un dato secundario.
   */
  var dondeVer by remember(itemId) { mutableStateOf<List<PlataformaTitulo>>(emptyList()) }
  var fileIdDescargaDialogo by remember(itemId) { mutableStateOf<Int?>(null) }
  var infoPistas by remember(itemId) { mutableStateOf<InfoReproduccion?>(null) }
  // null = «el de siempre» (audio) / apagados (subtítulos); lo que se toque en la ficha manda en esta reproducción.
  var audioElegido by remember(itemId) { mutableStateOf<Int?>(null) }
  var subElegido by remember(itemId) { mutableStateOf<String?>(null) }
  var dialogoPistas by remember(itemId) { mutableStateOf<String?>(null) }
  var codecDescarga by remember { mutableStateOf("h265") }
  val ambito = rememberCoroutineScope()

  // Música de cabecera en segundo plano si está disponible y activada
  DisposableEffect(itemId, ficha?.tieneTema, Ajustes.musicaCabecera) {
    var player: android.media.MediaPlayer? = null
    if (ficha?.tieneTema == 1 && Ajustes.musicaCabecera) {
      player = android.media.MediaPlayer().apply {
        try {
          setDataSource(Api.urlDeTema(itemId))
          setVolume(0.15f, 0.15f)
          isLooping = true
          setOnPreparedListener { start() }
          prepareAsync()
        } catch (_: Exception) {
          release()
        }
      }
    }
    onDispose {
      try {
        player?.stop()
        player?.release()
      } catch (_: Exception) {}
    }
  }

  LaunchedEffect(itemId, intento) {
    fallo = ""
    try {
      val traida = withContext(Dispatchers.IO) { Api.ficha(itemId) }
      ficha = traida
      esFavorita = traida.favorite == 1
      estaVista = traida.progress.firstOrNull { it.episodioId == null }?.watched == 1
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo abrir la ficha."
    }
  }

  LaunchedEffect(itemId) {
    dondeVer = try {
      withContext(Dispatchers.IO) { Api.dondeVer(itemId) }.suscripcion
    } catch (e: Exception) {
      emptyList() // sin dato: no sale nada y la ficha sigue igual
    }
  }

  LaunchedEffect(itemId, ficha?.extrasCount) {
    if (ficha != null && ficha?.extrasCount == 0) {
      extras = emptyList()
      return@LaunchedEffect
    }
    extras = try {
      withContext(Dispatchers.IO) { Api.extras(itemId) }.extras
    } catch (e: Exception) {
      emptyList() // sin extras: la pastilla no sale y ya esta
    }
  }

  var trailer by remember(itemId) { mutableStateOf<casa.tvwatch.datos.Trailer?>(null) }
  LaunchedEffect(itemId) {
    trailer = withContext(Dispatchers.IO) { Api.trailer(itemId) }
  }

  LaunchedEffect(itemId) {
    resenas = try {
      withContext(Dispatchers.IO) { Api.resenas(itemId) }
    } catch (_: Exception) {
      emptyList()
    }
  }

  val f = ficha
  if (fallo.isNotEmpty()) { Aviso(fallo, "Reintentar") { intento++ }; return }
  if (f == null) { EsqueletoDeRejilla(columnas = 2, filas = 3); return }

  val esSerie = f.kind == "show"
  val ficheroPelicula = f.files.firstOrNull { it.episodioId == null }

  // Las pistas del fichero, para poder elegir audio y subtítulos antes de reproducir (como en la tele).
  // En una serie se enseñan las pistas del próximo episodio por ver (o el primero); lo elegido vale, por idioma, para todos.
  val idFicheroDePistas = if (esSerie) {
    val conFichero = f.episodes.filter { it.ficheroId != null }.sortedWith(compareBy({ it.season }, { it.episode }))
    (conFichero.firstOrNull { e -> f.progress.none { it.episodioId == e.id && it.watched == 1 } } ?: conFichero.firstOrNull())?.ficheroId
  } else {
    ficheroPelicula?.id
  }
  LaunchedEffect(idFicheroDePistas) {
    if (idFicheroDePistas == null) return@LaunchedEffect
    val info = try {
      withContext(Dispatchers.IO) { Api.infoDeReproduccion(idFicheroDePistas) }
    } catch (e: Exception) {
      null
    }
    infoPistas = info
    // Al volver a la ficha de una serie se recuerda lo elegido antes; si no, lo guardado en el servidor.
    val previa = if (esSerie) EleccionDePistas.serieDe(itemId) else null
    if (info != null) {
      if (previa != null) {
        audioElegido = previa.audioIdioma?.let { l -> info.audio.firstOrNull { Pistas.mismoIdioma(it.language, l) }?.id }
        subElegido = previa.subtitulo?.let { Pistas.subtituloParecido(info.subtitles, it)?.id }
      } else {
        if (audioElegido == null && info.savedAudio != null) {
          audioElegido = info.savedAudio.toIntOrNull()?.takeIf { id -> info.audio.any { it.id == id } }
        }
        if (subElegido == null && info.savedSubtitle != null) {
          subElegido = if (info.savedSubtitle == "off") null else info.subtitles.firstOrNull { it.id == info.savedSubtitle }?.id
        }
      }
    }
  }

  /** En series lo elegido se guarda por idioma para todos los episodios. */
  fun recordarParaLaSerie(audioId: Int?, subId: String?) {
    val i = infoPistas ?: return
    if (!esSerie) return
    val idioma = i.audio.firstOrNull { it.id == audioId }?.language
    val sub = i.subtitles.firstOrNull { it.id == subId }
    EleccionDePistas.guardarSerie(if (idioma == null && sub == null) null else EleccionDePistas.DeSerie(itemId, idioma, sub))
  }

  /** Deja lo elegido para que lo recoja el reproductor o Cast. Sin cambios, no deja nada. */
  fun prepararPistas(fileId: Int) {
    val i = infoPistas
    EleccionDePistas.guardar(
      if (i != null && (audioElegido != null || subElegido != null)) {
        EleccionDePistas.Eleccion(fileId, audioElegido, i.subtitles.firstOrNull { it.id == subElegido })
      } else {
        null
      },
    )
  }
  val progresoPelicula = f.progress.firstOrNull { it.episodioId == null }
  /*
   * Dónde se reanuda. Mira también `estaVista`, que es el estado de aquí: al
   * marcarla vista, el progreso que trajo el servidor sigue diciendo
   * `watched = 0` hasta que se recarga la ficha, y sin esto se quedaba un
   * «Reanudar 29:11» debajo de una película que acabas de dar por vista.
   */
  val reanudarEn = if (!estaVista && progresoPelicula != null && progresoPelicula.watched == 0) progresoPelicula.position else 0.0

  val temporadas = remember(f) { f.episodes.map { it.season }.distinct().sorted() }
  // La primera temporada por defecto es la 1; los especiales (0) son una pestaña destacada.
  val temporadaActiva = temporada ?: temporadas.firstOrNull { it > 0 } ?: temporadas.firstOrNull()
  val estadoScroll = androidx.compose.foundation.lazy.rememberLazyListState()

  LazyColumn(
    state = estadoScroll,
    modifier = Modifier.fillMaxSize().background(Fondo),
    contentPadding = PaddingValues(bottom = 36.dp),
  ) {
    /*
     * Cabecera como la de la portada: el logotipo **sobre** el fotograma.
     *
     * Antes el fotograma acababa en un corte horizontal y el logotipo iba
     * suelto debajo, así que en las películas cuyo fotograma ya lleva el título
     * dibujado —«Apocalypse Now»— el nombre salía dos veces seguidas. Encima y
     * con el degradado llegando hasta el fondo, la cabecera es una sola cosa.
     */
    item {
      Box(Modifier.fillMaxWidth().height(400.dp)) {
        if (f.tieneFondo == 1) {
          Imagen(recordarUrl(f.id, "fanart", 1280), f.title, Modifier.fillMaxSize())
        }
        Box(
          Modifier.fillMaxSize().background(
            Brush.verticalGradient(
              0f to Color(0x55000000),
              0.4f to Color(0x22000000),
              0.78f to Color(0xCC09090C),
              1f to Fondo,
            ),
          ),
        )
        Row(
          Modifier
            .align(Alignment.BottomStart)
            .fillMaxWidth()
            .padding(horizontal = Aire.borde)
            .padding(bottom = 6.dp),
          verticalAlignment = Alignment.Bottom,
        ) {
          Column(Modifier.fillMaxWidth()) {
            if (f.tieneLogo == 1) {
              Imagen(
                recordarUrl(f.id, "logo", 560),
                f.title,
                Modifier.heightIn(max = 68.dp).fillMaxWidth(0.86f),
                escala = ContentScale.Fit,
                alineacion = Alignment.BottomStart,
              )
              Spacer(Modifier.height(6.dp))
              Text(f.title, color = Texto, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            } else {
              Text(f.title, color = Texto, style = MaterialTheme.typography.headlineMedium)
            }
            f.tagline?.takeIf { it.isNotBlank() }?.let {
              Spacer(Modifier.height(8.dp))
              Text(it, color = TextoSuave, style = MaterialTheme.typography.bodyMedium)
            }
          }
        }
      }
    }

    item {
      Column(Modifier.padding(horizontal = Aire.borde)) {
        Spacer(Modifier.height(14.dp))
        val es4k = remember(f) { etiquetasTecnicas(f).any { it.contains("4K", ignoreCase = true) || it.contains("UHD", ignoreCase = true) } }
        val mostrarEstuche = Ajustes.estuche3D && f.tienePoster == 1

        Row(
          modifier = Modifier.fillMaxWidth(),
          verticalAlignment = Alignment.Top,
        ) {
          Column(
            modifier = Modifier.weight(1f),
          ) {
            Text(
              listOfNotNull(
                f.year?.toString(),
                if (!esSerie) duracionLegible(f.runtime).ifEmpty { null } else "${temporadas.size} temporada${if (temporadas.size == 1) "" else "s"}",
                calificacion(f.mpaa),
              ).joinToString("  ·  "),
              color = Texto,
              fontSize = 14.sp,
            )

            if (f.ratings.isNotEmpty()) {
              Spacer(Modifier.height(8.dp))
              LazyRow(
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically,
              ) {
                items(f.ratings) { n ->
                  Row(verticalAlignment = Alignment.CenterVertically) {
                    BadgeNota(n.fuente, n.etiqueta)
                    Spacer(Modifier.width(5.dp))
                    Text(
                      if (n.maximo == 100) "${n.valor.toInt()}%" else "%.1f".format(n.valor),
                      color = Texto,
                      fontSize = 15.sp,
                      fontWeight = FontWeight.SemiBold,
                    )
                  }
                }
              }
            }

            val etiquetas = remember(f) { etiquetasTecnicas(f) }
            if (etiquetas.isNotEmpty()) {
              Spacer(Modifier.height(10.dp))
              FilaDeEtiquetas(etiquetas)
            }

            if (f.genres.isNotEmpty()) {
              Spacer(Modifier.height(10.dp))
              Text(f.genres.take(4).joinToString(", "), color = TextoTenue, fontSize = 13.sp)
            }

            val directores = remember(f) { f.cast.filter { it.role.equals("director", ignoreCase = true) } }
            if (directores.isNotEmpty()) {
              Spacer(Modifier.height(8.dp))
              Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Dirección: ", color = TextoTenue, fontSize = 13.sp)
                directores.forEachIndexed { idx, d ->
                  Text(
                    d.name + if (idx < directores.size - 1) ", " else "",
                    color = Texto,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.clickable { alAbrirPersona(d.id) },
                  )
                }
              }
            }
          }

          if (mostrarEstuche) {
            Spacer(Modifier.width(10.dp))
            Column(
              horizontalAlignment = Alignment.CenterHorizontally,
            ) {
              Estuche3DAndroid(
                itemId = f.id,
                tieneDisco = f.tieneDisco == 1,
                es4k = es4k,
                alAbrirColeccionista = { mostrarColeccionista = true },
                modifier = Modifier.padding(top = 2.dp),
              )
              if (!f.studio.isNullOrBlank()) {
                Spacer(Modifier.height(14.dp))
                LogosDeEstudios(f.id)
              }
            }
          }
        }

        f.plot?.let { sinopsis ->
          Spacer(Modifier.height(12.dp))
          Text(
            sinopsis,
            color = TextoSuave,
            fontSize = 14.sp,
            lineHeight = 21.sp,
            maxLines = if (sinopsisAbierta) Int.MAX_VALUE else 4,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.clickable { sinopsisAbierta = !sinopsisAbierta },
          )
          if (sinopsis.length > 220) {
            Text(
              if (sinopsisAbierta) "Menos" else "Más",
              color = TextoTenue,
              fontSize = 13.sp,
              modifier = Modifier
                .clickable { sinopsisAbierta = !sinopsisAbierta }
                .padding(top = 4.dp),
            )
          }
        }

        Spacer(Modifier.height(18.dp))
        if (!esSerie && ficheroPelicula != null) {
          BotonReproducirIos(
            texto = if (reanudarEn > 0) {
              // Dónde se quedó y cuánto falta: con el total del fichero, o la duración de la ficha si no la trae.
              val total = ficheroPelicula.duration ?: f.runtime?.times(60)
              val faltan = total?.let { (it - reanudarEn) / 60 }?.takeIf { it >= 1 }
              "Reanudar · ${reloj(reanudarEn)}" + (faltan?.let { " · faltan ${duracionLegible(it)}" } ?: "")
            } else {
              "Reproducir"
            },
            alPulsar = {
              prepararPistas(ficheroPelicula.id)
              alReproducir(ficheroPelicula.id, null, reanudarEn)
            },
          )
        }
        Spacer(Modifier.height(14.dp))
        /*
         * Como en la app de la tele: «Reproducir» es el único botón con texto; el
         * resto, iconos redondos con su nombre debajo (`BotonIcono`, en
         * AccionesDeFicha.kt).
         */
        Row(
          Modifier.horizontalScroll(rememberScrollState()),
          horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
          if (!esSerie && ficheroPelicula != null && reanudarEn > 0) {
            BotonIcono("Desde el principio", "reiniciar") {
              prepararPistas(ficheroPelicula.id)
              alReproducir(ficheroPelicula.id, null, 0.0)
            }
          }
          if (idFicheroDePistas != null) {
            BotonIcono("Audio", "audio", activo = audioElegido != null) { dialogoPistas = "audio" }
            BotonIcono("Subtítulos", "subtitulos", activo = subElegido != null) { dialogoPistas = "subs" }
          }
          /*
           * El tráiler se abre en la app de YouTube (o en el navegador si no
           * está): en el móvil no hay el problema de la tele, y Atrás vuelve
           * aquí. Nunca se descarga nada.
           */
          trailer?.let { t ->
            BotonIcono("Tráiler", "trailer") {
              val app = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("vnd.youtube:" + t.youtube))
              val web = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com/watch?v=" + t.youtube))
              try {
                contexto.startActivity(app)
              } catch (_: android.content.ActivityNotFoundException) {
                try { contexto.startActivity(web) } catch (_: Exception) {
                  Toast.makeText(contexto, "No hay nada con que abrir el tráiler", Toast.LENGTH_LONG).show()
                }
              }
            }
          }
          // Solo si los hay: extras disponibles
          if (extras.isNotEmpty()) {
            BotonIcono("Extras (${extras.size})", "extras") {
              ambito.launch {
                estadoScroll.animateScrollToItem(estadoScroll.layoutInfo.totalItemsCount - 1)
              }
            }
          }
          // «También en tu suscripción»
          for (p in dondeVer) {
            BotonIcono("En ${p.nombre}", "plataforma") {
              ambito.launch {
                val enlace = try {
                  withContext(Dispatchers.IO) { Api.enlaceDeTitulo(itemId, p.clave) }
                } catch (e: Exception) {
                  null
                }
                val fallo = AppsDePlataforma.abrirConRespaldo(contexto, p.clave, p.nombre, enlace) {
                  Toast.makeText(contexto, it, Toast.LENGTH_LONG).show()
                }
                if (fallo != null) Toast.makeText(contexto, fallo, Toast.LENGTH_LONG).show()
              }
            }
          }
          BotonIcono("Favorita", if (esFavorita) "favoritoSi" else "favorito", activo = esFavorita) {
            val nuevo = !esFavorita
            esFavorita = nuevo
            ambito.launch {
              try {
                withContext(Dispatchers.IO) { Api.favorito(itemId, nuevo) }
                Cache.olvidarFicha(itemId)
              } catch (e: Exception) {
                esFavorita = !nuevo
              }
            }
          }
          BotonIcono(if (estaVista) "Vista" else "Marcar vista", if (estaVista) "vistaSi" else "vista", activo = estaVista) {
            val nuevo = !estaVista
            estaVista = nuevo
            ambito.launch {
              try {
                withContext(Dispatchers.IO) { Api.marcarVista(itemId, nuevo) }
                Cache.olvidarFicha(itemId)
              } catch (e: Exception) {
                estaVista = !nuevo
              }
            }
          }
          if (!esSerie && ficheroPelicula != null) {
            BotonIcono("Descargar", "descargar") { fileIdDescargaDialogo = ficheroPelicula.id }
            BotonIcono("En la tele", "tele") { mandarALaTele(ficheroPelicula.id, null, reanudarEn) }
          }
          // Acciones de administración: editar metadatos y eliminar (el último en rojo)
          if (Ajustes.esAdmin) {
            BotonIcono("Editar", "metadatos") { dialogoEditar = true }
            BotonIcono("Eliminar", "eliminar", peligro = true) { dialogoBorrar = true }
          }
        }

        // Lo que se pondrá al reproducir, con lo elegido en ámbar (como en la tele).
        if (idFicheroDePistas != null) {
          val i = infoPistas
          if (i != null && i.audio.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            val a = Pistas.elegirAudio(i.audio, audioElegido)
            val s = i.subtitles.firstOrNull { it.id == subElegido }
            EtiquetasDePistas(
              audio = (a?.let { etiquetaAudio(it) } ?: "Sin audio") + (if (a != null && !a.compatible) " · se convertirá" else ""),
              subtitulos = when {
                s != null -> "Subtítulos: " + etiquetaSubtitulo(s)
                i.subtitles.isNotEmpty() -> "Subtítulos: desactivados (${i.subtitles.size})"
                else -> "Sin subtítulos"
              },
              subtitulosActivos = s != null,
            )
          }
        }

        Spacer(Modifier.height(24.dp))
      }
    }


    if (esSerie && temporadas.isNotEmpty()) {
      item {
        LazyRow(
          contentPadding = PaddingValues(horizontal = 16.dp),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          items(temporadas) { n ->
            val activa = n == temporadaActiva
            Text(
              if (n == 0) "★ Especiales" else "Temporada $n",
              color = if (activa) Color(0xFF15100A) else if (n == 0) Realce else Texto,
              fontSize = 13.sp,
              modifier = Modifier
                .clip(RoundedCornerShape(18.dp))
                .background(if (activa) Realce else FondoTarjeta)
                .then(if (n == 0 && !activa) Modifier.border(1.dp, Realce.copy(alpha = 0.6f), RoundedCornerShape(18.dp)) else Modifier)
                .clickable { temporada = n }
                .padding(horizontal = 14.dp, vertical = 8.dp),
            )
          }
        }
        Spacer(Modifier.height(14.dp))
      }

      val deLaTemporada = f.episodes.filter { it.season == temporadaActiva && it.ficheroId != null }
      items(deLaTemporada, key = { it.id }) { e ->
        FilaEpisodio(
          f,
          e,
          alPulsar = { alReproducir(e.ficheroId!!, e.id, posicionDe(f, e.id)) },
          alMantener = { mandarALaTele(e.ficheroId!!, e.id, posicionDe(f, e.id)) },
          alPedirDescarga = { fileIdDescargaDialogo = it },
          alMandarTele = { fid -> mandarALaTele(fid, e.id, posicionDe(f, e.id)) },
          alCambiarVisto = { nuevo ->
            ambito.launch {
              try {
                withContext(Dispatchers.IO) { Api.marcarVista(itemId, nuevo, e.id) }
                Cache.olvidarFicha(itemId)
                val progs = f.progress.filter { it.episodioId != e.id }.toMutableList()
                if (nuevo) {
                  progs.add(Progreso(episodioId = e.id, watched = 1, position = e.runtime?.times(60) ?: 0.0, duration = e.runtime?.times(60) ?: 0.0))
                }
                ficha = f.copy(progress = progs)
              } catch (_: Exception) {}
            }
          },
        )
      }
    }

    val reparto = f.cast.filter { it.role == "actor" }.take(12)
    if (reparto.isNotEmpty()) {
      item {
        Spacer(Modifier.height(18.dp))
        Text("Reparto", color = Texto, fontSize = 16.sp, modifier = Modifier.padding(start = 16.dp, bottom = 10.dp))
        LazyRow(
          contentPadding = PaddingValues(horizontal = 16.dp),
          horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
          items(reparto, key = { it.id }) { p ->
            Column(Modifier.width(78.dp).clickable { alAbrirPersona(p.id) }) {
              Box(
                Modifier
                  .width(78.dp)
                  .height(78.dp)
                  .clip(RoundedCornerShape(39.dp))
                  .background(FondoTarjeta),
                contentAlignment = Alignment.Center,
              ) {
                if (p.tieneFoto == 1) {
                  Imagen(Api.fotoDePersona(p.id, 160), p.name, Modifier.fillMaxSize())
                } else {
                  Text(p.name.take(1).uppercase(), color = TextoTenue, fontSize = 20.sp)
                }
              }
              Spacer(Modifier.height(6.dp))
              Text(p.name, color = Texto, fontSize = 11.sp, maxLines = 2, lineHeight = 14.sp)
              p.character?.let { Text(it, color = TextoTenue, fontSize = 10.sp, maxLines = 1) }
            }
          }
        }
      }
    }

    if (f.coleccionItems.size > 1) {
      item {
        Spacer(Modifier.height(16.dp))
        Fila(f.collection ?: "Colección", f.coleccionItems, alPulsar = alAbrirFicha)
      }
    }

    if (f.similares.isNotEmpty()) {
      item {
        Spacer(Modifier.height(16.dp))
        Fila("Títulos similares", f.similares, alPulsar = alAbrirFicha)
      }
    }

    if (resenas.isNotEmpty()) {
      item {
        Spacer(Modifier.height(18.dp))
        Text("Reseñas", color = Texto, fontSize = 16.sp, modifier = Modifier.padding(start = 16.dp, bottom = 10.dp))
        LazyRow(
          contentPadding = PaddingValues(horizontal = 16.dp),
          horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
          items(resenas) { res ->
            TarjetaResena(res)
          }
        }
      }
    }

    if (extras.isNotEmpty()) {
      item {
        Spacer(Modifier.height(18.dp))
        SeccionExtras(extras, alVerExtra = { extraViendo = it })
      }
    }
  }

  extraViendo?.let { extra ->
    ReproductorDeExtra(extra) { extraViendo = null }
  }

  // Elegir pista de audio o subtítulos para esta película (la ficha de la tele hace lo mismo).
  val dialogoDePistas = dialogoPistas
  val infoDelDialogo = infoPistas
  if (dialogoDePistas != null && infoDelDialogo != null) {
    if (dialogoDePistas == "audio") {
      SelectorDePistas(
        titulo = "Pista de audio",
        opciones = infoDelDialogo.audio.map { it.id.toString() to (etiquetaAudio(it) + if (it.compatible) "" else " · se convertirá") },
        elegida = (Pistas.elegirAudio(infoDelDialogo.audio, audioElegido)?.id ?: -1).toString(),
        alElegir = {
          audioElegido = it.toIntOrNull()
          recordarParaLaSerie(audioElegido, subElegido)
          dialogoPistas = null
        },
        alCerrar = { dialogoPistas = null },
      )
    } else {
      SelectorDePistas(
        titulo = "Subtítulos",
        opciones = listOf("" to "Desactivados") + infoDelDialogo.subtitles.map { it.id to etiquetaSubtitulo(it) },
        elegida = subElegido ?: "",
        alElegir = {
          subElegido = it.ifEmpty { null }
          recordarParaLaSerie(audioElegido, subElegido)
          dialogoPistas = null
        },
        alCerrar = { dialogoPistas = null },
      )
    }
  }
  if (fileIdDescargaDialogo != null) {
    val targetFileId = fileIdDescargaDialogo!!
    val ficheroElegido = f.files.firstOrNull { it.id == targetFileId }
    val duracionSegundos = ficheroElegido?.duration ?: (f.runtime?.times(60) ?: 5400.0)
    val opciones = estimarDescargas(duracionSegundos, ficheroElegido?.size, codecDescarga)
    androidx.compose.material3.AlertDialog(
      onDismissRequest = { fileIdDescargaDialogo = null },
      containerColor = Color(0xFF14141A),
      shape = RoundedCornerShape(24.dp),
      title = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          IconoDescarga(color = Realce, tamano = 22.dp)
          Text("Calidad de descarga", color = Texto, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
      },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .clip(RoundedCornerShape(12.dp))
              .background(Color(0x0AFFFFFF))
              .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text("Codec", color = TextoSuave, fontSize = 12.sp)
            TextButton(
              onClick = { codecDescarga = if (codecDescarga == "h265") "h264" else "h265" },
              contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
            ) {
              Text(
                if (codecDescarga == "h265") "H.265 (menor tamaño)" else "H.264 (más rápido)",
                color = Texto, fontSize = 12.sp,
              )
            }
          }
          opciones.forEach { (perfil, titulo, pie) ->
            val pulsacion = remember { MutableInteractionSource() }
            val pulsada by pulsacion.collectIsPressedAsState()
            val escala by animateFloatAsState(
              targetValue = if (pulsada) 0.97f else 1f,
              animationSpec = Movimiento.resorte(),
              label = "escala opcion descarga",
            )
            Row(
              modifier = Modifier
                .scale(escala)
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0x14FFFFFF))
                .border(1.dp, Color(0x1CFFFFFF), RoundedCornerShape(16.dp))
                .pulsable(pulsacion) {
                  fileIdDescargaDialogo = null
                  ambito.launch {
                    try {
                      val d = withContext(Dispatchers.IO) { Api.pedirDescarga(targetFileId, perfil, codecDescarga) }
                      Toast.makeText(contexto, if (d.estado == "lista") "Descarga lista" else "Preparando copia en el servidor...", Toast.LENGTH_SHORT).show()
                      if (d.estado == "lista") {
                        val url = "${Api.urlFicheroDescarga(d.id)}?token=${Ajustes.token ?: ""}"
                        val ext = if (d.perfil == "original") ".mkv" else ".mp4"
                        val nombreFichero = "${d.titulo.replace(Regex("[^a-zA-Z0-9.-]"), "_")}_${d.perfil}$ext"
                        iniciarDescargaEnAndroid(contexto, url, d.titulo, nombreFichero)
                      }
                    } catch (e: Exception) {
                      Toast.makeText(contexto, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                    }
                  }
                }
                .padding(horizontal = 16.dp, vertical = 12.dp),
              horizontalArrangement = Arrangement.SpaceBetween,
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Column(modifier = Modifier.weight(1f)) {
                Text(titulo, color = Texto, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text(pie, color = TextoSuave, fontSize = 12.sp)
              }
              IconoDescarga(color = TextoTenue, tamano = 16.dp)
            }
          }
        }
      },
      confirmButton = {},
      dismissButton = {
        TextButton(onClick = { fileIdDescargaDialogo = null }) {
          Text("Cancelar", color = TextoSuave, fontSize = 14.sp)
        }
      }
    )
  }

  if (dialogoEditar) {
    AlertDialog(
      onDismissRequest = { dialogoEditar = false },
      containerColor = Color(0xFF14141A),
      shape = RoundedCornerShape(24.dp),
      title = {
        Text("Editar metadatos / Arte", color = Texto, fontWeight = FontWeight.Bold, fontSize = 18.sp)
      },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Box(
            Modifier
              .fillMaxWidth()
              .clip(RoundedCornerShape(12.dp))
              .background(Color(0x0AFFFFFF))
              .clickable {
                dialogoEditar = false
                ambito.launch {
                  Toast.makeText(contexto, "Buscando en TMDb…", Toast.LENGTH_SHORT).show()
                  try {
                    val res = withContext(Dispatchers.IO) { Api.buscarEnTmdb(f.title, if (esSerie) "show" else "movie", f.year) }
                    val primero = res.results.firstOrNull()
                    if (primero != null) {
                      withContext(Dispatchers.IO) { Api.aplicarMetadatos(f.id, primero.tmdbId, if (esSerie) "show" else "movie") }
                      Toast.makeText(contexto, "Metadatos actualizados desde TMDb", Toast.LENGTH_SHORT).show()
                      Cache.olvidarFicha(f.id)
                      intento++
                    } else {
                      Toast.makeText(contexto, "No se encontraron resultados en TMDb", Toast.LENGTH_SHORT).show()
                    }
                  } catch (e: Exception) {
                    Toast.makeText(contexto, e.message ?: "Error al actualizar metadatos", Toast.LENGTH_LONG).show()
                  }
                }
              }
              .padding(horizontal = 14.dp, vertical = 12.dp)
          ) {
            Column {
              Text("Actualizar metadatos desde TMDb", color = Texto, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
              Text("Sinopsis, géneros, puntuación y año", color = TextoSuave, fontSize = 12.sp)
            }
          }

          Box(
            Modifier
              .fillMaxWidth()
              .clip(RoundedCornerShape(12.dp))
              .background(Color(0x0AFFFFFF))
              .clickable {
                dialogoEditar = false
                alCambiarImagenes(f.kind, f.title, f.year)
              }
              .padding(horizontal = 14.dp, vertical = 12.dp)
          ) {
            Column {
              Text("Cambiar imágenes", color = Texto, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
              Text("Póster, fondo fanart, logotipo y disco", color = TextoSuave, fontSize = 12.sp)
            }
          }
        }
      },
      confirmButton = {},
      dismissButton = {
        TextButton(onClick = { dialogoEditar = false }) {
          Text("Cancelar", color = TextoSuave, fontSize = 14.sp)
        }
      }
    )
  }

  if (dialogoBorrar) {
    AlertDialog(
      onDismissRequest = { if (!borrando) dialogoBorrar = false },
      containerColor = Color(0xFF1A1214),
      shape = RoundedCornerShape(24.dp),
      title = {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          IconoAccion("eliminar", Color(0xFFEF4444), tamano = 22.dp)
          Text("Eliminar «${f.title}»", color = Color(0xFFEF4444), fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
      },
      text = {
        Text(
          "${if (esSerie) "Se borrará la serie ENTERA con su carpeta" else "Se borrará la carpeta de la película"} en el servidor, sin papelera. Esta acción es definitiva.",
          color = TextoSuave,
          fontSize = 14.sp,
          lineHeight = 20.sp,
        )
      },
      confirmButton = {
        Button(
          onClick = {
            ambito.launch {
              borrando = true
              try {
                val res = withContext(Dispatchers.IO) { Api.borrarItem(f.id, f.title) }
                Toast.makeText(contexto, "Eliminada: ${res.titulo}", Toast.LENGTH_SHORT).show()
                Cache.olvidarFicha(f.id)
                dialogoBorrar = false
                alVolver()
              } catch (e: Exception) {
                Toast.makeText(contexto, e.message ?: "No se pudo eliminar", Toast.LENGTH_LONG).show()
              } finally {
                borrando = false
              }
            }
          },
          enabled = !borrando,
          colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
        ) {
          Text(if (borrando) "Eliminando…" else "Sí, eliminar", color = Color.White, fontWeight = FontWeight.Bold)
        }
      },
      dismissButton = {
        TextButton(onClick = { dialogoBorrar = false }, enabled = !borrando) {
          Text("Cancelar", color = TextoSuave, fontSize = 14.sp)
        }
      }
    )
  }

  if (mostrarColeccionista && ficha != null) {
    val f = ficha!!
    val es4k = remember(f) { etiquetasTecnicas(f).any { it.contains("4K", ignoreCase = true) || it.contains("UHD", ignoreCase = true) } }
    ModalColeccionistaAndroid(
      ficha = f,
      es4k = es4k,
      infoPistas = infoPistas,
      alCerrar = { mostrarColeccionista = false },
    )
  }
}


private fun posicionDe(f: Ficha, episodioId: Int): Double {
  val p = f.progress.firstOrNull { it.episodioId == episodioId } ?: return 0.0
  return if (p.watched == 1) 0.0 else p.position
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FilaEpisodio(
  f: Ficha,
  e: Episodio,
  alPulsar: () -> Unit,
  alMantener: () -> Unit = {},
  alPedirDescarga: (Int) -> Unit = {},
  alMandarTele: (Int) -> Unit = {},
  alCambiarVisto: (Boolean) -> Unit = {},
) {
  val prog = f.progress.firstOrNull { it.episodioId == e.id }
  val estaVisto = prog?.watched == 1
  val avance = run {
    val total = prog?.duration ?: (e.runtime?.times(60) ?: 0.0)
    if (prog != null && total > 0 && prog.watched == 0) (prog.position / total).coerceIn(0.0, 1.0).toFloat() else 0f
  }

  Row(
    Modifier
      .fillMaxWidth()
      .combinedClickable(onClick = alPulsar, onLongClick = alMantener)
      .padding(horizontal = 16.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    Box(
      Modifier
        .width(128.dp)
        .height(72.dp)
        .clip(RoundedCornerShape(8.dp))
        .background(FondoTarjeta),
    ) {
      if (e.tieneFoto == 1) {
        Imagen(Api.fotoDeEpisodio(e.id, 300), e.title, Modifier.fillMaxSize())
      }
      if (estaVisto) {
        Box(
          Modifier
            .align(Alignment.TopEnd)
            .padding(4.dp)
            .size(18.dp)
            .clip(CircleShape)
            .background(Realce),
          contentAlignment = Alignment.Center
        ) {
          IconoAccion("vistaSi", SobreRealce, tamano = 12.dp)
        }
      } else if (avance > 0.01f) {
        Box(
          Modifier
            .align(Alignment.BottomStart)
            .fillMaxWidth(avance)
            .height(3.dp)
            .background(Realce),
        )
      }
    }
    Spacer(Modifier.width(12.dp))
    Column(Modifier.weight(1f).padding(top = 2.dp, end = 6.dp)) {
      Text("T${e.season}E${e.episode}", color = TextoTenue, fontSize = 11.sp)
      Text(e.title ?: "Episodio ${e.episode}", color = Texto, fontSize = 14.sp, maxLines = 2, lineHeight = 18.sp)
      duracionLegible(e.runtime).takeIf { it.isNotEmpty() }?.let {
        Text(it, color = TextoTenue, fontSize = 11.sp)
      }
    }
    Row(
      horizontalArrangement = Arrangement.spacedBy(6.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      if (e.ficheroId != null) {
        BotonEpisodioMini(icono = "tele") { alMandarTele(e.ficheroId) }
        BotonEpisodioMini(icono = "descargar") { alPedirDescarga(e.ficheroId) }
      }
      BotonEpisodioMini(
        icono = if (estaVisto) "vistaSi" else "vista",
        activo = estaVisto,
      ) {
        alCambiarVisto(!estaVisto)
      }
    }
  }
}

@Composable
private fun BotonEpisodioMini(
  icono: String,
  activo: Boolean = false,
  alPulsar: () -> Unit
) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) 0.90f else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala boton mini"
  )
  val fondo by animateColorAsState(
    targetValue = if (activo) Realce.copy(alpha = 0.22f) else Color(0x18FFFFFF),
    animationSpec = Movimiento.aparecer(180),
    label = "fondo boton mini"
  )
  val color = if (activo) Realce else TextoSuave
  val borde = if (activo) Realce.copy(alpha = 0.5f) else Color(0x1FFFFFFF)

  Box(
    Modifier
      .size(36.dp)
      .scale(escala)
      .clip(CircleShape)
      .background(fondo)
      .border(1.dp, borde, CircleShape)
      .pulsable(pulsacion, alPulsar),
    contentAlignment = Alignment.Center
  ) {
    IconoAccion(icono, color, tamano = 18.dp)
  }
}

/**
 * La calificación por edades, en corto.
 *
 * Los `.nfo` de Kodi la traen como «ES:A / ES:A/fig / ES:Ai / ES:A/i/fig», que
 * es la ficha entera del ICAA y no le dice nada a nadie. Se queda el primer
 * trozo sin el país, que es lo que la gente reconoce: «A», «7», «12», «18».
 */
private fun calificacion(mpaa: String?): String? {
  if (mpaa.isNullOrBlank()) return null
  val primero = mpaa.split('/')[0].trim().removePrefix("ES:").trim()
  return primero.ifBlank { null }
}

/**
 * Lo que interesa saber antes de darle a reproducir: si es 4K, si trae HDR y
 * qué audio hay. Sale del fichero, no de la ficha, porque es propiedad de la
 * copia que hay en el disco.
 */
private fun etiquetasTecnicas(f: Ficha): List<String> {
  val fichero = f.files.firstOrNull { it.episodioId == null } ?: f.files.firstOrNull() ?: return emptyList()
  val out = mutableListOf<String>()
  val alto = fichero.height ?: 0
  val ancho = fichero.width ?: 0
  when {
    ancho >= 3800 || alto >= 1600 -> out += "4K"
    ancho >= 1900 || alto >= 800 -> out += "1080p"
    ancho >= 1200 || alto >= 700 -> out += "720p"
  }
  ratioPantalla(ancho, alto)?.let { out += it }
  fichero.codec?.let { out += it.uppercase() }
  fichero.hdr?.let { out += it }
  return out
}

private fun ratioPantalla(ancho: Int, alto: Int): String? {
  if (ancho <= 0 || alto <= 0) return null
  val r = ancho.toFloat() / alto.toFloat()
  return when {
    r in 2.30f..2.45f -> "2.39:1"
    r in 2.15f..2.29f -> "2.20:1"
    r in 1.95f..2.14f -> "2.00:1"
    r in 1.80f..1.94f -> "1.85:1"
    r in 1.70f..1.79f -> "16:9"
    r in 1.55f..1.69f -> "16:10"
    r in 1.45f..1.54f -> "1.50:1"
    r in 1.30f..1.44f -> "4:3"
    else -> "%.2f:1".format(java.util.Locale.US, r)
  }
}

@Composable
private fun BadgeNota(fuente: String, etiqueta: String) {
  when (fuente) {
    "imdb" -> {
      Box(
        Modifier
          .clip(RoundedCornerShape(3.dp))
          .background(Color(0xFFF5C518))
          .padding(horizontal = 4.dp, vertical = 1.dp),
      ) {
        Text("IMDb", color = Color.Black, fontSize = 10.sp, fontWeight = FontWeight.Black)
      }
    }
    "tomatometerallcritics" -> {
      Box(
        Modifier
          .size(15.dp)
          .clip(CircleShape)
          .background(Color(0xFFFA320A)),
        contentAlignment = Alignment.TopCenter,
      ) {
        Box(
          Modifier
            .size(4.dp)
            .clip(RoundedCornerShape(1.dp))
            .background(Color(0xFF00D000)),
        )
      }
    }
    "tmdb", "themoviedb" -> {
      Box(
        Modifier
          .clip(RoundedCornerShape(3.dp))
          .background(Color(0xFF01B4E4))
          .padding(horizontal = 4.dp, vertical = 1.dp),
      ) {
        Text("TMDb", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold)
      }
    }
    "tvdb", "thetvdb" -> {
      Box(
        Modifier
          .clip(RoundedCornerShape(3.dp))
          .background(Color(0xFF20B26C))
          .padding(horizontal = 4.dp, vertical = 1.dp),
      ) {
        Text("TVDB", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold)
      }
    }
    "metacritic" -> {
      Box(
        Modifier
          .size(16.dp)
          .clip(CircleShape)
          .background(Color(0xFF333333)),
        contentAlignment = Alignment.Center,
      ) {
        Text("mc", color = Color(0xFF66CC33), fontSize = 9.sp, fontWeight = FontWeight.Bold)
      }
    }
    else -> {
      Text(etiqueta, color = TextoTenue, fontSize = 11.sp)
    }
  }
}

@Composable
private fun TarjetaResena(res: Resena) {
  var abierta by remember { mutableStateOf(false) }
  Column(
    Modifier
      .width(280.dp)
      .clip(RoundedCornerShape(14.dp))
      .background(FondoTarjeta)
      .clickable { abierta = !abierta }
      .padding(14.dp),
  ) {
    Row(
      Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(
        res.autor,
        color = Texto,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.weight(1f, fill = false),
      )
      res.valor?.let { v ->
        Spacer(Modifier.width(6.dp))
        Text("★ %.1f".format(v), color = Realce, fontSize = 12.sp, fontWeight = FontWeight.Bold)
      }
    }
    Spacer(Modifier.height(8.dp))
    Text(
      res.contenido,
      color = TextoSuave,
      fontSize = 12.sp,
      lineHeight = 17.sp,
      maxLines = if (abierta) Int.MAX_VALUE else 4,
      overflow = TextOverflow.Ellipsis,
    )
    res.pie?.let {
      Spacer(Modifier.height(8.dp))
      Text(it, color = TextoTenue, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
  }
}

private fun estimarDescargas(duracionSegundos: Double, bytesOriginal: Long?, codec: String = "h265"): List<Triple<String, String, String>> {
  val d = if (duracionSegundos > 0) duracionSegundos else 5400.0
  val factor = if (codec == "h264") 1.8 else 1.0
  fun fmt(kbps: Int): String {
    val bytes = (kbps * factor * 1000.0 / 8.0 * d).toLong()
    return if (bytes < 1024L * 1024 * 1024) {
      "${bytes / (1024 * 1024)} MB"
    } else {
      String.format(java.util.Locale.US, "%.1f GB", bytes.toDouble() / (1024.0 * 1024 * 1024))
    }
  }
  fun fmtOriginal(b: Long): String {
    return if (b < 1024L * 1024 * 1024) {
      "${b / (1024 * 1024)} MB"
    } else {
      String.format(java.util.Locale.US, "%.1f GB", b.toDouble() / (1024.0 * 1024 * 1024))
    }
  }
  return listOf(
    Triple("baja", "360p (Muy ligera)", "Aprox. ${fmt(400)}"),
    Triple("movil", "480p (Móvil)", "Aprox. ${fmt(750)}"),
    Triple("tablet", "720p (HD)", "Aprox. ${fmt(1500)}"),
    Triple("fhd", "1080p (Full HD)", "Aprox. ${fmt(3000)}"),
    Triple("original", "Original", if (bytesOriginal != null && bytesOriginal > 0) "${fmtOriginal(bytesOriginal)} (intacto)" else "el fichero intacto")
  )
}

/**
 * Nombre limpio de un códec de audio, como lo escribe el fabricante: «Dolby Digital», «Dolby Digital Plus Atmos», «Dolby TrueHD Atmos»,
 * «DTS-HD Master Audio»… Nunca el identificador interno (`eac3_ddp_atmos`).
 */
internal fun nombreCodecAudio(codecCrudo: String?, atmos: Boolean = false): String {
  val c = (codecCrudo ?: "").lowercase().replace(Regex("[\\s/.:-]+"), "_")
  val conAtmos = atmos || c.contains("atmos") || c.contains("joc")
  return when {
    c.startsWith("truehd") || c.startsWith("mlp") -> if (conAtmos) "Dolby TrueHD Atmos" else "Dolby TrueHD"
    c.startsWith("eac3") || c == "ddp" -> if (conAtmos) "Dolby Digital Plus Atmos" else "Dolby Digital Plus"
    c.startsWith("ac3") || c == "dd" -> "Dolby Digital"
    c.startsWith("dts") -> when {
      c.contains("_x") -> "DTS:X"
      c.contains("ma") && c.contains("hd") -> "DTS-HD Master Audio"
      c.contains("hra") -> "DTS-HD High Resolution"
      c.contains("hd") -> "DTS-HD"
      else -> "DTS"
    }
    c == "aac" -> "AAC"
    c == "flac" -> "FLAC"
    c == "mp3" -> "MP3"
    c == "mp2" -> "MP2"
    c == "opus" -> "Opus"
    c == "vorbis" -> "Vorbis"
    c == "alac" -> "ALAC"
    c.startsWith("pcm") -> "PCM"
    else -> c.replace("_", " ").uppercase()
  }
}

internal fun disposicionCanales(canales: Int?): String = when (canales) {
  null, 0 -> ""
  1 -> "1.0"; 2 -> "2.0"; 3 -> "2.1"; 4 -> "4.0"; 5 -> "5.0"; 6 -> "5.1"; 7 -> "6.1"; 8 -> "7.1"
  else -> "${canales}ch"
}

/** «Dolby Digital Plus Atmos 5.1», «Dolby TrueHD Atmos 7.1»... a partir del códec y los canales que apunta el servidor. */
internal fun nombreAudioDeFichero(a: AudioDeFichero): String? {
  val codec = a.codec ?: return null
  return listOf(nombreCodecAudio(codec), disposicionCanales(a.channels)).filter { it.isNotBlank() }.joinToString(" ")
}

internal fun nombreAudioDePista(a: PistaAudio): String =
  listOf(nombreCodecAudio(a.codec, a.atmos), disposicionCanales(a.channels)).filter { it.isNotBlank() }.joinToString(" ")

@Composable
private fun Estuche3DAndroid(
  itemId: Int,
  tieneDisco: Boolean,
  es4k: Boolean = false,
  alAbrirColeccionista: (() -> Unit)? = null,
  modifier: Modifier = Modifier,
) {
  var arrastreX by remember { mutableStateOf(0f) }
  val rotacionY by animateFloatAsState(
    targetValue = -16f + (arrastreX * 0.15f).coerceIn(-25f, 25f),
    animationSpec = spring(dampingRatio = 0.75f, stiffness = Spring.StiffnessMediumLow),
    label = "rotY",
  )
  val rotacionX = 3f

  Column(
    modifier = modifier,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Box(
      modifier = Modifier
        .pointerInput(Unit) {
          detectHorizontalDragGestures(
            onDragEnd = { arrastreX = 0f },
            onDragCancel = { arrastreX = 0f },
            onHorizontalDrag = { _, dragAmount ->
              arrastreX += dragAmount
            },
          )
        }
        .clickable(
          interactionSource = remember { MutableInteractionSource() },
          indication = null,
        ) {
          alAbrirColeccionista?.invoke()
        },
      contentAlignment = Alignment.Center,
    ) {
      val anchoCaja = 100.dp
      val altoCaja = 148.dp
      val tamanoDisco = 114.dp

      Box(
        Modifier
          .width(anchoCaja + if (tieneDisco) 34.dp else 0.dp)
          .height(altoCaja + 12.dp)
          .graphicsLayer {
            this.rotationY = rotacionY
            this.rotationX = rotacionX
            cameraDistance = 14f * density
          },
        contentAlignment = Alignment.Center,
      ) {
        if (tieneDisco) {
          Box(
            Modifier
              .size(tamanoDisco)
              .align(Alignment.CenterEnd)
              .padding(end = 4.dp)
              .shadow(12.dp, CircleShape),
          ) {
            Imagen(
              Api.imagen(itemId, "discart", 400),
              "Disco",
              Modifier.fillMaxSize().clip(CircleShape),
              escala = ContentScale.Fit,
            )
            Box(
              Modifier
                .fillMaxSize()
                .clip(CircleShape)
                .background(
                  Brush.sweepGradient(
                    listOf(
                      Color(0x35FFFFFF),
                      Color(0x05FFFFFF),
                      Color(0x30FFFFFF),
                      Color(0x05FFFFFF),
                      Color(0x35FFFFFF),
                    ),
                  ),
                ),
            )
          }
        }

        Box(
          Modifier
            .width(anchoCaja)
            .height(altoCaja)
            .align(if (tieneDisco) Alignment.CenterStart else Alignment.Center)
            .shadow(16.dp, RoundedCornerShape(6.dp))
            .clip(RoundedCornerShape(6.dp))
            .background(Color(0xFF0C0C10))
            .border(1.dp, Color(0x38FFFFFF), RoundedCornerShape(6.dp)),
        ) {
          Imagen(
            Api.imagen(itemId, "poster", 400),
            "Póster",
            Modifier.fillMaxSize(),
            escala = ContentScale.Crop,
          )

          Box(
            Modifier
              .fillMaxWidth()
              .height(14.dp)
              .background(if (es4k) Color(0xDD111111) else Color(0x550284C7))
              .border(0.6.dp, Color(0x33FFFFFF))
              .align(Alignment.TopCenter),
            contentAlignment = Alignment.Center,
          ) {
            Text(
              if (es4k) "4K ULTRA HD" else "Blu-ray",
              color = if (es4k) Color(0xFFE2B755) else Color(0xEEFFFFFF),
              fontSize = 7.5.sp,
              fontWeight = FontWeight.Bold,
              letterSpacing = 0.8.sp,
            )
          }

          Box(
            Modifier
              .fillMaxSize()
              .background(
                Brush.linearGradient(
                  0f to Color(0x38FFFFFF),
                  0.42f to Color(0x08FFFFFF),
                  0.58f to Color.Transparent,
                  1f to Color(0x35000000),
                ),
              ),
          )

          Box(
            Modifier
              .fillMaxHeight()
              .width(5.dp)
              .background(
                Brush.horizontalGradient(
                  0f to Color(0x40FFFFFF),
                  0.5f to Color(0x25000000),
                  1f to Color.Transparent,
                ),
              ),
          )
        }
      }
    }

    Spacer(Modifier.height(5.dp))
    Text(
      "Ver en 3D",
      color = Realce,
      fontSize = 10.5.sp,
      fontWeight = FontWeight.SemiBold,
      textAlign = TextAlign.Center,
      modifier = Modifier
        .clip(RoundedCornerShape(4.dp))
        .clickable { alAbrirColeccionista?.invoke() }
        .padding(horizontal = 4.dp, vertical = 2.dp),
    )
  }
}

/**
 * Modal inmersivo a pantalla completa para móvil que expone el Steelbook:
 * Se abre con un efecto cinemático de acercamiento y apertura 3D como un libro real,
 * el disco gira hasta pararse recto a 0°, y el interior expone libreto físico con todos los datos y bandeja con disco.
 * Reactivo a la orientación de pantalla (aprovecha al máximo vertical y horizontal / apaisado).
 */
@Composable
private fun ModalColeccionistaAndroid(
  ficha: Ficha,
  es4k: Boolean,
  infoPistas: InfoReproduccion? = null,
  alCerrar: () -> Unit,
) {
  androidx.activity.compose.BackHandler { alCerrar() }

  var abierta by remember { mutableStateOf(false) }
  LaunchedEffect(Unit) {
    delay(100)
    abierta = true
  }

  var anguloY by remember { mutableFloatStateOf(-8f) }
  // Arrastre más blando: con rigidez 400 la caja seguía al dedo a tirones.
  val anguloYAnimado by animateFloatAsState(
    targetValue = anguloY,
    animationSpec = spring(dampingRatio = 0.85f, stiffness = 140f),
    label = "anguloY",
  )

  /*
   * La misma secuencia que la tele y la web (tv/public/app.css): la tapa gira 1,6 s con curva casi sinusoidal y un rebote
   * de 4° al final; el disco NO se mueve mientras la tapa lo cubre (antes giraba 720° desde el primer instante y se le veía
   * dar vueltas por la rendija) y se asienta con un cuarto de vuelta cuando la tapa pasa de 90°. Abierta, la caja flota y
   * el disco gira despacio (un minuto por vuelta) bajo un reflejo fijo.
   */
  val seno = remember { CubicBezierEasing(0.45f, 0.05f, 0.55f, 0.95f) }
  val tapa = remember { Animatable(180f) }
  val centrado = remember { Animatable(0f) }
  val asiento = remember { Animatable(0f) }
  val flotar = remember { Animatable(0f) }
  var reposo by remember { mutableStateOf(false) }
  LaunchedEffect(abierta) {
    if (abierta) {
      launch { tapa.animateTo(-4f, tween(1312, easing = seno)); tapa.animateTo(0f, tween(288, easing = seno)) }
      launch { centrado.animateTo(1f, tween(1600, easing = seno)) }
      launch { delay(650); asiento.animateTo(1f, tween(1100, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
      delay(2000)
      reposo = true
    } else {
      reposo = false
      launch { tapa.animateTo(180f, tween(900, easing = seno)) }
      launch { centrado.animateTo(0f, tween(900, easing = seno)) }
      // Se vuelve a dejar en su sitio cuando ya está tapado.
      launch { delay(900); asiento.snapTo(0f) }
    }
  }
  LaunchedEffect(reposo) {
    if (!reposo) {
      // Al cerrar, la flotación vuelve a reposo por el camino más corto; el giro se queda donde está (va tapado).
      flotar.animateTo(if (flotar.value < 0.5f) 0f else 1f, tween(600))
      return@LaunchedEffect
    }
    while (true) {
      flotar.animateTo(1f, tween(9_000, easing = LinearEasing))
      flotar.snapTo(0f)
    }
  }
  // El disco solo da el cuarto de vuelta de asiento al abrir y se queda recto; sin giro en reposo.
  val rotacionDisco = -75f * (1f - asiento.value)
  val escalaDisco = 0.94f + 0.06f * asiento.value
  val escalaZoom = 0.82f + (centrado.value * 0.18f)
  // 0 -> 1 -> 0 en cada ciclo, arrancando y parando sin velocidad: mismo perfil que la clave 0/50/100 % de la tele.
  val f = (1f - kotlin.math.cos(2f * Math.PI.toFloat() * flotar.value)) / 2f

  val resolucionTexto = if (es4k) "4K ULTRA HD" else "BLU-RAY 1080P"
  val hdrTexto = ficha.files.firstOrNull()?.hdr?.takeIf { it.isNotBlank() }
  val directores = remember(ficha) { ficha.cast.filter { it.role.contains("Direct", ignoreCase = true) }.joinToString(", ") { it.name } }
  val actores = remember(ficha) { ficha.cast.filter { !it.role.contains("Direct", ignoreCase = true) }.take(6).joinToString(", ") { it.name } }
  val generos = remember(ficha) { ficha.genres.take(3).joinToString(", ") }
  val fichero = ficha.files.firstOrNull { it.episodioId == null } ?: ficha.files.firstOrNull()
  val codecVideo = remember(fichero) { fichero?.codec?.uppercase() ?: if (es4k) "HEVC" else "H.264" }
  // Con la información de reproducción, el detalle real; sin ella, lo que el servidor ya sabe del fichero. Antes el
  // respaldo era el códec de VÍDEO (HEVC) puesto como si fuera el audio.
  val audioTracksTexto = remember(infoPistas, fichero) {
    infoPistas?.audio?.map { nombreAudioDePista(it) }?.distinct()?.take(2)?.joinToString(" · ")
      ?: fichero?.audio?.mapNotNull { nombreAudioDeFichero(it) }?.distinct()?.take(2)?.joinToString(" · ")?.takeIf { it.isNotBlank() }
  }
  val subsTexto = remember(infoPistas) {
    infoPistas?.subtitles?.mapNotNull { it.language?.uppercase() }?.distinct()?.take(4)?.joinToString(", ")
  }

  BoxWithConstraints(
    Modifier
      .fillMaxSize()
      .background(Color(0xF506070A))
      .pointerInput(Unit) {
        detectHorizontalDragGestures { _, dragAmount ->
          anguloY = (anguloY + dragAmount * 0.22f).coerceIn(-35f, 35f)
        }
      },
    contentAlignment = Alignment.Center,
  ) {
    val esApaisado = maxWidth > maxHeight
    val altoCaja = if (esApaisado) {
      (maxHeight * 0.74f).coerceIn(250.dp, 340.dp)
    } else {
      (maxWidth * 0.68f).coerceIn(230.dp, 305.dp)
    }
    val anchoCara = altoCaja * 0.68f
    val anchoLomo = 10.dp
    val tamanoDisco = anchoCara * 0.94f

    if (ficha.tieneFondo == 1) {
      Imagen(
        Api.imagen(ficha.id, "fanart", 1280),
        null,
        Modifier.fillMaxSize().alpha(0.12f),
        escala = ContentScale.Crop,
      )
    }

    // Botón de cerrar superior derecho
    Box(
      Modifier
        .align(Alignment.TopEnd)
        .padding(top = if (esApaisado) 16.dp else 40.dp, end = 20.dp)
        .size(40.dp)
        .clip(CircleShape)
        .background(Color(0x33FFFFFF))
        .clickable { alCerrar() },
      contentAlignment = Alignment.Center,
    ) {
      Text("✕", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
    }

    Column(
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center,
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = if (esApaisado) 8.dp else 20.dp),
    ) {
      Text(
        "EDICIÓN COLECCIONISTA",
        color = if (es4k) Color(0xFFE2B755) else Realce,
        fontSize = if (esApaisado) 11.sp else 12.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 2.sp,
      )

      Spacer(Modifier.height(if (esApaisado) 10.dp else 16.dp))

      // Ángulo de apertura de la tapa izquierda (de 180° = cerrada sobre la bandeja derecha a 0° = abierta)
      val anguloTapa = tapa.value
      // Compensación de centrado en X para que la caja cerrada esté perfectamente centrada en pantalla
      val offsetCentrado = (anchoCara * 0.5f + anchoLomo * 0.5f) * (1f - centrado.value)

      Box(
        modifier = Modifier
          .graphicsLayer {
            scaleX = escalaZoom
            scaleY = escalaZoom
            translationX = -offsetCentrado.toPx()
            translationY = -8.dp.toPx() * f
            rotationY = anguloYAnimado + 2.5f * f
            rotationX = 3f - 1f * f
            cameraDistance = 18f * density
          }
          .shadow(32.dp, RoundedCornerShape(10.dp))
          .clip(RoundedCornerShape(10.dp))
          .clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
          ) {
            abierta = !abierta
          },
        contentAlignment = Alignment.Center,
      ) {
        // Estructura fija tipo libro: Lado Izquierdo + Bisagra Central + Lado Derecho
        Row(
          modifier = Modifier
            .size(width = anchoCara * 2 + anchoLomo, height = altoCaja),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          // Tapa Izquierda (gira en 3D sobre su bisagra derecha)
          Box(
            modifier = Modifier
              // Por encima de la bandeja: en un Row los hijos se pintan en orden, así que sin esto la tapa, girada sobre
              // la bandeja al estar cerrada, quedaba DETRÁS y la caja cerrada enseñaba el disco en vez de la carátula.
              .zIndex(1f)
              .size(width = anchoCara, height = altoCaja)
              .graphicsLayer {
                transformOrigin = TransformOrigin(1f, 0.5f) // Pivote en la bisagra derecha
                rotationY = anguloTapa
                cameraDistance = 18f * density
              },
          ) {
            if (anguloTapa > 90f) {
              // Cara Exterior (Portada frontal visible cuando la caja está cerrada o cerrándose)
              Box(
                Modifier
                  .fillMaxSize()
                  .graphicsLayer {
                    rotationY = 180f // Contra-giro para que el póster no se vea en espejo
                  }
                  .clip(RoundedCornerShape(8.dp))
                  .background(Color(0xFF0C0C10))
                  .border(1.dp, Color(0x38FFFFFF), RoundedCornerShape(8.dp)),
              ) {
                Imagen(
                  Api.imagen(ficha.id, "poster", 600),
                  "Póster",
                  Modifier.fillMaxSize(),
                  escala = ContentScale.Crop,
                )

                Box(
                  Modifier
                    .fillMaxWidth()
                    .height(18.dp)
                    .background(if (es4k) Color(0xEE111116) else Color(0x880284C7))
                    .border(0.6.dp, if (es4k) Color(0x88E2B755) else Color(0x44FFFFFF))
                    .align(Alignment.TopCenter),
                  contentAlignment = Alignment.Center,
                ) {
                  Text(
                    if (es4k) "4K ULTRA HD" else "Blu-ray",
                    color = if (es4k) Color(0xFFE2B755) else Color.White,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp,
                  )
                }

                Box(
                  Modifier
                    .fillMaxSize()
                    .background(
                      Brush.linearGradient(
                        0f to Color(0x38FFFFFF),
                        0.42f to Color(0x08FFFFFF),
                        0.58f to Color.Transparent,
                        1f to Color(0x35000000),
                      ),
                    ),
                )
              }
            } else {
              // Cara Interior (Libreto físico de coleccionista con fondo satinado y alto contraste)
              Box(
                Modifier
                  .fillMaxSize()
                  .clip(RoundedCornerShape(topStart = 8.dp, bottomStart = 8.dp))
                  .background(Color(0xFF14151C))
                  .border(1.dp, Color(0x44FFFFFF), RoundedCornerShape(topStart = 8.dp, bottomStart = 8.dp))
                  .padding(10.dp),
              ) {
                // Clips metálicos translúcidos de sujeción
                Box(
                  Modifier
                    .size(width = 5.dp, height = 18.dp)
                    .align(Alignment.TopStart)
                    .background(Color(0x66FFFFFF), RoundedCornerShape(2.dp))
                    .border(0.6.dp, Color(0xAAFFFFFF), RoundedCornerShape(2.dp)),
                )
                Box(
                  Modifier
                    .size(width = 5.dp, height = 18.dp)
                    .align(Alignment.BottomStart)
                    .background(Color(0x66FFFFFF), RoundedCornerShape(2.dp))
                    .border(0.6.dp, Color(0xAAFFFFFF), RoundedCornerShape(2.dp)),
                )

                Column(
                  modifier = Modifier
                    .fillMaxSize()
                    .padding(start = 6.dp, end = 2.dp, top = 2.dp, bottom = 2.dp),
                  verticalArrangement = Arrangement.SpaceBetween,
                ) {
                  Column {
                    Row(
                      verticalAlignment = Alignment.CenterVertically,
                      horizontalArrangement = Arrangement.SpaceBetween,
                      modifier = Modifier.fillMaxWidth(),
                    ) {
                      Text(
                        "TVWATCH ARCHIVE",
                        color = Color(0xFFE2B755),
                        fontSize = 8.5.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.2.sp,
                      )
                      ficha.year?.let {
                        Text(
                          "$it",
                          color = Color(0xFF94A3B8),
                          fontSize = 8.5.sp,
                          fontWeight = FontWeight.SemiBold,
                        )
                      }
                    }

                    Spacer(Modifier.height(3.dp))

                    Text(
                      ficha.title,
                      color = Color.White,
                      fontSize = if (esApaisado) 14.sp else 13.sp,
                      fontWeight = FontWeight.Bold,
                      maxLines = 2,
                      overflow = TextOverflow.Ellipsis,
                      lineHeight = 16.sp,
                    )

                    ficha.tagline?.takeIf { it.isNotBlank() }?.let { tag ->
                      Spacer(Modifier.height(2.dp))
                      Text(
                        "«$tag»",
                        color = Color(0xFFCBD5E1),
                        fontSize = 8.sp,
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }

                    Spacer(Modifier.height(4.dp))

                    if (directores.isNotBlank()) {
                      Text(
                        "Dirección: $directores",
                        color = Color(0xFFE2E8F0),
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }

                    if (actores.isNotBlank()) {
                      Text(
                        "Reparto: $actores",
                        color = Color(0xFF94A3B8),
                        fontSize = 8.5.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }

                    if (generos.isNotBlank()) {
                      Text(
                        "Género: $generos",
                        color = Color(0xFF64748B),
                        fontSize = 8.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }

                    ficha.studio?.takeIf { it.isNotBlank() }?.let { est ->
                      Spacer(Modifier.height(3.dp))
                      Text(
                        "Estudio: $est",
                        color = Color(0xFF94A3B8),
                        fontSize = 8.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }
                  }

                  // Bloque de Especificaciones Técnicas del Master
                  Column(
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                    modifier = Modifier.padding(top = 4.dp),
                  ) {
                    Box(
                      Modifier
                        .fillMaxWidth()
                        .height(0.6.dp)
                        .background(Color(0x33E2B755)),
                    )

                    Row(
                      horizontalArrangement = Arrangement.spacedBy(4.dp),
                      verticalAlignment = Alignment.CenterVertically,
                    ) {
                      Text(
                        if (es4k) "4K UHD" else "BD-1080",
                        color = if (es4k) Color(0xFFE2B755) else Color.White,
                        fontSize = 8.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                          .background(Color(0x33000000), RoundedCornerShape(3.dp))
                          .border(0.6.dp, if (es4k) Color(0x88E2B755) else Color(0x44FFFFFF), RoundedCornerShape(3.dp))
                          .padding(horizontal = 4.dp, vertical = 1.dp),
                      )
                      hdrTexto?.let {
                        Text(
                          it,
                          color = Color.White,
                          fontSize = 8.sp,
                          fontWeight = FontWeight.SemiBold,
                          modifier = Modifier
                            .background(Color(0x33000000), RoundedCornerShape(3.dp))
                            .border(0.6.dp, Color(0x44FFFFFF), RoundedCornerShape(3.dp))
                            .padding(horizontal = 4.dp, vertical = 1.dp),
                        )
                      }
                      Text(
                        codecVideo,
                        color = Color(0xFF94A3B8),
                        fontSize = 7.5.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier
                          .background(Color(0x22FFFFFF), RoundedCornerShape(2.dp))
                          .padding(horizontal = 3.dp, vertical = 1.dp),
                      )
                      if (ficha.runtime != null && ficha.runtime > 0) {
                        Text(
                          duracionLegible(ficha.runtime),
                          color = Color(0xFF94A3B8),
                          fontSize = 8.sp,
                        )
                      }
                    }

                    if (!audioTracksTexto.isNullOrBlank()) {
                      Text(
                        "AUDIO: $audioTracksTexto",
                        color = Color(0xFFCBD5E1),
                        fontSize = 7.5.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }

                    if (!subsTexto.isNullOrBlank()) {
                      Text(
                        "SUBS: $subsTexto",
                        color = Color(0xFF94A3B8),
                        fontSize = 7.5.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }
                  }
                }
              }
            }
          }

          // Lomo / Bisagra central
          Box(
            Modifier
              .size(width = anchoLomo, height = altoCaja)
              .background(
                Brush.horizontalGradient(
                  listOf(Color(0xFF111116), Color(0xFF2D2E38), Color(0xFF111116)),
                ),
              )
              .border(0.5.dp, Color(0x30FFFFFF)),
          )

          // Bandeja Derecha con Disco (permanece fija; la tapa izquierda se abre sobre ella)
          Box(
            Modifier
              .size(width = anchoCara, height = altoCaja)
              .clip(RoundedCornerShape(topEnd = 8.dp, bottomEnd = 8.dp))
              .background(Color(0xFF0E0F16))
              .border(1.dp, Color(0x38FFFFFF), RoundedCornerShape(topEnd = 8.dp, bottomEnd = 8.dp)),
            contentAlignment = Alignment.Center,
          ) {
            if (ficha.tieneFondo == 1) {
              Imagen(
                Api.imagen(ficha.id, "fanart", 600),
                null,
                Modifier.fillMaxSize().alpha(0.20f),
                escala = ContentScale.Crop,
              )
            }

            // Circunferencia de la bandeja de plástico
            Box(
              Modifier
                .size(tamanoDisco)
                .clip(CircleShape)
                .border(1.dp, Color(0x18FFFFFF), CircleShape),
            )

            // Disco: quieto mientras la tapa lo cubre, se asienta al quedar a la vista y luego gira despacio.
            val modifierDisco = Modifier
              .size(tamanoDisco)
              .graphicsLayer {
                rotationZ = rotacionDisco
                scaleX = escalaDisco
                scaleY = escalaDisco
              }
              .shadow(14.dp, CircleShape)
              .clip(CircleShape)

            if (ficha.tieneDisco == 1) {
              Imagen(
                Api.imagen(ficha.id, "discart", 600),
                "Disco",
                modifierDisco,
                escala = ContentScale.Fit,
              )
            } else {
              Imagen(
                Api.imagen(ficha.id, "poster", 600),
                "Disco",
                modifierDisco,
                escala = ContentScale.Crop,
              )
            }

            // Reflejo sobre el disco: fijo, no gira con él, así el brillo «corre» por el disco como en uno de verdad.
            Box(
              Modifier
                .size(tamanoDisco)
                .graphicsLayer { scaleX = escalaDisco; scaleY = escalaDisco }
                .clip(CircleShape)
                .background(
                Brush.sweepGradient(
                  listOf(
                    Color(0x28FFFFFF),
                    Color(0x05FFFFFF),
                    Color(0x22FFFFFF),
                    Color(0x05FFFFFF),
                    Color(0x28FFFFFF),
                  ),
                ),
              ),
            )

            // Pivote central / hub
            Box(
              Modifier
                .size(altoCaja * 0.09f)
                .clip(CircleShape)
                .background(Color(0xFF1B1C24))
                .border(1.2.dp, Color(0x55FFFFFF), CircleShape),
            )
          }
        }
      }

      Spacer(Modifier.height(if (esApaisado) 8.dp else 16.dp))

      Text(
        if (abierta) "Toca la caja para cerrarla · Arrastra para inclinar en 3D" else "Toca la caja para abrirla · Arrastra para inclinar en 3D",
        color = TextoTenue,
        fontSize = if (esApaisado) 10.5.sp else 11.5.sp,
        textAlign = TextAlign.Center,
      )

      if (!esApaisado) {
        Spacer(Modifier.height(12.dp))

        Text(
          ficha.title,
          color = Color.White,
          fontSize = 19.sp,
          fontWeight = FontWeight.Bold,
          textAlign = TextAlign.Center,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )

        Spacer(Modifier.height(8.dp))

        Row(
          horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text(
            resolucionTexto,
            color = if (es4k) Color(0xFFE2B755) else Color.White,
            fontSize = 11.5.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
              .background(
                if (es4k) Color(0x33E2B755) else Color(0x22FFFFFF),
                RoundedCornerShape(6.dp),
              )
              .border(
                0.8.dp,
                if (es4k) Color(0x88E2B755) else Color(0x44FFFFFF),
                RoundedCornerShape(6.dp),
              )
              .padding(horizontal = 10.dp, vertical = 4.dp),
          )

          if (hdrTexto != null) {
            Text(
              hdrTexto,
              color = Color(0xFFE2E8F0),
              fontSize = 11.5.sp,
              fontWeight = FontWeight.SemiBold,
              modifier = Modifier
                .background(Color(0x22FFFFFF), RoundedCornerShape(6.dp))
                .border(0.8.dp, Color(0x33FFFFFF), RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp, vertical = 4.dp),
            )
          }

          if (ficha.runtime != null && ficha.runtime > 0) {
            Text(
              duracionLegible(ficha.runtime),
              color = Color(0xFF94A3B8),
              fontSize = 11.5.sp,
              fontWeight = FontWeight.Medium,
              modifier = Modifier
                .background(Color(0x18FFFFFF), RoundedCornerShape(6.dp))
                .border(0.8.dp, Color(0x22FFFFFF), RoundedCornerShape(6.dp))
                .padding(horizontal = 10.dp, vertical = 4.dp),
            )
          }
        }
      }
    }
  }
}
