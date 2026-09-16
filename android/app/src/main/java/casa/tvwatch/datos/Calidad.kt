package casa.tvwatch.datos

/**
 * Calidad elegida a mano, como el «Original / 8 Mb/s / 4 Mb/s» de Plex.
 *
 * En casa da igual: la red local lo aguanta todo y se ve el fichero tal cual.
 * Fuera, con datos del móvil, es lo que decide si se ve o se pasa el rato
 * cargando. Por eso se recuerda **una para casa y otra para fuera**, y la que
 * se aplica depende de por dónde se haya entrado.
 *
 * El servidor recibe un tope de altura y otro de tasa; si el fichero está por
 * debajo de los dos, lo manda tal cual aunque se haya pedido «720p»: no tiene
 * sentido recodificar para empeorar.
 */
enum class Calidad(val etiqueta: String, val altura: Int, val kbps: Int) {
  ORIGINAL("Original", 0, 0),
  ALTA("1080p · 8 Mb/s", 1080, 8000),
  MEDIA("720p · 4 Mb/s", 720, 4000),
  BAJA("480p · 2 Mb/s", 480, 2000),
  MINIMA("360p · 1 Mb/s", 360, 1000);

  companion object {
    fun deNombre(n: String?): Calidad? = entries.firstOrNull { it.name == n }

    /** La que toca ahora, según se esté dentro o fuera de casa. */
    fun actual(): Calidad = if (Servidor.enCasa()) Ajustes.calidadCasa else Ajustes.calidadFuera

    /** Guardarla para el sitio en el que se está. */
    fun recordar(c: Calidad) {
      if (Servidor.enCasa()) Ajustes.calidadCasa = c else Ajustes.calidadFuera = c
    }
  }
}
