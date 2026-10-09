package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Biblioteca
import casa.tvwatch.datos.Cache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/*
 * Orden y visibilidad del menú, como «Reordenar el menú» de la app de la tele
 * (`pantallaOrdenMenu` en tv/src/main.ts). Mismas claves que allí: las
 * secciones fijas por nombre y cada biblioteca como `lib-<id>`. «Ajustes» no
 * entra: si se pudiera esconder, no habría modo de volver a esta pantalla.
 */

/** Las secciones fijas del menú, en su orden de fábrica. */
val SECCIONES_FIJAS = listOf(
  "inicio" to "Inicio",
  "buscar" to "Buscar",
  "favoritos" to "Favoritas",
  "descargas" to "Descargas",
  "sagas" to "Sagas",
  "plataformas" to "Plataformas",
)

fun claveDeBiblioteca(b: Biblioteca) = "lib-${b.id}"

@Composable
fun PantallaOrdenMenu() {
  var bibliotecas by remember { mutableStateOf(Cache.bibliotecasGuardadas() ?: emptyList()) }
  // Se cuenta aquí un «cambio» para repintar al tocar: lo guardado vive en Ajustes, no en un estado de Compose.
  var cambios by remember { mutableStateOf(0) }

  LaunchedEffect(Unit) {
    if (bibliotecas.isNotEmpty()) return@LaunchedEffect
    try {
      val b = withContext(Dispatchers.IO) { Api.bibliotecas() }
      Cache.guardarBibliotecas(b)
      bibliotecas = b
    } catch (_: Exception) {
      // Sin red solo se pueden ordenar las secciones fijas.
    }
  }

  check(cambios >= 0) // leerlo suscribe esta pantalla a los cambios
  val ocultos = Ajustes.menuOcultos
  val fijas = Ajustes.ordenar(SECCIONES_FIJAS.map { it.first })
  val libs = Ajustes.ordenar(bibliotecas.map { claveDeBiblioteca(it) })
  val etiquetas = SECCIONES_FIJAS.toMap() + bibliotecas.associate { claveDeBiblioteca(it) to it.name }

  fun guardar(nuevasFijas: List<String>, nuevasLibs: List<String>) {
    Ajustes.ordenMenu = nuevasFijas + nuevasLibs
    cambios++
  }

  fun mover(grupo: List<String>, clave: String, paso: Int, esFijo: Boolean) {
    val i = grupo.indexOf(clave)
    val j = i + paso
    if (i < 0 || j < 0 || j >= grupo.size) return
    val nuevo = grupo.toMutableList().also { it[i] = grupo[j]; it[j] = clave }
    if (esFijo) guardar(nuevo, libs) else guardar(fijas, nuevo)
  }

  fun alternar(clave: String) {
    val o = Ajustes.menuOcultos
    Ajustes.menuOcultos = if (clave in o) o - clave else o + clave
    cambios++
  }

  @Composable
  fun Grupo(titulo: String, grupo: List<String>, esFijo: Boolean) {
    if (grupo.isEmpty()) return
    Text(titulo, color = Realce, fontSize = 13.sp, modifier = Modifier.padding(top = 18.dp, bottom = 4.dp))
    grupo.forEachIndexed { i, clave ->
      val oculta = clave in ocultos
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
          etiquetas[clave] ?: clave,
          color = if (oculta) TextoTenue else Texto,
          fontSize = 15.sp,
          modifier = Modifier.weight(1f),
        )
        TextButton(onClick = { mover(grupo, clave, -1, esFijo) }, enabled = i > 0) { Text("Subir") }
        TextButton(onClick = { mover(grupo, clave, 1, esFijo) }, enabled = i < grupo.size - 1) { Text("Bajar") }
        TextButton(onClick = { alternar(clave) }) { Text(if (oculta) "Mostrar" else "Esconder") }
      }
    }
  }

  Column(
    Modifier
      .fillMaxSize()
      .background(Fondo)
      .verticalScroll(rememberScrollState())
      .padding(horizontal = Aire.borde, vertical = 12.dp),
  ) {
    Text(
      "Sube o baja cada sección o biblioteca, o escóndela si no la usas. Vale para el menú y los atajos de la portada.",
      color = TextoSuave,
      fontSize = 13.sp,
    )
    Grupo("Secciones", fijas, esFijo = true)
    Grupo("Bibliotecas", libs, esFijo = false)
    Spacer(Modifier.height(18.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      TextButton(onClick = {
        Ajustes.ordenMenu = emptyList()
        Ajustes.menuOcultos = emptyList()
        cambios++
      }) { Text("Restablecer") }
    }
  }
}
