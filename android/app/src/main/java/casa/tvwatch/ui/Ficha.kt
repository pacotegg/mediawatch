package casa.tvwatch.ui

import androidx.compose.foundation.background
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.platform.LocalContext
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
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Episodio
import casa.tvwatch.datos.Ficha
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * La ficha de una película o una serie.
 *
 * Una sola columna sobre el fotograma: identidad, datos, sinopsis y acciones en
 * el orden en que se leen. No hay cartel porque el fondo ya es la imagen.
 *
 * Las etiquetas técnicas (4K, HEVC, HDR10, el audio) van en su propia línea y
 * no encima del fotograma: en una pantalla estrecha se comían las notas de
 * IMDb, que es el fallo que tenía la web.
 */
@Composable
fun PantallaFicha(
  itemId: Int,
  alReproducir: (fileId: Int, episodioId: Int?, desde: Double) -> Unit,
  alCambiarImagenes: (kind: String, titulo: String, anio: Int?) -> Unit,
  alPerderSesion: () -> Unit,
  alAbrirPersona: (Int) -> Unit = {},
) {
  val contexto = LocalContext.current
  val ambitoTele = rememberCoroutineScope()
  fun mandarALaTele(fileId: Int, episodioId: Int?, desde: Double) {
    ambitoTele.launch {
      val texto = try {
        withContext(Dispatchers.IO) { Api.verEnLaTele(fileId, itemId, episodioId, desde) }
        "Enviado a la tele. Si está en el reproductor, lo recoge al salir."
      } catch (e: Exception) {
        "No se pudo enviar: " + (e.message ?: "sin respuesta")
      }
      Toast.makeText(contexto, texto, Toast.LENGTH_LONG).show()
    }
  }
  var ficha by remember(itemId) { mutableStateOf<Ficha?>(null) }
  var fallo by remember(itemId) { mutableStateOf("") }
  var intento by remember(itemId) { mutableStateOf(0) }
  var temporada by remember(itemId) { mutableStateOf<Int?>(null) }
  var sinopsisAbierta by remember(itemId) { mutableStateOf(false) }
  /*
   * Favorito y visto se pintan al instante y se mandan después. Esperar a que
   * conteste el servidor para que la estrella cambie de color hace que la
   * aplicación parezca lenta aunque tarde 30 ms; si falla, se deshace.
   */
  var esFavorita by remember(itemId) { mutableStateOf(false) }
  var estaVista by remember(itemId) { mutableStateOf(false) }
  val ambito = rememberCoroutineScope()

  LaunchedEffect(itemId, intento) {
    fallo = ""
    try {
      val traida = withContext(Dispatchers.IO) { Api.ficha(itemId) }
      ficha = traida
      esFavorita = traida.favorite == 1
      estaVista = traida.progress.firstOrNull { it.episodioId == null }?.watched == 1
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo abrir la ficha."
    }
  }

  val f = ficha
  if (fallo.isNotEmpty()) { Aviso(fallo, "Reintentar") { intento++ }; return }
  if (f == null) { EsqueletoDeRejilla(columnas = 2, filas = 3); return }

  val esSerie = f.kind == "show"
  val ficheroPelicula = f.files.firstOrNull { it.episodioId == null }
  val progresoPelicula = f.progress.firstOrNull { it.episodioId == null }
  val reanudarEn = if (progresoPelicula != null && progresoPelicula.watched == 0) progresoPelicula.position else 0.0

  val temporadas = remember(f) { f.episodes.map { it.season }.distinct().sorted() }
  val temporadaActiva = temporada ?: temporadas.firstOrNull()

  LazyColumn(
    Modifier.fillMaxSize().background(Fondo),
    contentPadding = PaddingValues(bottom = 36.dp),
  ) {
    /*
     * Cabecera como la de la portada: el logotipo **sobre** el fotograma.
     *
     * Antes el fotograma acababa en un corte horizontal y el logotipo iba
     * suelto debajo, así que en las películas cuyo fotograma ya lleva el título
     * dibujado —«Apocalypse Now»— el nombre salía dos veces seguidas. Encima y
     * con el degradado llegando hasta el fondo, la cabecera es una sola cosa.
     */
    item {
      Box(Modifier.fillMaxWidth().height(400.dp)) {
        if (f.tieneFondo == 1) {
          Imagen(recordarUrl(f.id, "fanart", 1280), f.title, Modifier.fillMaxSize())
        }
        Box(
          Modifier.fillMaxSize().background(
            Brush.verticalGradient(
              0f to Color(0x55000000),
              0.4f to Color(0x22000000),
              0.78f to Color(0xCC09090C),
              1f to Fondo,
            ),
          ),
        )
        Column(
          Modifier
            .align(Alignment.BottomStart)
            .padding(horizontal = Aire.borde)
            .padding(bottom = 4.dp),
        ) {
          if (f.tieneLogo == 1) {
            Imagen(
              recordarUrl(f.id, "logo", 560),
              f.title,
              Modifier.heightIn(max = 68.dp).fillMaxWidth(0.86f),
              escala = ContentScale.Fit,
              alineacion = Alignment.BottomStart,
            )
          } else {
            Text(f.title, color = Texto, style = MaterialTheme.typography.headlineMedium)
          }
          f.tagline?.takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = TextoSuave, style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
    }

    item {
      Column(Modifier.padding(horizontal = Aire.borde)) {
        Spacer(Modifier.height(14.dp))
        Text(
          listOfNotNull(
            f.year?.toString(),
            if (!esSerie) duracionLegible(f.runtime).ifEmpty { null } else "${temporadas.size} temporada${if (temporadas.size == 1) "" else "s"}",
            calificacion(f.mpaa),
          ).joinToString("  ·  "),
          color = Texto,
          fontSize = 14.sp,
        )

        if (f.ratings.isNotEmpty()) {
          Spacer(Modifier.height(8.dp))
          LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(f.ratings) { n ->
              Row(verticalAlignment = Alignment.Bottom) {
                Text(
                  if (n.maximo == 100) "${n.valor.toInt()}%" else "%.1f".format(n.valor),
                  color = Texto,
                  fontSize = 15.sp,
                  fontWeight = FontWeight.SemiBold,
                )
                Spacer(Modifier.width(4.dp))
                Text(n.etiqueta, color = TextoTenue, fontSize = 11.sp)
              }
            }
          }
        }

        val etiquetas = remember(f) { etiquetasTecnicas(f) }
        if (etiquetas.isNotEmpty()) {
          Spacer(Modifier.height(10.dp))
          FilaDeEtiquetas(etiquetas)
        }

        if (f.genres.isNotEmpty()) {
          Spacer(Modifier.height(10.dp))
          Text(f.genres.take(4).joinToString(", "), color = TextoTenue, fontSize = 13.sp)
        }

        f.plot?.let { sinopsis ->
          Spacer(Modifier.height(12.dp))
          Text(
            sinopsis,
            color = TextoSuave,
            fontSize = 14.sp,
            lineHeight = 21.sp,
            maxLines = if (sinopsisAbierta) Int.MAX_VALUE else 4,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.clickable { sinopsisAbierta = !sinopsisAbierta },
          )
          if (sinopsis.length > 220) {
            Text(
              if (sinopsisAbierta) "Menos" else "Más",
              color = TextoTenue,
              fontSize = 13.sp,
              modifier = Modifier
                .clickable { sinopsisAbierta = !sinopsisAbierta }
                .padding(top = 4.dp),
            )
          }
        }

        Spacer(Modifier.height(18.dp))
        if (!esSerie && ficheroPelicula != null) {
          Button(
            onClick = { alReproducir(ficheroPelicula.id, null, reanudarEn) },
            modifier = Modifier.fillMaxWidth(),
          ) {
            Text(if (reanudarEn > 0) "Reanudar ${reloj(reanudarEn)}" else "Reproducir")
          }
          if (reanudarEn > 0) {
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
              onClick = { alReproducir(ficheroPelicula.id, null, 0.0) },
              modifier = Modifier.fillMaxWidth(),
            ) { Text("Desde el principio") }
          }
        }
        Spacer(Modifier.height(12.dp))
        /*
         * La fila de siempre: favorito, vista y las imágenes. Van en una sola
         * línea de pastillas y no como botones grandes, porque son cosas que se
         * usan de vez en cuando; el botón grande es para reproducir, que es a lo
         * que se viene.
         */
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Pastilla(
            if (esFavorita) "★ Favorita" else "☆ Favorita",
            activa = esFavorita,
          ) {
            val nuevo = !esFavorita
            esFavorita = nuevo
            ambito.launch {
              try {
                withContext(Dispatchers.IO) { Api.favorito(itemId, nuevo) }
                Cache.olvidarFicha(itemId)
              } catch (e: Exception) {
                esFavorita = !nuevo // no coló: se deja como estaba
              }
            }
          }
          Pastilla(
            if (estaVista) "Vista" else "Marcar vista",
            activa = estaVista,
          ) {
            val nuevo = !estaVista
            estaVista = nuevo
            ambito.launch {
              try {
                withContext(Dispatchers.IO) { Api.marcarVista(itemId, nuevo) }
                Cache.olvidarFicha(itemId)
              } catch (e: Exception) {
                estaVista = !nuevo
              }
            }
          }
          // Cambiar las imágenes se guarda para todos: solo el administrador.
          if (Ajustes.esAdmin) Pastilla("Imágenes") { alCambiarImagenes(f.kind, f.title, f.year) }
        }
        if (!esSerie && ficheroPelicula != null) {
          Spacer(Modifier.height(8.dp))
          /*
           * Lo que hace Chromecast, con la aplicación de la tele de receptor:
           * la Samsung no tiene Google Cast. La tele lo recoge en dos segundos
           * si está en cualquier pantalla que no sea el reproductor.
           */
          Pastilla("Ver en la tele" + (if (reanudarEn > 0) " desde " + reloj(reanudarEn) else "")) {
            mandarALaTele(ficheroPelicula.id, null, reanudarEn)
          }
        }

        Spacer(Modifier.height(24.dp))
      }
    }

    if (esSerie && temporadas.isNotEmpty()) {
      item {
        LazyRow(
          contentPadding = PaddingValues(horizontal = 16.dp),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          items(temporadas) { n ->
            val activa = n == temporadaActiva
            Text(
              if (n == 0) "Especiales" else "Temporada $n",
              color = if (activa) Color(0xFF15100A) else Texto,
              fontSize = 13.sp,
              modifier = Modifier
                .clip(RoundedCornerShape(18.dp))
                .background(if (activa) Realce else FondoTarjeta)
                .clickable { temporada = n }
                .padding(horizontal = 14.dp, vertical = 8.dp),
            )
          }
        }
        Spacer(Modifier.height(14.dp))
      }

      val deLaTemporada = f.episodes.filter { it.season == temporadaActiva && it.ficheroId != null }
      items(deLaTemporada, key = { it.id }) { e ->
        FilaEpisodio(
          f,
          e,
          alPulsar = { alReproducir(e.ficheroId!!, e.id, posicionDe(f, e.id)) },
          // Mantener pulsado un episodio lo manda a la tele.
          alMantener = { mandarALaTele(e.ficheroId!!, e.id, posicionDe(f, e.id)) },
        )
      }
    }

    val reparto = f.cast.filter { it.role == "actor" }.take(12)
    if (reparto.isNotEmpty()) {
      item {
        Spacer(Modifier.height(18.dp))
        Text("Reparto", color = Texto, fontSize = 16.sp, modifier = Modifier.padding(start = 16.dp, bottom = 10.dp))
        LazyRow(
          contentPadding = PaddingValues(horizontal = 16.dp),
          horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
          items(reparto, key = { it.id }) { p ->
            Column(Modifier.width(78.dp).clickable { alAbrirPersona(p.id) }) {
              Box(
                Modifier
                  .width(78.dp)
                  .height(78.dp)
                  .clip(RoundedCornerShape(39.dp))
                  .background(FondoTarjeta),
                contentAlignment = Alignment.Center,
              ) {
                if (p.tieneFoto == 1) {
                  Imagen(Api.fotoDePersona(p.id, 160), p.name, Modifier.fillMaxSize())
                } else {
                  Text(p.name.take(1).uppercase(), color = TextoTenue, fontSize = 20.sp)
                }
              }
              Spacer(Modifier.height(6.dp))
              Text(p.name, color = Texto, fontSize = 11.sp, maxLines = 2, lineHeight = 14.sp)
              p.character?.let { Text(it, color = TextoTenue, fontSize = 10.sp, maxLines = 1) }
            }
          }
        }
      }
    }
  }
}


private fun posicionDe(f: Ficha, episodioId: Int): Double {
  val p = f.progress.firstOrNull { it.episodioId == episodioId } ?: return 0.0
  return if (p.watched == 1) 0.0 else p.position
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FilaEpisodio(f: Ficha, e: Episodio, alPulsar: () -> Unit, alMantener: () -> Unit = {}) {
  val avance = run {
    val p = f.progress.firstOrNull { it.episodioId == e.id }
    val total = p?.duration ?: (e.runtime?.times(60) ?: 0.0)
    if (p != null && total > 0 && p.watched == 0) (p.position / total).coerceIn(0.0, 1.0).toFloat() else 0f
  }

  Row(
    Modifier
      .fillMaxWidth()
      .combinedClickable(onClick = alPulsar, onLongClick = alMantener)
      .padding(horizontal = 16.dp, vertical = 8.dp),
  ) {
    Box(
      Modifier
        .width(128.dp)
        .height(72.dp)
        .clip(RoundedCornerShape(8.dp))
        .background(FondoTarjeta),
    ) {
      if (e.tieneFoto == 1) {
        Imagen(Api.fotoDeEpisodio(e.id, 300), e.title, Modifier.fillMaxSize())
      }
      if (avance > 0.01f) {
        Box(
          Modifier
            .align(Alignment.BottomStart)
            .fillMaxWidth(avance)
            .height(3.dp)
            .background(Realce),
        )
      }
    }
    Spacer(Modifier.width(12.dp))
    Column(Modifier.padding(top = 2.dp)) {
      Text("T${e.season}E${e.episode}", color = TextoTenue, fontSize = 11.sp)
      Text(e.title ?: "Episodio ${e.episode}", color = Texto, fontSize = 14.sp, maxLines = 2, lineHeight = 18.sp)
      duracionLegible(e.runtime).takeIf { it.isNotEmpty() }?.let {
        Text(it, color = TextoTenue, fontSize = 11.sp)
      }
    }
  }
}

/**
 * La calificación por edades, en corto.
 *
 * Los `.nfo` de Kodi la traen como «ES:A / ES:A/fig / ES:Ai / ES:A/i/fig», que
 * es la ficha entera del ICAA y no le dice nada a nadie. Se queda el primer
 * trozo sin el país, que es lo que la gente reconoce: «A», «7», «12», «18».
 */
private fun calificacion(mpaa: String?): String? {
  if (mpaa.isNullOrBlank()) return null
  val primero = mpaa.split('/')[0].trim().removePrefix("ES:").trim()
  return primero.ifBlank { null }
}

/**
 * Lo que interesa saber antes de darle a reproducir: si es 4K, si trae HDR y
 * qué audio hay. Sale del fichero, no de la ficha, porque es propiedad de la
 * copia que hay en el disco.
 */
private fun etiquetasTecnicas(f: Ficha): List<String> {
  val fichero = f.files.firstOrNull { it.episodioId == null } ?: f.files.firstOrNull() ?: return emptyList()
  val out = mutableListOf<String>()
  val alto = fichero.height ?: 0
  when {
    alto >= 1900 -> out += "4K"
    alto >= 1000 -> out += "1080p"
    alto >= 700 -> out += "720p"
  }
  fichero.codec?.let { out += it.uppercase() }
  fichero.hdr?.let { out += it }
  return out
}
