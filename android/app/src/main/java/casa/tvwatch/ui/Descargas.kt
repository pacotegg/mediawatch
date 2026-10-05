package casa.tvwatch.ui

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Descarga
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun tamanoFormateado(bytes: Long?): String {
  if (bytes == null || bytes <= 0) return ""
  if (bytes >= 1_000_000_000) return "%.2f GB".format(bytes / 1e9)
  return "%d MB".format(bytes / 1_000_000)
}

private val ETIQUETAS_PERFIL = mapOf(
  "baja" to "Muy ligera · 360p",
  "movil" to "Móvil · 480p",
  "tablet" to "HD · 720p",
  "fhd" to "Full HD · 1080p",
  "original" to "Fichero original"
)

fun iniciarDescargaEnAndroid(contexto: Context, url: String, titulo: String, nombreFichero: String) {
  try {
    val soloWifi = Ajustes.descargasSoloWifi
    val request = DownloadManager.Request(Uri.parse(url))
      .setTitle(titulo)
      .setDescription("Media Watch - Ver sin conexión")
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nombreFichero)
      .setAllowedOverMetered(!soloWifi)
      .setAllowedOverRoaming(!soloWifi)
    if (soloWifi) {
      request.setAllowedNetworkTypes(DownloadManager.Request.NETWORK_WIFI)
    }
    val manager = contexto.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    manager.enqueue(request)
    Toast.makeText(contexto, "Descarga iniciada en el teléfono", Toast.LENGTH_SHORT).show()
  } catch (e: Exception) {
    Toast.makeText(contexto, "Error al iniciar descarga: ${e.message}", Toast.LENGTH_LONG).show()
  }
}

@Composable
fun PantallaDescargas(alPerderSesion: () -> Unit) {
  val contexto = LocalContext.current
  val ambito = rememberCoroutineScope()
  var descargas by remember { mutableStateOf<List<Descarga>>(emptyList()) }
  var cargando by remember { mutableStateOf(true) }
  var fallo by remember { mutableStateOf("") }

  fun cargar() {
    ambito.launch {
      try {
        val lista = withContext(Dispatchers.IO) { Api.descargas() }
        descargas = lista
        fallo = ""
      } catch (e: Api.SinSesion) {
        alPerderSesion()
      } catch (e: Exception) {
        fallo = e.message ?: "Error al cargar descargas"
      } finally {
        cargando = false
      }
    }
  }

  LaunchedEffect(Unit) {
    cargar()
    while (true) {
      delay(3000)
      if (descargas.any { it.estado == "preparando" }) {
        cargar()
      }
    }
  }

  Column(
    Modifier
      .fillMaxSize()
      .background(Fondo)
      .padding(horizontal = Aire.borde, vertical = 12.dp)
  ) {
    Text("Descargas", color = Texto, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(4.dp))
    Text("Copias preparadas para ver sin conexión.", color = TextoTenue, fontSize = 13.sp)
    Spacer(Modifier.height(16.dp))

    if (cargando && descargas.isEmpty()) {
      Text("Cargando descargas...", color = TextoSuave, fontSize = 14.sp)
    } else if (fallo.isNotBlank()) {
      Text(fallo, color = MaterialTheme.colorScheme.error, fontSize = 14.sp)
    } else if (descargas.isEmpty()) {
      Box(
        Modifier
          .fillMaxWidth()
          .clip(RoundedCornerShape(Esquinas.panel))
          .background(FondoTarjeta)
          .padding(20.dp)
      ) {
        Text(
          "Todavía no has pedido ninguna descarga. Se piden desde la ficha de cada película o episodio.",
          color = TextoSuave,
          fontSize = 14.sp
        )
      }
    } else {
      LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(descargas, key = { it.id }) { d ->
          Column(
            Modifier
              .fillMaxWidth()
              .clip(RoundedCornerShape(Esquinas.tarjeta))
              .background(FondoTarjeta)
              .padding(14.dp)
          ) {
            Text(d.titulo, color = Texto, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Spacer(Modifier.height(4.dp))
            val etiqueta = ETIQUETAS_PERFIL[d.perfil] ?: d.perfil
            val tamaño = tamanoFormateado(d.bytes)
            val estadoTexto = when (d.estado) {
              "preparando" -> "Preparando en servidor (${d.progreso}%)"
              "lista" -> "Lista para guardar"
              "error" -> "Error: ${d.error ?: "desconocido"}"
              else -> d.estado
            }
            Text("$etiqueta ${if (tamaño.isNotBlank()) "· $tamaño" else ""} · $estadoTexto", color = TextoTenue, fontSize = 12.sp)

            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              if (d.estado == "lista") {
                Button(
                  onClick = {
                    val url = "${Api.urlFicheroDescarga(d.id)}?token=${Ajustes.token ?: ""}"
                    val ext = if (d.perfil == "original") ".mkv" else ".mp4"
                    val nombreFichero = "${d.titulo.replace(Regex("[^a-zA-Z0-9.-]"), "_")}_${d.perfil}$ext"
                    iniciarDescargaEnAndroid(contexto, url, d.titulo, nombreFichero)
                  }
                ) {
                  Text("Descargar al móvil", fontSize = 13.sp)
                }
              }
              OutlinedButton(
                onClick = {
                  ambito.launch {
                    try {
                      withContext(Dispatchers.IO) { Api.borrarDescarga(d.id) }
                      cargar()
                    } catch (e: Exception) {
                      Toast.makeText(contexto, "Error: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                  }
                }
              ) {
                Text("Quitar", fontSize = 13.sp)
              }
            }
          }
        }
      }
    }
  }
}
