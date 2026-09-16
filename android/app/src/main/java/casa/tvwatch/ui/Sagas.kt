package casa.tvwatch.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.ContenidoDeSaga
import casa.tvwatch.datos.Saga
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** «James Bond - Colección» → «James Bond»: el sufijo de TMDb no aporta nada. */
fun nombreDeSaga(n: String): String = n.replace(Regex("""\s*[-.:·]?\s*Colecci[óo]n\s*$""", RegexOption.IGNORE_CASE), "").trim()

private fun vistas(n: Int) = if (n == 1) "1 vista" else "$n vistas"

/**
 * Las sagas: lo que el servidor agrupa por la colección de TMDb —Bond, Alien,
 * Toy Story— con más de una película en la biblioteca. La tele ya las enseña;
 * en el móvil faltaban.
 *
 * Cada tarjeta lleva el fotograma de la película mejor valorada de la saga,
 * el nombre, cuántas hay y cuántas has visto.
 */
@Composable
fun PantallaSagas(alAbrirSaga: (String) -> Unit, alPerderSesion: () -> Unit) {
  var sagas by remember { mutableStateOf<List<Saga>?>(null) }
  var fallo by remember { mutableStateOf("") }
  var intento by remember { mutableStateOf(0) }

  LaunchedEffect(intento) {
    fallo = ""
    try {
      sagas = withContext(Dispatchers.IO) { Api.sagas() }
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo cargar."
    }
  }

  val lista = sagas
  when {
    fallo.isNotEmpty() -> Aviso(fallo, "Reintentar") { intento++ }
    lista == null -> EsqueletoDeRejilla(columnas = 2, filas = 4)
    lista.isEmpty() -> Aviso("No hay sagas: hacen falta dos películas de la misma colección.")
    else -> LazyVerticalGrid(
      columns = GridCells.Adaptive(minSize = 170.dp),
      modifier = Modifier.fillMaxSize().background(Fondo),
      contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      items(lista, key = { it.name }) { s -> TarjetaDeSaga(s) { alAbrirSaga(s.name) } }
    }
  }
}

@Composable
private fun TarjetaDeSaga(s: Saga, alPulsar: () -> Unit) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) Movimiento.ESCALA_PULSADA else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala de la saga",
  )
  Column(Modifier.scale(escala).pulsable(pulsacion, alPulsar)) {
    Box(
      Modifier
        .fillMaxWidth()
        .aspectRatio(16f / 9f)
        .clip(RoundedCornerShape(Esquinas.tarjeta))
        .background(FondoTarjeta),
    ) {
      val imagenId = s.fanartId ?: s.posterId
      if (imagenId != null) {
        Imagen(recordarUrl(imagenId, if (s.fanartId != null) "fanart" else "poster", 640), s.name, Modifier.fillMaxSize())
      }
      Box(
        Modifier.fillMaxSize().background(
          Brush.verticalGradient(0.4f to Color.Transparent, 1f to Color(0xCC000000)),
        ),
      )
      Text(
        nombreDeSaga(s.name),
        color = Texto,
        style = MaterialTheme.typography.titleMedium,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
      )
    }
    Spacer(Modifier.height(6.dp))
    Text(
      buildString {
        append(s.count).append(if (s.count == 1) " película" else " películas")
        if (s.firstYear != null) append("  ·  ").append(s.firstYear).append(if (s.lastYear != null && s.lastYear != s.firstYear) "–" + s.lastYear else "")
        if (s.seen > 0) append("  ·  ").append(vistas(s.seen))
      },
      color = TextoTenue,
      style = MaterialTheme.typography.labelSmall,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/** Una saga: fotograma arriba y sus películas en orden de año. */
@Composable
fun PantallaSaga(nombre: String, alAbrirFicha: (Int) -> Unit, alPerderSesion: () -> Unit) {
  var contenido by remember(nombre) { mutableStateOf<ContenidoDeSaga?>(null) }
  var fallo by remember(nombre) { mutableStateOf("") }

  LaunchedEffect(nombre) {
    try {
      contenido = withContext(Dispatchers.IO) { Api.saga(nombre) }
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo cargar."
    }
  }

  val c = contenido
  when {
    fallo.isNotEmpty() -> Aviso(fallo)
    c == null -> EsqueletoDeRejilla()
    else -> LazyVerticalGrid(
      columns = GridCells.Adaptive(minSize = 118.dp),
      modifier = Modifier.fillMaxSize().background(Fondo),
      contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      item(span = { GridItemSpan(maxLineSpan) }) {
        val cuantasVistas = c.items.count { (it.watched ?: 0) == 1 }
        Text(
          "${c.items.size} películas" + (if (cuantasVistas > 0) "  ·  " + vistas(cuantasVistas) else "") + "  ·  por año",
          color = TextoTenue,
          style = MaterialTheme.typography.labelSmall,
          modifier = Modifier.padding(start = 4.dp, bottom = 2.dp),
        )
      }
      items(c.items, key = { it.id }) { t -> Cartel(t, ancho = 118, alPulsar = alAbrirFicha) }
    }
  }
}
