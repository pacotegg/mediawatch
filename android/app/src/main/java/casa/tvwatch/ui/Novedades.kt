package casa.tvwatch.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

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

fun leerHistorialCompleto(contexto: Context): List<SeccionNovedades> =
  try {
    val changelog = contexto.assets.open("CHANGELOG.md").bufferedReader().use { it.readText() }
    ultimasSecciones(changelog, Int.MAX_VALUE).filter { sec ->
      sec.version.firstOrNull()?.isDigit() == true
    }
  } catch (_: Exception) {
    emptyList()
  }

@Composable
fun DialogoHistorialCompleto(alCerrar: () -> Unit) {
  val contexto = LocalContext.current
  val secciones = remember { leerHistorialCompleto(contexto) }

  AlertDialog(
    onDismissRequest = alCerrar,
    containerColor = FondoTarjeta,
    title = {
      Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text("Historial de versiones", color = Texto, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        if (secciones.isNotEmpty()) {
          Text("${secciones.size} versiones", color = TextoTenue, fontSize = 12.sp)
        }
      }
    },
    text = {
      Column(
        Modifier
          .fillMaxWidth()
          .verticalScroll(rememberScrollState()),
      ) {
        if (secciones.isEmpty()) {
          Text("No se pudo cargar el historial.", color = TextoTenue, fontSize = 14.sp)
        } else {
          secciones.forEachIndexed { index, sec ->
            if (index > 0) Spacer(Modifier.height(16.dp))
            Text(
              text = "Versión ${sec.titulo}",
              style = MaterialTheme.typography.titleMedium,
              color = Realce,
              fontWeight = FontWeight.Bold,
              fontSize = 15.sp,
              modifier = Modifier.padding(bottom = 6.dp),
            )
            sec.viñetas.forEach { viñeta ->
              Row(
                Modifier
                  .fillMaxWidth()
                  .padding(vertical = 2.dp),
                verticalAlignment = Alignment.Top,
              ) {
                Text(
                  "• ",
                  color = Realce,
                  fontSize = 14.sp,
                  fontWeight = FontWeight.Bold,
                )
                Text(
                  viñeta,
                  color = Texto,
                  fontSize = 14.sp,
                  lineHeight = 20.sp,
                )
              }
            }
          }
        }
      }
    },
    confirmButton = {
      TextButton(onClick = alCerrar) {
        Text("Cerrar", color = Realce, fontWeight = FontWeight.SemiBold)
      }
    },
  )
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

/** Una descarga de APK en curso o acabada: el porcentaje (null si el servidor no dice el tamaño) o el fichero listo. */
private sealed class Bajada {
  data class EnCurso(val porcentaje: Int?) : Bajada()
  data class Lista(val fichero: java.io.File) : Bajada()
  data class Fallo(val motivo: String) : Bajada()
}

/** Tope de tiempo de la descarga: ninguna espera sin límite. */
private val clienteApk: okhttp3.OkHttpClient by lazy {
  casa.tvwatch.datos.Api.http.newBuilder()
    .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
    .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
    .callTimeout(10, java.util.concurrent.TimeUnit.MINUTES)
    .build()
}

/**
 * Baja `MediaWatch-<versión>.apk` del servidor a `cacheDir/apk/`.
 *
 * Primero a `.part` y solo se renombra si han llegado los bytes que dijo
 * `Content-Length`: un APK cortado nunca llega al instalador. Si ya está bajado
 * entero (se vuelve de dar el permiso), no se baja otra vez.
 */
private suspend fun bajarApk(contexto: Context, version: String, alAvanzar: (Int?) -> Unit): java.io.File =
  kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val carpeta = java.io.File(contexto.cacheDir, "apk").apply { mkdirs() }
    val nombre = "MediaWatch-$version.apk"
    val destino = java.io.File(carpeta, nombre)
    if (destino.length() > 0) return@withContext destino
    // Solo esta carpeta: APK de versiones anteriores y descargas a medias.
    carpeta.listFiles()?.forEach { if (it.name != nombre) it.delete() }
    val parcial = java.io.File(carpeta, "$nombre.part")
    val url = casa.tvwatch.datos.Servidor.base().trimEnd('/') + "/" + nombre
    val llamada = clienteApk.newCall(okhttp3.Request.Builder().url(url).build())
    // Cancelar la corrutina corta también la conexión, no solo el bucle.
    coroutineContext[kotlinx.coroutines.Job]?.invokeOnCompletion { if (it != null) llamada.cancel() }
    llamada.execute().use { r ->
      if (!r.isSuccessful) throw java.io.IOException("El servidor respondió ${r.code}")
      val cuerpo = r.body ?: throw java.io.IOException("Respuesta vacía")
      val total = cuerpo.contentLength()
      var leidos = 0L
      var ultimo: Int? = -1
      cuerpo.byteStream().use { entrada ->
        parcial.outputStream().use { salida ->
          val bufer = ByteArray(64 * 1024)
          while (true) {
            ensureActive()
            val n = entrada.read(bufer)
            if (n < 0) break
            salida.write(bufer, 0, n)
            leidos += n
            val pct = if (total > 0) (leidos * 100 / total).toInt() else null
            if (pct != ultimo) { ultimo = pct; alAvanzar(pct) }
          }
        }
      }
      if (leidos == 0L) throw java.io.IOException("Descarga vacía")
      if (total > 0 && leidos != total) throw java.io.IOException("Descarga incompleta ($leidos de $total bytes)")
    }
    if (!parcial.renameTo(destino)) throw java.io.IOException("No se pudo guardar el APK")
    destino
  }

/**
 * Le pasa el APK al instalador del sistema. Si Android aún no deja instalar
 * desde Media Watch, abre esa pantalla de ajustes y devuelve false: al volver
 * se pulsa otra vez «Instalar» y el APK ya está bajado.
 */
private fun lanzarInstalador(contexto: Context, apk: java.io.File): Boolean {
  if (!contexto.packageManager.canRequestPackageInstalls()) {
    contexto.startActivity(
      android.content.Intent(
        android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        android.net.Uri.parse("package:" + contexto.packageName),
      ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    return false
  }
  val uri = androidx.core.content.FileProvider.getUriForFile(contexto, contexto.packageName + ".archivos", apk)
  contexto.startActivity(
    android.content.Intent(android.content.Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
  )
  return true
}

/** Lo de antes, como último recurso: instalar.html en el navegador, o la dirección a la vista. */
private fun abrirPaginaDeInstalar(contexto: Context) {
  val url = casa.tvwatch.datos.Servidor.baseCacheada().trimEnd('/') + "/instalar.html"
  try {
    contexto.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
  } catch (_: Exception) {
    android.widget.Toast.makeText(contexto, "Abre $url en el navegador", android.widget.Toast.LENGTH_LONG).show()
  }
}

/**
 * «Instalar» baja el APK aquí mismo y abre el instalador del sistema. Antes
 * abría instalar.html, y en Google TV no hay navegador.
 *
 * Mientras baja, el botón principal enseña el porcentaje y no hace nada, pero
 * no se desactiva: uno desactivado pierde el foco y con el mando de la tele
 * no habría dónde estar. El otro pasa a «Cancelar».
 */
@Composable
fun DialogoActualizacion(
  versionNueva: casa.tvwatch.datos.VersionApp,
  versionLocal: String,
  alCerrar: () -> Unit,
  alDescartar: (() -> Unit)? = null,
) {
  val contexto = LocalContext.current
  val remota = versionNueva.version ?: return
  val ambito = androidx.compose.runtime.rememberCoroutineScope()
  var bajada by remember { mutableStateOf<Bajada?>(null) }
  var tarea by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
  /** Se ha mandado a dar el permiso: el texto lo recuerda al volver. */
  var faltabaPermiso by remember { mutableStateOf(false) }

  fun cancelar() { tarea?.cancel(); tarea = null; bajada = null }

  fun instalar() {
    val b = bajada
    if (b is Bajada.EnCurso) return
    if (b is Bajada.Lista) {
      try {
        if (lanzarInstalador(contexto, b.fichero)) alCerrar() else faltabaPermiso = true
      } catch (e: Exception) {
        bajada = Bajada.Fallo(e.message ?: "No se pudo abrir el instalador")
      }
      return
    }
    bajada = Bajada.EnCurso(null)
    tarea = ambito.launch {
      try {
        val apk = bajarApk(contexto, remota) { pct -> bajada = Bajada.EnCurso(pct) }
        bajada = Bajada.Lista(apk)
        if (lanzarInstalador(contexto, apk)) alCerrar() else faltabaPermiso = true
      } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
      } catch (e: Exception) {
        android.util.Log.w("MediaWatch", "Descarga del APK $remota", e)
        bajada = Bajada.Fallo(e.message ?: "No se pudo descargar")
      }
    }
  }

  AlertDialog(
    // Atrás o tocar fuera durante la descarga la corta, como «Cancelar».
    onDismissRequest = { cancelar(); alCerrar() },
    title = { Text("Hay una versión nueva: $remota") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState())) {
        Text("Tienes la $versionLocal.", Modifier.padding(bottom = 8.dp))
        when (val b = bajada) {
          is Bajada.EnCurso -> {
            Text(if (b.porcentaje != null) "Descargando… ${b.porcentaje} %" else "Descargando…", Modifier.padding(bottom = 6.dp))
            val pct = b.porcentaje
            if (pct != null) {
              androidx.compose.material3.LinearProgressIndicator(progress = { pct / 100f }, modifier = Modifier.fillMaxWidth())
            } else {
              androidx.compose.material3.LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }
          }
          is Bajada.Lista -> if (faltabaPermiso) {
            Text("Activa «Permitir de esta fuente» para Media Watch, vuelve y pulsa Instalar otra vez.")
          }
          is Bajada.Fallo -> Text("No se pudo: ${b.motivo}", color = MaterialTheme.colorScheme.error)
          null -> versionNueva.novedades.forEach { Text("• $it", Modifier.padding(vertical = 4.dp)) }
        }
      }
    },
    confirmButton = {
      val b = bajada
      TextButton(onClick = {
        if (b is Bajada.Fallo) { alCerrar(); abrirPaginaDeInstalar(contexto) } else instalar()
      }) {
        Text(
          when (b) {
            is Bajada.EnCurso -> if (b.porcentaje != null) "Descargando ${b.porcentaje} %" else "Descargando…"
            is Bajada.Fallo -> "Abrir la página"
            else -> "Instalar"
          },
        )
      }
    },
    dismissButton = {
      TextButton(onClick = {
        if (bajada is Bajada.EnCurso) { cancelar(); return@TextButton }
        alDescartar?.invoke()
        alCerrar()
      }) {
        Text(
          when {
            bajada is Bajada.EnCurso -> "Cancelar"
            alDescartar != null -> "Más tarde"
            else -> "Cerrar"
          },
        )
      }
    },
  )
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
  DialogoActualizacion(
    versionNueva = v,
    versionLocal = local,
    alCerrar = { nueva = null },
    alDescartar = {
      val remota = v.version ?: return@DialogoActualizacion
      prefs.edit().putString(CLAVE_AVISO_DESCARTADO, remota).apply()
    },
  )
}
