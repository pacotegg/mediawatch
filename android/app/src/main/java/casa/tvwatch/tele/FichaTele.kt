package casa.tvwatch.tele

import casa.tvwatch.datos.Ajustes
import casa.tvwatch.ui.nombreAudioDeFichero
import androidx.compose.ui.zIndex
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.border
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import android.view.KeyEvent
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.TextButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Episodio
import casa.tvwatch.datos.Ficha
import casa.tvwatch.datos.Resena
import casa.tvwatch.datos.Trailer
import casa.tvwatch.ui.Fondo
import casa.tvwatch.ui.FondoTarjeta
import casa.tvwatch.ui.IconoEstrella
import casa.tvwatch.ui.Imagen
import casa.tvwatch.ui.Realce
import casa.tvwatch.ui.Texto
import casa.tvwatch.ui.TextoSuave
import casa.tvwatch.ui.TextoTenue
import casa.tvwatch.ui.duracionLegible
import casa.tvwatch.ui.recordarUrl
import casa.tvwatch.ui.reloj
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * La ficha, a lo Plex: el fotograma a pantalla completa, los datos a la
 * izquierda, una fila de botones y, en las series, temporadas y episodios
 * debajo. Reproducir es el único botón con texto; el resto son iconos que dicen
 * su nombre al enfocarlos, como en la Samsung.
 */
@Composable
fun FichaTele(
  itemId: Int,
  alReproducir: (fileId: Int, episodioId: Int?, desde: Double) -> Unit,
  alPerderSesion: () -> Unit,
  alAbrirFicha: (Int) -> Unit = {},
  alVolver: () -> Unit = {},
) {
  val contexto = LocalContext.current
  val ambito = rememberCoroutineScope()
  var ficha by remember(itemId) { mutableStateOf(Cache.fichaGuardada(itemId)) }
  var fallo by remember(itemId) { mutableStateOf("") }
  var intento by remember(itemId) { mutableStateOf(0) }
  var temporada by rememberSaveable(itemId) { mutableStateOf<Int?>(null) }
  /** Último episodio enfocado: al volver del reproductor, el foco vuelve a él. */
  var ultimoEpisodio by rememberSaveable(itemId) { mutableStateOf<Int?>(null) }
  var esFavorita by remember(itemId) { mutableStateOf(false) }
  var estaVista by remember(itemId) { mutableStateOf(false) }
  var trailer by remember(itemId) { mutableStateOf<Trailer?>(null) }
  var resenas by remember(itemId) { mutableStateOf<List<Resena>>(emptyList()) }
  var viendoResenas by remember { mutableStateOf(false) }
  var dialogoBorrar by remember(itemId) { mutableStateOf(false) }
  var borrando by remember(itemId) { mutableStateOf(false) }

  // Se vuelve a pedir siempre (también al volver del reproductor): el progreso cambia.
  LaunchedEffect(itemId, intento) {
    fallo = ""
    try {
      val f = withContext(Dispatchers.IO) { Api.ficha(itemId) }
      Cache.guardarFicha(f)
      ficha = f
      esFavorita = f.favorite == 1
      estaVista = f.progress.firstOrNull { it.episodioId == null }?.watched == 1
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      if (ficha == null) fallo = e.message ?: "No se pudo abrir la ficha."
    }
  }
  LaunchedEffect(itemId) { trailer = withContext(Dispatchers.IO) { Api.trailer(itemId) } }
  LaunchedEffect(itemId) { resenas = withContext(Dispatchers.IO) { Api.resenas(itemId) } }

  val f = ficha
  if (fallo.isNotEmpty()) { AvisoTele(fallo, "Reintentar") { intento++ }; return }
  if (f == null) {
    Box(Modifier.fillMaxSize().background(Fondo), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Realce) }
    return
  }

  val esSerie = f.kind == "show"
  val ficheroPelicula = f.files.firstOrNull { it.episodioId == null }
  val progreso = f.progress.firstOrNull { it.episodioId == null }
  val reanudarEn = if (!estaVista && progreso != null && progreso.watched == 0) progreso.position else 0.0
  val orden = remember(f) { f.episodes.filter { it.ficheroId != null }.sortedWith(compareBy({ it.season }, { it.episode })) }
  val temporadas = remember(f) { orden.map { it.season }.distinct() }
  val siguiente = remember(f) { episodioParaSeguir(f, orden) }
  val temporadaActiva = temporada ?: siguiente?.season ?: temporadas.firstOrNull()

  fun abrirTrailer(t: Trailer) {
    // La app de YouTube de la tele; si no está, el navegador.
    try {
      contexto.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:" + t.youtube)))
    } catch (_: ActivityNotFoundException) {
      try {
        contexto.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=" + t.youtube)))
      } catch (_: ActivityNotFoundException) {
        Toast.makeText(contexto, "Esta tele no tiene YouTube", Toast.LENGTH_LONG).show()
      }
    }
  }

  val focoPlay = remember { FocusRequester() }
  LaunchedEffect(f.id) { if (ultimoEpisodio == null) runCatching { focoPlay.requestFocus() } }

  Box(Modifier.fillMaxSize().background(Fondo)) {
    if (f.tieneFondo == 1) Imagen(recordarUrl(f.id, "fanart", 1280), null, Modifier.fillMaxSize())
    Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Fondo, 0.5f to Color(0xCC09090C), 1f to Color(0x2209090C))))
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.4f to Color.Transparent, 1f to Fondo)))

    var mostrarColeccionista by remember { mutableStateOf(false) }
    val es4k = remember(f) { f.files.any { (it.width ?: 0) >= 3800 || (it.height ?: 0) >= 2000 } }

    if (Ajustes.estuche3D && f.tienePoster == 1) {
      Box(
        Modifier
          .align(Alignment.TopEnd)
          .padding(top = 56.dp, end = AireTele.lado)
      ) {
        Estuche3DTele(f.id, f.tieneDisco == 1, es4k = es4k, alAbrir = { mostrarColeccionista = true })
      }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 56.dp, bottom = 60.dp)) {
      item {
        Column(Modifier.padding(horizontal = AireTele.lado).width(560.dp)) {
          if (f.tieneLogo == 1) {
            Imagen(recordarUrl(f.id, "logo", 560), f.title, Modifier.heightIn(max = 90.dp).width(360.dp), escala = ContentScale.Fit, alineacion = Alignment.CenterStart)
            Spacer(Modifier.height(8.dp))
            Text(f.title, color = Texto, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
          } else {
            Text(f.title, color = Texto, fontSize = 34.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
          }
          Spacer(Modifier.height(14.dp))
          Text(
            listOfNotNull(
              f.year?.toString(),
              if (esSerie) "${temporadas.size} temporada${if (temporadas.size == 1) "" else "s"}" else duracionLegible(f.runtime).ifEmpty { null },
              f.mpaa?.takeIf { it.isNotBlank() },
              f.rating?.takeIf { it > 0 }?.let { "★ " + "%.1f".format(it) },
            ).joinToString("   "),
            color = Texto,
            fontSize = 15.sp,
          )
          if (f.genres.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(f.genres.take(4).joinToString(" · "), color = TextoSuave, fontSize = 14.sp)
          }
          val directores = remember(f) { f.cast.filter { it.role.equals("director", ignoreCase = true) } }
          if (directores.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Text("Dirección: " + directores.joinToString(", ") { it.name }, color = TextoTenue, fontSize = 13.sp)
          }
          f.plot?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = TextoSuave, fontSize = 15.sp, lineHeight = 22.sp, maxLines = 5, overflow = TextOverflow.Ellipsis)
          }
          Spacer(Modifier.height(22.dp))
        }
      }

      item {
        Row(
          Modifier.padding(horizontal = AireTele.lado, vertical = 6.dp),
          horizontalArrangement = Arrangement.spacedBy(12.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          if (!esSerie && ficheroPelicula != null) {
            BotonTele(
              if (reanudarEn > 0) "Reanudar · ${reloj(reanudarEn)}" else "Reproducir",
              Modifier.focusRequester(focoPlay),
              icono = Icons.Default.PlayArrow,
              principal = true,
            ) { alReproducir(ficheroPelicula.id, null, reanudarEn) }
            if (reanudarEn > 0) {
              BotonIcono("Desde el principio", alPulsar = { alReproducir(ficheroPelicula.id, null, 0.0) }) {
                Icon(Icons.Default.Refresh, null, tint = it)
              }
            }
          } else if (esSerie && siguiente != null) {
            val desde = posicionDe(f, siguiente.id)
            BotonTele(
              (if (desde > 0) "Reanudar " else "Ver ") + "T${siguiente.season} E${siguiente.episode}",
              Modifier.focusRequester(focoPlay),
              icono = Icons.Default.PlayArrow,
              principal = true,
            ) { alReproducir(siguiente.ficheroId!!, siguiente.id, desde) }
          }
          trailer?.let { t ->
            BotonIcono("Tráiler", alPulsar = { abrirTrailer(t) }) { IconoTrailer(it) }
          }
          if (resenas.isNotEmpty()) {
            BotonIcono("Reseñas (${resenas.size})", alPulsar = { viendoResenas = true }) {
              Icon(Icons.AutoMirrored.Filled.List, null, tint = it)
            }
          }
          if (!esSerie) {
            BotonIcono(if (estaVista) "Vista · quitar" else "Marcar vista", activo = estaVista, alPulsar = {
              val nuevo = !estaVista
              estaVista = nuevo
              ambito.launch {
                try { withContext(Dispatchers.IO) { Api.marcarVista(itemId, nuevo) } } catch (_: Exception) { estaVista = !nuevo }
              }
            }) { Icon(Icons.Default.Check, null, tint = it) }
          }
          BotonIcono(if (esFavorita) "Quitar de favoritas" else "Añadir a favoritas", activo = esFavorita, alPulsar = {
            val nuevo = !esFavorita
            esFavorita = nuevo
            ambito.launch {
              try { withContext(Dispatchers.IO) { Api.favorito(itemId, nuevo) } } catch (_: Exception) { esFavorita = !nuevo }
            }
          }) { IconoEstrella(it, rellena = esFavorita, tamano = 20.dp) }

          if (Ajustes.esAdmin) {
            BotonIcono("Editar", alPulsar = {
              ambito.launch {
                Toast.makeText(contexto, "Actualizando metadatos desde TMDb…", Toast.LENGTH_SHORT).show()
                try {
                  val res = withContext(Dispatchers.IO) { Api.buscarEnTmdb(f.title, if (esSerie) "show" else "movie", f.year) }
                  val primero = res.results.firstOrNull()
                  if (primero != null) {
                    withContext(Dispatchers.IO) { Api.aplicarMetadatos(f.id, primero.tmdbId, if (esSerie) "show" else "movie") }
                    Toast.makeText(contexto, "Metadatos actualizados", Toast.LENGTH_SHORT).show()
                    intento++
                  } else {
                    Toast.makeText(contexto, "No se encontraron en TMDb", Toast.LENGTH_SHORT).show()
                  }
                } catch (e: Exception) {
                  Toast.makeText(contexto, e.message ?: "Error", Toast.LENGTH_LONG).show()
                }
              }
            }) { Icon(Icons.Default.Edit, null, tint = it) }

            BotonIcono("Eliminar", colorPeligro = true, alPulsar = { dialogoBorrar = true }) {
              Icon(Icons.Default.Delete, null, tint = Color(0xFFEF4444))
            }
          }
        }
      }

      if (esSerie && temporadas.isNotEmpty()) {
        item {
          LazyRow(
            contentPadding = PaddingValues(horizontal = AireTele.lado, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            items(temporadas) { s ->
              Pestana(if (s == 0) "Especiales" else "Temporada $s", activa = s == temporadaActiva) { temporada = s }
            }
          }
        }
        item {
          val episodios = orden.filter { it.season == temporadaActiva }
          LazyRow(
            contentPadding = PaddingValues(horizontal = AireTele.lado, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
          ) {
            items(episodios, key = { it.id }) { e ->
              val pedir = remember { FocusRequester() }
              if (e.id == ultimoEpisodio) LaunchedEffect(Unit) { runCatching { pedir.requestFocus() } }
              TarjetaEpisodio(f, e, Modifier.focusRequester(pedir)) {
                ultimoEpisodio = e.id
                alReproducir(e.ficheroId!!, e.id, posicionDe(f, e.id))
              }
            }
          }
        }
      }

      if (f.coleccionItems.size > 1) {
        item {
          Column(Modifier.padding(top = 16.dp)) {
            Text(
              f.collection ?: "En la misma saga",
              color = Texto,
              fontSize = 18.sp,
              fontWeight = FontWeight.Bold,
              modifier = Modifier.padding(horizontal = AireTele.lado, vertical = 8.dp),
            )
            LazyRow(
              contentPadding = PaddingValues(horizontal = AireTele.lado, vertical = 8.dp),
              horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
              items(f.coleccionItems, key = { it.id }) { c ->
                CartelTele(c, ancho = 120.dp, alPulsar = alAbrirFicha)
              }
            }
          }
        }
      }

      if (f.similares.isNotEmpty()) {
        item {
          Column(Modifier.padding(top = 16.dp)) {
            Text(
              "Títulos similares",
              color = Texto,
              fontSize = 18.sp,
              fontWeight = FontWeight.Bold,
              modifier = Modifier.padding(horizontal = AireTele.lado, vertical = 8.dp),
            )
            LazyRow(
              contentPadding = PaddingValues(horizontal = AireTele.lado, vertical = 8.dp),
              horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
              items(f.similares, key = { it.id }) { s ->
                CartelTele(s, ancho = 120.dp, alPulsar = alAbrirFicha)
              }
            }
          }
        }
      }
    }

    if (viendoResenas) PanelResenas(resenas) { viendoResenas = false }

    if (dialogoBorrar) {
      AlertDialog(
        onDismissRequest = { if (!borrando) dialogoBorrar = false },
        containerColor = Color(0xFF1A1214),
        shape = RoundedCornerShape(24.dp),
        title = {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Default.Delete, null, tint = Color(0xFFEF4444))
            Text("Eliminar «${f.title}»", color = Color(0xFFEF4444), fontWeight = FontWeight.Bold, fontSize = 20.sp)
          }
        },
        text = {
          Text(
            "${if (esSerie) "Se borrará la serie ENTERA con su carpeta" else "Se borrará la carpeta de la película"} en el servidor, sin papelera. Esta acción es definitiva.",
            color = TextoSuave,
            fontSize = 15.sp,
            lineHeight = 22.sp,
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
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
          ) {
            Text(if (borrando) "Eliminando…" else "Sí, eliminar", color = Color.White, fontWeight = FontWeight.Bold)
          }
        },
        dismissButton = {
          TextButton(onClick = { dialogoBorrar = false }, enabled = !borrando) {
            Text("Cancelar", color = TextoSuave, fontSize = 15.sp)
          }
        }
      )
    }

    if (mostrarColeccionista) {
      ModalColeccionistaTele(
        ficha = f,
        es4k = es4k,
        alCerrar = { mostrarColeccionista = false },
      )
    }
  }
}

/** El episodio que toca: el que se dejó a medias, o el siguiente al último visto, o el primero. */
private fun episodioParaSeguir(f: Ficha, orden: List<Episodio>): Episodio? {
  val aMedias = f.progress.filter { it.episodioId != null && it.watched == 0 && it.position > 0 }
    .mapNotNull { p -> orden.firstOrNull { it.id == p.episodioId } }
  if (aMedias.isNotEmpty()) return aMedias.last()
  val vistos = f.progress.filter { it.watched == 1 }.mapNotNull { it.episodioId }.toSet()
  val ultimoVisto = orden.indexOfLast { it.id in vistos }
  return orden.getOrNull(ultimoVisto + 1) ?: orden.firstOrNull()
}

private fun posicionDe(f: Ficha, episodioId: Int): Double {
  val p = f.progress.firstOrNull { it.episodioId == episodioId } ?: return 0.0
  return if (p.watched == 1) 0.0 else p.position
}

@Composable
private fun TarjetaEpisodio(f: Ficha, e: Episodio, modifier: Modifier, alPulsar: () -> Unit) {
  var foco by remember { mutableStateOf(false) }
  val p = f.progress.firstOrNull { it.episodioId == e.id }
  val visto = p?.watched == 1
  val total = p?.duration ?: (e.runtime?.times(60) ?: 0.0)
  val avance = if (p != null && !visto && total > 0) (p.position / total).coerceIn(0.0, 1.0).toFloat() else 0f
  Column(Modifier.width(250.dp)) {
    Box(
      modifier
        .fillMaxWidth()
        .aspectRatio(16f / 9f)
        .enfocable(RoundedCornerShape(10.dp), alFoco = { foco = it }, alPulsar = alPulsar)
        .clip(RoundedCornerShape(10.dp))
        .background(FondoTarjeta),
    ) {
      if (e.tieneFoto == 1) Imagen(remember(e.id) { Api.fotoDeEpisodio(e.id, 500) }, null, Modifier.fillMaxSize())
      else if (f.tieneFondo == 1) Imagen(recordarUrl(f.id, "fanart", 600), null, Modifier.fillMaxSize())
      if (visto) {
        Box(Modifier.align(Alignment.TopEnd).padding(8.dp).size(24.dp).clip(RoundedCornerShape(100.dp)).background(Realce), contentAlignment = Alignment.Center) {
          Icon(Icons.Default.Check, null, tint = Color(0xFF111114), modifier = Modifier.size(16.dp))
        }
      }
      if (avance > 0.01f) {
        Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color(0x66000000))) {
          Box(Modifier.fillMaxWidth(avance).height(4.dp).background(Realce))
        }
      }
    }
    Spacer(Modifier.height(8.dp))
    Text(
      "${e.episode}. " + (e.title ?: "Episodio ${e.episode}"),
      color = if (foco) Texto else TextoSuave,
      fontSize = 14.sp,
      fontWeight = FontWeight.SemiBold,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
    Text(
      if (foco) (e.plot ?: "") else duracionLegible(e.runtime),
      color = TextoTenue,
      fontSize = 12.sp,
      lineHeight = 16.sp,
      maxLines = 3,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.height(50.dp),
    )
  }
}

/** Un triángulo dentro de un rectángulo redondeado: el «tráiler» de siempre. */
@Composable
private fun IconoTrailer(color: Color) {
  Box(
    Modifier.size(width = 22.dp, height = 16.dp).clip(RoundedCornerShape(4.dp)).background(color),
    contentAlignment = Alignment.Center,
  ) {
    Icon(Icons.Default.PlayArrow, null, tint = if (color == Color(0xFF111114)) Color.White else Color(0xFF111114), modifier = Modifier.size(14.dp))
  }
}

/**
 * Reseñas a pantalla completa. Cada una coge el foco, así que las flechas
 * bajan por la lista; Atrás cierra.
 */
@Composable
private fun PanelResenas(resenas: List<Resena>, alCerrar: () -> Unit) {
  androidx.activity.compose.BackHandler { alCerrar() }
  val primera = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { primera.requestFocus() } }
  Box(Modifier.fillMaxSize().background(Color(0xF209090C))) {
    LazyColumn(
      Modifier.fillMaxSize(),
      contentPadding = PaddingValues(horizontal = 140.dp, vertical = 40.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      item { Text("Reseñas", color = Texto, fontSize = 26.sp, fontWeight = FontWeight.Bold) }
      items(resenas.size) { i ->
        val r = resenas[i]
        var foco by remember { mutableStateOf(false) }
        Column(
          Modifier
            .fillMaxWidth()
            .then(if (i == 0) Modifier.focusRequester(primera) else Modifier)
            .enfocable(RoundedCornerShape(12.dp), escala = 1.02f, aro = Color(0x88FFFFFF), alFoco = { foco = it }) {}
            .clip(RoundedCornerShape(12.dp))
            .background(if (foco) Color(0xFF26262E) else FondoTarjeta)
            .padding(18.dp),
        ) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(r.autor, color = Texto, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            r.valor?.let { Text("★ " + "%.1f".format(it), color = Realce, fontSize = 15.sp) }
          }
          r.pie?.let { Text(it, color = TextoTenue, fontSize = 12.sp) }
          Spacer(Modifier.height(8.dp))
          Text(r.contenido, color = TextoSuave, fontSize = 15.sp, lineHeight = 22.sp, maxLines = if (foco) 14 else 4, overflow = TextOverflow.Ellipsis)
        }
      }
    }
  }
}

@Composable
private fun Estuche3DTele(
  itemId: Int,
  tieneDisco: Boolean,
  es4k: Boolean = false,
  alAbrir: () -> Unit,
) {
  var enfocado by remember { mutableStateOf(false) }

  val transicionInf = rememberInfiniteTransition(label = "brillo")
  val desplazamientoBrillo by transicionInf.animateFloat(
    initialValue = -1.5f,
    targetValue = 2.5f,
    animationSpec = infiniteRepeatable(
      animation = tween(6500, easing = LinearEasing),
      repeatMode = RepeatMode.Restart,
    ),
    label = "desplazamientoBrillo",
  )

  val escalaAnimada by animateFloatAsState(
    targetValue = if (enfocado) 1.07f else 1f,
    animationSpec = spring(dampingRatio = 0.8f, stiffness = 300f),
    label = "escala",
  )

  val separacionDisco by animateDpAsState(
    targetValue = if (enfocado) 115.dp else 42.dp,
    animationSpec = spring(dampingRatio = 0.8f, stiffness = 300f),
    label = "separacionDisco",
  )

  Column(
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Box(
      Modifier
        .width(370.dp)
        .height(370.dp)
        .graphicsLayer {
          scaleX = escalaAnimada
          scaleY = escalaAnimada
          cameraDistance = 18f * density
        }
        .enfocable(
          RoundedCornerShape(12.dp),
          escala = 1.0f,
          aro = if (es4k) Color(0xFFE2B755) else Color(0xFF38BDF8),
          alFoco = { enfocado = it },
        ) { alAbrir() },
      contentAlignment = Alignment.CenterStart,
    ) {
      if (tieneDisco) {
        Box(
          Modifier
            .size(280.dp)
            .align(Alignment.CenterStart)
            .offset(x = separacionDisco)
            .shadow(20.dp, CircleShape)
        ) {
          Imagen(Api.imagen(itemId, "discart", 600), "Disco", Modifier.fillMaxSize().clip(CircleShape), escala = ContentScale.Fit)
        }
      }

      Box(
        Modifier
          .width(245.dp)
          .height(360.dp)
          .graphicsLayer {
            rotationY = -14f
            rotationX = 2f
          }
          .shadow(24.dp, RoundedCornerShape(8.dp))
          .clip(RoundedCornerShape(8.dp))
          .background(Color(0xFF09090C))
          .border(
            if (enfocado) 2.dp else 1.dp,
            if (enfocado) (if (es4k) Color(0xFFE2B755) else Color(0xFF38BDF8)) else Color(0x38FFFFFF),
            RoundedCornerShape(8.dp),
          ),
      ) {
        Imagen(Api.imagen(itemId, "poster", 500), "Póster", Modifier.fillMaxSize(), escala = ContentScale.Crop)

        // Banda superior Blu-ray / 4K UHD
        Box(
          Modifier
            .fillMaxWidth()
            .height(18.dp)
            .background(if (es4k) Color(0xEE111116) else Color(0x770284C7))
            .border(0.6.dp, if (es4k) Color(0x88E2B755) else Color(0x33FFFFFF))
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

        // Reflejo holográfico dinámico (haz de luz que recorre suavemente la carátula). Se lee `desplazamientoBrillo` dentro
        // de `drawBehind`: así solo se vuelve a DIBUJAR en cada fotograma; leído al componer, recomponía todo el estuche.
        Box(
          Modifier
            .fillMaxSize()
            .drawBehind {
              val d = desplazamientoBrillo
              drawRect(
                Brush.linearGradient(
                  (d - 0.4f) to Color.Transparent,
                  d to Color(0x35FFFFFF),
                  (d + 0.4f) to Color.Transparent,
                ),
              )
            },
        )
      }
    }

    if (enfocado) {
      Spacer(Modifier.height(8.dp))
      Text(
        "Edición física · Enter",
        color = Color(0xDDFFFFFF),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
          .clip(RoundedCornerShape(99.dp))
          .background(Color(0xCC181A20))
          .border(0.5.dp, Color(0x44FFFFFF), RoundedCornerShape(99.dp))
          .padding(horizontal = 10.dp, vertical = 4.dp),
      )
    }
  }
}

/**
 * Visor «Edición coleccionista» a pantalla completa para Google TV.
 *
 * Una caja de dos hojas con bisagra, igual que la del móvil. La TAPA (hoja izquierda) gira 3D sobre su bisagra: cerrada está
 * sobre la bandeja con la carátula a la vista; al abrirse pasa a la izquierda y enseña el libreto (dirección, reparto,
 * sinopsis y ficha técnica). El disco gira hasta pararse recto. Izquierda y derecha del mando inclinan la caja; OK o Atrás
 * cierran.
 *
 * Dos cosas que no son evidentes:
 * - **La tapa va por delante de la bandeja (`zIndex`).** En un `Row` los hijos se pintan en el orden en que están, y la
 *   tapa girada sobre la bandeja quedaba detrás: la caja «cerrada» enseñaba el disco en lugar de la carátula.
 * - **El tamaño sale de la pantalla**, no de dp fijos: a 1080p una tele de Google TV mide 540 dp de alto, y una caja de
 *   480 dp más el título y las etiquetas se salía por abajo.
 */
@Composable
private fun ModalColeccionistaTele(
  ficha: Ficha,
  es4k: Boolean,
  alCerrar: () -> Unit,
) {
  androidx.activity.compose.BackHandler { alCerrar() }

  var anguloY by remember { mutableFloatStateOf(-8f) }
  var abierta by remember { mutableStateOf(false) }
  val focoModal = remember { FocusRequester() }
  LaunchedEffect(Unit) {
    runCatching { focoModal.requestFocus() }
    kotlinx.coroutines.delay(150)
    abierta = true
  }

  val anguloYAnimado by animateFloatAsState(
    targetValue = anguloY,
    animationSpec = spring(dampingRatio = 0.8f, stiffness = 400f),
    label = "anguloY",
  )
  val progresoApertura by animateFloatAsState(
    targetValue = if (abierta) 1f else 0f,
    animationSpec = tween(durationMillis = 1000, easing = androidx.compose.animation.core.FastOutSlowInEasing),
    label = "apertura",
  )

  val resolucionTexto = if (es4k) "4K ULTRA HD" else "BLU-RAY 1080P"
  val fichero = ficha.files.firstOrNull { it.episodioId == null } ?: ficha.files.firstOrNull()
  val hdrTexto = fichero?.hdr?.takeIf { it.isNotBlank() }
  val directores = remember(ficha) { ficha.cast.filter { it.role.contains("Direct", ignoreCase = true) }.take(2).joinToString(", ") { it.name } }
  val actores = remember(ficha) { ficha.cast.filter { !it.role.contains("Direct", ignoreCase = true) }.take(4).joinToString(", ") { it.name } }
  val generos = remember(ficha) { ficha.genres.take(3).joinToString(", ") }
  val textoVideo = remember(fichero) {
    fichero?.let { f ->
      val dim = if (f.width != null && f.height != null) "${f.width}×${f.height}" else ""
      listOf(dim, f.codec?.uppercase() ?: "", f.hdr ?: "").filter { it.isNotBlank() }.joinToString(" ")
    }
  }
  val textoAudio = remember(fichero) {
    fichero?.audio?.take(2)?.mapNotNull { nombreAudioDeFichero(it) }?.joinToString(" · ")?.takeIf { it.isNotBlank() }
  }

  androidx.compose.foundation.layout.BoxWithConstraints(
    Modifier
      .fillMaxSize()
      .background(Color(0xF406070A))
      .focusRequester(focoModal)
      .focusable()
      .onKeyEvent { evt ->
        if (evt.type == KeyEventType.KeyDown) {
          when (evt.nativeKeyEvent.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> {
              anguloY = (anguloY - 5f).coerceIn(-28f, 28f)
              true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
              anguloY = (anguloY + 5f).coerceIn(-28f, 28f)
              true
            }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_BACK -> {
              alCerrar()
              true
            }
            else -> false
          }
        } else false
      },
    contentAlignment = Alignment.Center,
  ) {
    val altoCaja = (maxHeight * 0.62f).coerceIn(240.dp, 420.dp)
    // La sinopsis se queda con el hueco que sobra: con una caja baja, menos líneas, para que la ficha técnica no se corte.
    val lineasSinopsis = ((altoCaja.value - 200f) / 15f).toInt().coerceIn(2, 6)
    val anchoCara = altoCaja * 0.72f
    val anchoLomo = 12.dp
    val tamanoDisco = anchoCara * 0.94f
    val formaIzq = RoundedCornerShape(topStart = 10.dp, bottomStart = 10.dp)
    val formaDer = RoundedCornerShape(topEnd = 10.dp, bottomEnd = 10.dp)

    if (ficha.tieneFondo == 1) {
      Imagen(
        Api.imagen(ficha.id, "fanart", 1280),
        null,
        Modifier.fillMaxSize().alpha(0.12f),
        escala = ContentScale.Crop,
      )
    }

    Column(
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center,
      modifier = Modifier.padding(24.dp),
    ) {
      // 180° = cerrada sobre la bandeja; 0° = abierta a la izquierda.
      val anguloTapa = (1f - progresoApertura) * 180f
      // Cerrada, la caja es solo la hoja derecha: se corre media caja para que quede centrada en pantalla.
      val offsetCentrado = (anchoCara * 0.5f + anchoLomo * 0.5f) * (1f - progresoApertura)

      Box(
        modifier = Modifier
          .graphicsLayer {
            val zoom = 0.86f + progresoApertura * 0.14f
            scaleX = zoom
            scaleY = zoom
            translationX = -offsetCentrado.toPx()
            rotationY = anguloYAnimado
            rotationX = 2f
            cameraDistance = 22f * density
          }
          .shadow(36.dp, RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
      ) {
        Row(
          modifier = Modifier.size(width = anchoCara * 2 + anchoLomo, height = altoCaja),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          // Tapa: gira sobre su borde derecho (la bisagra).
          Box(
            modifier = Modifier
              .zIndex(1f)
              .size(width = anchoCara, height = altoCaja)
              .graphicsLayer {
                transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 0.5f)
                rotationY = anguloTapa
                cameraDistance = 22f * density
              },
          ) {
            if (anguloTapa > 90f) {
              // Cara exterior: la carátula. Contra-giro de 180° para que no salga en espejo.
              Box(
                Modifier
                  .fillMaxSize()
                  .graphicsLayer { rotationY = 180f }
                  .clip(RoundedCornerShape(10.dp))
                  .background(Color(0xFF09090C))
                  .border(1.dp, Color(0x38FFFFFF), RoundedCornerShape(10.dp)),
              ) {
                Imagen(
                  Api.imagen(ficha.id, "poster", 800),
                  ficha.title,
                  Modifier.fillMaxSize(),
                  escala = ContentScale.Crop,
                )
                Box(
                  Modifier
                    .fillMaxWidth()
                    .height(24.dp)
                    .background(if (es4k) Color(0xEE111116) else Color(0x880284C7))
                    .border(0.6.dp, if (es4k) Color(0x88E2B755) else Color(0x44FFFFFF))
                    .align(Alignment.TopCenter),
                  contentAlignment = Alignment.Center,
                ) {
                  Text(
                    if (es4k) "4K ULTRA HD" else "Blu-ray",
                    color = if (es4k) Color(0xFFE2B755) else Color.White,
                    fontSize = 11.sp,
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
              // Cara interior: el libreto.
              Column(
                Modifier
                  .fillMaxSize()
                  .clip(formaIzq)
                  .background(Color(0xFF14151C))
                  .border(1.dp, Color(0x44FFFFFF), formaIzq)
                  .padding(start = 18.dp, end = 14.dp, top = 14.dp, bottom = 12.dp),
              ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                  Text("TVWATCH ARCHIVE", color = Color(0xFFE2B755), fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
                  ficha.year?.let { Text("$it", color = Color(0xFF94A3B8), fontSize = 10.sp, fontWeight = FontWeight.SemiBold) }
                }
                Spacer(Modifier.height(6.dp))
                Text(
                  ficha.title,
                  color = Color.White,
                  fontSize = 19.sp,
                  fontWeight = FontWeight.Bold,
                  maxLines = 2,
                  overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                  lineHeight = 22.sp,
                )
                Spacer(Modifier.height(6.dp))
                @Composable
                fun fila(clave: String, valor: String, anchoClave: androidx.compose.ui.unit.Dp = 58.dp) {
                  if (valor.isBlank()) return
                  Row(Modifier.padding(top = 2.dp)) {
                    Text(clave, color = Color(0xFF94A3B8), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(anchoClave))
                    Text(valor, color = Color(0xFFCBD5E1), fontSize = 11.sp, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                  }
                }
                fila("Dirección", directores)
                fila("Reparto", actores)
                fila("Género", generos)
                ficha.plot?.takeIf { it.isNotBlank() }?.let { plot ->
                  Spacer(Modifier.height(8.dp))
                  Text(
                    plot,
                    color = Color(0xFFE2E8F0),
                    fontSize = 11.sp,
                    lineHeight = 15.sp,
                    maxLines = lineasSinopsis,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                  )
                }
                Spacer(Modifier.weight(1f))
                Box(Modifier.fillMaxWidth().height(0.6.dp).background(Color(0x33E2B755)))
                Spacer(Modifier.height(4.dp))
                fila("Vídeo", textoVideo ?: "", 46.dp)
                fila("Audio", textoAudio ?: "", 46.dp)
              }
            }
          }

          // Bisagra central
          Box(
            Modifier
              .size(width = anchoLomo, height = altoCaja)
              .background(Brush.horizontalGradient(listOf(Color(0xFF111116), Color(0xFF2D2E38), Color(0xFF111116))))
              .border(0.5.dp, Color(0x30FFFFFF)),
          )

          // Bandeja con el disco (fija; la tapa se abre sobre ella)
          Box(
            Modifier
              .size(width = anchoCara, height = altoCaja)
              .clip(formaDer)
              .background(Color(0xFF0E0F16))
              .border(1.dp, Color(0x38FFFFFF), formaDer),
            contentAlignment = Alignment.Center,
          ) {
            if (ficha.tieneFondo == 1) {
              Imagen(
                Api.imagen(ficha.id, "fanart", 800),
                null,
                Modifier.fillMaxSize().alpha(0.20f),
                escala = ContentScale.Crop,
              )
            }
            Box(
              Modifier
                .size(tamanoDisco)
                .clip(CircleShape)
                .border(1.dp, Color(0x18FFFFFF), CircleShape),
            )
            // El disco entra girando y se para recto (0°) cuando la tapa termina de abrirse.
            val modifierDisco = Modifier
              .size(tamanoDisco)
              .clip(CircleShape)
              .shadow(14.dp, CircleShape)
              .graphicsLayer { rotationZ = (1f - progresoApertura) * 720f }
            Imagen(
              if (ficha.tieneDisco == 1) Api.imagen(ficha.id, "discart", 800) else Api.imagen(ficha.id, "poster", 800),
              "Disco",
              modifierDisco,
              escala = if (ficha.tieneDisco == 1) ContentScale.Fit else ContentScale.Crop,
            )
            Box(
              Modifier
                .size(altoCaja * 0.08f)
                .clip(CircleShape)
                .background(Color(0xFF1B1C24))
                .border(1.5.dp, Color(0x55FFFFFF), CircleShape),
            )
          }
        }
      }

      Spacer(Modifier.height(18.dp))

      Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.alpha(progresoApertura),
      ) {
        Text(
          resolucionTexto,
          color = if (es4k) Color(0xFFE2B755) else Color.White,
          fontSize = 13.sp,
          fontWeight = FontWeight.Bold,
          modifier = Modifier
            .background(if (es4k) Color(0x33E2B755) else Color(0x22FFFFFF), RoundedCornerShape(6.dp))
            .border(0.8.dp, if (es4k) Color(0x88E2B755) else Color(0x44FFFFFF), RoundedCornerShape(6.dp))
            .padding(horizontal = 12.dp, vertical = 5.dp),
        )
        if (hdrTexto != null) {
          Text(
            hdrTexto,
            color = Color(0xFFE2E8F0),
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
              .background(Color(0x22FFFFFF), RoundedCornerShape(6.dp))
              .border(0.8.dp, Color(0x33FFFFFF), RoundedCornerShape(6.dp))
              .padding(horizontal = 12.dp, vertical = 5.dp),
          )
        }
        if (ficha.runtime != null && ficha.runtime > 0) {
          Text(
            duracionLegible(ficha.runtime),
            color = Color(0xFF94A3B8),
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
              .background(Color(0x18FFFFFF), RoundedCornerShape(6.dp))
              .border(0.8.dp, Color(0x22FFFFFF), RoundedCornerShape(6.dp))
              .padding(horizontal = 12.dp, vertical = 5.dp),
          )
        }
      }

      Spacer(Modifier.height(10.dp))

      Text(
        "◀ ▶ Inclinar perspectiva 3D · OK o Atrás para volver",
        color = Color(0x88FFFFFF),
        fontSize = 13.sp,
      )
    }
  }
}
