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
