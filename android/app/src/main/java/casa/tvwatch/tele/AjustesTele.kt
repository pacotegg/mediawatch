package casa.tvwatch.tele

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.ui.Fondo
import casa.tvwatch.ui.FondoTarjeta
import casa.tvwatch.ui.Realce
import casa.tvwatch.ui.Texto
import casa.tvwatch.ui.TextoTenue

/**
 * Ajustes en Android TV: las preferencias que ya guarda la app (las mismas que la pantalla del móvil), cada una en una fila que
 * se cambia con OK. Sin deslizadores ni diálogos: con mando, una fila = una pulsación.
 */
@Composable
fun AjustesTele() {
  val contexto = LocalContext.current
  val version = remember {
    try { contexto.packageManager.getPackageInfo(contexto.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
  }
  var idioma by remember { mutableStateOf(if (Ajustes.idiomaAudioPreferido == "spa") "spa" else "orig") }
  var maraton by remember { mutableStateOf(Ajustes.modoMaraton) }
  var musica by remember { mutableStateOf(Ajustes.musicaCabecera) }
  var informes by remember { mutableStateOf(Ajustes.informesTecnicos) }

  val primero = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { primero.requestFocus() } }

  Column(
    Modifier
      .fillMaxSize()
      .background(Fondo)
      .padding(start = AireTele.lado, end = AireTele.lado, top = 40.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Text("Ajustes", color = Texto, fontSize = 28.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(8.dp))

    FilaAjuste(
      "Idioma de audio preferido", "Se elige solo cuando la película tiene esa pista",
      if (idioma == "spa") "Castellano" else "Original",
      Modifier.focusRequester(primero),
    ) {
      idioma = if (idioma == "spa") "orig" else "spa"
      Ajustes.idiomaAudioPreferido = idioma
    }
    FilaAjuste("Modo maratón", "Salta cabecera y resumen al encadenar episodios", if (maraton) "Sí" else "No") {
      maraton = !maraton
      Ajustes.modoMaraton = maraton
    }
    FilaAjuste("Música de cabecera", "Suena la sintonía de la serie en su ficha", if (musica) "Sí" else "No") {
      musica = !musica
      Ajustes.musicaCabecera = musica
    }
    FilaAjuste("Enviar informes técnicos", "Ayuda a encontrar fallos de la app", if (informes) "Sí" else "No") {
      informes = !informes
      Ajustes.informesTecnicos = informes
    }

    Spacer(Modifier.height(10.dp))
    Text(
      "Media Watch v$version" + if (Ajustes.perfil.isNotEmpty()) "  ·  ${Ajustes.perfil}" else "",
      color = TextoTenue,
      fontSize = 13.sp,
    )
  }
}

@Composable
private fun FilaAjuste(titulo: String, detalle: String, valor: String, modifier: Modifier = Modifier, alPulsar: () -> Unit) {
  Row(
    modifier
      .fillMaxWidth()
      .enfocable(RoundedCornerShape(14.dp), escala = 1.0f, alPulsar = alPulsar)
      .clip(RoundedCornerShape(14.dp))
      .background(FondoTarjeta)
      .padding(horizontal = 20.dp, vertical = 14.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f)) {
      Text(titulo, color = Texto, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
      Text(detalle, color = TextoTenue, fontSize = 13.sp)
    }
    Text(valor, color = Realce, fontSize = 17.sp, fontWeight = FontWeight.Bold)
  }
}
