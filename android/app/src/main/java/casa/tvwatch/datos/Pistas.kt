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

  /**
   * Lo elegido para una serie: va por idioma y no por número de pista, porque
   * cada episodio es un fichero distinto con sus propios números. Vale para
   * todos los episodios de ese título mientras la app siga abierta.
   */
  data class DeSerie(val itemId: Int, val audioIdioma: String?, val subtitulo: PistaSubtitulo?)

  @Volatile private var deSerie: DeSerie? = null

  fun guardarSerie(e: DeSerie?) {
    deSerie = e
  }

  fun serieDe(itemId: Int): DeSerie? = deSerie?.takeIf { it.itemId == itemId }

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

  fun mismoIdioma(a: String?, b: String?): Boolean {
    if (a == null || b == null) return false
    if (esEspanol(a) && esEspanol(b)) return true
    return a.lowercase().trim().split('-', '_').first() == b.lowercase().trim().split('-', '_').first()
  }

  /** El subtítulo de esta lista que se parece al elegido en otro fichero: el mismo, o el del mismo idioma y «forzado». */
  fun subtituloParecido(lista: List<PistaSubtitulo>, querido: PistaSubtitulo): PistaSubtitulo? =
    lista.firstOrNull { it.id == querido.id && mismoIdioma(it.language, querido.language) && it.forced == querido.forced }
      ?: lista.firstOrNull { mismoIdioma(it.language, querido.language) && it.forced == querido.forced }
      ?: lista.firstOrNull { mismoIdioma(it.language, querido.language) }

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
    idioma: String? = null,
  ): PistaAudio? {
    pistas.firstOrNull { it.id == actual }?.let { return it }
    val candidatas = if (soloLasQueSeLeen) pistas.filter { it.compatible } else pistas
    // Un idioma elegido (en las series) manda sobre la preferencia general.
    if (idioma != null) candidatas.firstOrNull { mismoIdioma(it.language, idioma) }?.let { return it }
    val preferida = if (preferencia == "spa") candidatas.firstOrNull { esEspanol(it.language) } else null
    return preferida ?: candidatas.firstOrNull() ?: pistas.firstOrNull()
  }

  /** Para el registro: qué había y qué se eligió. */
  fun describir(pistas: List<PistaAudio>, elegida: PistaAudio?): String =
    "elegida=${elegida?.id}/${elegida?.language}/${elegida?.codec} · disponibles=" +
      pistas.joinToString(", ") { "${it.id}:${it.language ?: "?"}:${it.codec}${if (it.compatible) "" else "(no se lee)"}" } +
      " · preferencia=${Ajustes.idiomaAudioPreferido}"
}
