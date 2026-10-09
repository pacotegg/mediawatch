package casa.tvwatch.datos

/**
 * Lo que se eligió en la ficha (audio y subtítulos) para el próximo arranque de
 * ESE fichero. Se entrega una sola vez: la ficha lo deja justo antes de lanzar
 * el reproductor o Cast, y quien arranca lo recoge. Es un buzón y no un
 * parámetro de la ruta de navegación para no cambiar la firma de media docena
 * de funciones por algo que dura un instante.
 *
 * `audioId == null` = «el de siempre» (la regla de `Pistas.elegirAudio`).
 * `subtitulo == null` = subtítulos apagados, que es lo normal.
 */
object EleccionDePistas {
  data class Eleccion(val fileId: Int, val audioId: Int?, val subtitulo: PistaSubtitulo?)

  @Volatile private var pendiente: Eleccion? = null

  fun guardar(e: Eleccion?) {
    pendiente = e
  }

  fun tomar(fileId: Int): Eleccion? {
    val e = pendiente
    if (e != null && e.fileId == fileId) {
      pendiente = null
      return e
    }
    return null
  }
}

/**
 * Qué pista de audio se pone al empezar.
 *
 * `Ajustes.idiomaAudioPreferido` existía desde hace tiempo pero **nadie lo leía**:
 * el reproductor cogía «la primera pista que el aparato sepa leer», fuera del
 * idioma que fuera (08/10/2026). Aquí se decide en un solo sitio, y lo usan el
 * reproductor de la app y Cast.
 *
 * Reglas:
 * 1. La que ya estaba elegida (al cambiar de calidad, o si se eligió a mano).
 * 2. Con la preferencia «spa»: la primera en español.
 * 3. Si no, la primera; y si es el reproductor, mejor una que el aparato lea
 *    sin que el servidor la convierta (las que no, obligan a un flujo por
 *    tubería, sin saltos por rango).
 *
 * Solo «spa» cambia el comportamiento; «orig» y «cualquiera» dejan lo de siempre.
 */
object Pistas {

  private val ESPANOL = setOf("spa", "es", "esp", "spanish", "castellano")

  fun esEspanol(idioma: String?): Boolean {
    val base = idioma?.lowercase()?.trim()?.split('-', '_')?.firstOrNull().orEmpty()
    return base in ESPANOL
  }

  /**
   * @param soloLasQueSeLeen `true` en el reproductor de la app (se prefiere una pista
   * que el aparato decodifique). `false` en Cast: el servidor reconvierte el audio de
   * todos modos para el HLS, así que el idioma manda sobre el códec.
   */
  fun elegirAudio(
    pistas: List<PistaAudio>,
    actual: Int?,
    soloLasQueSeLeen: Boolean = true,
    preferencia: String = Ajustes.idiomaAudioPreferido,
  ): PistaAudio? {
    pistas.firstOrNull { it.id == actual }?.let { return it }
    val candidatas = if (soloLasQueSeLeen) pistas.filter { it.compatible } else pistas
    val preferida = if (preferencia == "spa") candidatas.firstOrNull { esEspanol(it.language) } else null
    return preferida ?: candidatas.firstOrNull() ?: pistas.firstOrNull()
  }

  /** Para el registro: qué había y qué se eligió. */
  fun describir(pistas: List<PistaAudio>, elegida: PistaAudio?): String =
    "elegida=${elegida?.id}/${elegida?.language}/${elegida?.codec} · disponibles=" +
      pistas.joinToString(", ") { "${it.id}:${it.language ?: "?"}:${it.codec}${if (it.compatible) "" else "(no se lee)"}" } +
      " · preferencia=${Ajustes.idiomaAudioPreferido}"
}
