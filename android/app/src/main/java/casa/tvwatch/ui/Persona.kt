package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.FichaDePersona
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Una persona: foto, biografía y todo lo que hay suyo en la biblioteca,
 * con el personaje debajo de cada carátula. Se llega desde el reparto de una
 * ficha o desde Buscar.
 */
@Composable
fun PantallaPersona(personaId: Int, alAbrirFicha: (Int) -> Unit, alPerderSesion: () -> Unit) {
  var ficha by remember(personaId) { mutableStateOf<FichaDePersona?>(null) }
  var fallo by remember(personaId) { mutableStateOf("") }
  var biografiaEntera by remember(personaId) { mutableStateOf(false) }

  LaunchedEffect(personaId) {
    try {
      ficha = withContext(Dispatchers.IO) { Api.persona(personaId) }
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo cargar."
    }
  }

  val f = ficha
  when {
    fallo.isNotEmpty() -> Aviso(fallo)
    f == null -> EsqueletoDeRejilla()
    else -> LazyVerticalGrid(
      columns = GridCells.Adaptive(minSize = 118.dp),
      modifier = Modifier.fillMaxSize().background(Fondo),
      contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      item(span = { GridItemSpan(maxLineSpan) }) {
        Column(Modifier.padding(horizontal = 4.dp)) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(84.dp).clip(CircleShape).background(FondoTarjeta), contentAlignment = Alignment.Center) {
              if (f.tieneFoto == 1) {
                Imagen(Api.fotoDePersona(f.id, 240), f.name, Modifier.fillMaxSize())
              } else {
                Text(f.name.take(1).uppercase(), color = TextoTenue, style = MaterialTheme.typography.headlineSmall)
              }
            }
            Spacer(Modifier.width(16.dp))
            Column {
              Text(f.name, color = Texto, style = MaterialTheme.typography.headlineSmall)
              val datos = listOfNotNull(
                f.detalle?.birthday?.let { "Nació en " + it.take(4) + (if (f.detalle.deathday != null) " · murió en " + f.detalle.deathday.take(4) else "") },
                f.detalle?.birthplace,
              )
              if (datos.isNotEmpty()) {
                Text(datos.joinToString("  ·  "), color = TextoSuave, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
              }
              Text(
                "${f.credits.distinctBy { it.id }.size} " + (if (f.credits.distinctBy { it.id }.size == 1) "título" else "títulos") + " en la biblioteca",
                color = TextoTenue,
                style = MaterialTheme.typography.labelSmall,
              )
            }
          }
          f.detalle?.biography?.takeIf { it.isNotBlank() }?.let { bio ->
            Spacer(Modifier.height(14.dp))
            Text(
              bio,
              color = TextoSuave,
              style = MaterialTheme.typography.bodyMedium,
              maxLines = if (biografiaEntera) Int.MAX_VALUE else 4,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.clickable { biografiaEntera = !biografiaEntera },
            )
          }
          Spacer(Modifier.height(10.dp))
        }
      }
      // Una persona puede salir dos veces en el mismo título (dirige y
      // escribe): una carátula por título, no por papel.
      val titulos = f.credits.distinctBy { it.id }
      items(titulos, key = { it.id }) { t ->
        Column {
          Cartel(t, ancho = 118, alPulsar = alAbrirFicha)
          t.character?.let {
            // TMDb pone «Self» cuando alguien sale como quien es.
            val papel = if (it.startsWith("Self", ignoreCase = true)) "como sí mismo" else "como $it"
            Text(papel, color = TextoTenue, style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
        }
      }
    }
  }
}
