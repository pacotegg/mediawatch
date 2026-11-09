package casa.tvwatch.datos

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PremiosTest {
  @Test fun traduceSoloLasPalabrasFijasDelFormato() {
    assertEquals("Ganó 1 Óscar. 19 premios y 22 nominaciones en total", Premios.enEspanol("Won 1 Oscar. 19 wins & 22 nominations total"))
    assertEquals("Nominada a 3 Óscar. 5 premios y 10 nominaciones en total", Premios.enEspanol("Nominated for 3 Oscars. 5 wins & 10 nominations total"))
    assertEquals("Ganó 2 Emmys. 140 premios y 300 nominaciones en total", Premios.enEspanol("Won 2 Primetime Emmys. 140 wins & 300 nominations total"))
    assertEquals("1 premio y 1 nominación", Premios.enEspanol("1 win & 1 nomination"))
    assertEquals("Otros 12 premios y 3 nominaciones", Premios.enEspanol("Another 12 wins & 3 nominations"))
  }

  @Test fun sinNadaQueEnsenarDevuelveNull() {
    assertNull(Premios.enEspanol(null))
    assertNull(Premios.enEspanol(""))
    assertNull(Premios.enEspanol("N/A"))
  }
}
