package casa.tvwatch.datos

import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Por dónde se llega al servidor ahora mismo: por casa o desde fuera.
 *
 * Plex no obliga a cambiar nada al salir de casa porque plex.tv le cuenta a la
 * aplicación las dos direcciones y ella prueba. Aquí lo mismo, sin intermediario:
 * el propio servidor dice cuál es su dirección pública (`/api/servidor`, que
 * solo la entrega dentro de casa), la aplicación se la guarda, y a partir de ahí
 * decide sola.
 *
 * Dos detalles que hacen que esto se note poco:
 *
 * 1. **La de casa se prueba con muy poca paciencia.** En la red de casa
 *    contesta en unos pocos milisegundos; si en 700 no ha dicho nada es que no
 *    estamos en casa, y esperar más solo sería tener la aplicación en blanco.
 * 2. **La decisión se guarda medio minuto.** Sin eso, cada carátula de la
 *    rejilla lanzaría su propia comprobación.
 *
 * Al cambiar de red (salir de casa con el móvil en la mano) la decisión vieja
 * caduca sola en ese medio minuto, y además cualquier fallo de red la tira.
 */
object Servidor {

  private const val VALIDEZ_MS = 30_000L

  /** Poca paciencia a propósito: en casa contesta en milisegundos. */
  private val sondeo: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(700, TimeUnit.MILLISECONDS)
    .readTimeout(700, TimeUnit.MILLISECONDS)
    .build()

  private const val ESPERA_APRENDER_MS = 10 * 60_000L

  /** Para preguntar quién es el servidor: algo más de paciencia que el sondeo de casa. */
  private val consulta: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(3, TimeUnit.SECONDS)
    .readTimeout(4, TimeUnit.SECONDS)
    .build()

  @Volatile private var elegido: String? = null
  @Volatile private var cuando = 0L
  @Volatile private var ultimoAprendizaje = 0L

  /** La última que se sabe buena, sin comprobar nada. Vale para las imágenes. */
  fun baseCacheada(): String = elegido ?: Ajustes.servidor

  /**
   * Dirección para Chromecast: el receptor web corre en https://www.gstatic.com
   * y bloquea conexiones http:// o a IPs privadas (Mixed Content / Private Network Access).
   */
  fun baseParaCast(): String {
    val fuera = Ajustes.servidorFuera
    if (fuera.isNotEmpty() && fuera.startsWith("https://")) return fuera
    val casa = Ajustes.servidor
    if (casa.startsWith("https://")) return casa
    return baseCacheada()
  }

  /**
   * La dirección a usar, comprobando si hace falta.
   *
   * **Nunca desde el hilo principal**: puede tardar hasta 700 ms. Todas las
   * llamadas de `Api` corren en `Dispatchers.IO`, que es de donde sale.
   */
  fun base(): String {
    val casa = Ajustes.servidor
    val fuera = Ajustes.servidorFuera
    if (fuera.isEmpty() || fuera == casa) {
      aprenderFuera(casa)
      return casa
    }

    val ahora = System.currentTimeMillis()
    elegido?.let { if (ahora - cuando < VALIDEZ_MS) return it }

    val bueno = if (responde(casa)) casa else fuera
    if (bueno != elegido) {
      Registro.i("servidor", "se usa la dirección de ${if (bueno == casa) "casa" else "fuera"}: $bueno")
    }
    elegido = bueno
    cuando = ahora
    return bueno
  }

  /**
   * Pregunta al servidor cuál es su dirección de fuera, **sin pasar por `base()`**.
   *
   * Antes llamaba a `Api.quienEs()`, que pedía la dirección a `base()`, que volvía
   * a preguntar... sin fin: cada nivel hacía otra petición y la app acababa
   * cayéndose (08/10/2026, un betatester que solo había entrado por el dominio:
   * el servidor solo da su dirección pública dentro de casa, así que nunca la
   * aprendía y entraba en el bucle en cada llamada).
   *
   * Si el servidor no la da desde donde se está, no se insiste hasta pasados
   * diez minutos.
   */
  private fun aprenderFuera(casa: String) {
    if (casa.isEmpty() || Ajustes.servidorFuera.isNotEmpty()) return
    val ahora = System.currentTimeMillis()
    if (ahora - ultimoAprendizaje < ESPERA_APRENDER_MS) return
    ultimoAprendizaje = ahora
    try {
      val cuerpo = consulta.newCall(Request.Builder().url("$casa/api/servidor").build()).execute().use {
        if (it.isSuccessful) it.body?.string() else null
      } ?: return
      val q = Api.json.decodeFromString<QuienEs>(cuerpo)
      if (q.publica.isNotEmpty()) {
        Ajustes.servidorFuera = q.publica
        Registro.i("servidor", "dirección de fuera aprendida: ${q.publica}")
      } else {
        Registro.i("servidor", "el servidor no da su dirección de fuera desde esta red; se vuelve a preguntar en 10 minutos")
      }
    } catch (e: Exception) {
      Registro.w("servidor", "no se pudo preguntar la dirección de fuera: ${e.javaClass.simpleName}: ${e.message}")
    }
  }

  /** Tras un fallo de red, que la próxima vez se vuelva a mirar. */
  fun olvidar() {
    elegido = null
    cuando = 0
  }

  /** Dónde estamos, para poder decirlo en los ajustes. */
  fun enCasa(): Boolean = baseCacheada() == Ajustes.servidor

  private fun responde(url: String): Boolean =
    try {
      sondeo.newCall(Request.Builder().url("$url/api/servidor").build()).execute().use { it.isSuccessful }
    } catch (e: Exception) {
      false
    }
}
