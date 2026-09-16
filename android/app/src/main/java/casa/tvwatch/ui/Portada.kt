package casa.tvwatch.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Biblioteca
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Titulo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * La portada: un destacado arriba y filas de carátulas debajo.
 *
 * Las filas las decide el servidor (`/api/home`), las mismas que ve la tele y la
 * web. Aquí no se reordena nada: si mañana el servidor añade una fila, sale sola
 * sin tocar la aplicación.
 *
 * Se guarda en memoria al cargarla. Sin eso, volver de una ficha costaba una
 * petición entera y **el destacado cambiaba de película cada vez**, que es lo
 * que hacía que la aplicación pareciese inquieta.
 */
@Composable
fun PantallaPortada(
  alAbrirFicha: (Int) -> Unit,
  alAbrirBiblioteca: (Int, String) -> Unit,
  alBuscar: () -> Unit,
  alPerderSesion: () -> Unit,
) {
  val guardado = remember { Cache.portadaGuardada() }
  var datos by remember { mutableStateOf(guardado?.first) }
  var bibliotecas by remember { mutableStateOf(guardado?.second ?: emptyList()) }
  var fallo by remember { mutableStateOf("") }
  var intento by remember { mutableStateOf(0) }

  LaunchedEffect(intento) {
    if (datos != null && intento == 0) return@LaunchedEffect
    fallo = ""
    try {
      val p = withContext(Dispatchers.IO) { Api.portada() }
      val b = withContext(Dispatchers.IO) { Api.bibliotecas() }
      Cache.guardarPortada(p, b)
      datos = p
      bibliotecas = b
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      if (datos == null) fallo = e.message ?: "No se pudo cargar."
    }
  }

  val d = datos
  when {
    fallo.isNotEmpty() -> Aviso(fallo, "Reintentar") { intento++ }
    d == null -> EsqueletoDePortada()
    else -> LazyColumn(
      Modifier.fillMaxSize().background(Fondo),
      contentPadding = PaddingValues(bottom = 30.dp),
    ) {
      item { Destacado(d.hero, alAbrirFicha, alBuscar) }
      item { AtajosDeBiblioteca(bibliotecas, alAbrirBiblioteca) }
      items(d.rows, key = { it.key }) { fila -> Fila(fila.title, fila.items, alAbrirFicha) }
    }
  }
}

/** Cada cuánto cambia el destacado. */
private const val SEGUNDOS_POR_DESTACADO = 8

/**
 * El destacado.
 *
 * Con el fotograma de fondo y el logotipo de la película encima, que es como lo
 * hacen todos porque funciona: el título en su tipografía se reconoce antes que
 * leído. Si no hay logotipo, el título en texto y ya está.
 *
 * El degradado de abajo no es decoración: sin él, el texto blanco sobre un
 * fotograma claro no se lee, y el fotograma cambia con cada película.
 *
 * Va rotando: el servidor manda seis al azar entre películas y series, y aquí
 * se pasa de una a otra cada ocho segundos, o antes si se arrastra con el
 * dedo, que es el gesto que todo el mundo prueba primero. Es un carrusel de
 * páginas con muchas vueltas para que se pueda arrastrar en los dos sentidos
 * sin llegar nunca al final. Cada cambio —a mano o solo— vuelve a contar los
 * ocho segundos, y al volver de una ficha sigue por donde iba. La siguiente
 * imagen se pide antes de que toque, para que no se vea un hueco.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Destacado(heroes: List<Titulo>, alAbrirFicha: (Int) -> Unit, alBuscar: () -> Unit) {
  if (heroes.isEmpty()) return
  val vueltas = 400
  val paginas = heroes.size * vueltas
  val estado = rememberPagerState(
    initialPage = paginas / 2 + (Cache.indiceDelDestacado % heroes.size),
    pageCount = { paginas },
  )
  val indice = estado.currentPage % heroes.size

  LaunchedEffect(estado.currentPage) {
    Cache.indiceDelDestacado = indice
    delay(SEGUNDOS_POR_DESTACADO * 1_000L)
    if (!estado.isScrollInProgress) estado.animateScrollToPage(estado.currentPage + 1)
  }
  val siguiente = heroes[(indice + 1) % heroes.size]
  if (siguiente.tieneFondo == 1) precargarImagen(recordarUrl(siguiente.id, "fanart", 1280))
  if (siguiente.tieneLogo == 1) precargarImagen(recordarUrl(siguiente.id, "logo", 560))

  HorizontalPager(state = estado, beyondViewportPageCount = 1) { pagina ->
    TarjetaDestacada(heroes[pagina % heroes.size], alAbrirFicha, alBuscar)
  }
}

@Composable
private fun TarjetaDestacada(h: Titulo, alAbrirFicha: (Int) -> Unit, alBuscar: () -> Unit) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) 0.985f else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala del destacado",
  )

  Box(
    Modifier
      .fillMaxWidth()
      .height(440.dp)
      .scale(escala)
      .pulsable(pulsacion) { alAbrirFicha(h.id) },
  ) {
    if (h.tieneFondo == 1) {
      Imagen(recordarUrl(h.id, "fanart", 1280), h.title, Modifier.fillMaxSize())
    }
    Box(
      Modifier.fillMaxSize().background(
        Brush.verticalGradient(
          0f to Color(0x99000000),
          0.35f to Color(0x22000000),
          0.72f to Color(0xCC09090C),
          1f to Fondo,
        ),
      ),
    )

    Pastilla(
      "Buscar",
      modifier = Modifier.align(Alignment.TopEnd).padding(Aire.borde),
      alPulsar = alBuscar,
    )

    Column(
      Modifier
        .align(Alignment.BottomStart)
        .padding(start = Aire.borde, end = Aire.borde, bottom = 22.dp),
    ) {
      if (h.tieneLogo == 1) {
        /*
         * Alto fijo **y** ancho máximo: un logotipo muy apaisado —«Los
         * excéntricos Tenenbaums»— se salía por la derecha, porque con
         * `ContentScale.Fit` y solo el alto puesto, el ancho crece sin tope.
         */
        Imagen(
          recordarUrl(h.id, "logo", 560),
          h.title,
          Modifier.heightIn(max = 72.dp).fillMaxWidth(0.82f),
          escala = ContentScale.Fit,
          alineacion = Alignment.BottomStart,
        )
      } else {
        Text(h.title, color = Texto, style = MaterialTheme.typography.headlineMedium)
      }
      Spacer(Modifier.height(10.dp))
      Text(
        listOfNotNull(
          h.year?.toString(),
          duracionLegible(h.runtime).ifEmpty { null },
          h.biblioteca,
          h.rating?.let { "★ %.1f".format(it) },
        ).joinToString("   ·   "),
        color = TextoSuave,
        style = MaterialTheme.typography.labelMedium,
      )
      h.plot?.let {
        Spacer(Modifier.height(8.dp))
        Text(
          it,
          color = TextoSuave,
          style = MaterialTheme.typography.bodyMedium,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
      Spacer(Modifier.height(14.dp))
      Pastilla("Ver ficha", destacada = true) { alAbrirFicha(h.id) }
    }
  }
}

/** Atajos a cada biblioteca. Es lo primero que se busca al abrir. */
@Composable
private fun AtajosDeBiblioteca(bibliotecas: List<Biblioteca>, alAbrir: (Int, String) -> Unit) {
  if (bibliotecas.isEmpty()) return
  LazyRow(
    contentPadding = PaddingValues(horizontal = Aire.borde, vertical = 18.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    items(bibliotecas, key = { it.id }) { b ->
      val pulsacion = remember { MutableInteractionSource() }
      val pulsada by pulsacion.collectIsPressedAsState()
      val escala by animateFloatAsState(
        targetValue = if (pulsada) 0.94f else 1f,
        animationSpec = Movimiento.resorte(),
        label = "escala del atajo",
      )
      Row(
        Modifier
          .scale(escala)
          .clip(RoundedCornerShape(Esquinas.pastilla))
          .background(FondoTarjeta)
          .pulsable(pulsacion) { alAbrir(b.id, b.name) }
          .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(b.name, color = Texto, style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.width(7.dp))
        Text(b.count.toString(), color = TextoTenue, style = MaterialTheme.typography.labelSmall)
      }
    }
  }
}
