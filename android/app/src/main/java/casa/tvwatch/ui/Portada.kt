package casa.tvwatch.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.tween
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Biblioteca
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Registro
import casa.tvwatch.datos.Servidor
import casa.tvwatch.datos.Titulo
import kotlinx.coroutines.CancellationException
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
  alAbrirDescargas: () -> Unit,
) {
  val guardado = remember { Cache.portadaGuardada() }
  var datos by remember { mutableStateOf(guardado?.first) }
  var bibliotecas by remember { mutableStateOf(guardado?.second ?: emptyList()) }
  var fallo by remember { mutableStateOf("") }
  var intento by remember { mutableStateOf(0) }

  LaunchedEffect(intento) {
    if (datos != null && intento == 0) return@LaunchedEffect
    fallo = ""
    val t0 = System.currentTimeMillis()
    Registro.i("portada", "cargando (intento $intento) · servidor=${Servidor.baseCacheada()} · red=${Registro.red()}")
    try {
      val p = withContext(Dispatchers.IO) { Api.portada() }
      val b = withContext(Dispatchers.IO) { Api.bibliotecas() }
      Cache.guardarPortada(p, b)
      datos = p
      bibliotecas = b
      Registro.i("portada", "cargada en ${System.currentTimeMillis() - t0} ms")
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Throwable) {
      // Throwable y no solo Exception: un fallo que no lo fuera dejaba el esqueleto para siempre.
      Registro.e("portada", "no se pudo cargar tras ${System.currentTimeMillis() - t0} ms", e)
      if (datos == null) fallo = e.message ?: "No se pudo cargar."
    }
  }

  val d = datos
  when {
    fallo.isNotEmpty() -> {
      Column(
        Modifier
          .fillMaxSize()
          .background(Fondo)
          .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Text(
          "Sin conexión con el servidor",
          color = Texto,
          style = MaterialTheme.typography.headlineSmall,
          fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(10.dp))
        Text(
          fallo,
          color = TextoSuave,
          style = MaterialTheme.typography.bodyMedium,
          textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        Button(
          onClick = alAbrirDescargas,
          colors = ButtonDefaults.buttonColors(containerColor = Realce),
        ) {
          Text("Ver descargas en este móvil", color = Color.Black, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = { intento++ }) {
          Text("Reintentar conexión", color = Texto)
        }
      }
    }
    d == null -> CargandoPortada()
    else -> LazyColumn(
      Modifier.fillMaxSize().background(Fondo),
      contentPadding = PaddingValues(bottom = 30.dp),
    ) {
      item { Destacado(d.hero, alAbrirFicha, alBuscar) }
      item { AtajosDeBiblioteca(bibliotecasOrdenadas(bibliotecas), alAbrirBiblioteca) }
      items(d.rows, key = { it.key }) { fila -> Fila(fila.title, fila.items, alAbrirFicha) }
    }
  }
}

/**
 * El esqueleto, con una línea que dice a qué dirección está conectando y cuánto
 * lleva. Un esqueleto mudo no le dice nada a quien lo ve ni a quien le pregunta
 * qué ve (08/10/2026).
 */
@Composable
private fun CargandoPortada() {
  var segundos by remember { mutableStateOf(0) }
  LaunchedEffect(Unit) {
    while (true) {
      delay(1000)
      segundos++
    }
  }
  val direccion = Servidor.baseCacheada().removePrefix("https://").removePrefix("http://")
  Box(Modifier.fillMaxSize()) {
    EsqueletoDePortada()
    Text(
      if (segundos < 8) "Conectando con $direccion…" else "Está tardando más de lo normal ($segundos s) · $direccion",
      color = TextoSuave,
      fontSize = 13.sp,
      textAlign = TextAlign.Center,
      modifier = Modifier
        .align(Alignment.BottomCenter)
        .padding(horizontal = 24.dp, vertical = 32.dp),
    )
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
 * dedo, que es el gesto que todo el mundo prueba primero (cambia con un fundido
 * en los dos sentidos, sin llegar nunca al final). Cada cambio —a mano o solo— vuelve a contar los
 * ocho segundos, y al volver de una ficha sigue por donde iba. La siguiente
 * imagen se pide antes de que toque, para que no se vea un hueco.
 */
@Composable
private fun Destacado(heroes: List<Titulo>, alAbrirFicha: (Int) -> Unit, alBuscar: () -> Unit) {
  if (heroes.isEmpty()) return
  var indice by remember { mutableIntStateOf(Cache.indiceDelDestacado % heroes.size) }

  LaunchedEffect(indice) {
    Cache.indiceDelDestacado = indice
    delay(SEGUNDOS_POR_DESTACADO * 1_000L)
    indice = (indice + 1) % heroes.size
  }
  val siguiente = heroes[(indice + 1) % heroes.size]
  if (siguiente.tieneFondo == 1) precargarImagen(recordarUrl(siguiente.id, "fanart", 1280))
  if (siguiente.tieneLogo == 1) precargarImagen(recordarUrl(siguiente.id, "logo", 560))

  /*
   * Fundido y no deslizamiento: al pasar solo de uno a otro, el desplazamiento
   * dejaba a media transición dos fotogramas distintos lado a lado con los textos
   * cortados (se veía desordenado). Con el fundido nunca hay dos a medias a la vez
   * en pantalla. Un gesto de lado a lado también cambia (con el mismo fundido).
   * «Buscar» va fijo, fuera del fundido.
   */
  Box(
    Modifier.pointerInput(heroes.size) {
      var acumulado = 0f
      detectHorizontalDragGestures(
        onDragStart = { acumulado = 0f },
        onDragEnd = {
          val n = heroes.size
          if (acumulado < -80f) indice = (indice + 1) % n else if (acumulado > 80f) indice = (indice - 1 + n) % n
        },
        onDragCancel = { acumulado = 0f },
        onHorizontalDrag = { _, delta -> acumulado += delta },
      )
    },
  ) {
    Crossfade(targetState = indice, animationSpec = tween(700), label = "destacado") { i ->
      TarjetaDestacada(heroes[i % heroes.size], alAbrirFicha)
    }
    Pastilla(
      "Buscar",
      modifier = Modifier.align(Alignment.TopEnd).padding(Aire.borde),
      alPulsar = alBuscar,
    )
  }
}

@Composable
private fun TarjetaDestacada(h: Titulo, alAbrirFicha: (Int) -> Unit) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) 0.985f else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala del destacado",
  )

  val transicion = rememberInfiniteTransition(label = "ken-burns")
  val zoomFanart by transicion.animateFloat(
    initialValue = 1.0f,
    targetValue = 1.05f,
    animationSpec = infiniteRepeatable(
      animation = tween(12000, easing = LinearEasing),
      repeatMode = RepeatMode.Reverse,
    ),
    label = "zoom",
  )

  Box(
    Modifier
      .fillMaxWidth()
      .height(440.dp)
      // El zoom lento del fondo se salía de la tarjeta (un 5 %): una franja de la imagen asomaba por los lados
      // y por debajo al cambiar de destacado. Recortado a la tarjeta, no se ve nada fuera de ella.
      .clipToBounds()
      .scale(escala)
      .pulsable(pulsacion) { alAbrirFicha(h.id) },
  ) {
    if (h.tieneFondo == 1) {
      Imagen(
        recordarUrl(h.id, "fanart", 1280),
        h.title,
        Modifier
          .fillMaxSize()
          .graphicsLayer {
            scaleX = zoomFanart
            scaleY = zoomFanart
          },
      )
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
          .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        IconoDeBiblioteca(b.name, b.kind, Realce, tamano = 16.dp)
        Text(b.name, color = Texto, style = MaterialTheme.typography.labelLarge)
        Text(b.count.toString(), color = TextoTenue, style = MaterialTheme.typography.labelSmall)
      }
    }
  }
}
