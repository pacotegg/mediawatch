package casa.tvwatch.tele

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
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
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
    }

    if (viendoResenas) PanelResenas(resenas) { viendoResenas = false }
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
