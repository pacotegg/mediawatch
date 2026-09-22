package casa.tvwatch.datos

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import androidx.media3.common.MimeTypes
import androidx.media3.decoder.ffmpeg.FfmpegLibrary

/**
 * Qué sabe decodificar este aparato, preguntándoselo a él.
 *
 * Es la diferencia entre reproducir el fichero original y transcodificarlo por
 * nada. Dos móviles de la misma marca traen decodificadores distintos según el
 * chip que lleven dentro: el AC3 y el DD+ van con licencia y muchos fabricantes
 * no la pagan, mientras que casi todos traen HEVC. Adivinarlo por el modelo
 * sería inventárselo; `MediaCodecList` lo dice sin margen de error.
 *
 * Lo que sale de aquí viaja al servidor, que decide con ello si manda el MKV
 * tal cual —lo normal, y entonces no gasta ni un ciclo de CPU— o si le cambia
 * solo la pista de audio.
 */
object Capacidades {

  /** Nombres de ffmpeg, que es el idioma que habla el servidor. */
  private val EQUIVALENCIAS = mapOf(
    "audio/mp4a-latm" to "aac",
    "audio/mpeg" to "mp3",
    "audio/ac3" to "ac3",
    "audio/eac3" to "eac3",
    "audio/eac3-joc" to "eac3",
    "audio/ac4" to "ac4",
    "audio/opus" to "opus",
    "audio/vorbis" to "vorbis",
    "audio/flac" to "flac",
    "audio/raw" to "pcm_s16le",
    "audio/vnd.dts" to "dts",
    "audio/vnd.dts.hd" to "dts",
    "audio/true-hd" to "truehd",
  )

  private val soportados: Set<String> by lazy { detectar() }

  /**
   * Hasta qué altura descodifica cada códec de vídeo.
   *
   * Que exista el decodificador no significa que pueda con cualquier cosa. El
   * emulador tiene decodificador de HEVC y con un 4K HDR contesta
   * `NO_EXCEEDS_CAPABILITIES` y se cae; muchos móviles hacen lo mismo. Sin
   * preguntar esto, la aplicación pide el fichero original, el reproductor
   * revienta y el usuario ve una pantalla negra sin saber por qué.
   */
  private val alturas: Map<String, Int> by lazy { detectarAlturas() }

  private fun detectarAlturas(): Map<String, Int> {
    val topes = mutableMapOf<String, Int>()
    try {
      for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
        if (info.isEncoder) continue
        for (tipo in info.supportedTypes) {
          val nuestro = when (tipo.lowercase()) {
            "video/avc" -> "h264"
            "video/hevc" -> "hevc"
            "video/x-vnd.on2.vp9" -> "vp9"
            "video/av01" -> "av1"
            else -> continue
          }
          val alto = try {
            info.getCapabilitiesForType(tipo).videoCapabilities?.supportedHeights?.upper ?: 0
          } catch (e: Exception) {
            0
          }
          if (alto > (topes[nuestro] ?: 0)) topes[nuestro] = alto
        }
      }
    } catch (e: Exception) {
      /* sin datos: se queda vacío y el servidor usa lo que ya sabía */
    }
    return topes
  }

  val alturaMaxima: Int get() = alturas["h264"] ?: 0
  val alturaMaximaHevc: Int get() = alturas["hevc"] ?: 0

  /**
   * ¿Descodifica HEVC de 10 bits?
   *
   * Que haya decodificador de HEVC y que llegue a 4K no basta. Casi todo el cine
   * en 4K de la biblioteca es HEVC **Main 10** con HDR, y un decodificador que
   * solo tenga el perfil Main de 8 bits lo rechaza: contesta
   * `NO_EXCEEDS_CAPABILITIES` y se cae. Comprobado en el emulador con Vaiana
   * (`hvc1.2.4.L150.90`, BT.2020 PQ): decodificador presente, alturas de sobra,
   * y aun así imposible. Sin mirar el perfil, la aplicación pide el fichero
   * original y el usuario ve una pantalla negra.
   */
  val hevcDiezBits: Boolean by lazy { perfilDeVideo("video/hevc", PERFILES_HEVC_10) }

  /** Main10 y Main10HDR10, con sus números por si la constante no existe. */
  private val PERFILES_HEVC_10 = setOf(
    MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10,
    MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10,
    MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10Plus,
  )

  private fun perfilDeVideo(tipo: String, perfiles: Set<Int>): Boolean {
    try {
      for (info in MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos) {
        if (info.isEncoder) continue
        if (info.supportedTypes.none { it.equals(tipo, ignoreCase = true) }) continue
        val caps = info.getCapabilitiesForType(tipo)
        if (caps.profileLevels.any { it.profile in perfiles }) return true
      }
    } catch (e: Exception) {
      /* si no se puede preguntar, se supone que no: más vale recodificar de
         más que dejar una pantalla en negro */
    }
    return false
  }

  private fun detectar(): Set<String> {
    val encontrados = mutableSetOf<String>()
    try {
      val lista = MediaCodecList(MediaCodecList.REGULAR_CODECS)
      for (info in lista.codecInfos) {
        if (info.isEncoder) continue
        for (tipo in info.supportedTypes) {
          val t = tipo.lowercase()
          EQUIVALENCIAS[t]?.let { encontrados += it }
          when {
            t == "video/avc" -> encontrados += "h264"
            t == "video/hevc" -> encontrados += "hevc"
            t == "video/x-vnd.on2.vp9" -> encontrados += "vp9"
            t == "video/av01" -> encontrados += "av1"
          }
        }
      }
    } catch (e: Exception) {
      /* si el aparato no deja preguntar, se queda lo básico de abajo */
    }
    // AAC y MP3 son obligatorios en Android desde siempre; si la consulta falla
    // del todo, al menos eso se puede dar por hecho y algo sonará.
    encontrados += "aac"
    encontrados += "mp3"
    encontrados += deLaExtension()
    return encontrados
  }

  /**
   * Lo que descodifica la aplicación por su cuenta, además del sistema.
   *
   * El AAR de FFmpeg trae AC3, DD+, TrueHD y DTS, que es justo lo que muchos
   * móviles no traen por no pagar la licencia. `MediaCodecList` no los ve —no
   * son del sistema—, así que hay que añadirlos aquí; pero **no a mano**: se
   * le pregunta a la propia librería, que mira si el decodificador está de
   * verdad compilado dentro. Si un día el `.so` no viajara en el APK,
   * `isAvailable()` da falso, el servidor deja de creer que este aparato lee
   * DD+ y vuelve a convertir el audio. Vale más eso que quedarse en silencio.
   */
  private fun deLaExtension(): Set<String> {
    val nuestros = mapOf(
      MimeTypes.AUDIO_AC3 to "ac3",
      MimeTypes.AUDIO_E_AC3 to "eac3",
      MimeTypes.AUDIO_TRUEHD to "truehd",
      MimeTypes.AUDIO_DTS to "dts",
      MimeTypes.AUDIO_FLAC to "flac",
      MimeTypes.AUDIO_ALAC to "alac",
    )
    return try {
      if (!FfmpegLibrary.isAvailable()) emptySet()
      else nuestros.filterKeys { FfmpegLibrary.supportsFormat(it) }.values.toSet()
    } catch (e: Throwable) {
      // Sin la librería (o sin el .so de este ABI) no se declara nada.
      emptySet()
    }
  }

  val hevc: Boolean get() = "hevc" in soportados
  val ac3: Boolean get() = "ac3" in soportados
  val eac3: Boolean get() = "eac3" in soportados

  /** Los códecs de audio, como los espera `/api/play/...?perfil=`. */
  val perfilDeAudio: String
    get() = "lista:" + soportados.filter { it !in setOf("h264", "hevc", "vp9", "av1") }.sorted().joinToString(",")

  /**
   * Los parámetros que el servidor mira para decidir si transcodifica el vídeo.
   *
   * `sinHevc` es la marcha atrás: cuando el decodificador ha rechazado el
   * fichero de verdad, se vuelve a pedir diciendo que este aparato no lee HEVC,
   * y entonces el servidor lo recodifica. Es mentira a medias y es a propósito:
   * el objetivo es que se vea, no tener razón.
   */
  fun consulta(sinHevc: Boolean = false, calidad: Calidad = Calidad.ORIGINAL): String = buildString {
    append("perfil=").append(java.net.URLEncoder.encode(perfilDeAudio, "UTF-8"))
    append("&hevc=").append(if (hevc && !sinHevc) "1" else "0")
    append("&ac3=").append(if (ac3) "1" else "0")
    append("&eac3=").append(if (eac3) "1" else "0")
    // El tope de altura es el menor entre lo que descodifica el aparato y lo
    // que se ha pedido a mano; el de tasa solo existe si se ha pedido.
    val techo = listOf(alturaMaxima, calidad.altura).filter { it > 0 }.minOrNull() ?: 0
    val techoHevc = listOf(alturaMaximaHevc, calidad.altura).filter { it > 0 }.minOrNull() ?: 0
    if (techo > 0) append("&maxHeight=").append(techo)
    if (techoHevc > 0 && !sinHevc) append("&maxHeightHevc=").append(techoHevc)
    if (calidad.kbps > 0) append("&maxKbps=").append(calidad.kbps)
  }

  val consulta: String get() = consulta(false)

  /** Para la pantalla de información y para los registros: qué se ha detectado. */
  val resumen: String
    get() = soportados.sorted().joinToString(", ") +
      "  · H.264 hasta " + alturaMaxima + "p, HEVC hasta " + alturaMaximaHevc + "p"
}
