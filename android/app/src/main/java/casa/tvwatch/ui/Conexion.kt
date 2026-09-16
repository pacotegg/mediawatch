package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Perfil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Conectar con el servidor de casa y elegir perfil.
 *
 * Sale la primera vez y cuando la sesión deja de valer. Se comprueba la
 * dirección antes de darla por buena: escribir un número mal y quedarse
 * mirando una pantalla vacía sin saber si falla la dirección, el wifi o el
 * servidor es exactamente lo que no debe pasar.
 */
@Composable
fun PantallaConexion(alEntrar: () -> Unit) {
  var direccion by remember { mutableStateOf(Ajustes.servidor.ifEmpty { "" }) }
  var perfiles by remember { mutableStateOf<List<Perfil>>(emptyList()) }
  var pin by remember { mutableStateOf("") }
  var perfilElegido by remember { mutableStateOf<Perfil?>(null) }
  var estado by remember { mutableStateOf("") }
  var ocupado by remember { mutableStateOf(false) }
  val ambito = rememberCoroutineScope()

  fun buscarServidor() {
    val url = Ajustes.normalizar(direccion)
    if (url.isEmpty()) { estado = "Escribe la dirección."; return }
    ocupado = true
    estado = "Buscando el servidor en $url…"
    ambito.launch {
      try {
        Ajustes.servidor = url
        val lista = withContext(Dispatchers.IO) { Api.perfiles() }
        perfiles = lista.users
        /*
         * De paso se le pregunta al servidor su dirección de fuera y se guarda.
         * Solo la da estando en casa, que es justo cuando se configura esto: a
         * partir de aquí el móvil sabe volver a entrar desde la calle sin que
         * nadie le escriba nada, como hacen las apps de Plex.
         */
        try {
          val quien = withContext(Dispatchers.IO) { Api.quienEs() }
          if (quien.publica.isNotEmpty()) Ajustes.servidorFuera = quien.publica
        } catch (e: Exception) {
          /* un servidor sin dirección pública es perfectamente normal */
        }
        estado = when {
          lista.users.isEmpty() -> "El servidor no tiene ningún perfil todavía."
          Ajustes.servidorFuera.isNotEmpty() -> "Encontrado. Fuera de casa entrará por " +
            Ajustes.servidorFuera.removePrefix("https://").removePrefix("http://") + "."
          else -> ""
        }
      } catch (e: Exception) {
        perfiles = emptyList()
        estado = e.message ?: "No se pudo conectar."
      } finally {
        ocupado = false
      }
    }
  }

  fun entrar(p: Perfil) {
    ocupado = true
    estado = ""
    ambito.launch {
      try {
        withContext(Dispatchers.IO) { Api.entrar(p.id, pin.ifBlank { null }) }
        Ajustes.perfil = p.name
        Ajustes.esAdmin = p.esAdmin == 1
        alEntrar()
      } catch (e: Exception) {
        estado = e.message ?: "No se pudo entrar."
      } finally {
        ocupado = false
      }
    }
  }

  Column(
    Modifier
      .fillMaxSize()
      .background(Fondo)
      .verticalScroll(rememberScrollState())
      .imePadding()
      .padding(horizontal = 28.dp, vertical = 56.dp),
  ) {
    Text("Media Watch", color = Texto, fontSize = 34.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(8.dp))
    Text(
      "La dirección del servidor de casa: la del ordenador y el puerto 8730.",
      color = TextoSuave,
      fontSize = 14.sp,
    )

    Spacer(Modifier.height(24.dp))
    OutlinedTextField(
      value = direccion,
      onValueChange = { direccion = it; perfiles = emptyList() },
      singleLine = true,
      label = { Text("Servidor") },
      placeholder = { Text("192.168.1.20 en casa, o el dominio desde fuera") },
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
      keyboardActions = KeyboardActions(onGo = { buscarServidor() }),
      modifier = Modifier.fillMaxWidth(),
    )

    Spacer(Modifier.height(14.dp))
    Button(onClick = { buscarServidor() }, enabled = !ocupado, modifier = Modifier.fillMaxWidth()) {
      Text(if (perfiles.isEmpty()) "Buscar el servidor" else "Volver a buscar")
    }

    if (perfiles.isNotEmpty()) {
      Spacer(Modifier.height(30.dp))
      Text("¿Quién está viendo?", color = Texto, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
      Spacer(Modifier.height(14.dp))
      perfiles.forEach { p ->
        Row(
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (perfilElegido?.id == p.id) Color(0x22E0A340) else FondoTarjeta)
            .clickable {
              perfilElegido = p
              if (p.tienePin == 0) entrar(p)
            }
            .padding(14.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Box(
            Modifier
              .size(38.dp)
              .clip(CircleShape)
              .background(colorDePerfil(p.color)),
            contentAlignment = Alignment.Center,
          ) {
            Text(p.name.take(1).uppercase(), color = Color(0xFF15100A), fontWeight = FontWeight.Bold)
          }
          Spacer(Modifier.width(14.dp))
          Column {
            Text(p.name, color = Texto, fontSize = 16.sp)
            if (p.tienePin == 1) Text("Pide PIN", color = TextoTenue, fontSize = 12.sp)
          }
        }
        Spacer(Modifier.height(10.dp))
      }

      val elegido = perfilElegido
      if (elegido != null && elegido.tienePin == 1) {
        OutlinedTextField(
          value = pin,
          onValueChange = { pin = it.filter { c -> c.isDigit() }.take(8) },
          singleLine = true,
          label = { Text("PIN de ${elegido.name}") },
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Go),
          keyboardActions = KeyboardActions(onGo = { entrar(elegido) }),
          modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        Button(onClick = { entrar(elegido) }, enabled = !ocupado, modifier = Modifier.fillMaxWidth()) {
          Text("Entrar")
        }
      }
    }

    if (estado.isNotEmpty()) {
      Spacer(Modifier.height(20.dp))
      Text(estado, color = Realce, fontSize = 14.sp)
    }
  }
}

private fun colorDePerfil(hex: String?): Color =
  try {
    if (hex.isNullOrBlank()) Realce else Color(android.graphics.Color.parseColor(hex))
  } catch (e: Exception) {
    Realce
  }
