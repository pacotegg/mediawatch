package casa.tvwatch.tele

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.content.pm.PackageManager
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Titulo
import casa.tvwatch.ui.FondoTarjeta
import casa.tvwatch.ui.Imagen
import casa.tvwatch.ui.Movimiento
import casa.tvwatch.ui.Realce
import casa.tvwatch.ui.Texto
import casa.tvwatch.ui.TextoSuave
import casa.tvwatch.ui.TextoTenue
import casa.tvwatch.ui.recordarUrl

/**
 * La interfaz de tele: lo común a todas sus pantallas.
 *
 * Mismo APK que el móvil y mismos datos; cambia cómo se maneja. En la tele no
 * hay dedo, hay un mando con cuatro flechas y OK, así que lo que importa es que
 * **siempre se vea dónde está el foco** y que cada flecha lleve a donde se
 * espera. El modelo es la app de la Samsung (`tv/`): la tarjeta enfocada crece
 * un 8 % con un aro ámbar, y el botón enfocado se pone blanco.
 */
object Tele {
  /**
   * Si esto corre en una tele. `UiModeManager` es lo que dice Google para
   * Google TV y Android TV; la característica `leanback` cubre los aparatos
   * que no ponen bien el modo.
   */
  fun es(c: Context): Boolean {
    val modo = (c.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager)?.currentModeType
    return modo == Configuration.UI_MODE_TYPE_TELEVISION ||
      c.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
  }
}

/** Márgenes de tele: lo de los bordes se pierde en muchas pantallas (overscan). */
object AireTele {
  val lado = 48.dp
  val arriba = 27.dp
}

/**
 * Enfocable y pulsable con OK.
 *
 * Crece y se le pone un aro cuando tiene el foco. Sin destello de Android: en
 * una tele el gris de la pulsación casi no se ve y el aro ya lo dice todo.
 */
fun Modifier.enfocable(
  forma: Shape = RoundedCornerShape(10.dp),
  escala: Float = 1.08f,
  aro: Color = Realce,
  alFoco: (Boolean) -> Unit = {},
  alPulsar: () -> Unit,
): Modifier = composed {
  var foco by remember { mutableStateOf(false) }
  val s by animateFloatAsState(
    if (foco) escala else 1f,
    if (foco) Movimiento.resorte() else Movimiento.suave(),
    label = "foco",
  )
  this
    .graphicsLayer { scaleX = s; scaleY = s }
    .then(if (foco) Modifier.border(3.dp, aro, forma) else Modifier)
    .onFocusChanged { foco = it.isFocused; alFoco(it.isFocused) }
    .clickable(remember { MutableInteractionSource() }, indication = null, onClick = alPulsar)
}

/**
 * Botón de texto: gris en reposo, blanco con letra oscura al enfocarlo, como
 * `.boton.enfocado` de la Samsung.
 */
@Composable
fun BotonTele(
  texto: String,
  modifier: Modifier = Modifier,
  icono: ImageVector? = null,
  principal: Boolean = false,
  alPulsar: () -> Unit,
) {
  var foco by remember { mutableStateOf(false) }
  val fondo = when {
    foco -> Color.White
    principal -> Realce
    else -> Color(0x33FFFFFF)
  }
  val tinta = if (foco || principal) Color(0xFF111114) else Texto
  Row(
    modifier
      .enfocable(RoundedCornerShape(100.dp), escala = 1.06f, aro = Color.Transparent, alFoco = { foco = it }, alPulsar = alPulsar)
      .clip(RoundedCornerShape(100.dp))
      .background(fondo)
      .padding(horizontal = 22.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (icono != null) {
      Icon(icono, null, tint = tinta, modifier = Modifier.size(20.dp))
      Spacer(Modifier.width(8.dp))
    }
    Text(texto, color = tinta, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
  }
}

/**
 * Botón redondo con un icono que enseña su nombre al enfocarlo, como
 * `botonIcono` de la Samsung: la fila de acciones de la ficha cabe entera y
 * aun así se sabe qué hace cada uno.
 */
@Composable
fun BotonIcono(
  nombre: String,
  activo: Boolean = false,
  alPulsar: () -> Unit,
  dibujo: @Composable (Color) -> Unit,
) {
  var foco by remember { mutableStateOf(false) }
  val tinta = when {
    foco -> Color(0xFF111114)
    activo -> Realce
    else -> Texto
  }
  Row(
    Modifier
      .height(44.dp)
      .enfocable(RoundedCornerShape(100.dp), escala = 1.06f, aro = Color.Transparent, alFoco = { foco = it }, alPulsar = alPulsar)
      .clip(RoundedCornerShape(100.dp))
      .background(if (foco) Color.White else Color(0x33FFFFFF))
      .padding(horizontal = 11.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) { dibujo(tinta) }
    if (foco) {
      Spacer(Modifier.width(8.dp))
      Text(nombre, color = tinta, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
      Spacer(Modifier.width(4.dp))
    }
  }
}

/** Un cartel de la rejilla o de una fila, con el título debajo. */
@Composable
fun CartelTele(
  t: Titulo,
  ancho: Dp? = 120.dp,
  modifier: Modifier = Modifier,
  /** Va sobre la carátula, que es lo que coge el foco (p. ej. un `focusRequester`). */
  focoModifier: Modifier = Modifier,
  alPulsar: (Int) -> Unit,
) {
  var foco by remember { mutableStateOf(false) }
  Column(if (ancho != null) modifier.width(ancho) else modifier.fillMaxWidth()) {
    Box(
      focoModifier
        .fillMaxWidth()
        .aspectRatio(2f / 3f)
        .enfocable(RoundedCornerShape(10.dp), alFoco = { foco = it }) { alPulsar(t.id) }
        .clip(RoundedCornerShape(10.dp))
        .background(FondoTarjeta),
      contentAlignment = Alignment.Center,
    ) {
      if (t.tienePoster == 1) {
        Imagen(recordarUrl(t.id, "poster", 300), t.title, Modifier.fillMaxSize())
      } else {
        Text(t.title, color = TextoTenue, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(8.dp))
      }
      if (t.avance > 0.01f) {
        Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color(0x66000000))) {
          Box(Modifier.fillMaxWidth(t.avance).height(4.dp).background(Realce))
        }
      }
    }
    Spacer(Modifier.height(8.dp))
    Text(
      t.title,
      color = if (foco) Texto else TextoSuave,
      fontSize = 13.sp,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
    Text(t.year?.toString() ?: "", color = TextoTenue, fontSize = 11.sp, maxLines = 1)
  }
}

/** Un aviso a pantalla completa con, si hace falta, un botón para reintentar. */
@Composable
fun AvisoTele(texto: String, accion: String? = null, alPulsar: () -> Unit = {}) {
  Column(
    Modifier.fillMaxSize().padding(AireTele.lado),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(texto, color = TextoSuave, fontSize = 18.sp, textAlign = TextAlign.Center)
    if (accion != null) {
      Spacer(Modifier.height(24.dp))
      BotonTele(accion, alPulsar = alPulsar)
    }
  }
}

/**
 * Fondo claro cuando tiene el foco, como `.opcion.enfocado` de la Samsung. Para
 * las listas de opciones (pistas, calidad) que ya son pulsables: va **antes**
 * del `clickable`. En el móvil no cambia nada, porque ahí nada coge el foco.
 */
fun Modifier.resaltarFoco(forma: Shape = RoundedCornerShape(8.dp)): Modifier = composed {
  var foco by remember { mutableStateOf(false) }
  this
    .onFocusChanged { foco = it.isFocused }
    .then(if (foco) Modifier.clip(forma).background(Color(0x33FFFFFF)) else Modifier)
}

/**
 * Un campo de texto que no se queda con el foco.
 *
 * En la tele, el `TextField` de Compose se traga ▲ y ▼ (medido en el emulador
 * de Google TV: con el foco dentro, ▼ no llegaba al botón de debajo). Aquí
 * esas dos flechas mueven el foco, y OK abre el teclado de la tele.
 */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
fun Modifier.campoDeTele(): Modifier = composed {
  val foco = androidx.compose.ui.platform.LocalFocusManager.current
  val teclado = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
  this.onPreviewKeyEvent { e ->
    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
    when (e.key) {
      Key.DirectionDown -> { teclado?.hide(); foco.moveFocus(androidx.compose.ui.focus.FocusDirection.Down) }
      Key.DirectionUp -> { teclado?.hide(); foco.moveFocus(androidx.compose.ui.focus.FocusDirection.Up) }
      Key.DirectionCenter -> { teclado?.show(); true }
      else -> false
    }
  }
}
