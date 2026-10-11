package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Api
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Mando virtual exclusivo para controlar la aplicación de la televisión desde el móvil.
 * Ofrece cruceta D-pad (arriba, abajo, izquierda, derecha, OK), navegación (Atrás, Play/Pausa)
 * y un teclado rápido para mandar texto a la búsqueda de la tele sin tener que teclear con las flechas.
 */
@Composable
fun PantallaMandoVirtual() {
  val haptico = LocalHapticFeedback.current
  val ambito = rememberCoroutineScope()
  var textoABuscar by remember { mutableStateOf("") }
  var estadoEnvio by remember { mutableStateOf("") }

  fun pulsar(tecla: String) {
    haptico.performHapticFeedback(HapticFeedbackType.LongPress)
    ambito.launch(Dispatchers.IO) {
      try {
        Api.enviarTeclaALaTele(tecla)
      } catch (_: Exception) {
      }
    }
  }

  fun enviarTexto() {
    val t = textoABuscar.trim()
    if (t.isEmpty()) return
    haptico.performHapticFeedback(HapticFeedbackType.LongPress)
    ambito.launch(Dispatchers.IO) {
      try {
        Api.enviarALaTele(t)
        estadoEnvio = "Enviado a la tele"
      } catch (_: Exception) {
        estadoEnvio = "Error al enviar"
      }
    }
    textoABuscar = ""
  }

  Column(
    Modifier
      .fillMaxSize()
      .navigationBarsPadding()
      .padding(horizontal = 20.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Spacer(Modifier.height(8.dp))

    Text(
      "Control directo para Samsung Smart TV",
      color = TextoTenue,
      fontSize = 13.sp,
    )

    Spacer(Modifier.height(24.dp))

    // Cruceta D-pad direccional
    Box(
      Modifier
        .size(260.dp)
        .clip(CircleShape)
        .background(
          Brush.radialGradient(
            listOf(Color(0xFF22242D), Color(0xFF16171E)),
          )
        )
        .border(1.2.dp, Color(0x33FFFFFF), CircleShape),
      contentAlignment = Alignment.Center,
    ) {
      // Botón Arriba
      BotonDireccion(
        simbolo = "▲",
        modifier = Modifier
          .align(Alignment.TopCenter)
          .padding(top = 14.dp),
      ) { pulsar("arriba") }

      // Botón Abajo
      BotonDireccion(
        simbolo = "▼",
        modifier = Modifier
          .align(Alignment.BottomCenter)
          .padding(bottom = 14.dp),
      ) { pulsar("abajo") }

      // Botón Izquierda
      BotonDireccion(
        simbolo = "◀",
        modifier = Modifier
          .align(Alignment.CenterStart)
          .padding(start = 14.dp),
      ) { pulsar("izquierda") }

      // Botón Derecha
      BotonDireccion(
        simbolo = "▶",
        modifier = Modifier
          .align(Alignment.CenterEnd)
          .padding(end = 14.dp),
      ) { pulsar("derecha") }

      // Botón Central OK
      Box(
        Modifier
          .size(92.dp)
          .clip(CircleShape)
          .background(Realce)
          .clickable { pulsar("ok") },
        contentAlignment = Alignment.Center,
      ) {
        Text(
          "OK",
          color = Color(0xFF15100A),
          fontSize = 19.sp,
          fontWeight = FontWeight.Bold,
        )
      }
    }

    Spacer(Modifier.height(28.dp))

    // Fila de acciones principales (Atrás, Play/Pause)
    Row(
      Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceEvenly,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      BotonAccionMando(etiqueta = "Atrás", icono = "↺") { pulsar("atras") }
      BotonAccionMando(etiqueta = "Play / Pausa", icono = "⏯") { pulsar("play_pause") }
    }

    Spacer(Modifier.height(28.dp))

    // Entrada rápida de texto hacia la tele
    Column(
      Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(16.dp))
        .background(FondoTarjeta)
        .border(0.8.dp, Color(0x22FFFFFF), RoundedCornerShape(16.dp))
        .padding(16.dp),
    ) {
      Text(
        "Teclado en la tele",
        color = Texto,
        fontSize = 14.sp,
        fontWeight = FontWeight.SemiBold,
      )
      Spacer(Modifier.height(4.dp))
      Text(
        "Escribe aquí para no tener que pulsar letra a letra en el salón:",
        color = TextoTenue,
        fontSize = 12.sp,
      )
      Spacer(Modifier.height(10.dp))

      Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        OutlinedTextField(
          value = textoABuscar,
          onValueChange = { textoABuscar = it; estadoEnvio = "" },
          placeholder = { Text("Título a buscar…", color = TextoTenue, fontSize = 14.sp) },
          singleLine = true,
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
          keyboardActions = KeyboardActions(onSend = { enviarTexto() }),
          colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Realce,
            unfocusedBorderColor = Color(0x33FFFFFF),
            focusedTextColor = Texto,
            unfocusedTextColor = Texto,
          ),
          modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(10.dp))
        Box(
          Modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (textoABuscar.isNotBlank()) Realce else Color(0x22FFFFFF))
            .clickable(enabled = textoABuscar.isNotBlank()) { enviarTexto() }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
          Text(
            "Enviar",
            color = if (textoABuscar.isNotBlank()) Color(0xFF15100A) else TextoTenue,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
          )
        }
      }

      if (estadoEnvio.isNotEmpty()) {
        Spacer(Modifier.height(6.dp))
        Text(estadoEnvio, color = Realce, fontSize = 12.sp)
      }
    }
  }
}

@Composable
private fun BotonDireccion(
  simbolo: String,
  modifier: Modifier = Modifier,
  alPulsar: () -> Unit,
) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsado by pulsacion.collectIsPressedAsState()
  Box(
    modifier
      .size(56.dp)
      .scale(if (pulsado) 0.92f else 1f)
      .clip(CircleShape)
      .background(if (pulsado) Color(0x44FFFFFF) else Color.Transparent)
      .clickable(
        interactionSource = pulsacion,
        indication = null,
      ) { alPulsar() },
    contentAlignment = Alignment.Center,
  ) {
    Text(
      simbolo,
      color = if (pulsado) Realce else Texto,
      fontSize = 20.sp,
      fontWeight = FontWeight.Bold,
    )
  }
}

@Composable
private fun BotonAccionMando(
  etiqueta: String,
  icono: String,
  alPulsar: () -> Unit,
) {
  val pulsacion = remember { MutableInteractionSource() }
  val pulsado by pulsacion.collectIsPressedAsState()
  Column(
    horizontalAlignment = Alignment.CenterHorizontally,
    modifier = Modifier
      .scale(if (pulsado) 0.94f else 1f)
      .clip(RoundedCornerShape(16.dp))
      .background(FondoTarjeta)
      .border(0.8.dp, Color(0x22FFFFFF), RoundedCornerShape(16.dp))
      .clickable(
        interactionSource = pulsacion,
        indication = null,
      ) { alPulsar() }
      .padding(horizontal = 24.dp, vertical = 14.dp),
  ) {
    Text(icono, fontSize = 24.sp, color = if (pulsado) Realce else Texto)
    Spacer(Modifier.height(4.dp))
    Text(etiqueta, color = TextoSuave, fontSize = 12.sp, fontWeight = FontWeight.Medium)
  }
}
