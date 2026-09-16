package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Genero
import casa.tvwatch.datos.Titulo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Cuántos títulos se piden de una vez. Películas tiene 1.372. */
private const val PAGINA = 60

/** Los órdenes que ofrece el servidor, con su nombre para la pastilla. */
private val ORDENES = listOf(
  "title" to "A–Z",
  "added" to "Recientes",
  "year" to "Año",
  "rating" to "Nota",
  "random" to "Al azar",
)

/**
 * Una biblioteca entera, en rejilla, con orden y filtros arriba.
 *
 * Se carga por páginas según se baja. Pedir los 1.372 de golpe sería medio
 * megabyte de JSON y mil cuatrocientas carátulas que nadie va a mirar; y
 * quedarse en los primeros 120 fue justo el fallo que hacía que «Peques»
 * terminara en «Merlín el encantado».
 *
 * `LazyVerticalGrid` con `Adaptive` decide las columnas por el ancho: tres en
 * un móvil de pie, cinco o seis tumbado o en una tableta, sin escribir una
 * línea para cada caso.
 *
 * El orden, el género y «sin ver» los aplica el servidor: cambiar cualquiera
 * vacía la rejilla y vuelve a pedir desde el principio. Es lo que hace Plex
 * en cada biblioteca y lo que faltaba para moverse por mil títulos.
 */
@Composable
fun PantallaBiblioteca(
  libraryId: Int,
  nombre: String,
  alAbrirFicha: (Int) -> Unit,
  alPerderSesion: () -> Unit,
) {
  var orden by remember(libraryId) { mutableStateOf("title") }
  var genero by remember(libraryId) { mutableStateOf<String?>(null) }
  var sinVer by remember(libraryId) { mutableStateOf(false) }
  var generos by remember(libraryId) { mutableStateOf<List<Genero>>(emptyList()) }
  var eligiendoGenero by remember { mutableStateOf(false) }

  // La combinación de filtros: cambia, y la rejilla empieza de cero.
  val filtro = Triple(orden, genero, sinVer)
  val items = remember(libraryId, filtro) { mutableStateListOf<Titulo>() }
  var total by remember(libraryId, filtro) { mutableStateOf(-1) }
  var cargando by remember(libraryId, filtro) { mutableStateOf(false) }
  var fallo by remember(libraryId, filtro) { mutableStateOf("") }
  val rejilla = rememberLazyGridState()

  suspend fun traerMas() {
    if (cargando) return
    if (total >= 0 && items.size >= total) return
    cargando = true
    try {
      val p = withContext(Dispatchers.IO) { Api.titulos(libraryId, items.size, PAGINA, orden, genero, sinVer) }
      total = p.total
      items.addAll(p.items)
      fallo = ""
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo cargar."
    } finally {
      cargando = false
    }
  }

  LaunchedEffect(libraryId, filtro) {
    if (items.isEmpty()) traerMas()
    rejilla.scrollToItem(0)
  }
  LaunchedEffect(libraryId) {
    try { generos = withContext(Dispatchers.IO) { Api.generos(libraryId) } } catch (e: Exception) { /* sin filtro de género */ }
  }

  /*
   * Pedir la página siguiente cuando quedan doce por delante, no al llegar al
   * final: así la petición termina antes de que se vea el hueco.
   */
  val cercaDelFinal by remember {
    derivedStateOf {
      val ultimo = rejilla.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
      ultimo >= items.size - 12
    }
  }
  LaunchedEffect(rejilla, filtro) {
    snapshotFlow { cercaDelFinal }.collect { cerca -> if (cerca && items.isNotEmpty()) traerMas() }
  }

  Column(Modifier.fillMaxSize().background(Fondo)) {
    LazyRow(
      contentPadding = PaddingValues(horizontal = Aire.borde, vertical = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      items(ORDENES, key = { it.first }) { (clave, nombreOrden) ->
        Pastilla(nombreOrden, activa = orden == clave) { orden = clave }
      }
      item { Pastilla(if (sinVer) "Sin ver ✓" else "Sin ver", activa = sinVer) { sinVer = !sinVer } }
      if (generos.isNotEmpty()) {
        item { Pastilla(genero ?: "Género ▾", activa = genero != null) { eligiendoGenero = true } }
      }
    }
    if (total >= 0) {
      Text(
        "$total títulos" + (if (genero != null || sinVer) " con este filtro" else ""),
        color = TextoTenue,
        style = MaterialTheme.typography.labelSmall,
        modifier = Modifier.padding(horizontal = Aire.borde, vertical = 2.dp),
      )
    }

    when {
      items.isEmpty() && fallo.isNotEmpty() -> Aviso(fallo)
      items.isEmpty() && total == 0 -> Aviso("Nada con este filtro.")
      items.isEmpty() -> EsqueletoDeRejilla()
      else -> LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 118.dp),
        state = rejilla,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
        verticalArrangement = Arrangement.spacedBy(16.dp),
      ) {
        items(items, key = { it.id }) { t ->
          Cartel(t, ancho = 118, alPulsar = alAbrirFicha)
        }
      }
    }
  }

  if (eligiendoGenero) {
    ElegirGenero(generos, genero, alElegir = { genero = it; eligiendoGenero = false }, alCerrar = { eligiendoGenero = false })
  }
}

/** La lista de géneros de esta biblioteca, con cuántos títulos tiene cada uno. */
@Composable
private fun ElegirGenero(generos: List<Genero>, actual: String?, alElegir: (String?) -> Unit, alCerrar: () -> Unit) {
  Box(
    Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xB3000000)).clickable(onClick = alCerrar),
    contentAlignment = Alignment.Center,
  ) {
    LazyColumn(
      Modifier
        .fillMaxWidth(0.8f)
        .heightIn(max = 520.dp)
        .clip(RoundedCornerShape(Esquinas.panel))
        .background(FondoAlto)
        .padding(vertical = 8.dp),
    ) {
      item {
        Text(
          "Todos los géneros",
          color = if (actual == null) Realce else Texto,
          style = MaterialTheme.typography.bodyLarge,
          modifier = Modifier.fillMaxWidth().clickable { alElegir(null) }.padding(horizontal = 20.dp, vertical = 12.dp),
        )
      }
      items(generos, key = { it.id }) { g ->
        Text(
          g.name + "   " + g.count,
          color = if (actual == g.name) Realce else Texto,
          style = MaterialTheme.typography.bodyLarge,
          modifier = Modifier.fillMaxWidth().clickable { alElegir(g.name) }.padding(horizontal = 20.dp, vertical = 12.dp),
        )
      }
    }
  }
}
