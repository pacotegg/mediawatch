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

  @Volatile private var elegido: String? = null
  @Volatile private var cuando = 0L

  /** La última que se sabe buena, sin comprobar nada. Vale para las imágenes. */
  fun baseCacheada(): String = elegido ?: Ajustes.servidor

  /**
   * La dirección a usar, comprobando si hace falta.
   *
   * **Nunca desde el hilo principal**: puede tardar hasta 700 ms. Todas las
   * llamadas de `Api` corren en `Dispatchers.IO`, que es de donde sale.
   */
  fun base(): String {
    val casa = Ajustes.servidor
    val fuera = Ajustes.servidorFuera
    if (fuera.isEmpty() || fuera == casa) return casa

    val ahora = System.currentTimeMillis()
    elegido?.let { if (ahora - cuando < VALIDEZ_MS) return it }

    val bueno = if (responde(casa)) casa else fuera
    elegido = bueno
    cuando = ahora
    return bueno
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
