package casa.tvwatch.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * El aspecto de TvWatch, en un solo sitio.
 *
 * La referencia es el Apple TV: negro de verdad, tipografía con mucho contraste
 * de peso, mucho aire y movimiento con resorte en vez de rampas lineales. La
 * identidad propia es el **ámbar**: el color de la luz de una sala de cine
 * antes de que se apague, y el mismo que ya llevan la tele y la web para que
 * las tres pantallas de casa se reconozcan entre ellas.
 *
 * Reglas que se siguen en toda la aplicación:
 *
 * - **Siempre oscuro**, también si el teléfono está en claro. Una aplicación de
 *   ver películas en blanco no la quiere nadie.
 * - **Un solo acento.** El ámbar marca lo que se puede pulsar ahora; si se usa
 *   para adornar, deja de significar nada.
 * - **El texto tiene tres niveles y no más**: el que se lee, el que acompaña y
 *   el que casi no está.
 * - **Nada se mueve en línea recta.** Todo con resorte, que es lo que hace que
 *   parezca que responde en vez de que se ejecuta.
 */

/* ------------------------------------------------------------- superficies */

/** Negro con una gota de azul: el negro puro sobre OLED «traga» los bordes. */
val Fondo = Color(0xFF09090C)

/** Una tarjeta, un panel, un campo: lo que se levanta un milímetro del fondo. */
val FondoTarjeta = Color(0xFF16161B)

/** Lo que se levanta dos: menús sobre paneles. */
val FondoAlto = Color(0xFF1F1F26)

/* ------------------------------------------------------------------ texto */

val Texto = Color(0xFFF2F2F5)
val TextoSuave = Color(0xFF9E9EAC)
val TextoTenue = Color(0xFF6B6B78)

/* ----------------------------------------------------------------- acento */

val Realce = Color(0xFFE8B04A)
val RealceApagado = Color(0xFF8A6A2C)
/** Sobre el ámbar el texto va oscuro; el blanco encima no se lee. */
val SobreRealce = Color(0xFF17120A)

/** Separadores y bordes: casi invisibles a propósito. */
val Linea = Color(0x14FFFFFF)

private val esquema = darkColorScheme(
  primary = Realce,
  onPrimary = SobreRealce,
  secondary = Realce,
  background = Fondo,
  onBackground = Texto,
  surface = Fondo,
  onSurface = Texto,
  surfaceVariant = FondoTarjeta,
  onSurfaceVariant = TextoSuave,
  outline = Linea,
  error = Color(0xFFE5705F),
)

/* ------------------------------------------------------------ tipografía */

/*
 * Escala con saltos grandes y pesos claros. El error habitual es usar cinco
 * tamaños parecidos: entonces no hay jerarquía, solo ruido. Aquí un título es
 * inconfundiblemente un título.
 *
 * El `letterSpacing` negativo en los tamaños grandes es lo que hace que un
 * titular no parezca «texto grande» sino un titular; es lo que hace San
 * Francisco en iOS y lo que más se nota sin saber por qué.
 */
private val tipos = Typography().run {
  copy(
    displaySmall = displaySmall.copy(fontSize = 34.sp, lineHeight = 39.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.8).sp),
    headlineMedium = headlineMedium.copy(fontSize = 26.sp, lineHeight = 31.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
    headlineSmall = headlineSmall.copy(fontSize = 21.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
    titleMedium = titleMedium.copy(fontSize = 16.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.1).sp),
    bodyLarge = bodyLarge.copy(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = bodyMedium.copy(fontSize = 13.5.sp, lineHeight = 19.sp),
    labelLarge = labelLarge.copy(fontSize = 13.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium, color = TextoSuave),
    labelSmall = TextStyle(fontSize = 10.5.sp, color = TextoTenue, letterSpacing = 0.2.sp),
  )
}

/* ------------------------------------------------------------- movimiento */

object Movimiento {
  /** Lo que reacciona a un dedo: rápido y con un punto de rebote. */
  fun <T> resorte() = spring<T>(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow)

  /** Lo que solo aparece o desaparece: sin rebote, que distraería. */
  fun <T> suave() = spring<T>(dampingRatio = 1f, stiffness = Spring.StiffnessMediumLow)

  /** Curva de salida rápida y entrada lenta, la de siempre para aparecer. */
  val entrada = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

  fun <T> aparecer(ms: Int = 260) = tween<T>(durationMillis = ms, easing = entrada)

  /** Cuánto se encoge una tarjeta al tocarla. */
  const val ESCALA_PULSADA = 0.955f
}

/* ----------------------------------------------------------------- ritmo */

/*
 * Márgenes en múltiplos de 4. Tenerlos con nombre evita que cada pantalla
 * invente el suyo, que es de donde sale la sensación de «hecho a trozos».
 */
object Aire {
  val borde = 16.dp
  val entreTarjetas = 11.dp
  val entreFilas = 26.dp
  val tituloAFila = 12.dp
}

/** Esquinas: las tarjetas algo más suaves que los paneles, como en iOS. */
object Esquinas {
  val tarjeta = 12.dp
  val panel = 18.dp
  val pastilla = 100.dp
}

@Composable
fun TemaTvWatch(contenido: @Composable () -> Unit) {
  MaterialTheme(colorScheme = esquema, typography = tipos, content = contenido)
}
