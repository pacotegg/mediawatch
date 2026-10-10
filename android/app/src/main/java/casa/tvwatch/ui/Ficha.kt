package casa.tvwatch.ui

import androidx.compose.foundation.background
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.draw.scale
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
  /*
   * Favorito y visto se pintan al instante y se mandan después. Esperar a que
   * conteste el servidor para que la estrella cambie de color hace que la
   * aplicación parezca lenta aunque tarde 30 ms; si falla, se deshace.
   */
  var esFavorita by remember(itemId) { mutableStateOf(false) }
  var estaVista by remember(itemId) { mutableStateOf(false) }
  // Los extras se piden aparte para no retrasar la ficha, que es lo que se mira.
  var extras by remember(itemId) { mutableStateOf<List<Extra>>(emptyList()) }
  var extrasAbiertos by remember(itemId) { mutableStateOf(false) }
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
    // Al volver a la ficha de una serie se recuerda lo elegido antes.
    val previa = if (esSerie) EleccionDePistas.serieDe(itemId) else null
    if (info != null && previa != null) {
      audioElegido = previa.audioIdioma?.let { l -> info.audio.firstOrNull { Pistas.mismoIdioma(it.language, l) }?.id }
      subElegido = previa.subtitulo?.let { Pistas.subtituloParecido(info.subtitles, it)?.id }
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
  val temporadaActiva = temporada ?: temporadas.firstOrNull()

  LazyColumn(
    Modifier.fillMaxSize().background(Fondo),
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
        Column(
          Modifier
            .align(Alignment.BottomStart)
            .padding(horizontal = Aire.borde)
            .padding(bottom = 4.dp),
        ) {
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

    item {
      Column(Modifier.padding(horizontal = Aire.borde)) {
        Spacer(Modifier.height(14.dp))
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
            BotonIcono("Extras (${extras.size})", "extras") { extrasAbiertos = true }
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
          // Cambiar las imágenes: solo administrador
          if (Ajustes.esAdmin) BotonIcono("Imágenes", "imagenes") { alCambiarImagenes(f.kind, f.title, f.year) }
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
              if (n == 0) "Especiales" else "Temporada $n",
              color = if (activa) Color(0xFF15100A) else Texto,
              fontSize = 13.sp,
              modifier = Modifier
                .clip(RoundedCornerShape(18.dp))
                .background(if (activa) Realce else FondoTarjeta)
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
          // Mantener pulsado un episodio lo manda a la tele.
          alMantener = { mandarALaTele(e.ficheroId!!, e.id, posicionDe(f, e.id)) },
          alPedirDescarga = { fileIdDescargaDialogo = it },
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
  }

  if (extrasAbiertos) {
    DialogoDeExtras(extras) { extrasAbiertos = false }
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
  alPedirDescarga: (Int) -> Unit = {}
) {
  val avance = run {
    val p = f.progress.firstOrNull { it.episodioId == e.id }
    val total = p?.duration ?: (e.runtime?.times(60) ?: 0.0)
    if (p != null && total > 0 && p.watched == 0) (p.position / total).coerceIn(0.0, 1.0).toFloat() else 0f
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
      if (avance > 0.01f) {
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
    Column(Modifier.weight(1f).padding(top = 2.dp)) {
      Text("T${e.season}E${e.episode}", color = TextoTenue, fontSize = 11.sp)
      Text(e.title ?: "Episodio ${e.episode}", color = Texto, fontSize = 14.sp, maxLines = 2, lineHeight = 18.sp)
      duracionLegible(e.runtime).takeIf { it.isNotEmpty() }?.let {
        Text(it, color = TextoTenue, fontSize = 11.sp)
      }
    }
    if (e.ficheroId != null) {
      Pastilla("⬇") { alPedirDescarga(e.ficheroId) }
    }
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
  when {
    alto >= 1900 -> out += "4K"
    alto >= 1000 -> out += "1080p"
    alto >= 700 -> out += "720p"
  }
  fichero.codec?.let { out += it.uppercase() }
  fichero.hdr?.let { out += it }
  return out
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
