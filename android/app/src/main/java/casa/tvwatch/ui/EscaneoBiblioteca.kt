package casa.tvwatch.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.CarpetaBiblioteca
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * «Actualizar biblioteca», solo para administradores: lanza `POST /api/scan` como el botón «Volver a escanear» de la
 * web. Deja elegir entre todas las carpetas o una sola (el servidor acepta una `ruta` de su configuración). El servidor
 * escanea de fondo y no da el avance: aquí solo se sabe si arrancó o si ya había un escaneo en curso.
 *
 * Aparte de `PantallaAjustes`, por la misma razón que `FilasReinicioServidor`.
 */
@Composable
internal fun FilaEscaneoBiblioteca() {
  val contexto = LocalContext.current
  val alcance = rememberCoroutineScope()
  var carpetas by remember { mutableStateOf<List<CarpetaBiblioteca>?>(null) }
  var dialogo by remember { mutableStateOf(false) }
  var ocupado by remember { mutableStateOf(false) }

  fun aviso(texto: String, largo: Boolean = false) =
    Toast.makeText(contexto, texto, if (largo) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()

  fun abrir() {
    if (ocupado) return
    ocupado = true
    alcance.launch {
      val r = withContext(Dispatchers.IO) { runCatching { Api.carpetasDeBiblioteca() } }
      ocupado = false
      r.onSuccess { carpetas = it; dialogo = true }
        .onFailure { aviso(it.message ?: "No se pudo leer la lista de carpetas", largo = true) }
    }
  }

  fun lanzar(ruta: String?) {
    dialogo = false
    if (ocupado) return
    ocupado = true
    alcance.launch {
      val r = withContext(Dispatchers.IO) { runCatching { Api.escanear(ruta) } }
      ocupado = false
      r.onSuccess {
        if (it.started) aviso("Escaneo iniciado. Tarda alrededor de medio minuto.")
        else aviso(it.reason ?: "No se pudo iniciar el escaneo", largo = true)
      }.onFailure { aviso(it.message ?: "No se pudo iniciar el escaneo", largo = true) }
    }
  }

  FilaBoton(
    titulo = "Actualizar biblioteca",
    detalle = if (ocupado) "Un momento…" else "Busca ficheros nuevos y cambios en los discos",
    alPulsar = { abrir() },
  )

  if (dialogo) {
    AlertDialog(
      onDismissRequest = { dialogo = false },
      containerColor = FondoTarjeta,
      title = { Text("Actualizar biblioteca", color = Texto, fontWeight = FontWeight.Bold) },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text("¿Qué quieres escanear? Los títulos nuevos aparecen en cuanto termina.", color = TextoSuave)
          TextButton(onClick = { lanzar(null) }) { Text("Toda la biblioteca", color = Realce, fontWeight = FontWeight.SemiBold) }
          for (c in carpetas.orEmpty()) {
            TextButton(onClick = { lanzar(c.path) }) { Text(c.name, color = Realce) }
          }
        }
      },
      confirmButton = {},
      dismissButton = { TextButton(onClick = { dialogo = false }) { Text("Cancelar", color = TextoSuave) } },
    )
  }
}
