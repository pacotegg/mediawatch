package casa.tvwatch.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.AparatoActividad
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/**
 * «Quién está viendo», solo para administradores: lo mismo que Ajustes → Actividad de la web (`GET /api/actividad`).
 * Cada aparato con sesión de las últimas 24 h, qué ve, por dónde va, si el servidor lo transcodifica, y dos acciones:
 * mandarle un mensaje (le llega en unos 5 s) o parar lo que ve. Se refresca cada 5 s, lo que tardan los reproductores
 * en informar. El servidor da el modo (directo, remux, transcodificación) y el cliente, no la calidad ni el bitrate.
 */
@Composable
fun PantallaActividad(alPerderSesion: () -> Unit) {
  val contexto = LocalContext.current
  val alcance = rememberCoroutineScope()
  var aparatos by remember { mutableStateOf<List<AparatoActividad>?>(null) }
  var fallo by remember { mutableStateOf<String?>(null) }
  var paraMensaje by remember { mutableStateOf<AparatoActividad?>(null) }
  var paraParar by remember { mutableStateOf<AparatoActividad?>(null) }
  var recarga by remember { mutableStateOf(0) }

  LaunchedEffect(recarga) {
    while (true) {
      val r = withContext(Dispatchers.IO) { runCatching { Api.actividad() } }
      r.onSuccess { aparatos = it; fallo = null }
        .onFailure {
          if (it is Api.SinSesion) { alPerderSesion(); return@LaunchedEffect }
          fallo = it.message ?: "No se pudo leer la actividad"
        }
      delay(5_000L)
    }
  }

  fun aviso(texto: String) = Toast.makeText(contexto, texto, Toast.LENGTH_SHORT).show()

  val lista = aparatos
  if (lista == null) {
    Box(Modifier.fillMaxSize().padding(24.dp)) {
      Text(fallo ?: "Cargando…", color = TextoSuave, fontSize = 14.sp)
    }
    return
  }

  val viendo = lista.filter { it.viendo != null }
  val resto = lista.filter { it.viendo == null }

  LazyColumn(
    Modifier.fillMaxSize(),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    if (fallo != null) item { Text(fallo!!, color = Color(0xFFE5705F), fontSize = 13.sp) }
    item { Cabecera("Viendo ahora", if (viendo.isEmpty()) "Nadie está viendo nada ahora mismo." else "${viendo.size} reproduciendo") }
    items(viendo, key = { it.sesion }) { TarjetaAparato(it, { paraMensaje = it }, { paraParar = it }) }
    item { Spacer(Modifier.height(6.dp)); Cabecera("Conectados", "Aparatos con sesión vistos en las últimas 24 horas") }
    items(resto, key = { it.sesion }) { TarjetaAparato(it, { paraMensaje = it }, { paraParar = it }) }
    if (resto.isEmpty()) item { Text("Ninguno.", color = TextoTenue, fontSize = 13.sp) }
  }

  paraMensaje?.let { a ->
    var texto by remember(a.sesion) { mutableStateOf("") }
    AlertDialog(
      onDismissRequest = { paraMensaje = null },
      containerColor = FondoTarjeta,
      title = { Text("Mensaje para ${a.usuario}", color = Texto, fontWeight = FontWeight.Bold) },
      text = {
        Column {
          Text("Lo verá en ${a.dispositivo ?: "su aparato"} en unos segundos.", color = TextoSuave, fontSize = 13.sp)
          Spacer(Modifier.height(8.dp))
          OutlinedTextField(value = texto, onValueChange = { texto = it.take(300) }, modifier = Modifier.fillMaxWidth(), placeholder = { Text("Escribe el mensaje…") })
        }
      },
      confirmButton = {
        TextButton(
          enabled = texto.isNotBlank(),
          onClick = {
            val t = texto.trim()
            paraMensaje = null
            alcance.launch {
              val r = withContext(Dispatchers.IO) { runCatching { Api.actividadMensaje(a.sesion, t) } }
              aviso(r.exceptionOrNull()?.message ?: "Mensaje enviado")
            }
          },
        ) { Text("Enviar", color = Realce) }
      },
      dismissButton = { TextButton(onClick = { paraMensaje = null }) { Text("Cancelar", color = TextoSuave) } },
    )
  }

  paraParar?.let { a ->
    AlertDialog(
      onDismissRequest = { paraParar = null },
      containerColor = FondoTarjeta,
      title = { Text("Parar la reproducción", color = Texto, fontWeight = FontWeight.Bold) },
      text = { Text("Se corta lo que ve ${a.usuario} en ${a.dispositivo ?: "su aparato"} y se le avisa. Puede volver a ponerlo.", color = TextoSuave) },
      confirmButton = {
        TextButton(onClick = {
          paraParar = null
          alcance.launch {
            val r = withContext(Dispatchers.IO) { runCatching { Api.actividadParar(a.sesion) } }
            aviso(r.exceptionOrNull()?.message ?: "Reproducción parada")
            recarga++
          }
        }) { Text("Parar", color = Color(0xFFE5705F)) }
      },
      dismissButton = { TextButton(onClick = { paraParar = null }) { Text("Cancelar", color = TextoSuave) } },
    )
  }
}

@Composable
private fun Cabecera(titulo: String, detalle: String) {
  Column(Modifier.padding(top = 4.dp)) {
    Text(titulo.uppercase(), color = Realce, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    Text(detalle, color = TextoTenue, fontSize = 12.sp)
  }
}

@Composable
private fun TarjetaAparato(a: AparatoActividad, alMensaje: () -> Unit, alParar: () -> Unit) {
  val v = a.viendo
  Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(FondoTarjeta).padding(12.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      if (v != null) {
        Box(Modifier.width(56.dp).height(84.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xFF0C0C10))) {
          Imagen(Api.imagen(v.itemId, "poster", 200), null, Modifier.fillMaxSize(), escala = ContentScale.Crop)
        }
      }
      Column(Modifier.weight(1f)) {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
          Box(Modifier.size(10.dp).clip(CircleShape).background(colorDePerfil(a.color)))
          Spacer(Modifier.width(8.dp))
          Text(a.usuario, color = Texto, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
          if (a.esAdmin == 1) Text("  administrador", color = TextoTenue, fontSize = 11.sp)
        }
        Text("${a.dispositivo ?: "aparato"} · ${hace(a.ultimaVez)}", color = TextoTenue, fontSize = 12.sp)
        if (v != null) {
          Spacer(Modifier.height(4.dp))
          Text(
            v.titulo + (v.episodio?.let { " · $it" } ?: ""),
            color = Texto, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
          )
          val total = v.duracion ?: 0.0
          val fraccion = if (total > 0) (v.posicion / total).coerceIn(0.0, 1.0).toFloat() else 0f
          Spacer(Modifier.height(6.dp))
          Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Color(0xFF2A2A33))) {
            Box(Modifier.fillMaxWidth(fraccion).height(4.dp).background(Realce))
          }
          Text(
            reloj(v.posicion) + (if (total > 0) " / " + reloj(total) else "") + " · " + etiquetaModo(v.modo) + (v.cliente?.let { " · $it" } ?: ""),
            color = TextoTenue, fontSize = 12.sp,
          )
        } else {
          Text("Sin reproducir nada", color = TextoTenue, fontSize = 13.sp)
        }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      TextButton(onClick = alMensaje) { Text("Mensaje", color = Realce) }
      if (v != null) TextButton(onClick = alParar) { Text("Parar", color = Color(0xFFE5705F)) }
    }
  }
}

private fun etiquetaModo(modo: String?): String = when (modo) {
  "raw", "direct" -> "directo"
  "remux" -> "reempaquetando"
  "remux-audio" -> "convirtiendo el audio"
  "transcode" -> "transcodificando"
  null, "" -> "—"
  else -> modo
}

/** «ahora», «hace 3 min», «hace 2 h», «hace 4 d», como la web. */
private fun hace(iso: String): String {
  val ms = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return ""
  val s = ((System.currentTimeMillis() - ms) / 1000).coerceAtLeast(0)
  return when {
    s < 45 -> "ahora"
    s < 3600 -> "hace ${(s + 30) / 60} min"
    s < 86400 -> "hace ${(s + 1800) / 3600} h"
    else -> "hace ${(s + 43200) / 86400} d"
  }
}

private fun colorDePerfil(hex: String?): Color =
  try {
    if (hex.isNullOrBlank()) Realce else Color(android.graphics.Color.parseColor(hex))
  } catch (e: Exception) {
    Realce
  }
