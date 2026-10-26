package casa.tvwatch.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Ficha
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val colorCampo
  @Composable get() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Texto,
    unfocusedTextColor = Texto,
    focusedBorderColor = Realce,
    unfocusedBorderColor = Color(0x33FFFFFF),
    focusedLabelColor = Realce,
    unfocusedLabelColor = TextoSuave,
    cursorColor = Realce,
    focusedPlaceholderColor = TextoSuave,
    unfocusedPlaceholderColor = TextoSuave,
  )

@Composable
private fun CampoDeTexto(
  etiqueta: String,
  valor: String,
  alCambiar: (String) -> Unit,
  modifier: Modifier = Modifier,
  unaLinea: Boolean = true,
  minLineas: Int = 1,
  teclado: KeyboardType = KeyboardType.Text,
  ayuda: String? = null,
  error: Boolean = false,
) {
  OutlinedTextField(
    value = valor,
    onValueChange = alCambiar,
    label = { Text(etiqueta) },
    singleLine = unaLinea,
    minLines = minLineas,
    isError = error,
    supportingText = if (ayuda != null) ({ Text(ayuda, fontSize = 11.sp) }) else null,
    keyboardOptions = KeyboardOptions(keyboardType = teclado),
    colors = colorCampo,
    modifier = modifier.fillMaxWidth(),
  )
}

/**
 * Editar a mano los datos de un título, para administradores (como el diálogo de editar de Plex): título, título original y de
 * orden, año, edad, estudio, lema, sinopsis, saga y géneros. Solo se envía lo que ha cambiado; el servidor lo guarda en su base de
 * datos (no escribe en la carpeta de la película), el escáner lo respeta y se deshace con «Deshacer último».
 */
@Composable
fun EditorDatos(ficha: Ficha, alCerrar: () -> Unit, alGuardado: () -> Unit) {
  val contexto = LocalContext.current
  val ambito = rememberCoroutineScope()

  var titulo by remember(ficha.id) { mutableStateOf(ficha.title) }
  var original by remember(ficha.id) { mutableStateOf(ficha.tituloOriginal ?: "") }
  var orden by remember(ficha.id) { mutableStateOf(ficha.tituloOrden ?: "") }
  var anio by remember(ficha.id) { mutableStateOf(ficha.year?.toString() ?: "") }
  var edad by remember(ficha.id) { mutableStateOf(ficha.mpaa ?: "") }
  var estudio by remember(ficha.id) { mutableStateOf(ficha.studio ?: "") }
  var lema by remember(ficha.id) { mutableStateOf(ficha.tagline ?: "") }
  var sinopsis by remember(ficha.id) { mutableStateOf(ficha.plot ?: "") }
  var saga by remember(ficha.id) { mutableStateOf(ficha.collection ?: "") }
  var generos by remember(ficha.id) { mutableStateOf(ficha.genres) }
  var generoNuevo by remember(ficha.id) { mutableStateOf("") }
  var sagas by remember { mutableStateOf<List<String>>(emptyList()) }
  var ocupado by remember { mutableStateOf(false) }

  LaunchedEffect(Unit) {
    sagas = try { withContext(Dispatchers.IO) { Api.sagas() }.map { it.name } } catch (_: Exception) { emptyList() }
  }

  val anioMal = anio.trim().isNotEmpty() && !Regex("^\\d{4}$").matches(anio.trim())
  val tituloVacio = titulo.trim().isEmpty()

  // Solo lo que ha cambiado: `null` quita el dato y un texto lo pone.
  fun cambios(): JsonObject {
    val c = mutableMapOf<String, kotlinx.serialization.json.JsonElement>()
    fun texto(clave: String, nuevo: String, antes: String?) {
      if (nuevo.trim() != (antes ?: "").trim()) c[clave] = if (nuevo.trim().isEmpty()) JsonNull else JsonPrimitive(nuevo.trim())
    }
    if (titulo.trim() != ficha.title.trim()) c["title"] = JsonPrimitive(titulo.trim())
    texto("original_title", original, ficha.tituloOriginal)
    texto("sort_title", orden, ficha.tituloOrden)
    texto("mpaa", edad, ficha.mpaa)
    texto("studio", estudio, ficha.studio)
    texto("tagline", lema, ficha.tagline)
    texto("plot", sinopsis, ficha.plot)
    texto("collection", saga, ficha.collection)
    if (anio.trim() != (ficha.year?.toString() ?: "")) c["year"] = if (anio.trim().isEmpty()) JsonNull else JsonPrimitive(anio.trim().toInt())
    if (generos != ficha.genres) c["genres"] = JsonArray(generos.map { JsonPrimitive(it) })
    return JsonObject(c)
  }
  val hayCambios = cambios().isNotEmpty()

  fun anadirGenero() {
    val g = generoNuevo.trim()
    if (g.isNotEmpty() && generos.none { it.equals(g, ignoreCase = true) }) generos = generos + g
    generoNuevo = ""
  }

  Dialog(onDismissRequest = { if (!ocupado) alCerrar() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Surface(
      color = Color(0xFF14141A),
      shape = RoundedCornerShape(24.dp),
      modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 24.dp).heightIn(max = 780.dp),
    ) {
      Column(
        Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Text("Editar datos", color = Texto, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text("Lo que cambies aquí el escáner no lo pisa, y se puede deshacer.", color = TextoSuave, fontSize = 12.sp)
        Spacer(Modifier.height(4.dp))

        CampoDeTexto("Título", titulo, { titulo = it }, error = tituloVacio)
        CampoDeTexto("Título original", original, { original = it })
        CampoDeTexto("Título de orden", orden, { orden = it }, ayuda = "Cómo se ordena en las listas; vacío = el título")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          CampoDeTexto("Año", anio, { if (it.length <= 4) anio = it.filter { c -> c.isDigit() } }, modifier = Modifier.weight(1f), teclado = KeyboardType.Number, error = anioMal)
          CampoDeTexto("Edad", edad, { edad = it }, modifier = Modifier.weight(1f))
        }
        CampoDeTexto("Estudio", estudio, { estudio = it })
        CampoDeTexto("Lema", lema, { lema = it })
        CampoDeTexto("Sinopsis", sinopsis, { sinopsis = it }, unaLinea = false, minLineas = 4)

        CampoDeTexto("Saga / colección", saga, { saga = it }, ayuda = "Elige una existente o escribe un nombre nuevo; vacío = sin saga")
        val sugeridas = sagas.filter { s -> saga.isNotBlank() && !s.equals(saga.trim(), ignoreCase = true) && s.contains(saga.trim(), ignoreCase = true) }.take(8)
          .ifEmpty { if (saga.isBlank()) sagas.take(0) else emptyList() }
        if (sugeridas.isNotEmpty()) {
          LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(sugeridas) { s ->
              Text(s, color = Texto, fontSize = 12.sp, modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(Color(0x14FFFFFF)).clickable { saga = s }.padding(horizontal = 10.dp, vertical = 6.dp))
            }
          }
        }

        Text("Géneros", color = TextoSuave, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        if (generos.isNotEmpty()) {
          LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(generos) { g ->
              Text(g + "  ×", color = Texto, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(Color(0x1FFFFFFF)).clickable { generos = generos.filter { it != g } }.padding(horizontal = 12.dp, vertical = 7.dp))
            }
          }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          CampoDeTexto("Añadir género", generoNuevo, { generoNuevo = it }, modifier = Modifier.weight(1f))
          TextButton(onClick = { anadirGenero() }, enabled = generoNuevo.isNotBlank()) { Text("Añadir", color = Realce) }
        }

        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          TextButton(onClick = { if (!ocupado) alCerrar() }) { Text("Cancelar", color = TextoSuave) }
          TextButton(
            enabled = !ocupado,
            onClick = {
              ocupado = true
              ambito.launch {
                try {
                  val que = withContext(Dispatchers.IO) { Api.deshacerUltimoCambio(ficha.id) }
                  Toast.makeText(contexto, "Deshecho: $que", Toast.LENGTH_SHORT).show()
                  Cache.olvidarFicha(ficha.id)
                  alGuardado()
                  alCerrar()
                } catch (e: Exception) {
                  Toast.makeText(contexto, e.message ?: "No se pudo deshacer", Toast.LENGTH_LONG).show()
                  ocupado = false
                }
              }
            },
          ) { Text("Deshacer último", color = TextoSuave) }
        }
        Button(
          enabled = hayCambios && !anioMal && !tituloVacio && !ocupado,
          colors = ButtonDefaults.buttonColors(containerColor = Realce, contentColor = Color(0xFF15100A)),
          modifier = Modifier.fillMaxWidth(),
          onClick = {
            val envio = cambios()
            ocupado = true
            ambito.launch {
              try {
                withContext(Dispatchers.IO) { Api.editarMetadatos(ficha.id, envio) }
                Toast.makeText(contexto, "Guardado", Toast.LENGTH_SHORT).show()
                Cache.olvidarFicha(ficha.id)
                alGuardado()
                alCerrar()
              } catch (e: Exception) {
                Toast.makeText(contexto, e.message ?: "No se pudo guardar", Toast.LENGTH_LONG).show()
                ocupado = false
              }
            }
          },
        ) { Text(if (ocupado) "Guardando…" else "Guardar cambios", fontWeight = FontWeight.SemiBold) }
      }
    }
  }
}
