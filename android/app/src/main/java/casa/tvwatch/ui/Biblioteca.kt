package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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

private val DECADAS = listOf(
  null to "Todas las décadas",
  "2020" to "Años 2020",
  "2010" to "Años 2010",
  "2000" to "Años 2000",
  "1990" to "Años 90",
  "1980" to "Años 80",
  "1970" to "Años 70",
  "<1970" to "Clásicos (<1970)",
)

private val CALIDADES = listOf(
  null to "Cualquier calidad",
  "4k" to "4K Ultra HD",
  "1080p" to "1080p Full HD",
  "720p" to "720p HD",
  "sd" to "SD",
)

private val DURACIONES = listOf(
  null to "Cualquier duración",
  "short" to "Corta (< 90 min)",
  "medium" to "Media (90 – 120 min)",
  "long" to "Larga (> 120 min)",
)

private data class FiltrosBiblioteca(
  val orden: String,
  val genero: String?,
  val sinVer: Boolean,
  val decada: String?,
  val calidad: String?,
  val duracion: String?,
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
  var pestana by remember(libraryId) { mutableStateOf("recomendado") }
  var continuar by remember(libraryId) { mutableStateOf<List<Titulo>?>(null) }
  var recientes by remember(libraryId) { mutableStateOf<List<Titulo>?>(null) }
  var valoradas by remember(libraryId) { mutableStateOf<List<Titulo>?>(null) }
  var cargandoRecomendado by remember(libraryId) { mutableStateOf(false) }

  var orden by remember(libraryId) { mutableStateOf("title") }
  var genero by remember(libraryId) { mutableStateOf<String?>(null) }
  var sinVer by remember(libraryId) { mutableStateOf(false) }
  var decada by remember(libraryId) { mutableStateOf<String?>(null) }
  var calidad by remember(libraryId) { mutableStateOf<String?>(null) }
  var duracion by remember(libraryId) { mutableStateOf<String?>(null) }

  var generos by remember(libraryId) { mutableStateOf<List<Genero>>(emptyList()) }
  var eligiendoGenero by remember { mutableStateOf(false) }
  var eligiendoDecada by remember { mutableStateOf(false) }
  var eligiendoCalidad by remember { mutableStateOf(false) }
  var eligiendoDuracion by remember { mutableStateOf(false) }

  // La combinación de filtros: cambia, y la rejilla empieza de cero.
  val filtro = remember(orden, genero, sinVer, decada, calidad, duracion) {
    FiltrosBiblioteca(orden, genero, sinVer, decada, calidad, duracion)
  }
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
      val p = withContext(Dispatchers.IO) {
        Api.titulos(
          libraryId = libraryId,
          offset = items.size,
          limite = PAGINA,
          orden = orden,
          genero = genero,
          sinVer = sinVer,
          decada = decada,
          calidad = calidad,
          duracion = duracion,
        )
      }
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

  LaunchedEffect(libraryId, pestana) {
    if (pestana != "recomendado" || recientes != null) return@LaunchedEffect
    cargandoRecomendado = true
    try {
      val c = withContext(Dispatchers.IO) { Api.continuarBiblioteca(libraryId) }
      val r = withContext(Dispatchers.IO) { Api.titulos(libraryId, offset = 0, limite = 20, orden = "added").items }
      val v = withContext(Dispatchers.IO) { Api.titulos(libraryId, offset = 0, limite = 20, orden = "rating").items }
      continuar = c
      recientes = r
      valoradas = v
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (_: Exception) {
    } finally {
      cargandoRecomendado = false
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

  val hayFiltrosActivos = genero != null || sinVer || decada != null || calidad != null || duracion != null

  Column(Modifier.fillMaxSize().background(Fondo)) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = Aire.borde, vertical = 6.dp),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Pastilla("Recomendado", activa = pestana == "recomendado", destacada = pestana == "recomendado") { pestana = "recomendado" }
      Pastilla("Biblioteca", activa = pestana == "biblioteca", destacada = pestana == "biblioteca") { pestana = "biblioteca" }
    }

    if (pestana == "recomendado") {
      when {
        cargandoRecomendado && recientes == null -> EsqueletoDeRejilla()
        recientes != null && recientes?.isEmpty() == true && continuar.isNullOrEmpty() -> Aviso("No hay títulos en esta biblioteca.")
        else -> LazyColumn(
          modifier = Modifier.fillMaxSize(),
          contentPadding = PaddingValues(vertical = 12.dp),
        ) {
          continuar?.takeIf { it.isNotEmpty() }?.let { lista ->
            item { Fila("Continuar viendo en $nombre", lista, alAbrirFicha) }
          }
          recientes?.takeIf { it.isNotEmpty() }?.let { lista ->
            item { Fila("Añadido recientemente", lista, alAbrirFicha) }
          }
          valoradas?.takeIf { it.isNotEmpty() }?.let { lista ->
            item { Fila("Mejor valoradas", lista, alAbrirFicha) }
          }
          item {
            Box(
              Modifier
                .fillMaxWidth()
                .padding(horizontal = Aire.borde, vertical = 16.dp),
              contentAlignment = Alignment.Center,
            ) {
              Pastilla("Ver todos los títulos de $nombre →") {
                pestana = "biblioteca"
              }
            }
          }
        }
      }
    } else {
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
        item {
          val etiquetaDecada = DECADAS.firstOrNull { it.first == decada }?.second ?: "Década ▾"
          Pastilla(if (decada != null) etiquetaDecada else "Década ▾", activa = decada != null) { eligiendoDecada = true }
        }
        item {
          val etiquetaCalidad = CALIDADES.firstOrNull { it.first == calidad }?.second ?: "Calidad ▾"
          Pastilla(if (calidad != null) etiquetaCalidad else "Calidad ▾", activa = calidad != null) { eligiendoCalidad = true }
        }
        item {
          val etiquetaDuracion = DURACIONES.firstOrNull { it.first == duracion }?.second ?: "Duración ▾"
          Pastilla(if (duracion != null) etiquetaDuracion else "Duración ▾", activa = duracion != null) { eligiendoDuracion = true }
        }
        if (hayFiltrosActivos) {
          item {
            Pastilla("Limpiar ✕", activa = false) {
              genero = null
              sinVer = false
              decada = null
              calidad = null
              duracion = null
            }
          }
        }
      }
      if (total >= 0) {
        Text(
          "$total títulos" + (if (hayFiltrosActivos) " con este filtro" else ""),
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
          columns = GridCells.Adaptive(minSize = 100.dp),
          state = rejilla,
          modifier = Modifier.fillMaxSize(),
          contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
          horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
          verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
          items(items, key = { it.id }) { t ->
            Cartel(t, ancho = 100, alPulsar = alAbrirFicha)
          }
        }
      }
    }
  }

  if (eligiendoGenero) {
    ElegirGenero(generos, genero, alElegir = { genero = it; eligiendoGenero = false }, alCerrar = { eligiendoGenero = false })
  }
  if (eligiendoDecada) {
    ElegirOpcionFiltro("Filtrar por año / década", DECADAS, decada, alElegir = { decada = it; eligiendoDecada = false }, alCerrar = { eligiendoDecada = false })
  }
  if (eligiendoCalidad) {
    ElegirOpcionFiltro("Filtrar por calidad", CALIDADES, calidad, alElegir = { calidad = it; eligiendoCalidad = false }, alCerrar = { eligiendoCalidad = false })
  }
  if (eligiendoDuracion) {
    ElegirOpcionFiltro("Filtrar por duración", DURACIONES, duracion, alElegir = { duracion = it; eligiendoDuracion = false }, alCerrar = { eligiendoDuracion = false })
  }
}

/** La lista de opciones de un filtro genérico en modal. */
@Composable
private fun ElegirOpcionFiltro(
  titulo: String,
  opciones: List<Pair<String?, String>>,
  actual: String?,
  alElegir: (String?) -> Unit,
  alCerrar: () -> Unit,
) {
  Box(
    Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xB3000000)).clickable(onClick = alCerrar),
    contentAlignment = Alignment.Center,
  ) {
    LazyColumn(
      Modifier
        .fillMaxWidth(0.85f)
        .heightIn(max = 520.dp)
        .clip(RoundedCornerShape(Esquinas.panel))
        .background(FondoAlto)
        .padding(vertical = 12.dp),
    ) {
      item {
        Text(
          titulo,
          color = TextoTenue,
          style = MaterialTheme.typography.labelLarge,
          modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
        )
      }
      items(opciones, key = { it.first ?: "todos" }) { (clave, nombreOpcion) ->
        Text(
          nombreOpcion,
          color = if (actual == clave) Realce else Texto,
          style = MaterialTheme.typography.bodyLarge,
          modifier = Modifier
            .fillMaxWidth()
            .clickable { alElegir(clave) }
            .padding(horizontal = 20.dp, vertical = 12.dp),
        )
      }
    }
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
