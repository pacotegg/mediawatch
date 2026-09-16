package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.ImagenDisponible
import casa.tvwatch.datos.PropuestaTmdb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Elegir carátula, fondo y logotipo desde el móvil.
 *
 * La misma idea que en la web: una película tiene treinta carteles y el que
 * gusta depende de quién mire. Lo que se elige **no se escribe en la carpeta de
 * la película** —esas carpetas son del usuario y están cuidadas— sino en los
 * datos de TvWatch, marcado para que el escáner no lo pise en la siguiente
 * pasada. Sin esa marca, cambiar una carátula duraba hasta el próximo escaneo.
 *
 * Aquí tiene más sentido de lo que parece: el móvil es donde uno está cuando se
 * da cuenta de que una carátula está mal, con la tele delante.
 */
private val PAPELES = listOf(
  Triple("poster", "Carátula", 2f / 3f),
  Triple("fanart", "Fondo", 16f / 9f),
  Triple("clearlogo", "Logotipo", 16f / 9f),
  Triple("landscape", "Apaisada", 16f / 9f),
)

@Composable
fun PantallaSelectorDeArte(
  itemId: Int,
  kind: String,
  titulo: String,
  anio: Int?,
  alTerminar: () -> Unit,
) {
  var consulta by remember { mutableStateOf(titulo) }
  var propuestas by remember { mutableStateOf<List<PropuestaTmdb>>(emptyList()) }
  var tmdbId by remember { mutableStateOf<Int?>(null) }
  var papel by remember { mutableStateOf("poster") }
  var imagenes by remember { mutableStateOf<Map<String, List<ImagenDisponible>>>(emptyMap()) }
  var estado by remember { mutableStateOf("") }
  var ocupado by remember { mutableStateOf(false) }
  val ambito = rememberCoroutineScope()

  fun buscar() {
    ocupado = true
    estado = "Buscando «${consulta.trim()}» en TMDb…"
    ambito.launch {
      try {
        val r = withContext(Dispatchers.IO) { Api.buscarEnTmdb(consulta.trim(), kind, anio) }
        propuestas = r.results
        estado = if (r.results.isEmpty()) "No aparece nada con ese título." else ""
        // Con un solo resultado no hace falta preguntar nada.
        if (r.results.size == 1) tmdbId = r.results.first().tmdbId
      } catch (e: Exception) {
        estado = e.message ?: "No se pudo buscar."
      } finally {
        ocupado = false
      }
    }
  }

  // Al abrir se busca sola: casi siempre el título ya es el bueno.
  LaunchedEffect(Unit) { buscar() }

  LaunchedEffect(tmdbId) {
    val id = tmdbId ?: return@LaunchedEffect
    estado = "Pidiendo las imágenes…"
    try {
      imagenes = withContext(Dispatchers.IO) { Api.imagenesDe(kind, id) }
      estado = ""
    } catch (e: Exception) {
      estado = e.message ?: "No se pudieron pedir las imágenes."
    }
  }

  fun poner(url: String?) {
    ocupado = true
    ambito.launch {
      try {
        withContext(Dispatchers.IO) { Api.ponerArte(itemId, papel, url) }
        alTerminar()
      } catch (e: Exception) {
        estado = e.message ?: "No se pudo guardar."
        ocupado = false
      }
    }
  }

  val lista = imagenes[papel] ?: emptyList()
  val forma = PAPELES.first { it.first == papel }.third

  Column(Modifier.fillMaxSize().background(Fondo).imePadding()) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
      Text("Imágenes", color = Texto, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
      Spacer(Modifier.height(4.dp))
      Text(
        "Se guarda aparte y el escáner ya no la pisa.",
        color = TextoTenue,
        fontSize = 12.sp,
      )

      Spacer(Modifier.height(12.dp))
      OutlinedTextField(
        value = consulta,
        onValueChange = { consulta = it },
        singleLine = true,
        label = { Text("¿No es esta película?") },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { buscar() }),
        modifier = Modifier.fillMaxWidth(),
      )

      if (propuestas.size > 1) {
        Spacer(Modifier.height(10.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          items(propuestas.take(6)) { p ->
            val activa = p.tmdbId == tmdbId
            Text(
              p.title + (p.year?.let { " ($it)" } ?: ""),
              color = if (activa) Color(0xFF15100A) else Texto,
              fontSize = 12.sp,
              modifier = Modifier
                .clip(RoundedCornerShape(16.dp))
                .background(if (activa) Realce else FondoTarjeta)
                .clickable { tmdbId = p.tmdbId }
                .padding(horizontal = 12.dp, vertical = 7.dp),
            )
          }
        }
      }

      Spacer(Modifier.height(12.dp))
      LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(PAPELES) { (clave, etiqueta, _) ->
          val activa = clave == papel
          Text(
            etiqueta + (imagenes[clave]?.size?.let { "  $it" } ?: ""),
            color = if (activa) Color(0xFF15100A) else Texto,
            fontSize = 13.sp,
            modifier = Modifier
              .clip(RoundedCornerShape(16.dp))
              .background(if (activa) Realce else FondoTarjeta)
              .clickable { papel = clave }
              .padding(horizontal = 14.dp, vertical = 8.dp),
          )
        }
      }

      if (estado.isNotEmpty()) {
        Spacer(Modifier.height(10.dp))
        Text(estado, color = Realce, fontSize = 13.sp)
      }
    }

    LazyVerticalGrid(
      columns = GridCells.Adaptive(minSize = if (papel == "poster") 104.dp else 170.dp),
      modifier = Modifier.weight(1f),
      contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
      horizontalArrangement = Arrangement.spacedBy(10.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      items(lista.take(40), key = { it.url }) { img ->
        Box(
          Modifier
            .fillMaxWidth()
            .aspectRatio(forma)
            .clip(RoundedCornerShape(8.dp))
            .background(FondoTarjeta)
            .clickable(enabled = !ocupado) { poner(img.url) },
        ) {
          Imagen(img.vista, null, Modifier.fillMaxSize())
          Text(
            if (img.idioma.isEmpty()) "sin texto" else img.idioma,
            color = Texto,
            fontSize = 9.sp,
            modifier = Modifier
              .align(Alignment.BottomStart)
              .background(Color(0xAA000000))
              .padding(horizontal = 4.dp, vertical = 1.dp),
          )
        }
      }
    }

    Row(
      Modifier.fillMaxWidth().padding(16.dp),
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(
        "Quitar la elegida",
        color = TextoSuave,
        fontSize = 13.sp,
        modifier = Modifier
          .clip(RoundedCornerShape(16.dp))
          .background(FondoTarjeta)
          .clickable(enabled = !ocupado) { poner(null) }
          .padding(horizontal = 14.dp, vertical = 9.dp),
      )
      Text(
        "Cerrar",
        color = TextoSuave,
        fontSize = 13.sp,
        modifier = Modifier
          .clip(RoundedCornerShape(16.dp))
          .background(FondoTarjeta)
          .clickable { alTerminar() }
          .padding(horizontal = 14.dp, vertical = 9.dp),
      )
    }
  }
}
