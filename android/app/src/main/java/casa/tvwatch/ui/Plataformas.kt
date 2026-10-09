package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.items as itemsLista
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import android.widget.Toast
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.AppsDePlataforma
import casa.tvwatch.datos.FichaPlataforma
import casa.tvwatch.datos.Plataforma
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Catálogo de las plataformas del usuario (Movistar+, Prime, Apple TV+).
 *
 * Aquí NO se reproduce nada: van cifradas con DRM y solo las sirve su propia app.
 * Lo que ya está en la biblioteca se marca y abre la copia de casa, que sí se
 * ve; lo demás abre la app de la plataforma, si está instalada.
 */
@Composable
fun PantallaPlataformas(alAbrirFicha: (Int) -> Unit, alPerderSesion: () -> Unit) {
  val ctx = LocalContext.current
  val ambito = rememberCoroutineScope()
  var lista by remember { mutableStateOf<List<Plataforma>?>(null) }
  var titulosPorPlataforma by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
  var activa by remember { mutableStateOf("") }
  var kind by remember { mutableStateOf("movie") }
  var pagina by remember { mutableStateOf(1) }
  var total by remember { mutableStateOf(0) }
  var paginas by remember { mutableStateOf(1) }
  var items by remember { mutableStateOf<List<FichaPlataforma>?>(null) }
  var fallo by remember { mutableStateOf("") }
  var intento by remember { mutableStateOf(0) }

  LaunchedEffect(intento) {
    if (lista != null) return@LaunchedEffect
    try {
      val r = withContext(Dispatchers.IO) { Api.plataformas() }
      lista = r.plataformas
      titulosPorPlataforma = r.porPlataforma.associate { it.clave to it.titulos }
      // Las del perfil como pestañas; si aún no tiene ninguna, directo a elegirlas.
      if (activa.isEmpty()) activa = r.plataformas.firstOrNull { it.mia }?.clave ?: GESTIONAR
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudieron cargar las plataformas."
    }
  }

  LaunchedEffect(activa, kind, pagina, intento) {
    if (activa.isEmpty() || activa == GESTIONAR) return@LaunchedEffect
    items = null
    fallo = ""
    try {
      // El catálogo sale de internet (TMDb) y puede fallar alguna vez: se dice
      // y se deja reintentar, en vez de quedarse cargando.
      val c = withContext(Dispatchers.IO) { Api.catalogoPlataforma(activa, kind, "popular", pagina) }
      items = c.items
      total = c.total
      paginas = c.paginas
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo pedir el catálogo."
    }
  }

  val plataformas = lista
  val nombreActiva = plataformas?.firstOrNull { it.clave == activa }?.nombre ?: ""

  /** Marca o desmarca una plataforma como del perfil y lo guarda en el servidor. */
  fun alternarPlataforma(p: Plataforma) {
    val actual = lista ?: return
    val nuevas = actual.map { if (it.clave == p.clave) it.copy(mia = !it.mia) else it }
    lista = nuevas
    ambito.launch {
      try {
        withContext(Dispatchers.IO) { Api.guardarMisPlataformas(nuevas.filter { it.mia }.map { it.clave }) }
        Toast.makeText(
          ctx,
          if (!p.mia) "${p.nombre} conectada: verás «también en ${p.nombre}» en tus títulos" else "${p.nombre} quitada",
          Toast.LENGTH_SHORT,
        ).show()
      } catch (e: Exception) {
        lista = actual
        Toast.makeText(ctx, e.message ?: "No se pudo guardar", Toast.LENGTH_LONG).show()
      }
    }
  }

  Column(Modifier.fillMaxSize().background(Fondo)) {
    if (plataformas != null && plataformas.isNotEmpty()) {
      Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          for (p in plataformas.filter { it.mia }) Pestana(p.nombre, p.clave == activa) { activa = p.clave; pagina = 1 }
          Pestana("＋ Plataformas", activa == GESTIONAR) { activa = GESTIONAR }
          if (activa != GESTIONAR) {
            Spacer(Modifier.padding(horizontal = 2.dp))
            Pestana("Películas", kind == "movie") { kind = "movie"; pagina = 1 }
            Pestana("Series", kind == "show") { kind = "show"; pagina = 1 }
          }
        }
        if (activa == GESTIONAR) return@Column
        Spacer(Modifier.height(6.dp))
        Text(
          // Datos de JustWatch (vía TMDb) y de Watchmode: los dos exigen citarlos.
          "$total ${if (kind == "movie") "películas" else "series"} · se abren en su aplicación · datos de JustWatch y Watchmode",
          color = TextoTenue,
          style = MaterialTheme.typography.labelSmall,
        )
      }
    }

    val lote = items
    when {
      activa == GESTIONAR && plataformas != null -> GestorDePlataformas(plataformas, titulosPorPlataforma, ::alternarPlataforma) { p ->
        // Pulsar la plataforma abre su aplicación, y nada más.
        val motivo = AppsDePlataforma.abrir(ctx, p.clave, p.nombre)
        if (motivo != null) Toast.makeText(ctx, motivo, Toast.LENGTH_LONG).show()
      }
      fallo.isNotEmpty() -> Aviso(fallo, "Reintentar") { intento++ }
      plataformas != null && plataformas.isEmpty() -> Aviso("No hay ninguna plataforma configurada.")
      lote == null -> EsqueletoDeRejilla()
      lote.isEmpty() -> Aviso("Sin resultados.")
      else -> LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 118.dp),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
        verticalArrangement = Arrangement.spacedBy(16.dp),
      ) {
        items(lote, key = { it.tmdbId }) { f ->
          CartelDePlataforma(f) {
            val enCasa = f.enBiblioteca
            if (enCasa != null) {
              alAbrirFicha(enCasa)
            } else {
              ambito.launch {
                // Enlace directo al título (Watchmode). Si no lo hay o falla, se
                // abre la app a secas y se busca desde ella.
                val enlace = try {
                  withContext(Dispatchers.IO) { Api.enlaceDeCatalogo(activa, f.kind, f.tmdbId) }
                } catch (e: Exception) {
                  null
                }
                val fallo = AppsDePlataforma.abrirConRespaldo(ctx, activa, nombreActiva, enlace) {
                  Toast.makeText(ctx, it, Toast.LENGTH_LONG).show()
                }
                if (fallo != null) Toast.makeText(ctx, fallo, Toast.LENGTH_LONG).show()
              }
            }
          }
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
          Row(
            Modifier.fillMaxWidth().padding(vertical = 12.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            if (pagina > 1) Pestana("Anterior", false) { pagina-- }
            Text(
              "  Página $pagina de $paginas  ",
              color = TextoSuave,
              style = MaterialTheme.typography.labelMedium,
            )
            if (pagina < paginas) Pestana("Siguiente", false) { pagina++ }
          }
        }
      }
    }
  }
}

private const val GESTIONAR = "+"

/**
 * Las plataformas posibles (todas las que JustWatch da en España) y un botón para
 * «conectarlas»: no hay inicio de sesión —van cifradas y no tienen API para terceros—,
 * conectar es decir «tengo esta suscripción» y entonces los títulos muestran
 * «también en…» solo de las tuyas.
 */
@Composable
private fun GestorDePlataformas(
  lista: List<Plataforma>,
  titulos: Map<String, Int>,
  alAlternar: (Plataforma) -> Unit,
  alAbrir: (Plataforma) -> Unit,
) {
  androidx.compose.foundation.lazy.LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    item {
      Text(
        "Pulsa una plataforma para abrir su aplicación. Marca «Conectar» en las que tengas contratadas: los títulos de tu biblioteca que estén en ellas lo dirán en su ficha. Disponibilidad según JustWatch, en España.",
        color = TextoSuave,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.padding(bottom = 6.dp),
      )
    }
    itemsLista(lista, key = { it.clave }) { p ->
      val n = titulos[p.clave] ?: 0
      Row(
        Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(12.dp))
          .background(FondoTarjeta)
          .padding(start = 14.dp, top = 4.dp, bottom = 4.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        // El nombre abre la aplicación; el botón de la derecha marca o desmarca la suscripción.
        Column(Modifier.weight(1f).clickable { alAbrir(p) }.padding(vertical = 8.dp)) {
          Text(p.nombre, color = Texto, style = MaterialTheme.typography.titleMedium)
          if (n > 0) Text("$n títulos de tu biblioteca", color = TextoTenue, style = MaterialTheme.typography.labelSmall)
        }
        Text(
          if (p.mia) "Conectada ✓" else "Conectar",
          color = if (p.mia) Realce else Texto,
          style = MaterialTheme.typography.labelLarge,
          modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(if (p.mia) Realce.copy(alpha = 0.16f) else Color(0x18FFFFFF))
            .clickable { alAlternar(p) }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        )
      }
    }
  }
}

@Composable
private fun Pestana(texto: String, activa: Boolean, alPulsar: () -> Unit) {
  Box(
    Modifier
      .clip(RoundedCornerShape(50))
      .background(if (activa) Texto else FondoTarjeta)
      .clickable(onClick = alPulsar)
      .padding(horizontal = 14.dp, vertical = 8.dp),
  ) {
    Text(
      texto,
      color = if (activa) Fondo else TextoSuave,
      style = MaterialTheme.typography.labelLarge,
    )
  }
}

@Composable
private fun CartelDePlataforma(f: FichaPlataforma, alPulsar: () -> Unit) {
  Column(Modifier.clickable(onClick = alPulsar)) {
    Box(
      Modifier
        .fillMaxWidth()
        .aspectRatio(2f / 3f)
        .clip(RoundedCornerShape(Esquinas.tarjeta))
        .background(FondoTarjeta),
      contentAlignment = Alignment.Center,
    ) {
      val poster = f.poster
      if (poster != null) {
        Imagen(Api.caratulaPlataforma(poster, 342), f.title, Modifier.fillMaxSize())
      } else {
        Text(
          f.title,
          color = TextoTenue,
          style = MaterialTheme.typography.labelMedium,
          textAlign = TextAlign.Center,
          modifier = Modifier.padding(10.dp),
        )
      }
      if (f.enBiblioteca != null) {
        Text(
          "En tu biblioteca",
          color = Fondo,
          style = MaterialTheme.typography.labelSmall,
          modifier = Modifier
            .align(Alignment.TopStart)
            .padding(6.dp)
            .clip(RoundedCornerShape(50))
            .background(Realce)
            .padding(horizontal = 8.dp, vertical = 3.dp),
        )
      }
    }
    Spacer(Modifier.height(7.dp))
    Text(
      f.title,
      color = Texto,
      style = MaterialTheme.typography.labelMedium,
      maxLines = 2,
      overflow = TextOverflow.Ellipsis,
    )
    Text(f.year?.toString() ?: "", color = TextoTenue, style = MaterialTheme.typography.labelSmall)
  }
}
