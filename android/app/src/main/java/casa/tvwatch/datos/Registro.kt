package casa.tvwatch.datos

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.RandomAccessFile
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Registro técnico de la app, y su envío al servidor.
 *
 * Nació el 08/10/2026: un betatester se quedaba con el esqueleto de la portada y
 * no había nada que mirar, ni en su móvil ni en el servidor. Ahora la app anota
 * lo que le pasa (arranque, a qué dirección intenta conectar, qué peticiones
 * fallan o tardan, fallos no capturados y por qué terminó la ejecución anterior)
 * y lo manda a `/api/cliente/log`, donde queda separado por usuario y aparato.
 *
 * Reglas:
 * - **Nada de tokens ni contraseñas**: se tachan antes de escribir.
 * - **Se guarda primero en el móvil** y se envía cuando hay sesión y conexión: lo
 *   que pasó antes de poder conectar llega después.
 * - **El envío no se registra a sí mismo.** Si falla, lo reintenta más tarde y
 *   calla; si no, un servidor caído llenaría el registro de avisos de sí mismo.
 * - Se puede apagar en Ajustes (`Ajustes.informesTecnicos`).
 */
object Registro {

  private const val MAX_BYTES = 256 * 1024L
  private const val LOTE_LINEAS = 150
  private const val LOTE_BYTES = 48 * 1024
  private const val ENTRE_ENVIOS_MS = 20_000L
  private const val REPASO_MS = 120_000L

  private var fichero: File? = null
  private var marca: File? = null
  private var contexto: Context? = null
  private var version = ""

  private val cerrojo = Any()
  private val formato = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }
  private val secreto = Regex("(?i)(token=|Bearer\\s+)[^&\\s]+")

  private val enviando = AtomicBoolean(false)
  @Volatile private var ultimoEnvio = 0L

  /** Con poca paciencia y sin reintentos propios: si no se puede ahora, se manda luego. */
  private val http = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .callTimeout(12, TimeUnit.SECONDS)
    .build()

  fun iniciar(c: Context) {
    val ctx = c.applicationContext
    contexto = ctx
    fichero = File(ctx.filesDir, "registro.log")
    marca = File(ctx.filesDir, "registro.enviado")
    version = try {
      ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
    } catch (e: Exception) {
      ""
    }

    val previo = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { hilo, fallo ->
      try {
        e("fallo", "excepción no capturada en el hilo ${hilo.name}", fallo)
      } catch (_: Throwable) {
      }
      previo?.uncaughtException(hilo, fallo)
    }

    i(
      "arranque",
      "versión=$version android=${Build.VERSION.RELEASE} modelo=${Build.MANUFACTURER} ${Build.MODEL} " +
        "red=${red()} servidor=${Servidor.baseCacheada()} " +
        "fuera=${if (Ajustes.servidorFuera.isEmpty()) "sin aprender" else "aprendida"} " +
        "sesión=${if (Ajustes.token.isNullOrEmpty()) "no" else "sí"}",
    )
    salidasAnteriores()

    val espera = Thread {
      try {
        Thread.sleep(8_000)
      } catch (_: InterruptedException) {
      }
      enviarSiToca(true)
    }
    espera.isDaemon = true
    espera.start()
  }

  fun i(etiqueta: String, mensaje: String) = escribir('I', etiqueta, mensaje)
  fun w(etiqueta: String, mensaje: String) = escribir('W', etiqueta, mensaje)

  fun e(etiqueta: String, mensaje: String, fallo: Throwable? = null) {
    var texto = mensaje
    if (fallo != null) {
      val pila = fallo.stackTrace.take(20).joinToString(" < ") {
        it.className.substringAfterLast('.') + "." + it.methodName + ":" + it.lineNumber
      }
      texto += " | ${fallo.javaClass.name}: ${fallo.message} | $pila"
    }
    escribir('E', etiqueta, texto)
  }

  /** Para el botón de Ajustes: manda ya lo pendiente. */
  fun enviarAhora() = enviarSiToca(true)

  /** Cuántos bytes del registro aún no se han mandado. */
  fun pendiente(): Long = (fichero?.length() ?: 0L) - enviado()

  /** Cómo está conectado el móvil ahora. */
  fun red(): String {
    val ctx = contexto ?: return "?"
    return try {
      val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "sin red"
      when {
        caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "datos móviles"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "otra"
      }
    } catch (e: Exception) {
      "?"
    }
  }

  private fun escribir(nivel: Char, etiqueta: String, mensaje: String) {
    val f = fichero ?: return
    synchronized(cerrojo) {
      try {
        val limpio = secreto.replace(mensaje.replace('\n', ' ').replace('\r', ' '), "$1oculto").take(700)
        f.appendText("${formato.format(Date())} $nivel $etiqueta $limpio\n")
        if (f.length() > MAX_BYTES) recortar(f)
      } catch (_: Exception) {
      }
    }
    if (nivel != 'I' || System.currentTimeMillis() - ultimoEnvio > REPASO_MS) enviarSiToca(false)
  }

  /** Conserva la mitad más reciente y ajusta lo ya enviado a lo que se ha quitado. */
  private fun recortar(f: File) {
    val texto = f.readText()
    val mitad = texto.length / 2
    val corte = texto.indexOf('\n', mitad).let { if (it < 0) mitad else it + 1 }
    f.writeText(texto.substring(corte))
    val quitado = texto.substring(0, corte).toByteArray().size.toLong()
    guardarEnviado(maxOf(0L, enviado() - quitado))
  }

  private fun enviado(): Long = try {
    marca?.takeIf { it.exists() }?.readText()?.trim()?.toLong() ?: 0L
  } catch (e: Exception) {
    0L
  }

  private fun guardarEnviado(v: Long) {
    try {
      marca?.writeText(v.toString())
    } catch (_: Exception) {
    }
  }

  private fun enviarSiToca(forzar: Boolean) {
    val f = fichero ?: return
    if (!Ajustes.informesTecnicos || Ajustes.token.isNullOrEmpty()) return
    if (!forzar && System.currentTimeMillis() - ultimoEnvio < ENTRE_ENVIOS_MS) return
    if (f.length() <= enviado()) return
    if (!enviando.compareAndSet(false, true)) return
    ultimoEnvio = System.currentTimeMillis()
    val hilo = Thread {
      try {
        enviarLotes()
      } catch (_: Throwable) {
      } finally {
        enviando.set(false)
      }
    }
    hilo.isDaemon = true
    hilo.start()
  }

  private fun enviarLotes() {
    repeat(5) {
      val lote = leerLote() ?: return
      val cuerpo = buildJsonObject {
        put("plataforma", "android")
        put("aparato", Ajustes.aparatoId)
        put("version", version)
        put("dispositivo", "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} · ${red()}")
        put("lineas", JsonArray(lote.first.map { JsonPrimitive(it) }))
      }.toString()
      val peticion = Request.Builder()
        .url(Servidor.baseCacheada() + "/api/cliente/log")
        .header("Authorization", "Bearer " + Ajustes.token)
        .header("User-Agent", "MediaWatch Android/" + Build.VERSION.RELEASE)
        .post(cuerpo.toRequestBody("application/json".toMediaType()))
        .build()
      val bien = try {
        http.newCall(peticion).execute().use { it.isSuccessful }
      } catch (_: Exception) {
        false
      }
      if (!bien) return
      synchronized(cerrojo) { guardarEnviado(enviado() + lote.second) }
    }
  }

  /** Líneas completas pendientes (hasta un lote) y cuántos bytes ocupan. */
  private fun leerLote(): Pair<List<String>, Long>? {
    val f = fichero ?: return null
    synchronized(cerrojo) {
      val desde = enviado()
      if (f.length() <= desde) return null
      val buf = ByteArray(minOf(LOTE_BYTES.toLong(), f.length() - desde).toInt())
      RandomAccessFile(f, "r").use {
        it.seek(desde)
        it.readFully(buf)
      }
      val ultimoSalto = buf.lastIndexOf('\n'.code.toByte())
      if (ultimoSalto < 0) return null
      val completo = String(buf, 0, ultimoSalto + 1, Charsets.UTF_8)
      var lineas = completo.split('\n').filter { it.isNotBlank() }
      var bytes = (ultimoSalto + 1).toLong()
      if (lineas.size > LOTE_LINEAS) {
        lineas = lineas.take(LOTE_LINEAS)
        bytes = lineas.sumOf { it.toByteArray().size + 1L }
      }
      return lineas to bytes
    }
  }

  /** Por qué terminó la ejecución anterior, si fue un fallo (Android 11 o más). */
  private fun salidasAnteriores() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
    val ctx = contexto ?: return
    try {
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val prefs = ctx.getSharedPreferences("registro", Context.MODE_PRIVATE)
      val visto = prefs.getLong("ultimaSalida", 0L)
      var maximo = visto
      for (s in am.getHistoricalProcessExitReasons(ctx.packageName, 0, 5)) {
        if (s.timestamp <= visto) continue
        maximo = maxOf(maximo, s.timestamp)
        val motivo = when (s.reason) {
          ApplicationExitInfo.REASON_CRASH -> "fallo de Java"
          ApplicationExitInfo.REASON_CRASH_NATIVE -> "fallo nativo"
          ApplicationExitInfo.REASON_ANR -> "la app no respondía (ANR)"
          ApplicationExitInfo.REASON_LOW_MEMORY -> "poca memoria"
          ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "fallo al iniciar"
          ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "uso excesivo de recursos"
          else -> null
        } ?: continue
        w("salida", "la ejecución anterior terminó por: $motivo · ${Date(s.timestamp)} · ${s.description ?: ""}")
      }
      prefs.edit().putLong("ultimaSalida", maximo).apply()
    } catch (_: Exception) {
    }
  }
}
