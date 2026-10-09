package casa.tvwatch.datos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PistasTest {

  private fun pista(id: Int, idioma: String?, codec: String = "eac3", compatible: Boolean = true) =
    PistaAudio(id = id, codec = codec, language = idioma, compatible = compatible)

  private val inglesPrimero = listOf(pista(1, "eng"), pista(2, "spa"), pista(3, "fre"))

  @Test fun conPreferenciaEspanolSeElegiraElEspanolAunqueNoSeaLaPrimera() {
    assertEquals(2, Pistas.elegirAudio(inglesPrimero, null, preferencia = "spa")?.id)
  }

  @Test fun sinPreferenciaSeQuedaLaPrimeraQueSeLee() {
    assertEquals(1, Pistas.elegirAudio(inglesPrimero, null, preferencia = "cualquiera")?.id)
    assertEquals(1, Pistas.elegirAudio(inglesPrimero, null, preferencia = "orig")?.id)
  }

  @Test fun laQueYaEstabaElegidaSiempreGana() {
    assertEquals(3, Pistas.elegirAudio(inglesPrimero, 3, preferencia = "spa")?.id)
  }

  @Test fun unaElegidaQueYaNoExisteCaeEnLaRegla() {
    assertEquals(2, Pistas.elegirAudio(inglesPrimero, 99, preferencia = "spa")?.id)
  }

  @Test fun elReproductorPrefiereLasQueSeLeenAunqueHayaUnEspanolQueNo() {
    val pistas = listOf(pista(1, "eng"), pista(2, "spa", "dts", compatible = false))
    assertEquals(1, Pistas.elegirAudio(pistas, null, soloLasQueSeLeen = true, preferencia = "spa")?.id)
  }

  @Test fun castPrefiereElIdiomaAunqueElMovilNoLeaElCodec() {
    val pistas = listOf(pista(1, "eng"), pista(2, "spa", "dts", compatible = false))
    assertEquals(2, Pistas.elegirAudio(pistas, null, soloLasQueSeLeen = false, preferencia = "spa")?.id)
  }

  @Test fun siNingunaSeLeeSeDevuelveLaPrimeraYElServidorLaConvierte() {
    val pistas = listOf(pista(1, "eng", "truehd", false), pista(2, "spa", "dts", false))
    assertEquals(1, Pistas.elegirAudio(pistas, null, soloLasQueSeLeen = true, preferencia = "cualquiera")?.id)
  }

  @Test fun elCodigoDeIdiomaSeReconoceEnSusVariantes() {
    for (c in listOf("spa", "es", "esp", "ES", "es-ES", "es_MX", "Spanish", "castellano")) {
      assertEquals("$c debia ser español", true, Pistas.esEspanol(c))
    }
    for (c in listOf("eng", "fre", "cat", null, "", "estonian-x")) {
      assertEquals("$c no debia ser español", false, Pistas.esEspanol(c))
    }
  }

  @Test fun sinPistasNoHayNada() {
    assertNull(Pistas.elegirAudio(emptyList(), null, preferencia = "spa"))
  }

  @Test fun unIdiomaElegidoEnUnaSerieManda() {
    // Otro episodio, con los números de pista cambiados: manda el idioma.
    val otro = listOf(pista(7, "spa"), pista(8, "eng"))
    assertEquals(8, Pistas.elegirAudio(otro, null, preferencia = "spa", idioma = "eng")?.id)
    assertEquals(7, Pistas.elegirAudio(otro, null, preferencia = "spa", idioma = "xxx")?.id)
  }

  @Test fun elSubtituloSeBuscaPorIdiomaYForzadosEnOtroFichero() {
    val querido = PistaSubtitulo(id = "0", language = "spa", forced = false)
    val lista = listOf(PistaSubtitulo("0", "eng"), PistaSubtitulo("1", "es", forced = true), PistaSubtitulo("2", "spa"))
    assertEquals("2", Pistas.subtituloParecido(lista, querido)?.id)
  }
}
