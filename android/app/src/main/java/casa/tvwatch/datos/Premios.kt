package casa.tvwatch.datos

/**
 * Los premios llegan de OMDb en inglés («Won 1 Oscar. 19 wins & 22 nominations total»). Solo se traducen las palabras fijas del
 * formato; los nombres de los premios se dejan como vienen. Mismo criterio que la web y la tele.
 */
object Premios {
  private val cambios = listOf(
    Regex("\\bNominated for\\b") to "Nominada a",
    Regex("\\bWon\\b") to "Ganó",
    Regex("\\bAnother\\b") to "Otros",
    Regex("\\bOscars?\\b") to "Óscar",
    Regex("\\bPrimetime Emmys?\\b") to "Emmys",
    Regex("\\bwins\\b") to "premios",
    Regex("\\bwin\\b") to "premio",
    Regex("\\bnominations\\b") to "nominaciones",
    Regex("\\bnomination\\b") to "nominación",
    Regex(" & ") to " y ",
    Regex("\\btotal\\b") to "en total",
  )

  fun enEspanol(texto: String?): String? {
    val t = texto?.trim().orEmpty()
    if (t.isEmpty() || t.equals("N/A", ignoreCase = true)) return null
    return cambios.fold(t) { acc, (re, por) -> re.replace(acc, por) }
  }
}
