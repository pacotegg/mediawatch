package casa.tvwatch.datos

import android.content.Context
import android.content.SharedPreferences

/**
 * Lo poco que la aplicación guarda en el teléfono: dónde está el servidor y la
 * sesión. Todo lo demás —qué se ha visto, por dónde va cada película, las
 * preferencias— vive en el servidor, que es lo que hace que empieces una
 * película en la tele y la sigas en el sofá con el móvil.
 *
 * **Se lee de memoria, no del disco.** Parece un detalle y no lo es: la
 * dirección y el token se consultan al construir la URL de cada carátula, o sea
 * varias veces por tarjeta y en cada recomposición de la rejilla. Yendo a
 * `SharedPreferences` cada vez, eso son cientos de llamadas al sistema en el
 * hilo que dibuja. Se cargan una vez al arrancar y se escriben a los dos sitios.
 */
object Ajustes {

  private lateinit var prefs: SharedPreferences

  private var enMemoriaServidor = ""
  private var enMemoriaFuera = ""
  private var enMemoriaToken: String? = null
  private var enMemoriaPerfil = ""

  fun iniciar(c: Context) {
    prefs = c.getSharedPreferences("tvwatch", Context.MODE_PRIVATE)
    enMemoriaServidor = prefs.getString("servidor", "") ?: ""
    enMemoriaFuera = prefs.getString("servidorFuera", "") ?: ""
    enMemoriaToken = prefs.getString("token", null)
    enMemoriaPerfil = prefs.getString("perfil", "") ?: ""
  }

  var servidor: String
    get() = enMemoriaServidor
    set(v) {
      enMemoriaServidor = v
      prefs.edit().putString("servidor", v).apply()
    }

  /**
   * La dirección de fuera de casa, si el servidor tiene una.
   *
   * No se escribe a mano: la manda el propio servidor en `/api/servidor` cuando
   * se conecta uno desde casa, y se guarda. Así no hay que teclearla en cada
   * aparato ni volver a hacerlo el día que cambie el dominio.
   */
  var servidorFuera: String
    get() = enMemoriaFuera
    set(v) {
      enMemoriaFuera = v
      prefs.edit().putString("servidorFuera", v).apply()
    }

  var token: String?
    get() = enMemoriaToken
    set(v) {
      enMemoriaToken = v
      prefs.edit().putString("token", v).apply()
    }

  var perfil: String
    get() = enMemoriaPerfil
    set(v) {
      enMemoriaPerfil = v
      prefs.edit().putString("perfil", v).apply()
    }

  /** Si el perfil es administrador: cambiar imágenes es cosa suya, no de un invitado. */
  var esAdmin: Boolean
    get() = prefs.getBoolean("esAdmin", false)
    set(v) = prefs.edit().putBoolean("esAdmin", v).apply()

  /* La calidad elegida a mano, una para cada sitio. Se leen poco: no hace
     falta tenerlas en memoria. */
  var calidadCasa: Calidad
    get() = Calidad.deNombre(prefs.getString("calidadCasa", null)) ?: Calidad.ORIGINAL
    set(v) = prefs.edit().putString("calidadCasa", v.name).apply()

  var calidadFuera: Calidad
    get() = Calidad.deNombre(prefs.getString("calidadFuera", null)) ?: Calidad.ALTA
    set(v) = prefs.edit().putString("calidadFuera", v.name).apply()

  /*
   * Cómo encaja el vídeo en la pantalla. Se guarda porque es una preferencia
   * de la persona y del aparato, no de la película: quien no soporta las
   * bandas negras de un 1.85:1 en un móvil alargado no las soporta tampoco en
   * la siguiente, y tener que elegirlo en cada título sería un incordio.
   * Se guarda el nombre y no el número de Media3: si algún día cambian sus
   * constantes, aquí no se hereda un valor que signifique otra cosa.
   */
  var encajeVideo: String
    get() = prefs.getString("encajeVideo", null) ?: "AJUSTAR"
    set(v) = prefs.edit().putString("encajeVideo", v).apply()

  /** Sonido 5.1 (AC3/DD+) al Chromecast. Apagado: en un aparato sin Dolby es silencio. */
  var castCincoUno: Boolean
    get() = prefs.getBoolean("castCincoUno", false)
    set(v) = prefs.edit().putBoolean("castCincoUno", v).apply()

  val configurado: Boolean get() = servidor.isNotEmpty() && !token.isNullOrEmpty()

  fun olvidarSesion() {
    enMemoriaToken = null
    enMemoriaPerfil = ""
    prefs.edit().remove("token").remove("perfil").remove("esAdmin").apply()
  }

  /**
   * Deja la dirección en forma de URL.
   *
   * Se escribe con el teclado del móvil y con prisa, así que llega de todas las
   * maneras: «192.168.31.16», con http:// o sin él, con barra al final. Si no
   * lleva puerto se pone el de TvWatch, que es el que va a ser casi siempre.
   */
  fun normalizar(escrito: String): String {
    var t = escrito.trim()
    if (t.isEmpty()) return ""
    /*
     * Una IP es la red de casa: http y el puerto del servidor. Un nombre de
     * dominio («tv.micasa.duckdns.org») es la dirección de fuera, que va por
     * https y sin puerto, porque delante hay un proxy con certificado. Así
     * quien se conecta desde fuera solo escribe el dominio, sin más.
     */
    val sinEsquemaInicial = t.substringAfter("://", t)
    val hostInicial = sinEsquemaInicial.substringBefore('/').substringBefore(':')
    val esDominio = hostInicial.any { it.isLetter() } && hostInicial != "localhost"
    if (!t.startsWith("http://") && !t.startsWith("https://")) t = (if (esDominio) "https://" else "http://") + t
    t = t.trimEnd('/')
    val sinEsquema = t.substringAfter("://")
    if (!esDominio && !sinEsquema.contains(':') && !sinEsquema.contains('/')) t = "$t:8730"
    return t
  }
}
