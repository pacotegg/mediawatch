package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Dialogo
import casa.tvwatch.datos.PersonaBusqueda
import casa.tvwatch.datos.Titulo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Buscar.
 *
 * Tres cosas a la vez, y la tercera es la que no tiene nadie más: **títulos**,
 * **personas** y **frases**. El servidor lleva 1,29 millones de líneas de
 * subtítulo indexadas, así que se puede encontrar una película recordando solo
 * lo que decían; al pulsar la frase, empieza justo en ese momento.
 *
 * Y «Enviar a la tele»: se escribe aquí con el teclado del móvil y aparece en el
 * buscador del salón. Teclear «El halcón maltés» con las flechas del mando son
 * cuarenta y tantas pulsaciones y es la queja de siempre en cualquier tele.
 * Al pulsarlo una vez, la pastilla se queda encendida y **cada letra que se
 * escribe después va sola a la tele**, medio segundo tras dejar de teclear:
 * el móvil hace de teclado. Se apaga pulsándola otra vez o al salir.
 */
@Composable
fun PantallaBuscar(
  alAbrirFicha: (Int) -> Unit,
  alReproducirDesde: (fileId: Int, itemId: Int, episodioId: Int?, desde: Double) -> Unit,
  alPerderSesion: () -> Unit,
  alAbrirPersona: (Int) -> Unit = {},
) {
  var consulta by remember { mutableStateOf("") }
  var titulos by remember { mutableStateOf<List<Titulo>>(emptyList()) }
  var personas by remember { mutableStateOf<List<PersonaBusqueda>>(emptyList()) }
  var frases by remember { mutableStateOf<List<Dialogo>>(emptyList()) }
  var buscando by remember { mutableStateOf(false) }
  var aviso by remember { mutableStateOf("") }
  /** Encendido, cada cambio del texto se manda a la tele (con medio segundo de calma). */
  var espejo by remember { mutableStateOf(false) }
  val foco = remember { FocusRequester() }
  val ambito = rememberCoroutineScope()

  LaunchedEffect(consulta, espejo) {
    if (!espejo) return@LaunchedEffect
    delay(500)
    val q = consulta.trim()
    if (q.length < 2) return@LaunchedEffect
    try {
      withContext(Dispatchers.IO) { Api.enviarALaTele(q) }
      aviso = "En la tele: «$q»"
    } catch (e: Exception) {
      aviso = e.message ?: "No se pudo enviar."
    }
  }

  /*
   * Se busca al dejar de escribir, no en cada letra: 350 ms es lo que tarda uno
   * en pensar la siguiente tecla, y así no se manda una petición por carácter.
   */
  LaunchedEffect(consulta) {
    val q = consulta.trim()
    if (q.length < 2) {
      titulos = emptyList(); personas = emptyList(); frases = emptyList()
      return@LaunchedEffect
    }
    delay(350)
    buscando = true
    aviso = ""
    try {
      val r = withContext(Dispatchers.IO) { Api.buscar(q) }
      titulos = r.items
      personas = r.people
      // Las frases solo a partir de tres letras: con dos, medio catálogo.
      frases = if (q.length >= 3) withContext(Dispatchers.IO) { Api.buscarDialogos(q).hits } else emptyList()
    } catch (e: Api.SinSesion) {
      alPerderSesion()
    } catch (e: Exception) {
      aviso = e.message ?: "No se pudo buscar."
    } finally {
      buscando = false
    }
  }

  // El teclado, abierto desde el principio: si entras a buscar es para escribir.
  LaunchedEffect(Unit) { foco.requestFocus() }

  Column(Modifier.fillMaxSize().background(Fondo).imePadding()) {
    OutlinedTextField(
      value = consulta,
      onValueChange = { consulta = it },
      singleLine = true,
      label = { Text("Título, persona o una frase") },
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      keyboardActions = KeyboardActions(onSearch = {}),
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 10.dp)
        .focusRequester(foco),
    )

    if (consulta.trim().length >= 2) {
      Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          if (espejo) "Tecleando en la tele" else "Enviar a la tele",
          color = if (espejo) Realce else Color(0xFF15100A),
          fontSize = 13.sp,
          modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .background(if (espejo) FondoAlto else Realce)
            .clickable {
              espejo = !espejo
              if (espejo) {
                val q = consulta.trim()
                ambito.launch {
                  aviso = try {
                    withContext(Dispatchers.IO) { Api.enviarALaTele(q) }
                    "En la tele: «$q». Lo que escribas ahora también irá."
                  } catch (e: Exception) {
                    e.message ?: "No se pudo enviar."
                  }
                }
              } else {
                aviso = ""
              }
            }
            .padding(horizontal = 14.dp, vertical = 8.dp),
        )
        Spacer(Modifier.width(12.dp))
        if (buscando) Text("Buscando…", color = TextoTenue, fontSize = 12.sp)
        else if (aviso.isNotEmpty()) Text(aviso, color = TextoSuave, fontSize = 12.sp)
      }
    }

    LazyColumn(
      Modifier.fillMaxSize(),
      contentPadding = PaddingValues(top = 10.dp, bottom = 28.dp),
    ) {
      if (personas.isNotEmpty()) {
        item {
          Encabezado("Personas")
          LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
          ) {
            items(personas.take(12), key = { it.id }) { p ->
              Column(Modifier.width(76.dp).clickable { alAbrirPersona(p.id) }) {
                Box(
                  Modifier.size(76.dp).clip(CircleShape).background(FondoTarjeta),
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
                Text("${p.count} títulos", color = TextoTenue, fontSize = 10.sp)
              }
            }
          }
          Spacer(Modifier.height(18.dp))
        }
      }

      if (titulos.isNotEmpty()) {
        item { Encabezado("Títulos") }
        item {
          LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
          ) {
            items(titulos, key = { it.id }) { t -> Cartel(t, alPulsar = alAbrirFicha) }
          }
          Spacer(Modifier.height(20.dp))
        }
      }

      if (frases.isNotEmpty()) {
        item {
          Encabezado("Frases")
          Text(
            "Al pulsar, empieza en ese momento.",
            color = TextoTenue,
            fontSize = 11.5.sp,
            modifier = Modifier.padding(start = 16.dp, bottom = 8.dp),
          )
        }
        items(frases.take(30), key = { it.fileId.toString() + it.startMs }) { d ->
          FilaDeFrase(d) {
            alReproducirDesde(
              d.fileId,
              d.itemId,
              d.episodeId,
              // Tres segundos antes: la frase se oye entera, no a medias.
              ((d.startMs / 1000.0) - 3).coerceAtLeast(0.0),
            )
          }
        }
      }

      if (consulta.trim().length >= 2 && !buscando && titulos.isEmpty() && personas.isEmpty() && frases.isEmpty()) {
        item {
          Text(
            "Nada por aquí. Prueba con otro título o con otra frase.",
            color = TextoSuave,
            fontSize = 14.sp,
            modifier = Modifier.padding(24.dp),
          )
        }
      }
    }
  }
}

@Composable
private fun Encabezado(texto: String) {
  Text(
    texto,
    color = Texto,
    fontSize = 16.sp,
    fontWeight = FontWeight.SemiBold,
    modifier = Modifier.padding(start = 16.dp, bottom = 10.dp),
  )
}

@Composable
private fun FilaDeFrase(d: Dialogo, alPulsar: () -> Unit) {
  Row(
    Modifier
      .fillMaxWidth()
      .clickable { alPulsar() }
      .padding(horizontal = 16.dp, vertical = 9.dp),
    verticalAlignment = Alignment.Top,
  ) {
    Text(
      reloj(d.startMs / 1000.0),
      color = TextoTenue,
      fontSize = 11.sp,
      modifier = Modifier.width(62.dp).padding(top = 2.dp),
    )
    Column(Modifier.fillMaxWidth()) {
      // El servidor marca lo que coincide con « »; aquí se quitan las comillas
      // y se deja el texto limpio, que en una pantalla pequeña se lee mejor.
      Text(
        d.snippet.replace("«", "").replace("»", ""),
        color = Texto,
        fontSize = 13.sp,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        lineHeight = 18.sp,
      )
      Text(
        d.title + (if (d.season != null) "  ·  T${d.season}E${d.episode}" else d.year?.let { "  ·  $it" } ?: ""),
        color = TextoTenue,
        fontSize = 11.sp,
      )
    }
  }
}
