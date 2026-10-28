package casa.tvwatch.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
 * logo (el primero). Uno solo, más grande; varios, uno al lado de otro con la misma área, centrados y a todo el ancho
 * de la ficha (28/10/2026). El servidor da cada logo ya aclarado o dorado.
 *
 * Aparte de `PantallaFicha`: esa función ya es de las grandes (la 3.71 se rompió por una así, ver CHANGELOG 3.72).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LogosDeEstudios(itemId: Int, modifier: Modifier = Modifier) {
  var logos by remember(itemId) { mutableStateOf<List<LogoEstudio>>(emptyList()) }
  LaunchedEffect(itemId) {
    logos = withContext(Dispatchers.IO) { runCatching { Api.logosDeEstudios(itemId).logos }.getOrDefault(emptyList()) }
  }
  if (logos.isEmpty()) return

  val solo = logos.size == 1
  // Todos en una fila, centrados; si no caben, pasan a la siguiente (FlowRow). Misma área para cada uno, así un logo
  // casi cuadrado no sale diminuto al lado de uno alargado.
  Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
    Text("Producida por", color = TextoTenue, fontSize = 10.sp)
    Spacer(Modifier.height(8.dp))
    FlowRow(
      horizontalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterHorizontally),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      for (l in logos) {
        val r = if (l.aspecto > 0) l.aspecto else 1.0
        val (areaDp, tope, alto) = if (solo) Triple(7000.0, 150.0, 56.0) else Triple(3000.0, 130.0, 40.0)
        var w = sqrt(areaDp * r)
        var h = w / r
        if (w > tope) { w = tope; h = w / r }
        if (h > alto) { h = alto; w = h * r }
        Imagen(
          url = Api.logoDeEstudio(l.nombre),
          descripcion = l.nombre,
          modifier = Modifier.align(Alignment.CenterVertically).size(w.dp, h.dp),
          escala = ContentScale.Fit,
          alineacion = Alignment.Center,
        )
      }
    }
  }
}
