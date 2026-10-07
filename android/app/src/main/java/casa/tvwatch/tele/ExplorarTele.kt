package casa.tvwatch.tele

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.graphicsLayer
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.FilaPortada
import casa.tvwatch.datos.Titulo
import casa.tvwatch.ui.Fondo
import casa.tvwatch.ui.FondoTarjeta
import casa.tvwatch.ui.Imagen
import casa.tvwatch.ui.Movimiento
import casa.tvwatch.ui.Realce
import casa.tvwatch.ui.Texto
import casa.tvwatch.ui.TextoSuave
import casa.tvwatch.ui.TextoTenue
import casa.tvwatch.ui.duracionLegible
import casa.tvwatch.ui.recordarUrl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Lo que queda a la vista mientras se recorre: fondo y datos del título
 * enfocado, como hace Plex en Android TV. El fondo cambia con un fundido y
 * con un pequeño retraso, para no cargar diez imágenes al pasar de largo.
 */
@Composable
private fun FondoDelEnfocado(t: Titulo?) {
  var mostrado by remember { mutableStateOf(t) }
  LaunchedEffect(t?.id) {
    delay(250)
    mostrado = t
  }
  Crossfade(mostrado, label = "fondo", animationSpec = Movimiento.aparecer(350)) { m ->
    var activo by remember(m?.id) { mutableStateOf(false) }
    LaunchedEffect(m?.id) { activo = true }
    val escala by animateFloatAsState(
      targetValue = if (activo) 1.04f else 1.0f,
      animationSpec = tween(6000, easing = LinearEasing),
      label = "kenburns",
    )
    Box(Modifier.fillMaxSize()) {
      if (m != null && m.tieneFondo == 1) {
        Imagen(
          recordarUrl(m.id, "fanart", 1280),
          null,
          Modifier.fillMaxSize().graphicsLayer { scaleX = escala; scaleY = escala },
        )
      }
      Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(0f to Fondo, 0.45f to Color(0xCC09090C), 1f to Color(0x3309090C))))
      Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Transparent, 0.45f to Color(0x8809090C), 0.62f to Fondo)))
    }
  }
}

/** Título (o logotipo), año, duración, nota y sinopsis del enfocado. */
@Composable
private fun InfoDelEnfocado(t: Titulo?, modifier: Modifier = Modifier) {
  if (t == null) return
  Column(modifier.width(520.dp)) {
    if (t.tieneLogo == 1) {
      Imagen(
        recordarUrl(t.id, "logo", 500),
        t.title,
        Modifier.heightIn(max = 70.dp).width(300.dp),
        escala = ContentScale.Fit,
        alineacion = Alignment.CenterStart,
      )
    } else {
      Text(t.title, color = Texto, fontSize = 30.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    Spacer(Modifier.height(10.dp))
    Text(
      listOfNotNull(
        t.year?.toString(),
        if (t.kind == "show") "Serie" else duracionLegible(t.runtime).ifEmpty { null },
        t.rating?.takeIf { it > 0 }?.let { "★ " + "%.1f".format(it) },
      ).joinToString("   "),
      color = TextoSuave,
      fontSize = 14.sp,
    )
    t.plot?.takeIf { it.isNotBlank() }?.let {
      Spacer(Modifier.height(8.dp))
      Text(it, color = TextoSuave, fontSize = 14.sp, lineHeight = 20.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
  }
}

/** Tarjeta apaisada de «Continuar viendo», con la barra de lo visto. */
@Composable
private fun TarjetaApaisada(t: Titulo, modifier: Modifier, alFoco: () -> Unit, alPulsar: (Int) -> Unit) {
  var foco by remember { mutableStateOf(false) }
  Column(Modifier.width(220.dp)) {
    Box(
      modifier
        .fillMaxWidth()
        .aspectRatio(16f / 9f)
        .enfocable(RoundedCornerShape(10.dp), alFoco = { foco = it; if (it) alFoco() }) { alPulsar(t.id) }
        .clip(RoundedCornerShape(10.dp))
        .background(FondoTarjeta),
    ) {
      if (t.tieneFondo == 1) Imagen(recordarUrl(t.id, "fanart", 600), t.title, Modifier.fillMaxSize())
      else if (t.tienePoster == 1) Imagen(recordarUrl(t.id, "poster", 300), t.title, Modifier.fillMaxSize())
      Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color(0x66000000))) {
        Box(Modifier.fillMaxWidth(t.avance).height(4.dp).background(Realce))
      }
    }
    Spacer(Modifier.height(8.dp))
    Text(t.title, color = if (foco) Texto else TextoSuave, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/**
 * La portada, a lo Plex: arriba los datos del título enfocado sobre su
 * fotograma, abajo las filas. La fila enfocada sube a su sitio fijo, así que
 * el ojo no tiene que ir a buscarla.
 */
@Composable
fun PortadaTele(alAbrirFicha: (Int) -> Unit, alPerderSesion: () -> Unit) {
  val guardado = remember { Cache.portadaGuardada() }
  var filas by remember { mutableStateOf(guardado?.first?.rows ?: emptyList()) }
  var heroes by remember { mutableStateOf(guardado?.first?.hero ?: emptyList()) }
  var fallo by remember { mutableStateOf("") }
  var intento by remember { mutableStateOf(0) }
  var enfocado by remember { mutableStateOf<Titulo?>(null) }
  /** «fila:id» de la última tarjeta enfocada: al volver de una ficha, el foco vuelve ahí. */
  var ultimo by rememberSaveable { mutableStateOf<String?>(null) }

  LaunchedEffect(intento) {
    fallo = ""
    try {
      val p = withContext(Dispatchers.IO) { Api.portada() }
      val b = withContext(Dispatchers.IO) { Api.bibliotecas() }
      Cache.guardarPortada(p, b)
      filas = p.rows
      heroes = p.hero
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      if (filas.isEmpty()) fallo = e.message ?: "No se pudo cargar."
    }
  }

  if (fallo.isNotEmpty()) { AvisoTele(fallo, "Reintentar") { intento++ }; return }
  if (filas.isEmpty() && heroes.isEmpty()) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Realce) }
    return
  }

  /*
   * Los destacados del servidor van como primera fila: en la tele no hay
   * carrusel que arrastrar, y así se recorren con las mismas flechas.
   */
  val todas = remember(filas, heroes) {
    (if (heroes.isNotEmpty()) listOf(FilaPortada("hero", "Destacados", "poster", heroes)) else emptyList()) + filas
  }
  val lista = rememberLazyListState()
  val ambito = rememberCoroutineScope()

  Box(Modifier.fillMaxSize()) {
    FondoDelEnfocado(enfocado ?: heroes.firstOrNull())
    Column(Modifier.fillMaxSize()) {
      InfoDelEnfocado(
        enfocado ?: heroes.firstOrNull(),
        Modifier.padding(start = AireTele.lado, top = AireTele.arriba + 8.dp).height(190.dp),
      )
      LazyColumn(
        state = lista,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 200.dp),
      ) {
        itemsIndexed(todas, key = { _, f -> f.key }) { i, fila ->
          FilaTele(
            fila = fila,
            ultimo = ultimo,
            alEnfocar = { t ->
              enfocado = t
              ultimo = fila.key + ":" + t.id
              ambito.launch { lista.animateScrollToItem(i) }
            },
            alPulsar = alAbrirFicha,
          )
        }
      }
    }
  }
}

@Composable
private fun FilaTele(fila: FilaPortada, ultimo: String?, alEnfocar: (Titulo) -> Unit, alPulsar: (Int) -> Unit) {
  if (fila.items.isEmpty()) return
  Column(Modifier.padding(bottom = 18.dp)) {
    Text(fila.title, color = Texto, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = AireTele.lado, bottom = 10.dp))
    LazyRow(
      contentPadding = PaddingValues(horizontal = AireTele.lado, vertical = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      itemsIndexed(fila.items, key = { _, t -> t.id }) { _, t ->
        val clave = fila.key + ":" + t.id
        val pedir = remember { FocusRequester() }
        val m = Modifier.focusRequester(pedir)
        if (clave == ultimo) LaunchedEffect(Unit) { runCatching { pedir.requestFocus() } }
        if (fila.kind == "progress") {
          TarjetaApaisada(t, m, alFoco = { alEnfocar(t) }, alPulsar = alPulsar)
        } else {
          CartelTele(t, modifier = Modifier.onFocusChanged { if (it.hasFocus) alEnfocar(t) }, focoModifier = m, alPulsar = alPulsar)
        }
      }
    }
  }
}

private val ORDENES = listOf("title" to "A–Z", "added" to "Recientes", "year" to "Año", "rating" to "Nota", "random" to "Al azar")
private const val PAGINA = 70

/** Una biblioteca en rejilla de siete, con el orden y «sin ver» arriba. */
@Composable
fun BibliotecaTele(libraryId: Int, nombre: String, alAbrirFicha: (Int) -> Unit, alPerderSesion: () -> Unit) {
  var orden by rememberSaveable(libraryId) { mutableStateOf("title") }
  var sinVer by rememberSaveable(libraryId) { mutableStateOf(false) }
  val filtro = orden to sinVer
  val items = remember(libraryId, filtro) { mutableStateListOf<Titulo>() }
  var total by remember(libraryId, filtro) { mutableStateOf(-1) }
  var cargando by remember(libraryId, filtro) { mutableStateOf(false) }
  var fallo by remember(libraryId, filtro) { mutableStateOf("") }
  var ultimo by rememberSaveable(libraryId) { mutableStateOf(-1) }
  val rejilla = rememberLazyGridState()

  suspend fun traerMas() {
    if (cargando || (total >= 0 && items.size >= total)) return
    cargando = true
    try {
      val p = withContext(Dispatchers.IO) { Api.titulos(libraryId, items.size, PAGINA, orden, null, sinVer) }
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

  LaunchedEffect(libraryId, filtro) { if (items.isEmpty()) traerMas() }
  val cercaDelFinal by remember {
    derivedStateOf { (rejilla.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= items.size - 21 }
  }
  LaunchedEffect(rejilla, filtro) {
    snapshotFlow { cercaDelFinal }.collect { if (it && items.isNotEmpty()) traerMas() }
  }

  Column(Modifier.fillMaxSize().background(Fondo).padding(top = AireTele.arriba)) {
    Row(Modifier.padding(horizontal = AireTele.lado), verticalAlignment = Alignment.CenterVertically) {
      Text(nombre, color = Texto, fontSize = 26.sp, fontWeight = FontWeight.Bold)
      Spacer(Modifier.width(16.dp))
      if (total >= 0) Text("$total", color = TextoTenue, fontSize = 15.sp)
      Spacer(Modifier.weight(1f))
      ORDENES.forEach { (clave, texto) ->
        Pestana(texto, activa = orden == clave) { if (orden != clave) { orden = clave; ultimo = -1 } }
        Spacer(Modifier.width(6.dp))
      }
      Pestana(if (sinVer) "Sin ver ✓" else "Sin ver", activa = sinVer) { sinVer = !sinVer; ultimo = -1 }
    }
    Spacer(Modifier.height(10.dp))
    when {
      items.isEmpty() && fallo.isNotEmpty() -> AvisoTele(fallo)
      items.isEmpty() && total == 0 -> AvisoTele("Nada con este filtro.")
      items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Realce) }
      else -> LazyVerticalGrid(
        columns = GridCells.Fixed(7),
        state = rejilla,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = AireTele.lado, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
      ) {
        itemsIndexed(items, key = { _, t -> t.id }) { i, t ->
          val pedir = remember { FocusRequester() }
          if (i == ultimo) LaunchedEffect(Unit) { runCatching { pedir.requestFocus() } }
          CartelTele(
            t,
            ancho = null,
            modifier = Modifier.onFocusChanged { if (it.hasFocus) ultimo = i },
            focoModifier = Modifier.focusRequester(pedir),
            alPulsar = alAbrirFicha,
          )
        }
      }
    }
  }
}

/** Pastilla de orden o filtro: ámbar si está elegida, blanca si tiene el foco. */
@Composable
fun Pestana(texto: String, activa: Boolean, alPulsar: () -> Unit) {
  var foco by remember { mutableStateOf(false) }
  Text(
    texto,
    color = when { foco -> Color(0xFF111114); activa -> Realce; else -> TextoSuave },
    fontSize = 14.sp,
    fontWeight = if (activa) FontWeight.SemiBold else FontWeight.Normal,
    modifier = Modifier
      .enfocable(RoundedCornerShape(100.dp), escala = 1.05f, aro = Color.Transparent, alFoco = { foco = it }, alPulsar = alPulsar)
      .clip(RoundedCornerShape(100.dp))
      .background(if (foco) Color.White else if (activa) Color(0x22E8B04A) else Color.Transparent)
      .padding(horizontal = 14.dp, vertical = 7.dp),
  )
}

/** Favoritas: la misma rejilla, sin páginas (son pocas). */
@Composable
fun FavoritasTele(alAbrirFicha: (Int) -> Unit, alPerderSesion: () -> Unit) {
  var items by remember { mutableStateOf<List<Titulo>?>(null) }
  var fallo by remember { mutableStateOf("") }
  LaunchedEffect(Unit) {
    try { items = withContext(Dispatchers.IO) { Api.favoritos() } }
    catch (e: Api.SinSesion) { alPerderSesion() }
    catch (e: Exception) { fallo = e.message ?: "No se pudo cargar." }
  }
  Column(Modifier.fillMaxSize().background(Fondo).padding(top = AireTele.arriba)) {
    Text("Favoritas", color = Texto, fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = AireTele.lado))
    val l = items
    when {
      fallo.isNotEmpty() -> AvisoTele(fallo)
      l == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Realce) }
      l.isEmpty() -> AvisoTele("Aún no hay favoritas. Se añaden desde la ficha, con la estrella.")
      else -> RejillaSimple(l, alAbrirFicha)
    }
  }
}

@Composable
private fun RejillaSimple(l: List<Titulo>, alAbrirFicha: (Int) -> Unit) {
  LazyVerticalGrid(
    columns = GridCells.Fixed(7),
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(horizontal = AireTele.lado, vertical = 12.dp),
    horizontalArrangement = Arrangement.spacedBy(18.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    itemsIndexed(l, key = { _, t -> t.id }) { _, t -> CartelTele(t, ancho = null, alPulsar = alAbrirFicha) }
  }
}

/**
 * Buscar. El campo abre el teclado de la tele (que en Google TV trae también
 * el micrófono); los resultados salen debajo mientras se escribe.
 */
@Composable
fun BuscarTele(alAbrirFicha: (Int) -> Unit, alPerderSesion: () -> Unit) {
  var consulta by rememberSaveable { mutableStateOf("") }
  var titulos by remember { mutableStateOf<List<Titulo>>(emptyList()) }
  var aviso by remember { mutableStateOf("") }
  val campo = remember { FocusRequester() }

  LaunchedEffect(consulta) {
    val q = consulta.trim()
    if (q.length < 2) { titulos = emptyList(); aviso = ""; return@LaunchedEffect }
    delay(350)
    try {
      titulos = withContext(Dispatchers.IO) { Api.buscar(q) }.items
      aviso = if (titulos.isEmpty()) "Nada con «$q»." else ""
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      aviso = e.message ?: "No se pudo buscar."
    }
  }
  LaunchedEffect(Unit) { if (consulta.isEmpty()) runCatching { campo.requestFocus() } }

  Column(Modifier.fillMaxSize().background(Fondo).padding(top = AireTele.arriba)) {
    OutlinedTextField(
      value = consulta,
      onValueChange = { consulta = it },
      singleLine = true,
      label = { Text("Buscar película o serie") },
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      keyboardActions = KeyboardActions(onSearch = {}),
      modifier = Modifier.padding(horizontal = AireTele.lado).width(560.dp).focusRequester(campo).campoDeTele(),
    )
    if (aviso.isNotEmpty()) {
      Text(aviso, color = TextoSuave, fontSize = 15.sp, modifier = Modifier.padding(horizontal = AireTele.lado, vertical = 16.dp))
    }
    if (titulos.isNotEmpty()) RejillaSimple(titulos, alAbrirFicha)
  }
}
