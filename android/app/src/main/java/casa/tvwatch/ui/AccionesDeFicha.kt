package casa.tvwatch.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.PistaAudio
import casa.tvwatch.datos.PistaSubtitulo

/*
 * Las acciones de la ficha, como en la app de la tele: «Reproducir» es el único
 * con texto; el resto son iconos redondos con su nombre debajo.
 *
 * Los dibujos son los de `tv/src/main.ts` (`ACCIONES`), portados tal cual: 24 px,
 * trazo de 1,8, extremos redondeados. Si se cambia uno allí, cambiarlo aquí.
 * Los rectángulos y círculos de la tele (`<rect>`, `<circle>`) están pasados a
 * trazos de camino porque aquí solo se leen caminos SVG.
 */

private class Trazo(
  val d: String,
  val relleno: Boolean = false,
  val sinTrazo: Boolean = false,
  val grosor: Float = 1.8f,
  val contraste: Boolean = false,
)

private const val PANTALLA = "M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"
private const val ESTRELLA = "M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
private const val VISTO = "M8.3 12.4l2.6 2.6 5-5.4"

private val ACCIONES: Map<String, List<Trazo>> = mapOf(
  "play" to listOf(Trazo("M7.5 4.8v14.4L19 12z", relleno = true, sinTrazo = true)),
  "reiniciar" to listOf(Trazo("M4.5 12a7.5 7.5 0 1 0 2.2-5.3"), Trazo("M4.5 4.5v4h4")),
  "trailer" to listOf(Trazo(PANTALLA), Trazo("M10.2 9.4v5.2l4.4-2.6z", relleno = true)),
  "audio" to listOf(
    Trazo("M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"),
    Trazo("M15 9.2a4 4 0 0 1 0 5.6M17.6 6.7a7.5 7.5 0 0 1 0 10.6"),
  ),
  "subtitulos" to listOf(Trazo(PANTALLA), Trazo("M7 12h4M13.5 12H17M7 15h6.5M15.5 15H17")),
  "extras" to listOf(
    Trazo("M8.5 4h10.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H8.5A1.5 1.5 0 0 1 7 13V5.5A1.5 1.5 0 0 1 8.5 4z"),
    Trazo("M4 7.5v10.2c0 .8.7 1.5 1.5 1.5H17"),
  ),
  "vista" to listOf(Trazo("M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2z"), Trazo(VISTO, grosor = 2.4f)),
  "vistaSi" to listOf(
    Trazo("M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4z", relleno = true, sinTrazo = true),
    Trazo(VISTO, grosor = 2.6f, contraste = true),
  ),
  "favorito" to listOf(Trazo(ESTRELLA)),
  "favoritoSi" to listOf(Trazo(ESTRELLA, relleno = true)),
  // Estos cuatro no existen en la tele (allí no hay descargas ni «En la tele»); mismo trazo.
  "descargar" to listOf(Trazo("M12 4v11M7.5 10.8l4.5 4.5 4.5-4.5M5 19.5h14")),
  "tele" to listOf(Trazo("M4 5h16v11H4zM9 20h6M12 16v4"), Trazo("M10.5 8.2v4.6l3.6-2.3z", relleno = true)),
  "plataforma" to listOf(Trazo("M4 5h16v10H4zM9 19h6M12 15v4")),
  "imagenes" to listOf(Trazo("M4 5h16v14H4z"), Trazo("M4 16l4.5-4.5 4 4 3-3 4.5 4.5")),
)

@Composable
fun IconoAccion(nombre: String, color: Color, tamano: Dp = 24.dp, colorContraste: Color = SobreRealce) {
  val trazos = remember(nombre) {
    (ACCIONES[nombre] ?: emptyList()).map { it to PathParser().parsePathString(it.d).toPath() }
  }
  Canvas(Modifier.size(tamano)) {
    val s = size.minDimension / 24f
    withTransform({ scale(s, s, Offset.Zero) }) {
      for ((t, camino) in trazos) {
        val c = if (t.contraste) colorContraste else color
        if (t.relleno) drawPath(camino, c)
        if (!t.sinTrazo) {
          drawPath(camino, c, style = Stroke(width = t.grosor, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
      }
    }
  }
}

/**
 * Botón redondo con el icono dentro y el nombre debajo. Se encoge al tocarlo,
 * como el resto de botones de la casa (`Pastilla`).
 */
@Composable
fun BotonIcono(rotulo: String, icono: String, activo: Boolean = false, alPulsar: () -> Unit) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) 0.92f else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala del boton de icono",
  )
  val fondo by animateColorAsState(
    targetValue = if (activo) Realce.copy(alpha = 0.2f) else Color(0x18FFFFFF),
    animationSpec = Movimiento.aparecer(180),
    label = "fondo del boton de icono",
  )
  val color = if (activo) Realce else Texto
  val borde = if (activo) Realce.copy(alpha = 0.45f) else Color(0x1FFFFFFF)

  Column(Modifier.width(72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Box(
      Modifier
        .size(54.dp)
        .scale(escala)
        .clip(CircleShape)
        .background(fondo)
        .border(1.dp, borde, CircleShape)
        .pulsable(pulsacion, alPulsar),
      contentAlignment = Alignment.Center,
    ) {
      IconoAccion(icono, color)
    }
    Spacer(Modifier.height(5.dp))
    Text(
      rotulo,
      color = if (activo) Realce else TextoSuave,
      fontSize = 11.sp,
      lineHeight = 13.sp,
      textAlign = TextAlign.Center,
      maxLines = 2,
    )
  }
}

/* ------------------------------------------------------------ pistas */

fun etiquetaAudio(a: PistaAudio): String {
  val canales = when (a.channels) {
    null -> ""
    1 -> " 1.0"
    2 -> " 2.0"
    6 -> " 5.1"
    8 -> " 7.1"
    else -> " ${a.channels}ch"
  }
  val titulo = a.title?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""
  return idiomaLegible(a.language) + " · " + a.codec.uppercase() + canales + (if (a.atmos) " Atmos" else "") + titulo
}

fun etiquetaSubtitulo(s: PistaSubtitulo): String {
  val titulo = s.title?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""
  return idiomaLegible(s.language) + titulo + (if (s.forced) " (forzados)" else "") + (if (s.source == "external") " · fichero" else "")
}

/**
 * Lo que se pondrá al darle a «Reproducir»: la pista de audio y los subtítulos,
 * como las etiquetas de la tele. Lo elegido va en ámbar.
 */
@Composable
fun EtiquetasDePistas(audio: String, subtitulos: String, subtitulosActivos: Boolean) {
  Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    EtiquetaDePista("▶ $audio", elegida = true)
    EtiquetaDePista(subtitulos, elegida = subtitulosActivos)
  }
}

@Composable
private fun EtiquetaDePista(texto: String, elegida: Boolean) {
  Text(
    texto,
    color = if (elegida) Realce else TextoSuave,
    fontSize = 12.sp,
    maxLines = 1,
    modifier = Modifier
      .clip(RoundedCornerShape(10.dp))
      .background(if (elegida) Realce.copy(alpha = 0.14f) else Color(0x12FFFFFF))
      .padding(horizontal = 10.dp, vertical = 5.dp),
  )
}

/** Lista para elegir una pista (audio o subtítulos). La clave `""` es «ninguna». */
@Composable
fun SelectorDePistas(
  titulo: String,
  opciones: List<Pair<String, String>>,
  elegida: String,
  alElegir: (String) -> Unit,
  alCerrar: () -> Unit,
) {
  AlertDialog(
    onDismissRequest = alCerrar,
    title = { Text(titulo) },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState())) {
        opciones.forEach { (clave, texto) ->
          val es = clave == elegida
          Text(
            texto,
            color = if (es) Realce else Texto,
            fontWeight = if (es) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier
              .fillMaxWidth()
              .clickable { alElegir(clave) }
              .padding(vertical = 12.dp),
          )
        }
      }
    },
    confirmButton = { TextButton(onClick = alCerrar) { Text("Cerrar") } },
  )
}
