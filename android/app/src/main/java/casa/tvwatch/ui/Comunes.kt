package casa.tvwatch.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.LaunchedEffect
import coil.compose.AsyncImage
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Titulo

/**
 * Una carátula.
 *
 * `2f/3f` no es un número bonito: es la proporción de un cartel de cine, y
 * fijarla evita que la rejilla dé saltos mientras cargan las imágenes, que es lo
 * que más cutre hace ver a una aplicación de este tipo.
 *
 * Se encoge un poco al tocarla. Ese detalle —que la cosa responda al dedo antes
 * de que pase nada— es la mitad de la sensación de calidad de iOS, y cuesta seis
 * líneas.
 */
@Composable
fun Cartel(t: Titulo, ancho: Int = 128, alPulsar: (Int) -> Unit) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) Movimiento.ESCALA_PULSADA else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala del cartel",
  )

  Column(
    Modifier
      .width(ancho.dp)
      .scale(escala)
      .pulsable(pulsacion) { alPulsar(t.id) },
  ) {
    Box(
      Modifier
        .fillMaxWidth()
        .aspectRatio(2f / 3f)
        .clip(RoundedCornerShape(Esquinas.tarjeta))
        .background(FondoTarjeta),
      contentAlignment = Alignment.Center,
    ) {
      if (t.tienePoster == 1) {
        Imagen(recordarUrl(t.id, "poster", 360), t.title, Modifier.fillMaxSize())
      } else {
        Text(
          t.title,
          color = TextoTenue,
          style = MaterialTheme.typography.labelMedium,
          textAlign = TextAlign.Center,
          modifier = Modifier.padding(10.dp),
        )
      }

      // La barrita de lo que llevas visto. Es la referencia inmediata de «esto
      // lo dejé a medias» sin tener que abrir nada.
      if (t.avance > 0.01f) {
        Box(
          Modifier
            .align(Alignment.BottomStart)
            .fillMaxWidth()
            .height(3.dp)
            .background(Color(0x66000000)),
        ) {
          Box(Modifier.fillMaxWidth(t.avance).height(3.dp).background(Realce))
        }
      }
    }

    Spacer(Modifier.height(7.dp))
    /*
     * Dos líneas de alto SIEMPRE, ocupe una o dos el título.
     *
     * Sin esto, una rejilla con «Alien³» al lado de «El alucinante viaje de Bill
     * y Ted» sale a distinta altura por cada fila y el conjunto parece
     * desordenado aunque cada tarjeta esté bien. Reservar el sitio cuesta unos
     * píxeles y es la diferencia entre una rejilla y una lista de cosas.
     */
    Box(Modifier.height(38.dp)) {
      Text(
        t.title,
        color = if (t.watched == 1) TextoTenue else Texto,
        style = MaterialTheme.typography.bodyMedium,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
    }
    t.year?.let {
      Text(it.toString(), color = TextoTenue, style = MaterialTheme.typography.labelSmall)
    }
    Spacer(Modifier.height(2.dp))
  }
}

/**
 * Pulsable con la fuente de interacción fuera, para poder animar el encogido.
 *
 * Sin `indication`: el destello gris de Android encima de una carátula queda
 * sucio, y el encogido ya es respuesta suficiente.
 */
fun Modifier.pulsable(fuente: MutableInteractionSource, alPulsar: () -> Unit): Modifier =
  this.clickable(interactionSource = fuente, indication = null, onClick = alPulsar)

/**
 * La URL de una imagen, recordada.
 *
 * Construirla en cada recomposición significaba concatenar cadenas por cada
 * tarjeta visible cada vez que se desplaza la rejilla, y además hacía que Coil
 * creyera que era otra imagen distinta.
 */
@Composable
fun recordarUrl(id: Int, tipo: String, ancho: Int): String =
  remember(id, tipo, ancho) { Api.imagen(id, tipo, ancho) }

/**
 * Carga de imágenes con la sesión puesta.
 *
 * Las carátulas están detrás de la misma autenticación que el resto. En la web y
 * en la tele no se puede mandar la cabecera —una `<img>` no manda cabeceras— y
 * hubo que meter el token en la URL; aquí sí se puede, así que el token no acaba
 * escrito en ninguna caché de disco.
 */
@Composable
fun Imagen(
  url: String,
  descripcion: String?,
  modifier: Modifier = Modifier,
  escala: ContentScale = ContentScale.Crop,
  /** Con `Fit`, dónde se apoya lo que sobra. Un logotipo se apoya abajo. */
  alineacion: Alignment = Alignment.Center,
) {
  val ctx = LocalContext.current
  val peticion = remember(url) {
    ImageRequest.Builder(ctx)
      .data(url)
      .apply { Ajustes.token?.let { addHeader("Authorization", "Bearer $it") } }
      // Aparecer en 180 ms en vez de dar un salto: es lo que quita la sensación
      // de que la rejilla «parpadea» al bajar.
      .crossfade(180)
      .memoryCachePolicy(CachePolicy.ENABLED)
      .diskCachePolicy(CachePolicy.ENABLED)
      /*
       * No se toca el tamaño: por omisión Coil descodifica a la medida real del
       * hueco donde va a ir, que es justo lo que interesa. Poner `ORIGINAL`
       * aquí —tentador por el nombre— haría lo contrario: descodificar entero.
       */
      .build()
  }
  AsyncImage(
    model = peticion,
    contentDescription = descripcion,
    contentScale = escala,
    alignment = alineacion,
    modifier = modifier,
  )
}

/**
 * Pedir una imagen por adelantado, para que cuando toque enseñarla ya esté en
 * la caché y el fundido sea limpio en vez de un hueco negro medio segundo.
 */
@Composable
fun precargarImagen(url: String) {
  val ctx = LocalContext.current
  LaunchedEffect(url) {
    val peticion = ImageRequest.Builder(ctx)
      .data(url)
      .apply { Ajustes.token?.let { addHeader("Authorization", "Bearer $it") } }
      .memoryCachePolicy(CachePolicy.ENABLED)
      .diskCachePolicy(CachePolicy.ENABLED)
      .build()
    ctx.imageLoader.enqueue(peticion)
  }
}

/** Una fila horizontal de carátulas, como la portada de siempre. */
@Composable
fun Fila(titulo: String, items: List<Titulo>, alPulsar: (Int) -> Unit) {
  if (items.isEmpty()) return
  Column(Modifier.padding(bottom = Aire.entreFilas)) {
    Text(
      titulo,
      color = Texto,
      style = MaterialTheme.typography.titleMedium,
      modifier = Modifier.padding(start = Aire.borde, bottom = Aire.tituloAFila),
    )
    LazyRow(
      contentPadding = PaddingValues(horizontal = Aire.borde),
      horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
    ) {
      items(items, key = { it.id }) { t -> Cartel(t, alPulsar = alPulsar) }
    }
  }
}

/* --------------------------------------------------------- cargando y vacío */

/**
 * Esqueletos, no una ruleta girando.
 *
 * Una ruleta en mitad de la pantalla dice «espera» y no dice nada más. Unas
 * siluetas con el mismo tamaño que lo que va a venir dicen «esto va a ser una
 * rejilla de carteles» y, cuando llega, no se mueve nada de sitio. Es lo que
 * hacen iOS, Netflix y cualquier cosa que se sienta rápida aunque no lo sea.
 */
@Composable
fun BrilloDeCarga(): Brush {
  val transicion = rememberInfiniteTransition(label = "brillo")
  val x by transicion.animateFloat(
    initialValue = -600f,
    targetValue = 1400f,
    animationSpec = infiniteRepeatable(tween(1400, easing = Movimiento.entrada), RepeatMode.Restart),
    label = "posición del brillo",
  )
  return Brush.horizontalGradient(
    colors = listOf(FondoTarjeta, FondoAlto, FondoTarjeta),
    startX = x,
    endX = x + 600f,
  )
}

@Composable
fun EsqueletoDeRejilla(columnas: Int = 3, filas: Int = 4) {
  val brillo = BrilloDeCarga()
  Column(
    Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    repeat(filas) {
      Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        repeat(columnas) {
          Column(Modifier.weight(1f)) {
            Box(
              Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(Esquinas.tarjeta))
                .background(brillo),
            )
            Spacer(Modifier.height(7.dp))
            Box(Modifier.fillMaxWidth(0.8f).height(11.dp).clip(RoundedCornerShape(4.dp)).background(brillo))
          }
        }
      }
    }
  }
}

@Composable
fun EsqueletoDePortada() {
  val brillo = BrilloDeCarga()
  Column(Modifier.fillMaxSize()) {
    Box(Modifier.fillMaxWidth().height(420.dp).background(brillo))
    Spacer(Modifier.height(20.dp))
    Row(
      Modifier.padding(horizontal = Aire.borde),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      repeat(3) {
        Box(Modifier.width(112.dp).height(36.dp).clip(RoundedCornerShape(Esquinas.pastilla)).background(brillo))
      }
    }
    Spacer(Modifier.height(24.dp))
    Box(
      Modifier
        .padding(start = Aire.borde)
        .width(150.dp)
        .height(16.dp)
        .clip(RoundedCornerShape(4.dp))
        .background(brillo),
    )
    Spacer(Modifier.height(Aire.tituloAFila))
    Row(
      Modifier.padding(start = Aire.borde),
      horizontalArrangement = Arrangement.spacedBy(Aire.entreTarjetas),
    ) {
      repeat(3) {
        Box(
          Modifier
            .width(128.dp)
            .aspectRatio(2f / 3f)
            .clip(RoundedCornerShape(Esquinas.tarjeta))
            .background(brillo),
        )
      }
    }
  }
}

@Composable
fun Aviso(texto: String, accion: String? = null, alPulsar: () -> Unit = {}) {
  Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      Text(
        texto,
        color = TextoSuave,
        style = MaterialTheme.typography.bodyLarge,
        textAlign = TextAlign.Center,
      )
      if (accion != null) {
        Spacer(Modifier.height(20.dp))
        Pastilla(accion, destacada = true, alPulsar = alPulsar)
      }
    }
  }
}

/* -------------------------------------------------------------- pastillas */

/**
 * El botón de esta casa: una pastilla que se encoge al tocarla.
 *
 * Hay uno solo, con dos estados, en vez de tres botones distintos por pantalla.
 * Que todo lo pulsable se comporte igual es la mitad de que una aplicación
 * parezca de una pieza.
 */
@Composable
fun Pastilla(
  texto: String,
  destacada: Boolean = false,
  activa: Boolean = false,
  modifier: Modifier = Modifier,
  /**
   * Dibujo opcional delante del texto. Recibe el color que toca según el
   * estado, para que no haya que repetir aquí la regla de cuándo va en
   * `SobreRealce` y cuándo en `Texto`.
   */
  icono: (@Composable (Color) -> Unit)? = null,
  alPulsar: () -> Unit,
) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsada by pulsacion.collectIsPressedAsState()
  val escala by animateFloatAsState(
    targetValue = if (pulsada) 0.94f else 1f,
    animationSpec = Movimiento.resorte(),
    label = "escala de la pastilla",
  )
  val fondo by animateColorAsState(
    targetValue = when {
      destacada || activa -> Realce
      else -> FondoTarjeta
    },
    animationSpec = Movimiento.aparecer(180),
    label = "fondo de la pastilla",
  )

  val color = if (destacada || activa) SobreRealce else Texto
  val forma = modifier
    .scale(escala)
    .clip(RoundedCornerShape(Esquinas.pastilla))
    .background(fondo)
    .pulsable(pulsacion, alPulsar)
    .padding(horizontal = 16.dp, vertical = 10.dp)

  if (icono == null) {
    Text(texto, color = color, style = MaterialTheme.typography.labelLarge, modifier = forma)
  } else {
    Row(forma, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      icono(color)
      Text(texto, color = color, style = MaterialTheme.typography.labelLarge)
    }
  }
}

/**
 * El dibujo de «enviar a una pantalla».
 *
 * A mano y no `Icons.Default.Cast` porque ese icono **no existe** en
 * `material-icons-core`: solo trae 50, y el paquete extendido son varios megas
 * que aquí no se pueden podar (`isMinifyEnabled = false`). Son cuatro trazos.
 */
@Composable
fun IconoCast(color: Color, tamano: Dp = 15.dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val grosor = t * 0.1f
    drawRoundRect(
      color = color,
      topLeft = Offset(t * 0.12f, t * 0.14f),
      size = Size(t * 0.76f, t * 0.58f),
      cornerRadius = CornerRadius(t * 0.12f),
      style = Stroke(width = grosor),
    )
    // Las ondas salen de la esquina de abajo a la izquierda, hacia arriba.
    for (radio in listOf(0.26f, 0.44f)) {
      drawArc(
        color = color,
        startAngle = -90f,
        sweepAngle = 90f,
        useCenter = false,
        topLeft = Offset(t * 0.12f - t * radio, t * 0.86f - t * radio),
        size = Size(t * radio * 2, t * radio * 2),
        style = Stroke(width = grosor, cap = StrokeCap.Round),
      )
    }
    drawCircle(color = color, radius = grosor * 0.85f, center = Offset(t * 0.16f, t * 0.82f))
  }
}

/** Etiqueta de datos: 4K, HEVC, HDR10. No se pulsa. */
@Composable
fun Etiqueta(texto: String, destacada: Boolean = false) {
  Text(
    texto,
    color = if (destacada) Realce else TextoSuave,
    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
    modifier = Modifier
      .clip(RoundedCornerShape(6.dp))
      .background(if (destacada) Color(0x26E8B04A) else Color(0x12FFFFFF))
      .padding(horizontal = 8.dp, vertical = 4.dp),
  )
}

@Composable
fun FilaDeEtiquetas(etiquetas: List<String>) {
  if (etiquetas.isEmpty()) return
  LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    items(etiquetas) { e ->
      Etiqueta(e, destacada = e == "4K" || e.startsWith("HDR") || e == "DV")
    }
  }
}

/* ----------------------------------------------------------------- textos */

/** «1 h 54 min», que se lee de un vistazo. «114 min» hay que traducirlo. */
fun duracionLegible(minutos: Double?): String {
  val m = (minutos ?: 0.0).toInt()
  if (m <= 0) return ""
  return if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"
}

/** Segundos a «1:23:45». */
fun reloj(segundos: Double): String {
  val s = segundos.toInt().coerceAtLeast(0)
  val h = s / 3600
  val m = (s % 3600) / 60
  val r = s % 60
  return if (h > 0) "%d:%02d:%02d".format(h, m, r) else "%d:%02d".format(m, r)
}
