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

private val PERFILES_DESCARGA = listOf("_baja", "_movil", "_tablet", "_fhd", "_original")

private fun limpiarNombreFichero(nombre: String): String {
  var limpio = nombre
  for (p in PERFILES_DESCARGA) if (limpio.endsWith(p, ignoreCase = true)) limpio = limpio.dropLast(p.length)
  return limpio.replace('_', ' ').replace(Regex("\\s+"), " ").trim()
}

fun mismoTitulo(t1: String, t2: String): Boolean {
  val n1 = t1.lowercase().replace(Regex("[^a-z0-9]"), "")
  val n2 = t2.lowercase().replace(Regex("[^a-z0-9]"), "")
  if (n1.isEmpty() || n2.isEmpty()) return false
  if (n1 == n2) return true
  val perfiles = listOf("baja", "movil", "tablet", "fhd", "original")
  var p1 = n1
  var p2 = n2
  for (perf in perfiles) {
    if (p1.endsWith(perf)) p1 = p1.removeSuffix(perf)
    if (p2.endsWith(perf)) p2 = p2.removeSuffix(perf)
  }
  if (p1 == p2) return true
  if (p1.length >= 5 && p2.length >= 5 && (p1.contains(p2) || p2.contains(p1))) return true
  return false
}

fun iniciarDescargaEnAndroid(contexto: Context, url: String, titulo: String, nombreFichero: String) {
  try {
    val yaLocales = obtenerDescargasLocales(contexto)
    if (yaLocales.any { mismoTitulo(it.titulo, titulo) }) {
      Toast.makeText(contexto, "El vídeo ya está descargado en el teléfono", Toast.LENGTH_SHORT).show()
      return
    }
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

data class DescargaLocal(
  val idDownloadManager: Long?,
  val titulo: String,
  val uri: Uri,
  val bytes: Long,
  val path: String?,
)

fun obtenerDescargasLocales(contexto: Context): List<DescargaLocal> {
  val candidatos = mutableListOf<DescargaLocal>()
  val manager = contexto.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager

  if (manager != null) {
    try {
      val query = DownloadManager.Query()
      val cursor = manager.query(query)
      cursor?.use { c ->
        val idCol = c.getColumnIndex(DownloadManager.COLUMN_ID)
        val titleCol = c.getColumnIndex(DownloadManager.COLUMN_TITLE)
        val uriCol = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
        val bytesCol = c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
        val statusCol = c.getColumnIndex(DownloadManager.COLUMN_STATUS)

        while (c.moveToNext()) {
          val status = if (statusCol >= 0) c.getInt(statusCol) else -1
          if (status == DownloadManager.STATUS_SUCCESSFUL) {
            val id = if (idCol >= 0) c.getLong(idCol) else null
            val title = if (titleCol >= 0) c.getString(titleCol) else "Vídeo descargado"
            val uriStr = if (uriCol >= 0) c.getString(uriCol) else null
            val bytes = if (bytesCol >= 0) c.getLong(bytesCol) else 0L
            if (uriStr != null) {
              val uri = Uri.parse(uriStr)
              candidatos.add(DescargaLocal(id, title, uri, bytes, uri.path))
            }
          }
        }
      }
    } catch (e: Exception) {
      // Ignorar fallo de DownloadManager y probar escaneo de carpeta
    }
  }

  try {
    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    if (dir != null && dir.exists() && dir.isDirectory) {
      val ficheros = dir.listFiles { f ->
        f.isFile && (f.name.endsWith(".mp4", ignoreCase = true) || f.name.endsWith(".mkv", ignoreCase = true))
      }
      ficheros?.forEach { f ->
        val yaExiste = candidatos.any { it.path == f.absolutePath || it.titulo == f.name }
        if (!yaExiste) {
          candidatos.add(
            DescargaLocal(
              null,
              limpiarNombreFichero(f.name.removeSuffix(".mp4").removeSuffix(".mkv")),
              Uri.fromFile(f),
              f.length(),
              f.absolutePath,
            ),
          )
        }
      }
    }
  } catch (e: Exception) { /* ignorar */ }

  // Deduplicar la lista por título normalizado para no mostrar repetidos en la UI
  val resultado = mutableListOf<DescargaLocal>()
  for (item in candidatos) {
    if (!resultado.any { mismoTitulo(it.titulo, item.titulo) }) {
      resultado.add(item)
    }
  }
  return resultado
}

fun borrarDescargaLocal(contexto: Context, descarga: DescargaLocal) {
  try {
    val todasLocales = obtenerDescargasLocales(contexto)
    val coincidentes = todasLocales.filter { mismoTitulo(it.titulo, descarga.titulo) }
    val manager = contexto.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
    for (loc in coincidentes) {
      if (loc.idDownloadManager != null) {
        manager?.remove(loc.idDownloadManager)
      }
      if (loc.path != null) {
        val f = java.io.File(loc.path)
        if (f.exists()) f.delete()
      }
    }
  } catch (e: Exception) {
    Toast.makeText(contexto, "Error al borrar: ${e.message}", Toast.LENGTH_SHORT).show()
  }
}

@Composable
fun PantallaDescargas(
  alPerderSesion: () -> Unit,
  alReproducirLocal: (Uri, String) -> Unit,
) {
  val contexto = LocalContext.current
  val ambito = rememberCoroutineScope()
  var descargasServidor by remember { mutableStateOf<List<Descarga>>(emptyList()) }
  var descargasLocales by remember { mutableStateOf<List<DescargaLocal>>(emptyList()) }
  var cargando by remember { mutableStateOf(true) }
  var falloServidor by remember { mutableStateOf("") }

  fun refrescarLocales() {
    descargasLocales = obtenerDescargasLocales(contexto)
  }

  fun cargar() {
    refrescarLocales()
    ambito.launch {
      try {
        val lista = withContext(Dispatchers.IO) { Api.descargas() }

        // Borrar automáticamente del servidor copias de las que ya hay fichero descargado en el teléfono
        val paraBorrar = lista.filter { d ->
          descargasLocales.any { dl -> mismoTitulo(dl.titulo, d.titulo) }
        }
        for (d in paraBorrar) {
          launch(Dispatchers.IO) {
            try { Api.borrarDescarga(d.id) } catch (_: Exception) {}
          }
        }

        // Ocultar de la sección de servidor las películas que ya están descargadas en el teléfono
        descargasServidor = lista.filter { d ->
          !descargasLocales.any { dl -> mismoTitulo(dl.titulo, d.titulo) }
        }
        falloServidor = ""
      } catch (e: Api.SinSesion) {
        alPerderSesion()
      } catch (e: Exception) {
        falloServidor = "Servidor no disponible (${e.message ?: "sin conexión"})"
      } finally {
        cargando = false
      }
    }
  }

  LaunchedEffect(Unit) {
    cargar()
    while (true) {
      delay(3000)
      if (descargasServidor.any { it.estado == "preparando" }) {
        cargar()
      } else {
        refrescarLocales()
      }
    }
  }

  LazyColumn(
    Modifier
      .fillMaxSize()
      .background(Fondo)
      .padding(horizontal = Aire.borde, vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    item {
      Text("Descargas", color = Texto, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
      Spacer(Modifier.height(4.dp))
      Text("Vídeos disponibles para ver sin conexión a internet.", color = TextoTenue, fontSize = 13.sp)
    }

    if (descargasLocales.isNotEmpty()) {
      item {
        Spacer(Modifier.height(6.dp))
        Text("En este móvil (sin conexión)", color = Realce, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
      }
      items(descargasLocales, key = { it.uri.toString() }) { dl ->
        Column(
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Esquinas.tarjeta))
            .background(FondoTarjeta)
            .padding(14.dp),
        ) {
          Text(dl.titulo, color = Texto, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
          Spacer(Modifier.height(4.dp))
          Text(tamanoFormateado(dl.bytes) + " · Guardado en el móvil", color = TextoTenue, fontSize = 12.sp)

          Spacer(Modifier.height(10.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = { alReproducirLocal(dl.uri, dl.titulo) }) {
              Text("Reproducir", fontSize = 13.sp)
            }
            OutlinedButton(
              onClick = {
                borrarDescargaLocal(contexto, dl)
                refrescarLocales()
              },
            ) {
              Text("Borrar", fontSize = 13.sp)
            }
          }
        }
      }
    }

    item {
      Spacer(Modifier.height(6.dp))
      Text("En el servidor", color = TextoSuave, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }

    if (falloServidor.isNotBlank()) {
      item {
        Box(
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Esquinas.panel))
            .background(FondoTarjeta)
            .padding(14.dp),
        ) {
          Text(falloServidor, color = TextoTenue, fontSize = 13.sp)
        }
      }
    } else if (cargando && descargasServidor.isEmpty()) {
      item {
        Text("Comprobando servidor...", color = TextoSuave, fontSize = 14.sp)
      }
    } else if (descargasServidor.isEmpty()) {
      item {
        Box(
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Esquinas.panel))
            .background(FondoTarjeta)
            .padding(16.dp),
        ) {
          Text(
            "No hay copias preparadas en el servidor. Se piden desde la ficha de cada película o episodio.",
            color = TextoSuave,
            fontSize = 13.sp,
          )
        }
      }
    } else {
      items(descargasServidor, key = { it.id }) { d ->
        Column(
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Esquinas.tarjeta))
            .background(FondoTarjeta)
            .padding(14.dp),
        ) {
          Text(d.titulo, color = Texto, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
          Spacer(Modifier.height(4.dp))
          val etiqueta = ETIQUETAS_PERFIL[d.perfil] ?: d.perfil
          val tamaño = tamanoFormateado(d.bytes)
          val estadoTexto = when (d.estado) {
            "preparando" -> "Preparando en servidor (${d.progreso}%)"
            "lista" -> "Lista para descargar al móvil"
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
                },
              ) {
                Text("Bajar al móvil", fontSize = 13.sp)
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
              },
            ) {
              Text("Quitar", fontSize = 13.sp)
            }
          }
        }
      }
    }
  }
}
