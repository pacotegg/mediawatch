package casa.tvwatch.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Servidor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A dónde puede llevar el menú. La ruta de verdad la pone quien navega. */
sealed class Destino {
  data object Inicio : Destino()
  data object Buscar : Destino()
  data object Favoritas : Destino()
  data object Sagas : Destino()
  data class Biblioteca(val id: Int, val nombre: String) : Destino()
  data object Salir : Destino()
}

/**
 * El menú lateral: lo que se despliega desde las tres rayas o arrastrando
 * desde el borde izquierdo.
 *
 * Es el mapa de la aplicación en una pantalla: inicio, buscar, favoritas, cada
 * biblioteca con cuántos títulos tiene, y abajo quién está dentro y desde
 * dónde. Las bibliotecas se leen de lo que ya se cargó para la portada; si
 * todavía no están, se piden aquí una vez.
 *
 * No es el cajón de Material con sus iconos redondeados: es un panel oscuro con
 * la letra de la aplicación y el ámbar solo en lo que está activo, para que se
 * reconozca como TvWatch y no como una plantilla.
 */
@Composable
fun Menu(rutaActual: String?, bibliotecaActual: Int?, alIr: (Destino) -> Unit) {
  var bibliotecas by remember { mutableStateOf(Cache.bibliotecasGuardadas() ?: emptyList()) }

  LaunchedEffect(Unit) {
    if (bibliotecas.isNotEmpty()) return@LaunchedEffect
    try {
      val b = withContext(Dispatchers.IO) { Api.bibliotecas() }
      Cache.guardarBibliotecas(b)
      bibliotecas = b
    } catch (e: Exception) {
      // Sin red no hay lista; el resto del menú sigue sirviendo.
    }
  }

  ModalDrawerSheet(
    drawerContainerColor = FondoTarjeta,
    drawerContentColor = Texto,
    drawerShape = RoundedCornerShape(topEnd = Esquinas.panel, bottomEnd = Esquinas.panel),
    modifier = Modifier.width(300.dp),
  ) {
    Column(
      Modifier
        .fillMaxHeight()
        .statusBarsPadding()
        .navigationBarsPadding()
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 12.dp, vertical = 18.dp),
    ) {
      Text(
        "Media Watch",
        color = Realce,
        style = MaterialTheme.typography.headlineSmall,
        modifier = Modifier.padding(horizontal = 14.dp),
      )
      Spacer(Modifier.height(18.dp))

      Entrada("Inicio", Icons.Default.Home, activa = rutaActual == "portada") { alIr(Destino.Inicio) }
      Entrada("Buscar", Icons.Default.Search, activa = rutaActual == "buscar") { alIr(Destino.Buscar) }
      Entrada("Favoritas", Icons.Default.Star, activa = rutaActual == "favoritas") { alIr(Destino.Favoritas) }
      Entrada("Sagas", Icons.AutoMirrored.Filled.List, activa = rutaActual == "sagas") { alIr(Destino.Sagas) }

      if (bibliotecas.isNotEmpty()) {
        Seccion("Bibliotecas")
        for (b in bibliotecas) {
          Entrada(
            b.name,
            icono = null,
            detalle = b.count.toString(),
            activa = bibliotecaActual == b.id,
          ) { alIr(Destino.Biblioteca(b.id, b.name)) }
        }
      }

      Spacer(Modifier.weight(1f))
      Spacer(Modifier.height(18.dp))

      /* Quién y desde dónde. La dirección sin http://, que aquí es ruido. */
      Column(Modifier.padding(horizontal = 14.dp)) {
        Text(Ajustes.perfil.ifEmpty { "Sin perfil" }, color = Texto, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(2.dp))
        val enCasa = Servidor.enCasa()
        val direccion = Servidor.baseCacheada().removePrefix("https://").removePrefix("http://")
        Text(
          (if (enCasa) "En casa" else "Fuera de casa") + "  ·  " + direccion,
          color = TextoTenue,
          style = MaterialTheme.typography.labelSmall,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
      }
      Spacer(Modifier.height(10.dp))
      var cincoUno by remember { mutableStateOf(Ajustes.castCincoUno) }
      Entrada(
        "Chromecast: sonido 5.1",
        icono = null,
        detalle = if (cincoUno) "sí" else "no",
        activa = cincoUno,
      ) {
        cincoUno = !cincoUno
        Ajustes.castCincoUno = cincoUno
      }
      Text(
        "Solo si la tele o la barra descodifican Dolby; si no, no sonará.",
        color = TextoTenue,
        style = MaterialTheme.typography.labelSmall,
        modifier = Modifier.padding(start = 14.dp, end = 14.dp, bottom = 6.dp),
      )
      Entrada("Cambiar de perfil o servidor", Icons.AutoMirrored.Filled.ExitToApp, activa = false) { alIr(Destino.Salir) }
      val contexto = LocalContext.current
      val version = remember {
        try { contexto.packageManager.getPackageInfo(contexto.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }
      }
      Text(
        "Media Watch $version",
        color = TextoTenue,
        style = MaterialTheme.typography.labelSmall,
        modifier = Modifier.padding(start = 14.dp, top = 10.dp),
      )
    }
  }
}

@Composable
private fun Seccion(titulo: String) {
  Text(
    titulo.uppercase(),
    color = TextoTenue,
    style = MaterialTheme.typography.labelSmall,
    modifier = Modifier.padding(start = 14.dp, top = 22.dp, bottom = 6.dp),
  )
}

/**
 * Una línea del menú. La activa va en ámbar sobre un fondo un punto más claro;
 * las demás, en el texto normal. Se encoge al tocarla como todo lo demás.
 */
@Composable
private fun Entrada(
  texto: String,
  icono: ImageVector?,
  activa: Boolean,
  detalle: String? = null,
  alPulsar: () -> Unit,
) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) 0.97f else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala de la entrada",
  )
  val color = if (activa) Realce else Texto

  Row(
    Modifier
      .fillMaxWidth()
      .scale(escala)
      .clip(RoundedCornerShape(Esquinas.tarjeta))
      .background(if (activa) FondoAlto else FondoTarjeta)
      .pulsable(pulsacion, alPulsar)
      .padding(horizontal = 14.dp, vertical = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    if (icono != null) {
      Icon(icono, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
    } else {
      // Sin icono: un punto ámbar si está activa, y el hueco si no, para que
      // los nombres de las bibliotecas queden alineados con los de arriba.
      Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) {
        if (activa) Box(Modifier.size(6.dp).clip(RoundedCornerShape(Esquinas.pastilla)).background(Realce))
      }
    }
    Text(
      texto,
      color = color,
      style = MaterialTheme.typography.bodyLarge,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.weight(1f),
    )
    if (detalle != null) {
      Text(detalle, color = TextoTenue, style = MaterialTheme.typography.labelSmall)
    }
  }
}
