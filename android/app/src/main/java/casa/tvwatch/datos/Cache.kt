package casa.tvwatch.datos

/**
 * Lo último que contestó el servidor, guardado mientras la aplicación viva.
 *
 * Existe por algo que se notaba mucho: al volver de una ficha, la portada se
 * volvía a pedir entera. Además de un segundo de espera por nada, **el
 * destacado cambiaba de película cada vez** —el servidor lo elige al azar— así
 * que la aplicación parecía inquieta, como si no se acordara de dónde estabas.
 *
 * Ahora se pide una vez, se guarda, y al volver está ahí al instante. Se
 * refresca solo si ha pasado un rato o si se pide expresamente. No es una caché
 * en disco ni falta: dura lo que dura la aplicación abierta, que es justo lo que
 * hace falta para que ir y volver sea instantáneo.
 */
object Cache {

  /** Cinco minutos: lo que tarda una biblioteca de casa en cambiar algo. */
  private const val VIGENCIA_MS = 5 * 60_000L

  private var portada: Portada? = null
  private var bibliotecas: List<Biblioteca>? = null
  private var cuando = 0L

  private val fichas = LinkedHashMap<Int, Ficha>()

  /** Por qué destacado iba la portada, para seguir ahí al volver de una ficha. */
  var indiceDelDestacado = 0

  fun portadaGuardada(): Pair<Portada, List<Biblioteca>>? {
    val p = portada ?: return null
    val b = bibliotecas ?: return null
    if (System.currentTimeMillis() - cuando > VIGENCIA_MS) return null
    return p to b
  }

  fun guardarPortada(p: Portada, b: List<Biblioteca>) {
    portada = p
    bibliotecas = b
    cuando = System.currentTimeMillis()
  }

  /**
   * Las bibliotecas sin mirar la fecha: para el menu lateral, que las lista
   * cada vez que se abre y no puede esperar a una peticion. Cambian una vez al
   * anio, cuando se anade una carpeta.
   */
  fun bibliotecasGuardadas(): List<Biblioteca>? = bibliotecas

  fun guardarBibliotecas(b: List<Biblioteca>) {
    bibliotecas = b
  }

  fun fichaGuardada(id: Int): Ficha? = fichas[id]

  fun guardarFicha(f: Ficha) {
    // Veinte fichas es de sobra para ir y volver un rato sin que crezca.
    if (fichas.size > 20) fichas.remove(fichas.keys.first())
    fichas[f.id] = f
  }

  /**
   * Tirar lo guardado de un título.
   *
   * Hace falta tras cambiar una imagen o marcar algo como visto: si no, se
   * volvería a ver la ficha de antes y parecería que el cambio no se ha hecho.
   */
  fun olvidarFicha(id: Int) {
    fichas.remove(id)
    portada = null
  }

  fun olvidarTodo() {
    portada = null
    bibliotecas = null
    fichas.clear()
    cuando = 0
  }
}
