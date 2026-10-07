package casa.tvwatch.ui

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/*
 * Ventana de novedades: la primera vez que se abre una versión nueva (también
 * tras reinstalar), muestra lo que ha cambiado en ella. La fuente es
 * CHANGELOG.md del repo: el Gradle lo copia a los assets al compilar, así que
 * no hay dos listas que mantener a mano. Ver android/app/build.gradle.kts.
 */
private const val CLAVE_CODIGO_VISTO = "novedadesCodigoVisto"

data class SeccionNovedades(
  val version: String,
  val titulo: String,
  val viñetas: List<String>,
)

internal fun ultimasSecciones(changelog: String, maxVersiones: Int = 3): List<SeccionNovedades> {
  val secciones = mutableListOf<SeccionNovedades>()
  var versionActual: String? = null
  var tituloActual: String? = null
  var viñetasActuales = mutableListOf<String>()

  for (linea in changelog.lineSequence()) {
    if (linea.startsWith("## ")) {
      if (versionActual != null && viñetasActuales.isNotEmpty()) {
        secciones += SeccionNovedades(versionActual, tituloActual ?: versionActual, viñetasActuales.toList())
        if (secciones.size >= maxVersiones) break
      }
      val cabecera = linea.removePrefix("## ").trim()
      versionActual = cabecera.split(" ").firstOrNull()
      tituloActual = cabecera
      viñetasActuales = mutableListOf()
    } else if (versionActual != null && linea.startsWith("- ")) {
      viñetasActuales += linea.removePrefix("- ").trim()
    }
  }

  if (versionActual != null && viñetasActuales.isNotEmpty() && secciones.size < maxVersiones) {
    secciones += SeccionNovedades(versionActual, tituloActual ?: versionActual, viñetasActuales.toList())
  }
  return secciones
}

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

private fun leerUltimasNovedades(contexto: Context, maxVersiones: Int = 3): List<SeccionNovedades> =
  try {
    ultimasSecciones(contexto.assets.open("CHANGELOG.md").bufferedReader().use { it.readText() }, maxVersiones)
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
  val secciones = remember { leerUltimasNovedades(contexto, 3) }
  // Sin clave guardada (instalación nueva) vale 0 y se muestra; sin viñetas no hay nada que enseñar.
  var mostrar by remember {
    mutableStateOf(secciones.isNotEmpty() && prefs.getInt(CLAVE_CODIGO_VISTO, 0) < codigo)
  }
  if (!mostrar) return

  val cerrar = {
    prefs.edit().putInt(CLAVE_CODIGO_VISTO, codigo).apply()
    mostrar = false
  }
  AlertDialog(
    onDismissRequest = cerrar,
    title = { Text("Novedades en Media Watch") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState())) {
        secciones.forEachIndexed { index, sec ->
          if (index > 0) {
            Spacer(Modifier.height(14.dp))
          }
          Text(
            text = "Versión ${sec.titulo}",
            style = MaterialTheme.typography.titleSmall,
            color = Color(0xFFFFC107),
            modifier = Modifier.padding(bottom = 4.dp),
          )
          sec.viñetas.forEach { viñeta ->
            Text("• $viñeta", Modifier.padding(vertical = 3.dp))
          }
        }
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
