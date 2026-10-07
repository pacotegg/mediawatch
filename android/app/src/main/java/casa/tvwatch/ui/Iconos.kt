package casa.tvwatch.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Iconos temáticos vectoriales de trazo fino para Media Watch (móvil y tele).
 *
 * Dibujados en Canvas con vectores exactos, sin inflar el APK con librerías
 * externas de iconos (cero dependencias).
 */

@Composable
fun IconoPeliculas(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    // Claqueta de cine
    drawRoundRect(
      color = color,
      topLeft = Offset(t * 0.12f, t * 0.40f),
      size = Size(t * 0.76f, t * 0.46f),
      cornerRadius = CornerRadius(t * 0.08f),
      style = Stroke(width = grosor, join = StrokeJoin.Round),
    )

    drawRoundRect(
      color = color,
      topLeft = Offset(t * 0.12f, t * 0.16f),
      size = Size(t * 0.76f, t * 0.18f),
      cornerRadius = CornerRadius(t * 0.06f),
      style = Stroke(width = grosor, join = StrokeJoin.Round),
    )

    val franjaGrosor = grosor * 0.9f
    drawLine(color, Offset(t * 0.32f, t * 0.16f), Offset(t * 0.24f, t * 0.34f), strokeWidth = franjaGrosor, cap = StrokeCap.Round)
    drawLine(color, Offset(t * 0.52f, t * 0.16f), Offset(t * 0.44f, t * 0.34f), strokeWidth = franjaGrosor, cap = StrokeCap.Round)
    drawLine(color, Offset(t * 0.72f, t * 0.16f), Offset(t * 0.64f, t * 0.34f), strokeWidth = franjaGrosor, cap = StrokeCap.Round)
  }
}

@Composable
fun IconoSeries(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    // Antenas en V estilo tele retro
    drawLine(color, Offset(t * 0.50f, t * 0.22f), Offset(t * 0.34f, t * 0.10f), strokeWidth = grosor, cap = StrokeCap.Round)
    drawLine(color, Offset(t * 0.50f, t * 0.22f), Offset(t * 0.66f, t * 0.10f), strokeWidth = grosor, cap = StrokeCap.Round)

    // Pantalla de televisión
    drawRoundRect(
      color = color,
      topLeft = Offset(t * 0.12f, t * 0.22f),
      size = Size(t * 0.76f, t * 0.54f),
      cornerRadius = CornerRadius(t * 0.12f),
      style = Stroke(width = grosor, join = StrokeJoin.Round),
    )

    // Patitas inferiores de apoyo
    drawLine(color, Offset(t * 0.28f, t * 0.76f), Offset(t * 0.22f, t * 0.88f), strokeWidth = grosor, cap = StrokeCap.Round)
    drawLine(color, Offset(t * 0.72f, t * 0.76f), Offset(t * 0.78f, t * 0.88f), strokeWidth = grosor, cap = StrokeCap.Round)
  }
}

@Composable
fun IconoAnimacion(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    val path = Path().apply {
      moveTo(t * 0.82f, t * 0.18f)
      cubicTo(t * 0.72f, t * 0.28f, t * 0.64f, t * 0.44f, t * 0.58f, t * 0.58f)
      lineTo(t * 0.66f, t * 0.70f)
      lineTo(t * 0.50f, t * 0.66f)
      lineTo(t * 0.34f, t * 0.50f)
      lineTo(t * 0.30f, t * 0.34f)
      lineTo(t * 0.42f, t * 0.42f)
      cubicTo(t * 0.56f, t * 0.36f, t * 0.72f, t * 0.28f, t * 0.82f, t * 0.18f)
      close()
    }
    drawPath(path, color = color, style = Stroke(width = grosor, join = StrokeJoin.Round, cap = StrokeCap.Round))
    drawCircle(color, radius = t * 0.07f, center = Offset(t * 0.62f, t * 0.38f), style = Stroke(width = grosor * 0.9f))
    drawLine(color, Offset(t * 0.36f, t * 0.64f), Offset(t * 0.20f, t * 0.80f), strokeWidth = grosor, cap = StrokeCap.Round)
  }
}

@Composable
fun IconoPeques(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    drawCircle(color = color, radius = t * 0.38f, center = Offset(t * 0.5f, t * 0.5f), style = Stroke(width = grosor))
    drawCircle(color = color, radius = t * 0.045f, center = Offset(t * 0.37f, t * 0.42f))
    drawCircle(color = color, radius = t * 0.045f, center = Offset(t * 0.63f, t * 0.42f))

    val sonrisa = Path().apply {
      moveTo(t * 0.34f, t * 0.58f)
      quadraticTo(t * 0.50f, t * 0.76f, t * 0.66f, t * 0.58f)
    }
    drawPath(sonrisa, color = color, style = Stroke(width = grosor, cap = StrokeCap.Round))
  }
}

@Composable
fun IconoDocumentales(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)
    val radio = t * 0.38f
    val cx = t * 0.5f
    val cy = t * 0.5f

    drawCircle(color = color, radius = radio, center = Offset(cx, cy), style = Stroke(width = grosor))
    drawLine(color, Offset(cx - radio, cy), Offset(cx + radio, cy), strokeWidth = grosor * 0.9f)
    drawOval(
      color = color,
      topLeft = Offset(cx - radio * 0.45f, cy - radio),
      size = Size(radio * 0.90f, radio * 2f),
      style = Stroke(width = grosor * 0.9f),
    )
    drawLine(color, Offset(cx, cy - radio), Offset(cx, cy + radio), strokeWidth = grosor * 0.8f)
  }
}

@Composable
fun IconoConciertos(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    drawCircle(color = color, radius = t * 0.11f, center = Offset(t * 0.28f, t * 0.72f))
    drawCircle(color = color, radius = t * 0.11f, center = Offset(t * 0.72f, t * 0.60f))
    drawLine(color, Offset(t * 0.37f, t * 0.70f), Offset(t * 0.37f, t * 0.24f), strokeWidth = grosor, cap = StrokeCap.Round)
    drawLine(color, Offset(t * 0.81f, t * 0.58f), Offset(t * 0.81f, t * 0.14f), strokeWidth = grosor, cap = StrokeCap.Round)

    val barra = Path().apply {
      moveTo(t * 0.35f, t * 0.24f)
      lineTo(t * 0.83f, t * 0.14f)
      lineTo(t * 0.83f, t * 0.24f)
      lineTo(t * 0.35f, t * 0.34f)
      close()
    }
    drawPath(barra, color = color)
  }
}

@Composable
fun IconoMonologos(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    drawRoundRect(
      color = color,
      topLeft = Offset(t * 0.37f, t * 0.14f),
      size = Size(t * 0.26f, t * 0.42f),
      cornerRadius = CornerRadius(t * 0.13f),
      style = Stroke(width = grosor),
    )
    drawLine(color, Offset(t * 0.37f, t * 0.32f), Offset(t * 0.63f, t * 0.32f), strokeWidth = grosor * 0.8f)

    val soporte = Path().apply {
      moveTo(t * 0.27f, t * 0.36f)
      lineTo(t * 0.27f, t * 0.46f)
      quadraticTo(t * 0.27f, t * 0.66f, t * 0.50f, t * 0.66f)
      quadraticTo(t * 0.73f, t * 0.66f, t * 0.73f, t * 0.46f)
      lineTo(t * 0.73f, t * 0.36f)
    }
    drawPath(soporte, color = color, style = Stroke(width = grosor, cap = StrokeCap.Round))
    drawLine(color, Offset(t * 0.50f, t * 0.66f), Offset(t * 0.50f, t * 0.84f), strokeWidth = grosor, cap = StrokeCap.Round)
    drawLine(color, Offset(t * 0.32f, t * 0.84f), Offset(t * 0.68f, t * 0.84f), strokeWidth = grosor, cap = StrokeCap.Round)
  }
}

@Composable
fun IconoBuscar(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    drawCircle(color = color, radius = t * 0.27f, center = Offset(t * 0.42f, t * 0.42f), style = Stroke(width = grosor))
    drawLine(color = color, start = Offset(t * 0.62f, t * 0.62f), end = Offset(t * 0.84f, t * 0.84f), strokeWidth = grosor * 1.15f, cap = StrokeCap.Round)
  }
}

@Composable
fun IconoInicio(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    val techo = Path().apply {
      moveTo(t * 0.16f, t * 0.44f)
      lineTo(t * 0.50f, t * 0.16f)
      lineTo(t * 0.84f, t * 0.44f)
    }
    drawPath(techo, color = color, style = Stroke(width = grosor, cap = StrokeCap.Round, join = StrokeJoin.Round))

    val paredes = Path().apply {
      moveTo(t * 0.24f, t * 0.42f)
      lineTo(t * 0.24f, t * 0.82f)
      lineTo(t * 0.76f, t * 0.82f)
      lineTo(t * 0.76f, t * 0.42f)
    }
    drawPath(paredes, color = color, style = Stroke(width = grosor, cap = StrokeCap.Round, join = StrokeJoin.Round))

    drawRoundRect(
      color = color,
      topLeft = Offset(t * 0.41f, t * 0.58f),
      size = Size(t * 0.18f, t * 0.24f),
      cornerRadius = CornerRadius(t * 0.04f),
      style = Stroke(width = grosor * 0.85f),
    )
  }
}

@Composable
fun IconoUsuario(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    drawCircle(color = color, radius = t * 0.18f, center = Offset(t * 0.50f, t * 0.32f), style = Stroke(width = grosor))
    val hombros = Path().apply {
      moveTo(t * 0.22f, t * 0.82f)
      quadraticTo(t * 0.24f, t * 0.58f, t * 0.50f, t * 0.58f)
      quadraticTo(t * 0.76f, t * 0.58f, t * 0.78f, t * 0.82f)
    }
    drawPath(hombros, color = color, style = Stroke(width = grosor, cap = StrokeCap.Round))
  }
}

@Composable
fun IconoSagas(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    drawRoundRect(
      color = color.copy(alpha = 0.50f),
      topLeft = Offset(t * 0.32f, t * 0.14f),
      size = Size(t * 0.52f, t * 0.62f),
      cornerRadius = CornerRadius(t * 0.08f),
      style = Stroke(width = grosor, join = StrokeJoin.Round),
    )
    drawRoundRect(
      color = color,
      topLeft = Offset(t * 0.16f, t * 0.24f),
      size = Size(t * 0.52f, t * 0.62f),
      cornerRadius = CornerRadius(t * 0.08f),
      style = Stroke(width = grosor, join = StrokeJoin.Round),
    )
  }
}

@Composable
fun IconoPlataformas(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)

    drawRoundRect(
      color = color,
      topLeft = Offset(t * 0.14f, t * 0.20f),
      size = Size(t * 0.72f, t * 0.60f),
      cornerRadius = CornerRadius(t * 0.10f),
      style = Stroke(width = grosor, join = StrokeJoin.Round),
    )
    val play = Path().apply {
      moveTo(t * 0.44f, t * 0.38f)
      lineTo(t * 0.62f, t * 0.50f)
      lineTo(t * 0.44f, t * 0.62f)
      close()
    }
    drawPath(play, color = color)
  }
}

@Composable
fun IconoAjustes(color: Color, tamano: Dp = 22.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = (t * 0.085f).coerceAtLeast(1.5f)
    val cx = t * 0.5f
    val cy = t * 0.5f

    drawCircle(color, radius = t * 0.16f, center = Offset(cx, cy), style = Stroke(width = grosor))
    drawCircle(color, radius = t * 0.34f, center = Offset(cx, cy), style = Stroke(width = grosor))

    for (i in 0 until 6) {
      val angulo = (i * 60.0) * Math.PI / 180.0
      val cosA = Math.cos(angulo).toFloat()
      val sinA = Math.sin(angulo).toFloat()
      drawLine(
        color = color,
        start = Offset(cx + cosA * t * 0.30f, cy + sinA * t * 0.30f),
        end = Offset(cx + cosA * t * 0.42f, cy + sinA * t * 0.42f),
        strokeWidth = grosor * 1.25f,
        cap = StrokeCap.Round,
      )
    }
  }
}

/**
 * Elige el icono temático para una biblioteca según su nombre y tipo.
 */
@Composable
fun IconoDeBiblioteca(nombre: String, kind: String, color: Color, tamano: Dp = 22.dp) {
  val n = nombre.lowercase()
  when {
    n.contains("animaci") -> IconoAnimacion(color, tamano)
    n.contains("peque") || n.contains("infantil") || n.contains("niño") -> IconoPeques(color, tamano)
    n.contains("concierto") || n.contains("música") || n.contains("musica") -> IconoConciertos(color, tamano)
    n.contains("monólog") || n.contains("monolog") || n.contains("comedia") || n.contains("stand") -> IconoMonologos(color, tamano)
    n.contains("docu") -> IconoDocumentales(color, tamano)
    kind == "show" || n.contains("serie") -> IconoSeries(color, tamano)
    else -> IconoPeliculas(color, tamano)
  }
}
