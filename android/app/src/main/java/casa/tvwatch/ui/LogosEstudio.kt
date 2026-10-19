package casa.tvwatch.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.LogoEstudio
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.sqrt

/**
 * Los logos de TODOS los estudios del título, con «Producida por», como en la tele y la web (19/10/2026). Antes, un solo
 * logo (el primero). Uno solo, más grande; varios, de dos en dos con la misma área; los muy alargados (4:1 o más, p. ej.
 * el texto de DreamWorks Pictures) en su propia fila. El servidor da cada logo ya aclarado o dorado.
 *
 * Aparte de `PantallaFicha`: esa función ya es de las grandes (la 3.71 se rompió por una así, ver CHANGELOG 3.72).
 */
@Composable
internal fun LogosDeEstudios(itemId: Int, modifier: Modifier = Modifier) {
  var logos by remember(itemId) { mutableStateOf<List<LogoEstudio>>(emptyList()) }
  LaunchedEffect(itemId) {
    logos = withContext(Dispatchers.IO) { runCatching { Api.logosDeEstudios(itemId).logos }.getOrDefault(emptyList()) }
  }
  if (logos.isEmpty()) return

  val solo = logos.size == 1
  val largo = { l: LogoEstudio -> !solo && l.aspecto >= 4.0 }
  // Filas: los alargados solos; el resto, de dos en dos.
  val filas = mutableListOf<List<LogoEstudio>>()
  var suelto: LogoEstudio? = null
  for (l in logos) {
    if (largo(l)) { filas.add(listOf(l)); continue }
    val s = suelto
    if (s == null) { suelto = l } else { filas.add(listOf(s, l)); suelto = null }
  }
  suelto?.let { filas.add(listOf(it)) }

  Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
    Text("Producida por", color = TextoTenue, fontSize = 10.sp)
    Spacer(Modifier.height(6.dp))
    Column(verticalArrangement = Arrangement.spacedBy(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      for (fila in filas) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
          for (l in fila) {
            val r = if (l.aspecto > 0) l.aspecto else 1.0
            val (areaDp, tope, alto) = when {
              solo -> Triple(7000.0, 150.0, 56.0)
              largo(l) -> Triple(4200.0, 150.0, 30.0)
              else -> Triple(2900.0, 68.0, 36.0)
            }
            var w = sqrt(areaDp * r)
            var h = w / r
            if (w > tope) { w = tope; h = w / r }
            if (h > alto) { h = alto; w = h * r }
            Imagen(
              url = Api.logoDeEstudio(l.nombre),
              descripcion = l.nombre,
              modifier = Modifier.size(w.dp, h.dp),
              escala = ContentScale.Fit,
              alineacion = Alignment.Center,
            )
          }
        }
      }
    }
  }
}
