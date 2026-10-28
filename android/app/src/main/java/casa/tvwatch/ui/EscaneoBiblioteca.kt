package casa.tvwatch.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import casa.tvwatch.datos.EstadoEscaneo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * «Actualizar biblioteca», solo para administradores: lanza `POST /api/scan` como el botón «Volver a escanear» de la
 * web. Deja elegir entre todas las carpetas o una sola (el servidor acepta una `ruta` de su configuración). El servidor
 * escanea de fondo; desde la 3.84 la fila pregunta cada 2 s a `GET /api/scan/estado` mientras dure (también si lo lanzó
 * otro aparato) y al acabar avisa de cómo terminó. Sin escaneo en curso no pregunta más.
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
  var estado by remember { mutableStateOf<EstadoEscaneo?>(null) }
  /** Sube al lanzar un escaneo: reinicia el efecto que lo vigila. */
  var vigilar by remember { mutableStateOf(0) }

  fun aviso(texto: String, largo: Boolean = false) =
    Toast.makeText(contexto, texto, if (largo) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()

  // Al abrir Ajustes, y tras lanzar uno: mirar; si hay un escaneo en curso, seguirlo cada 2 s hasta que acabe.
  LaunchedEffect(vigilar) {
    // Si acabo de lanzarlo, ya cuenta como «en curso»: un escaneo muy corto puede acabar antes de la primera consulta.
    var antes = vigilar > 0
    while (true) {
      val e = withContext(Dispatchers.IO) { runCatching { Api.escaneoEstado() }.getOrNull() }
      if (e != null) {
        estado = e
        if (antes && !e.scanning) {
          val u = e.ultimo
          if (u == null) aviso("Escaneo terminado")
          else if (u.ok) aviso("Escaneo terminado: ${u.resultados.sumOf { it.count }} títulos en ${u.resultados.size} carpeta(s)", largo = true)
          else aviso("El escaneo ha fallado: ${u.error ?: "sin detalle"}", largo = true)
        }
        antes = e.scanning
        if (!e.scanning) break
      } else break
      delay(2_000L)
    }
  }

  fun abrir() {
    if (ocupado) return
    if (estado?.scanning == true) { aviso("Ya hay un escaneo en curso"); return }
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
        if (it.started) { aviso("Escaneo iniciado"); vigilar++ }
        else aviso(it.reason ?: "No se pudo iniciar el escaneo", largo = true)
      }.onFailure { aviso(it.message ?: "No se pudo iniciar el escaneo", largo = true) }
    }
  }

  val p = estado?.progreso
  val detalle = when {
    ocupado -> "Un momento…"
    estado?.scanning == true && p != null && p.total > 0 -> "Escaneando ${p.library}: ${p.done} de ${p.total}"
    estado?.scanning == true -> "Escaneando…"
    else -> "Busca ficheros nuevos y cambios en los discos"
  }
  FilaBoton(titulo = "Actualizar biblioteca", detalle = detalle, alPulsar = { abrir() })

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
