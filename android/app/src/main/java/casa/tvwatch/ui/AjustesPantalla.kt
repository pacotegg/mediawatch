package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Calidad
import casa.tvwatch.datos.Registro
import casa.tvwatch.datos.Servidor

@Composable
fun PantallaAjustes(
  alIrADescargas: () -> Unit,
  alOrdenarMenu: () -> Unit,
  alCerrarSesion: () -> Unit,
) {
  val contexto = LocalContext.current
  val version = remember {
    try {
      contexto.packageManager.getPackageInfo(contexto.packageName, 0).versionName ?: ""
    } catch (_: Exception) {
      ""
    }
  }

  var calidadCasa by remember { mutableStateOf(Ajustes.calidadCasa) }
  var calidadFuera by remember { mutableStateOf(Ajustes.calidadFuera) }
  var encaje by remember { mutableStateOf(Ajustes.encajeVideo) }
  var castCincoUno by remember { mutableStateOf(Ajustes.castCincoUno) }

  var descargasSoloWifi by remember { mutableStateOf(Ajustes.descargasSoloWifi) }
  var calidadDescarga by remember { mutableStateOf(Ajustes.calidadDescargaDefecto) }

  var modoAudio by remember { mutableStateOf(Ajustes.modoAudio) }
  var idiomaAudio by remember { mutableStateOf(if (Ajustes.idiomaAudioPreferido == "spa") "spa" else "orig") }
  var informesTecnicos by remember { mutableStateOf(Ajustes.informesTecnicos) }

  // Diálogo selector genérico
  var dialogoOpciones by remember { mutableStateOf<DialogoConfig?>(null) }

  if (dialogoOpciones != null) {
    val d = dialogoOpciones!!
    AlertDialog(
      onDismissRequest = { dialogoOpciones = null },
      containerColor = FondoTarjeta,
      title = { Text(d.titulo, color = Texto, fontWeight = FontWeight.Bold) },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          d.opciones.forEach { (valor, etiqueta) ->
            Row(
              Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .clickable {
                  d.alElegir(valor)
                  dialogoOpciones = null
                }
                .padding(vertical = 6.dp, horizontal = 4.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              RadioButton(
                selected = valor == d.seleccionado,
                onClick = null,
                colors = RadioButtonDefaults.colors(
                  selectedColor = Realce,
                  unselectedColor = TextoTenue,
                ),
              )
              Text(
                etiqueta,
                color = if (valor == d.seleccionado) Realce else Texto,
                fontSize = 15.sp,
                modifier = Modifier.padding(start = 10.dp),
              )
            }
          }
        }
      },
      confirmButton = {
        OutlinedButton(onClick = { dialogoOpciones = null }) {
          Text("Cerrar", color = Texto)
        }
      },
    )
  }

  Column(
    Modifier
      .fillMaxSize()
      .background(Fondo)
      .verticalScroll(rememberScrollState())
      .padding(horizontal = Aire.borde, vertical = 12.dp),
  ) {
    Text(
      "Opciones",
      color = Texto,
      style = MaterialTheme.typography.headlineMedium,
      fontWeight = FontWeight.Bold,
    )
    Spacer(Modifier.height(4.dp))
    Text("Ajustes de reproducción, descargas y red.", color = TextoTenue, fontSize = 13.sp)
    Spacer(Modifier.height(18.dp))

    // 1. VÍDEO Y REPRODUCCIÓN
    SeccionAjustes("Vídeo y Reproducción") {
      FilaSeleccion(
        titulo = "Calidad en casa (Wi-Fi)",
        valor = calidadCasa.etiqueta,
      ) {
        dialogoOpciones = DialogoConfig(
          titulo = "Calidad en casa (Wi-Fi)",
          seleccionado = calidadCasa.name,
          opciones = Calidad.entries.map { it.name to it.etiqueta },
          alElegir = {
            val c = Calidad.deNombre(it) ?: Calidad.ORIGINAL
            calidadCasa = c
            Ajustes.calidadCasa = c
          },
        )
      }

      FilaSeleccion(
        titulo = "Calidad fuera de casa (datos)",
        valor = calidadFuera.etiqueta,
      ) {
        dialogoOpciones = DialogoConfig(
          titulo = "Calidad fuera de casa",
          seleccionado = calidadFuera.name,
          opciones = Calidad.entries.filter { it != Calidad.ORIGINAL }.map { it.name to it.etiqueta },
          alElegir = {
            val c = Calidad.deNombre(it) ?: Calidad.ALTA
            calidadFuera = c
            Ajustes.calidadFuera = c
          },
        )
      }

      val etiquetasEncaje = mapOf(
        "AJUSTAR" to "Original (bandas negras)",
        "RELLENAR" to "Rellenar (recorte sin barras)",
        "ESTIRAR" to "Estirar a pantalla completa",
      )
      FilaSeleccion(
        titulo = "Formato de pantalla",
        valor = etiquetasEncaje[encaje] ?: "Original",
      ) {
        dialogoOpciones = DialogoConfig(
          titulo = "Formato de pantalla",
          seleccionado = encaje,
          opciones = etiquetasEncaje.map { it.key to it.value },
          alElegir = {
            encaje = it
            Ajustes.encajeVideo = it
          },
        )
      }

      FilaInterruptor(
        titulo = "Chromecast: sonido 5.1",
        subtitulo = "Actívalo solo si la tele o barra descodifica Dolby Surround.",
        activo = castCincoUno,
        alCambiar = {
          castCincoUno = it
          Ajustes.castCincoUno = it
        },
      )
    }

    Spacer(Modifier.height(16.dp))

    // 2. DESCARGAS
    SeccionAjustes("Descargas sin conexión") {
      val etiquetasDescargas = mapOf(
        "preguntar" to "Preguntar siempre al pulsar",
        "original" to "Fichero original",
        "fhd" to "Full HD · 1080p",
        "tablet" to "HD · 720p",
        "movil" to "Móvil · 480p",
        "baja" to "Muy ligera · 360p",
      )
      FilaSeleccion(
        titulo = "Calidad de descarga preferida",
        valor = etiquetasDescargas[calidadDescarga] ?: "Preguntar siempre",
      ) {
        dialogoOpciones = DialogoConfig(
          titulo = "Calidad de descarga preferida",
          seleccionado = calidadDescarga,
          opciones = etiquetasDescargas.map { it.key to it.value },
          alElegir = {
            calidadDescarga = it
            Ajustes.calidadDescargaDefecto = it
          },
        )
      }

      FilaInterruptor(
        titulo = "Descargar solo con Wi-Fi",
        subtitulo = "Evita consumir datos móviles al descargar copias sin conexión.",
        activo = descargasSoloWifi,
        alCambiar = {
          descargasSoloWifi = it
          Ajustes.descargasSoloWifi = it
        },
      )

      FilaBoton(
        titulo = "Ver descargas guardadas",
        detalle = "Gestionar espacio y copias",
        alPulsar = alIrADescargas,
      )
    }

    Spacer(Modifier.height(16.dp))

    // 3. MODO DE AUDIO
    SeccionAjustes("Modo de Audio") {
      val opcionesIdiomaAudio = listOf(
        "spa" to "Español (si el fichero lo trae)",
        "orig" to "El primero del fichero",
      )
      FilaSeleccion(
        titulo = "Idioma de audio",
        valor = opcionesIdiomaAudio.firstOrNull { it.first == idiomaAudio }?.second ?: "Español",
      ) {
        dialogoOpciones = DialogoConfig(
          titulo = "Idioma de audio",
          seleccionado = idiomaAudio,
          opciones = opcionesIdiomaAudio,
          alElegir = {
            idiomaAudio = it
            Ajustes.idiomaAudioPreferido = it
          },
        )
      }

      val opcionesModoAudio = listOf(
        "normal" to "Normal (mezcla original)",
        "dialogue" to "Realzar diálogos",
        "night" to "Modo nocturno (comprime explosiones)",
      )
      FilaSeleccion(
        titulo = "Modo de audio",
        valor = opcionesModoAudio.firstOrNull { it.first == modoAudio }?.second ?: "Normal",
      ) {
        dialogoOpciones = DialogoConfig(
          titulo = "Modo de audio",
          seleccionado = modoAudio,
          opciones = opcionesModoAudio,
          alElegir = {
            modoAudio = it
            Ajustes.modoAudio = it
          },
        )
      }
    }

    Spacer(Modifier.height(16.dp))

    // 4. SERVIDOR Y CUENTA
    SeccionAjustes("Servidor y Cuenta") {
      val enCasa = Servidor.enCasa()
      val direccion = Servidor.baseCacheada().removePrefix("https://").removePrefix("http://")

      Column(Modifier.padding(vertical = 4.dp)) {
        Text("Perfil activo", color = TextoTenue, fontSize = 12.sp)
        Text(
          Ajustes.perfil.ifEmpty { "Invitado" } + if (Ajustes.esAdmin) " (Administrador)" else "",
          color = Texto,
          fontSize = 15.sp,
          fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Text("Conexión", color = TextoTenue, fontSize = 12.sp)
        Text(
          (if (enCasa) "Red de casa (local)" else "Conexión remota") + " · " + direccion,
          color = TextoSuave,
          fontSize = 14.sp,
        )
      }

      Spacer(Modifier.height(10.dp))

      FilaInterruptor(
        titulo = "Enviar informes técnicos",
        subtitulo = "Manda al servidor errores y tiempos de conexión para poder arreglar fallos. Sin contraseñas ni lo que ves.",
        activo = informesTecnicos,
        alCambiar = {
          informesTecnicos = it
          Ajustes.informesTecnicos = it
        },
      )
      if (informesTecnicos) {
        FilaBoton(
          titulo = "Enviar el registro ahora",
          detalle = "Por si algo falla y quieres que lo vea quien administra el servidor",
          alPulsar = { Registro.enviarAhora() },
        )
      }

      Spacer(Modifier.height(10.dp))

      FilaBoton(
        titulo = "Reordenar el menú",
        detalle = "Cambiar el orden de las secciones y bibliotecas, o esconderlas",
        alPulsar = alOrdenarMenu,
      )

      FilaBoton(
        titulo = "Cambiar de perfil o servidor",
        detalle = "Cerrar sesión actual",
        destacado = true,
        alPulsar = alCerrarSesion,
      )

      if (version.isNotEmpty()) {
        Spacer(Modifier.height(8.dp))
        Text(
          "Media Watch v$version",
          color = TextoTenue,
          fontSize = 12.sp,
          modifier = Modifier.padding(top = 4.dp),
        )
      }
    }

    Spacer(Modifier.height(30.dp))
  }
}

private data class DialogoConfig(
  val titulo: String,
  val seleccionado: String,
  val opciones: List<Pair<String, String>>,
  val alElegir: (String) -> Unit,
)

@Composable
private fun SeccionAjustes(titulo: String, contenido: @Composable () -> Unit) {
  Text(
    titulo.uppercase(),
    color = Realce,
    fontSize = 12.sp,
    fontWeight = FontWeight.SemiBold,
    letterSpacing = 0.5.sp,
    modifier = Modifier.padding(start = 4.dp, bottom = 8.dp),
  )
  Column(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(Esquinas.panel))
      .background(FondoTarjeta)
      .padding(horizontal = 16.dp, vertical = 12.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    contenido()
  }
}

@Composable
private fun FilaSeleccion(
  titulo: String,
  valor: String,
  alPulsar: () -> Unit,
) {
  Row(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .clickable(onClick = alPulsar)
      .padding(vertical = 4.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f)) {
      Text(titulo, color = Texto, fontSize = 15.sp, fontWeight = FontWeight.Normal)
      Text(valor, color = Realce, fontSize = 13.sp)
    }
    Text("›", color = TextoTenue, fontSize = 20.sp, modifier = Modifier.padding(start = 8.dp))
  }
}

@Composable
private fun FilaInterruptor(
  titulo: String,
  subtitulo: String? = null,
  activo: Boolean,
  alCambiar: (Boolean) -> Unit,
) {
  Row(
    Modifier
      .fillMaxWidth()
      .padding(vertical = 4.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f).padding(end = 12.dp)) {
      Text(titulo, color = Texto, fontSize = 15.sp)
      if (!subtitulo.isNullOrBlank()) {
        Text(subtitulo, color = TextoTenue, fontSize = 12.sp, lineHeight = 16.sp)
      }
    }
    Switch(
      checked = activo,
      onCheckedChange = alCambiar,
      colors = SwitchDefaults.colors(
        checkedThumbColor = SobreRealce,
        checkedTrackColor = Realce,
        uncheckedThumbColor = TextoSuave,
        uncheckedTrackColor = FondoAlto,
      ),
    )
  }
}

@Composable
private fun FilaBoton(
  titulo: String,
  detalle: String? = null,
  destacado: Boolean = false,
  alPulsar: () -> Unit,
) {
  Row(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(8.dp))
      .clickable(onClick = alPulsar)
      .padding(vertical = 6.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f)) {
      Text(
        titulo,
        color = if (destacado) Realce else Texto,
        fontSize = 15.sp,
        fontWeight = FontWeight.Medium,
      )
      if (!detalle.isNullOrBlank()) {
        Text(detalle, color = TextoTenue, fontSize = 12.sp)
      }
    }
    Text("›", color = if (destacado) Realce else TextoTenue, fontSize = 20.sp)
  }
}
