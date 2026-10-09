package casa.tvwatch.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.clickable
import androidx.compose.material3.TextButton
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.zIndex
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
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Servidor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Las secciones fijas del menú, en su orden de fábrica. Mismas claves que la app de la tele. */
val SECCIONES_FIJAS = listOf(
  "inicio" to "Inicio",
  "buscar" to "Buscar",
  "favoritos" to "Favoritas",
  "descargas" to "Descargas",
  "sagas" to "Sagas",
  "plataformas" to "Plataformas",
)

fun claveDeBiblioteca(b: casa.tvwatch.datos.Biblioteca) = "lib-${b.id}"

/** Las bibliotecas en el orden elegido y sin las escondidas (ver `PantallaOrdenMenu`). */
fun bibliotecasOrdenadas(todas: List<casa.tvwatch.datos.Biblioteca>): List<casa.tvwatch.datos.Biblioteca> {
  val ocultos = Ajustes.menuOcultos
  val porClave = todas.associateBy { claveDeBiblioteca(it) }
  return Ajustes.ordenar(porClave.keys.toList()).filter { it !in ocultos }.mapNotNull { porClave[it] }
}

/** A dónde puede llevar el menú. La ruta de verdad la pone quien navega. */
sealed class Destino {
  data object Inicio : Destino()
  data object Buscar : Destino()
  data object Favoritas : Destino()
  data object Sagas : Destino()
  data object Plataformas : Destino()
  data object Descargas : Destino()
  data class Biblioteca(val id: Int, val nombre: String) : Destino()
  data object Ajustes : Destino()
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
  var editando by remember { mutableStateOf(false) }
  var arrastrada by remember { mutableStateOf<String?>(null) }
  var desplazamiento by remember { mutableFloatStateOf(0f) }
  var alturaFila by remember { mutableFloatStateOf(0f) }

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
      Row(
        Modifier.fillMaxWidth().padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Text("Media Watch", color = Realce, style = MaterialTheme.typography.headlineSmall)
        if (editando) TextButton(onClick = { editando = false; arrastrada = null }) { Text("Listo") }
      }
      if (editando) {
        Text(
          "Arrastra para ordenar; el ojo esconde.",
          color = TextoTenue,
          style = MaterialTheme.typography.labelSmall,
          modifier = Modifier.padding(horizontal = 14.dp),
        )
      }
      Spacer(Modifier.height(18.dp))

      /*
       * Ordenar y esconder, sin pantalla aparte: se deja pulsada una entrada y se
       * arrastra arriba o abajo; mientras tanto, cada entrada muestra un ojo para
       * esconderla (tachado = escondida). «Listo» sale. Las escondidas solo se
       * ven aquí, atenuadas, para poder recuperarlas. Cada grupo (secciones,
       * bibliotecas) se ordena por separado; «Ajustes» no se mueve ni se esconde.
       */
      val ocultos = Ajustes.menuOcultos
      val clavesLibs = bibliotecas.map { claveDeBiblioteca(it) }
      val fijasOrdenadas = Ajustes.ordenar(SECCIONES_FIJAS.map { it.first })
      val libsOrdenadas = Ajustes.ordenar(clavesLibs)

      /** Mueve `clave` un puesto dentro de su grupo. `false` si ya estaba en el borde. */
      fun mover(clave: String, paso: Int): Boolean {
        val enFijas = clave in fijasOrdenadas
        val grupo = (if (enFijas) fijasOrdenadas else libsOrdenadas).toMutableList()
        val i = grupo.indexOf(clave)
        val j = i + paso
        if (i < 0 || j < 0 || j >= grupo.size) return false
        grupo[i] = grupo[j]
        grupo[j] = clave
        Ajustes.ordenMenu = if (enFijas) grupo + libsOrdenadas else fijasOrdenadas + grupo
        return true
      }

      fun alternar(clave: String) {
        Ajustes.menuOcultos = if (clave in ocultos) ocultos - clave else ocultos + clave
      }

      /** Los gestos de una entrada movible: pulsación larga y arrastre vertical. */
      fun gestos(clave: String) = Modifier.pointerInput(clave) {
        detectDragGesturesAfterLongPress(
          onDragStart = {
            editando = true
            arrastrada = clave
            desplazamiento = 0f
          },
          onDrag = { cambio, delta ->
            cambio.consume()
            desplazamiento += delta.y
            val h = alturaFila
            if (h > 0f) {
              while (desplazamiento > h * 0.6f) {
                if (!mover(clave, 1)) { desplazamiento = 0f; break }
                desplazamiento -= h
              }
              while (desplazamiento < -h * 0.6f) {
                if (!mover(clave, -1)) { desplazamiento = 0f; break }
                desplazamiento += h
              }
            }
          },
          onDragEnd = { arrastrada = null; desplazamiento = 0f },
          onDragCancel = { arrastrada = null; desplazamiento = 0f },
        )
      }

      @Composable
      fun Movible(
        clave: String,
        texto: String,
        activa: Boolean,
        detalle: String? = null,
        alPulsar: () -> Unit,
        icono: @Composable (Color) -> Unit,
      ) {
        val oculta = clave in ocultos
        if (oculta && !editando) return
        Entrada(
          texto,
          activa = activa && !editando,
          detalle = if (editando) null else detalle,
          alPulsar = { if (!editando) alPulsar() },
          modificador = gestos(clave)
            .onSizeChanged { if (arrastrada == clave) alturaFila = it.height.toFloat() }
            .zIndex(if (arrastrada == clave) 1f else 0f)
            .graphicsLayer { translationY = if (arrastrada == clave) desplazamiento else 0f }
            .alpha(if (oculta) 0.45f else 1f),
          alzada = arrastrada == clave,
          finalDerecha = if (editando) {
            {
              Box(
                Modifier
                  .size(34.dp)
                  .clip(RoundedCornerShape(17.dp))
                  .clickable { alternar(clave) },
                contentAlignment = Alignment.Center,
              ) { IconoAccion(if (oculta) "ojoTachado" else "ojo", if (oculta) TextoTenue else Realce, 20.dp) }
            }
          } else {
            null
          },
          icono = icono,
        )
      }

      for (clave in fijasOrdenadas) {
        key(clave) {
          when (clave) {
            "inicio" -> Movible(clave, "Inicio", rutaActual == "portada", alPulsar = { alIr(Destino.Inicio) }) { IconoInicio(it) }
            "buscar" -> Movible(clave, "Buscar", rutaActual == "buscar", alPulsar = { alIr(Destino.Buscar) }) { IconoBuscar(it) }
            "favoritos" -> Movible(clave, "Favoritas", rutaActual == "favoritas", alPulsar = { alIr(Destino.Favoritas) }) {
              IconoEstrella(it, rellena = rutaActual == "favoritas", tamano = 20.dp)
            }
            "descargas" -> Movible(clave, "Descargas", rutaActual == "descargas", alPulsar = { alIr(Destino.Descargas) }) { IconoDescarga(it) }
            "sagas" -> Movible(clave, "Sagas", rutaActual == "sagas", alPulsar = { alIr(Destino.Sagas) }) { IconoSagas(it) }
            "plataformas" -> Movible(clave, "Plataformas", rutaActual == "plataformas", alPulsar = { alIr(Destino.Plataformas) }) { IconoPlataformas(it) }
          }
        }
      }
      Entrada("Ajustes", activa = rutaActual == "ajustes" && !editando, alPulsar = { if (!editando) alIr(Destino.Ajustes) }) { IconoAjustes(it) }

      if (bibliotecas.isNotEmpty()) {
        Seccion("Bibliotecas")
        val porClave = bibliotecas.associateBy { claveDeBiblioteca(it) }
        for (clave in libsOrdenadas) {
          val b = porClave[clave] ?: continue
          key(clave) {
            Movible(
              clave,
              b.name,
              bibliotecaActual == b.id,
              detalle = b.count.toString(),
              alPulsar = { alIr(Destino.Biblioteca(b.id, b.name)) },
            ) { IconoDeBiblioteca(b.name, b.kind, it) }
          }
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
      Entrada("Cambiar de perfil o servidor", activa = false, alPulsar = { alIr(Destino.Salir) }) { IconoUsuario(it) }
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
 * Una línea del menú. La activa lleva un indicador vertical en ámbar y el icono/texto
 * en realce; las demás, en el texto normal. Se encoge al tocarla como todo lo demás.
 */
@Composable
private fun Entrada(
  texto: String,
  activa: Boolean,
  detalle: String? = null,
  alPulsar: () -> Unit,
  modificador: Modifier = Modifier,
  alzada: Boolean = false,
  finalDerecha: (@Composable () -> Unit)? = null,
  icono: @Composable (Color) -> Unit,
) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) 0.97f else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala de la entrada",
  )
  val color = if (activa) Realce else Texto
  val fondo = if (activa || alzada) FondoAlto else FondoTarjeta

  Row(
    // El modificador de fuera (arrastre, desplazamiento, zIndex) va el primero: mueve la fila entera, fondo incluido.
    modificador
      .fillMaxWidth()
      .scale(escala)
      .clip(RoundedCornerShape(Esquinas.tarjeta))
      .background(fondo)
      .pulsable(pulsacion, alPulsar)
      .padding(horizontal = 12.dp, vertical = 11.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    if (activa) {
      Box(
        Modifier
          .size(width = 3.dp, height = 18.dp)
          .clip(RoundedCornerShape(2.dp))
          .background(Realce),
      )
    } else {
      Spacer(Modifier.width(3.dp))
    }
    Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
      icono(color)
    }
    Text(
      texto,
      color = color,
      style = MaterialTheme.typography.bodyLarge,
      fontWeight = if (activa) androidx.compose.ui.text.font.FontWeight.SemiBold else androidx.compose.ui.text.font.FontWeight.Normal,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.weight(1f),
    )
    if (detalle != null) {
      Text(detalle, color = TextoTenue, style = MaterialTheme.typography.labelSmall)
    }
    finalDerecha?.invoke()
  }
}
