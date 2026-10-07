package casa.tvwatch.ui

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/*
 * Ventana de novedades: la primera vez que se abre una versión nueva (también
 * tras reinstalar), muestra lo que ha cambiado en ella. La fuente es
 * CHANGELOG.md del repo: el Gradle lo copia a los assets al compilar, así que
 * no hay dos listas que mantener a mano. Ver android/app/build.gradle.kts.
 */
private const val CLAVE_CODIGO_VISTO = "novedadesCodigoVisto"

/** Viñetas de la sección `## <version> ...`; vacío si esa versión no tiene sección. */
internal fun viñetasDe(changelog: String, version: String): List<String> {
  val viñetas = mutableListOf<String>()
  var dentro = false
  for (linea in changelog.lineSequence()) {
    if (linea.startsWith("## ")) {
      if (dentro) break
      dentro = linea.startsWith("## $version ")
    } else if (dentro && linea.startsWith("- ")) {
      viñetas += linea.removePrefix("- ").trim()
    }
  }
  return viñetas
}

private fun leerNovedades(contexto: Context, version: String): List<String> =
  try {
    viñetasDe(contexto.assets.open("CHANGELOG.md").bufferedReader().use { it.readText() }, version)
  } catch (e: Exception) {
    emptyList()
  }

@Composable
fun NovedadesDialogo() {
  val contexto = LocalContext.current
  val prefs = remember { contexto.getSharedPreferences("tvwatch", Context.MODE_PRIVATE) }
  val info = remember { contexto.packageManager.getPackageInfo(contexto.packageName, 0) }
  @Suppress("DEPRECATION")
  val codigo = info.versionCode
  val nombre = info.versionName ?: ""
  val viñetas = remember(nombre) { leerNovedades(contexto, nombre) }
  // Sin clave guardada (instalación nueva) vale 0 y se muestra; sin viñetas no hay nada que enseñar.
  var mostrar by remember {
    mutableStateOf(viñetas.isNotEmpty() && prefs.getInt(CLAVE_CODIGO_VISTO, 0) < codigo)
  }
  if (!mostrar) return

  val cerrar = {
    prefs.edit().putInt(CLAVE_CODIGO_VISTO, codigo).apply()
    mostrar = false
  }
  AlertDialog(
    onDismissRequest = cerrar,
    title = { Text("Novedades en $nombre") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState())) {
        viñetas.forEach { Text("• $it", Modifier.padding(vertical = 4.dp)) }
      }
    },
    confirmButton = { TextButton(onClick = cerrar) { Text("Entendido") } },
  )
}

/*
 * Aviso de versión nueva. Al abrir la app se pregunta al servidor cuál es la
 * última publicada (la del APK más alto en la web); si es más nueva que esta,
 * se ofrece ir a instalar.html. «Más tarde» no vuelve a avisar de esa misma
 * versión, solo de la siguiente. Sin notificaciones con la app cerrada: eso
 * pediría meter Firebase, y basta con verlo al abrirla.
 */
private const val CLAVE_AVISO_DESCARTADO = "avisoVersionDescartada"

/** «3.30» es más nueva que «3.29» comparando números, no texto («3.100» > «3.99»). */
internal fun esMasNueva(remota: String, local: String): Boolean {
  val r = remota.split('.').map { it.toIntOrNull() ?: 0 }
  val l = local.split('.').map { it.toIntOrNull() ?: 0 }
  for (i in 0 until maxOf(r.size, l.size)) {
    val a = r.getOrElse(i) { 0 }
    val b = l.getOrElse(i) { 0 }
    if (a != b) return a > b
  }
  return false
}

@Composable
fun AvisoDeVersionNueva() {
  val contexto = LocalContext.current
  val prefs = remember { contexto.getSharedPreferences("tvwatch", Context.MODE_PRIVATE) }
  val local = remember { contexto.packageManager.getPackageInfo(contexto.packageName, 0).versionName ?: "" }
  var nueva by remember { mutableStateOf<casa.tvwatch.datos.VersionApp?>(null) }

  androidx.compose.runtime.LaunchedEffect(Unit) {
    val v = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { casa.tvwatch.datos.Api.versionApp() }
    val remota = v?.version ?: return@LaunchedEffect
    if (esMasNueva(remota, local) && prefs.getString(CLAVE_AVISO_DESCARTADO, "") != remota) nueva = v
  }

  val v = nueva ?: return
  val remota = v.version ?: return
  AlertDialog(
    // Tocar fuera no cuenta como «Más tarde»: vuelve a salir la próxima vez.
    onDismissRequest = { nueva = null },
    title = { Text("Hay una versión nueva: $remota") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState())) {
        Text("Tienes la $local.", Modifier.padding(bottom = 8.dp))
        v.novedades.forEach { Text("• $it", Modifier.padding(vertical = 4.dp)) }
      }
    },
    confirmButton = {
      TextButton(onClick = {
        nueva = null
        val url = casa.tvwatch.datos.Servidor.baseCacheada().trimEnd('/') + "/instalar.html"
        try {
          contexto.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
        } catch (_: Exception) {
          android.widget.Toast.makeText(contexto, "Abre $url en el navegador", android.widget.Toast.LENGTH_LONG).show()
        }
      }) { Text("Instalar") }
    },
    dismissButton = {
      TextButton(onClick = {
        prefs.edit().putString(CLAVE_AVISO_DESCARTADO, remota).apply()
        nueva = null
      }) { Text("Más tarde") }
    },
  )
}
