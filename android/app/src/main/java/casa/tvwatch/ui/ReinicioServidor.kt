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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.EstadoReinicio
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * «Reiniciar el servidor con aviso», solo para administradores (19/10/2026): reiniciar a mano exige estar en el HTPC, y
 * quien está viendo algo se queda sin vídeo sin saber por qué. El servidor avisa a todos los aparatos («Mantenimiento en
 * curso, volvemos en un minuto») y sale; lo levanta su vigilante. Ver `media/reinicio.ts` en el servidor.
 *
 * Aparte de `PantallaAjustes`: esa función ya es de las grandes (la 3.71 se rompió por una así, ver CHANGELOG 3.72).
 */
@Composable
internal fun FilasReinicioServidor() {
  val contexto = LocalContext.current
  val alcance = rememberCoroutineScope()
  var estado by remember { mutableStateOf<EstadoReinicio?>(null) }
  var dialogo by remember { mutableStateOf(false) }
  var ocupado by remember { mutableStateOf(false) }

  // Al abrir y mientras la pantalla esté a la vista: cada 5 s si hay un reinicio pendiente, cada 30 s si no.
  LaunchedEffect(Unit) {
    while (true) {
      estado = withContext(Dispatchers.IO) { runCatching { Api.reinicioEstado() }.getOrNull() }
      delay(if (estado?.pendiente == true) 5_000L else 30_000L)
    }
  }

  fun lanzar(accion: () -> EstadoReinicio, aviso: String) {
    if (ocupado) return
    ocupado = true
    alcance.launch {
      val r = withContext(Dispatchers.IO) { runCatching { accion() } }
      ocupado = false
      r.onSuccess { estado = it; Toast.makeText(contexto, aviso, Toast.LENGTH_SHORT).show() }
        .onFailure { Toast.makeText(contexto, it.message ?: "No se pudo", Toast.LENGTH_LONG).show() }
    }
  }

  val e = estado
  if (e != null && e.pendiente) {
    val detalle = if (e.salePara != null) "Avisados todos los aparatos: el servidor se reinicia en unos segundos"
      else "Esperando a que nadie esté viendo nada" + if (e.viendo > 0) " (ahora ven ${e.viendo})" else ""
    FilaBoton(
      titulo = "Reinicio del servidor en curso",
      detalle = "$detalle · toca para cancelar",
      destacado = true,
      alPulsar = { lanzar({ Api.reinicioCancelar() }, "Reinicio cancelado") },
    )
  } else {
    FilaBoton(
      titulo = "Reiniciar el servidor con aviso",
      detalle = "Avisa a todos los aparatos y lo reinicia; vuelve en uno o dos minutos",
      alPulsar = { dialogo = true },
    )
  }

  if (dialogo) {
    AlertDialog(
      onDismissRequest = { dialogo = false },
      containerColor = FondoTarjeta,
      title = { Text("Reiniciar el servidor", color = Texto, fontWeight = FontWeight.Bold) },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(
            "Se avisa a todos con «Mantenimiento en curso, volvemos en un minuto». Lo ve quien tenga el reproductor o la tele abiertos; el vídeo se corta al reiniciar.",
            color = TextoSuave,
          )
          TextButton(onClick = { dialogo = false; lanzar({ Api.reinicioPedir("cuando-libre") }, "Reiniciará cuando nadie vea nada") }, modifier = Modifier) {
            Text("Cuando nadie esté viendo nada", color = Realce)
          }
          TextButton(onClick = { dialogo = false; lanzar({ Api.reinicioPedir("ya") }, "Aviso enviado: se reinicia en unos segundos") }) {
            Text("Ahora (avisa y reinicia a los 20 s)", color = Realce)
          }
        }
      },
      confirmButton = {},
      dismissButton = { TextButton(onClick = { dialogo = false }) { Text("Cancelar", color = TextoSuave) } },
    )
  }
}
