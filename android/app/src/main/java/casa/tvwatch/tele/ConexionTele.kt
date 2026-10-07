package casa.tvwatch.tele

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Perfil
import casa.tvwatch.ui.Fondo
import casa.tvwatch.ui.Realce
import casa.tvwatch.ui.Texto
import casa.tvwatch.ui.TextoSuave
import casa.tvwatch.ui.TextoTenue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Conectar, elegir perfil y teclear el PIN, con el mando.
 *
 * La dirección se escribe con el teclado de la tele (OK sobre el campo lo
 * abre). El PIN no: un teclado numérico en pantalla, como el de la Samsung,
 * porque el del sistema tapa media pantalla para escribir cuatro cifras. Los
 * números del mando, si los tiene, también valen.
 *
 * Fuera de casa el servidor solo enseña los perfiles con PIN y no dice cuántas
 * cifras tiene (`pin_len`), así que ahí se entra con «Entrar».
 */
@Composable
fun ConexionTele(alEntrar: () -> Unit) {
  var direccion by remember { mutableStateOf(Ajustes.servidor) }
  var perfiles by remember { mutableStateOf<List<Perfil>>(emptyList()) }
  var elegido by remember { mutableStateOf<Perfil?>(null) }
  var pin by remember { mutableStateOf("") }
  var estado by remember { mutableStateOf("") }
  var ocupado by remember { mutableStateOf(false) }
  val ambito = rememberCoroutineScope()

  fun buscar() {
    val url = Ajustes.normalizar(direccion)
    if (url.isEmpty()) { estado = "Escribe la dirección."; return }
    ocupado = true
    estado = "Buscando el servidor…"
    ambito.launch {
      try {
        Ajustes.servidor = url
        val lista = withContext(Dispatchers.IO) { Api.perfiles() }
        try {
          val quien = withContext(Dispatchers.IO) { Api.quienEs() }
          if (quien.publica.isNotEmpty()) Ajustes.servidorFuera = quien.publica
        } catch (_: Exception) { /* sin dirección pública, normal */ }
        perfiles = lista.users
        estado = if (lista.users.isEmpty()) "El servidor no tiene perfiles que se puedan usar desde aquí." else ""
      } catch (e: Exception) {
        perfiles = emptyList()
        estado = e.message ?: "No se pudo conectar."
      } finally {
        ocupado = false
      }
    }
  }

  fun entrar(p: Perfil) {
    if (ocupado) return
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
        pin = ""
      } finally {
        ocupado = false
      }
    }
  }

  // Si ya hay dirección guardada (la sesión caducó), a los perfiles directamente.
  LaunchedEffect(Unit) { if (direccion.isNotEmpty()) buscar() }

  Box(Modifier.fillMaxSize().background(Fondo).padding(horizontal = AireTele.lado, vertical = AireTele.arriba)) {
    val p = elegido
    when {
      p != null -> TecladoPin(
        perfil = p,
        pin = pin,
        estado = estado,
        alCambiar = { nuevo ->
          pin = nuevo
          val largo = p.largoPin
          if (largo != null && largo > 0 && nuevo.length == largo) entrar(p)
        },
        alEntrar = { entrar(p) },
        alVolver = { elegido = null; pin = ""; estado = "" },
      )
      perfiles.isNotEmpty() -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("¿Quién está viendo?", color = Texto, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(36.dp))
        val primero = remember { FocusRequester() }
        Row(horizontalArrangement = Arrangement.spacedBy(36.dp)) {
          perfiles.forEachIndexed { i, perfil ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
              Box(
                Modifier
                  .size(110.dp)
                  .then(if (i == 0) Modifier.focusRequester(primero) else Modifier)
                  .enfocable(CircleShape, aro = Color.White) {
                    pin = ""
                    estado = ""
                    if (perfil.tienePin == 0) entrar(perfil) else elegido = perfil
                  }
                  .clip(CircleShape)
                  .background(colorDePerfil(perfil.color)),
                contentAlignment = Alignment.Center,
              ) {
                Text(perfil.name.take(1).uppercase(), color = Color(0xFF15100A), fontSize = 44.sp, fontWeight = FontWeight.Bold)
              }
              Spacer(Modifier.height(12.dp))
              Text(perfil.name, color = Texto, fontSize = 17.sp)
              if (perfil.tienePin == 1) Text("PIN", color = TextoTenue, fontSize = 12.sp)
            }
          }
        }
        LaunchedEffect(perfiles) { runCatching { primero.requestFocus() } }
        Spacer(Modifier.height(40.dp))
        BotonTele("Cambiar de servidor", alPulsar = { perfiles = emptyList() })
        if (estado.isNotEmpty()) {
          Spacer(Modifier.height(16.dp))
          Text(estado, color = Realce, fontSize = 15.sp)
        }
      }
      else -> Column(Modifier.fillMaxSize().padding(horizontal = 120.dp), verticalArrangement = Arrangement.Center) {
        Text("Media Watch", color = Texto, fontSize = 38.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
          "En casa, la IP del ordenador (192.168.x.x). Fuera, el dominio del servidor.",
          color = TextoSuave,
          fontSize = 16.sp,
        )
        Spacer(Modifier.height(24.dp))
        val campo = remember { FocusRequester() }
        OutlinedTextField(
          value = direccion,
          onValueChange = { direccion = it },
          singleLine = true,
          label = { Text("Servidor") },
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
          keyboardActions = KeyboardActions(onGo = { buscar() }),
          modifier = Modifier.width(560.dp).focusRequester(campo).campoDeTele(),
        )
        LaunchedEffect(Unit) { runCatching { campo.requestFocus() } }
        Spacer(Modifier.height(20.dp))
        BotonTele(if (ocupado) "Buscando…" else "Conectar", principal = true, alPulsar = { if (!ocupado) buscar() })
        if (estado.isNotEmpty()) {
          Spacer(Modifier.height(18.dp))
          Text(estado, color = Realce, fontSize = 15.sp)
        }
      }
    }
  }
}

/** Puntos del PIN y teclado de 3×4: cifras, borrar y entrar. */
@Composable
private fun TecladoPin(
  perfil: Perfil,
  pin: String,
  estado: String,
  alCambiar: (String) -> Unit,
  alEntrar: () -> Unit,
  alVolver: () -> Unit,
) {
  val primero = remember { FocusRequester() }
  LaunchedEffect(perfil.id) { runCatching { primero.requestFocus() } }
  androidx.activity.compose.BackHandler { alVolver() }
  fun pulsar(c: String) {
    when (c) {
      "⌫" -> alCambiar(pin.dropLast(1))
      "OK" -> alEntrar()
      else -> if (pin.length < 12) alCambiar(pin + c)
    }
  }
  Column(
    Modifier
      .fillMaxSize()
      // Los números del mando teclean directamente, sin pasar por el teclado de pantalla.
      .onPreviewKeyEvent { e ->
        if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
        val cifra = when (e.key) {
          Key.Zero, Key.NumPad0 -> "0"; Key.One, Key.NumPad1 -> "1"; Key.Two, Key.NumPad2 -> "2"
          Key.Three, Key.NumPad3 -> "3"; Key.Four, Key.NumPad4 -> "4"; Key.Five, Key.NumPad5 -> "5"
          Key.Six, Key.NumPad6 -> "6"; Key.Seven, Key.NumPad7 -> "7"; Key.Eight, Key.NumPad8 -> "8"
          Key.Nine, Key.NumPad9 -> "9"; Key.Backspace, Key.Delete -> "⌫"
          else -> null
        }
        if (cifra != null) { pulsar(cifra); true } else false
      },
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Text("PIN de ${perfil.name}", color = Texto, fontSize = 26.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(18.dp))
    val largo = perfil.largoPin?.takeIf { it > 0 }
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.height(20.dp)) {
      val huecos = largo ?: maxOf(4, pin.length)
      repeat(huecos) { i ->
        Box(
          Modifier.size(16.dp).clip(CircleShape)
            .background(if (i < pin.length) Realce else Color(0x33FFFFFF)),
        )
      }
    }
    Spacer(Modifier.height(24.dp))
    val filas = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("⌫", "0", "OK"))
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
      filas.forEachIndexed { f, fila ->
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          fila.forEachIndexed { c, tecla ->
            var foco by remember { mutableStateOf(false) }
            Box(
              Modifier
                .size(width = 84.dp, height = 56.dp)
                .then(if (f == 0 && c == 0) Modifier.focusRequester(primero) else Modifier)
                .enfocable(RoundedCornerShape(12.dp), escala = 1.06f, aro = Color.Transparent, alFoco = { foco = it }) { pulsar(tecla) }
                .clip(RoundedCornerShape(12.dp))
                .background(
                  when {
                    foco -> Color.White
                    tecla == "OK" -> Realce
                    else -> Color(0x26FFFFFF)
                  },
                ),
              contentAlignment = Alignment.Center,
            ) {
              Text(
                if (tecla == "OK") "Entrar" else tecla,
                color = if (foco || tecla == "OK") Color(0xFF111114) else Texto,
                fontSize = if (tecla == "OK") 16.sp else 24.sp,
                fontWeight = FontWeight.SemiBold,
              )
            }
          }
        }
      }
    }
    Spacer(Modifier.height(18.dp))
    Text(
      estado.ifEmpty { "Atrás para elegir otro perfil" },
      color = if (estado.isNotEmpty()) Realce else TextoTenue,
      fontSize = 14.sp,
      textAlign = TextAlign.Center,
    )
  }
}

private fun colorDePerfil(hex: String?): Color =
  try {
    if (hex.isNullOrBlank()) Realce else Color(android.graphics.Color.parseColor(hex))
  } catch (_: Exception) {
    Realce
  }
