package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Titulo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Los títulos guardados para ver más tarde, en la misma rejilla que una biblioteca.
 */
@Composable
fun PantallaWatchlist(alAbrirFicha: (Int) -> Unit, alPerderSesion: () -> Unit) {
  var items by remember { mutableStateOf<List<Titulo>?>(null) }
  var fallo by remember { mutableStateOf("") }
  var intento by remember { mutableStateOf(0) }

  LaunchedEffect(intento) {
    fallo = ""
    try {
      items = withContext(Dispatchers.IO) { Api.watchlist() }
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo cargar."
    }
  }

  val lista = items
  when {
    fallo.isNotEmpty() -> Aviso(fallo, "Reintentar") { intento++ }
    lista == null -> EsqueletoDeRejilla()
    lista.isEmpty() -> Aviso("Todavía no has guardado nada para ver más tarde.")
    else -> LazyVerticalGrid(
      columns = GridCells.Adaptive(minSize = 100.dp),
      modifier = Modifier.fillMaxSize().background(Fondo),
      contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      items(lista, key = { it.id }) { t -> Cartel(t, ancho = 100, alPulsar = alAbrirFicha) }
    }
  }
}
