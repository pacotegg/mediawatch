package casa.tvwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Extra

/*
 * Los extras de un título: featurettes, «cómo se hizo», escenas eliminadas.
 * 1.111 ficheros repartidos por 126 títulos que el escáner venía ignorando.
 *
 * Dos niveles cuando son muchos —Breaking Bad tiene 143, ya repartidos por
 * temporada en el disco—: primero las secciones y dentro los vídeos. Con pocos
 * se entra directo, que para seis un menú de paso sobra.
 */

private const val DIRECTO = 10

private fun seccionDe(e: Extra) = if (e.grupo != null) "${e.tipo} · ${e.grupo}" else e.tipo

private fun minutos(segundos: Double?): String {
  if (segundos == null || segundos <= 0) return ""
  val m = Math.round(segundos / 60).toInt()
  return if (m >= 60) "${m / 60} h ${m % 60} min" else "$m min"
}

@Composable
fun DialogoDeExtras(extras: List<Extra>, alCerrar: () -> Unit) {
  var seccion by remember { mutableStateOf<String?>(null) }
  var viendo by remember { mutableStateOf<Extra?>(null) }

  val secciones = remember(extras) { extras.map { seccionDe(it) }.distinct() }
  val porSecciones = extras.size > DIRECTO && secciones.size > 1
  val visibles = remember(seccion, extras) {
    val s = seccion
    if (s == null) extras else extras.filter { seccionDe(it) == s }
  }

  AlertDialog(
    onDismissRequest = alCerrar,
    title = { Text(seccion ?: "Extras") },
    text = {
      if (porSecciones && seccion == null) {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
          items(secciones) { nombre ->
            val cuantos = extras.count { seccionDe(it) == nombre }
            Row(
              Modifier
                .fillMaxWidth()
                .clickable { seccion = nombre }
                .padding(vertical = 14.dp),
              horizontalArrangement = Arrangement.SpaceBetween,
            ) {
              Text(nombre, style = MaterialTheme.typography.bodyLarge)
              Text("$cuantos", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
            }
          }
        }
      } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
          items(visibles) { e ->
            Row(
              Modifier
                .fillMaxWidth()
                .clickable { viendo = e },
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Box(
                Modifier
                  .height(62.dp)
                  .aspectRatio(16f / 9f)
                  .clip(RoundedCornerShape(8.dp))
                  .background(MaterialTheme.colorScheme.surfaceVariant),
              ) {
                Imagen(Api.miniaturaDeExtra(e.id), null, Modifier.fillMaxSize())
              }
              Spacer(Modifier.fillMaxWidth(0.04f))
              Column(Modifier.fillMaxWidth()) {
                Text(e.titulo, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val pie = listOf(e.tipo, minutos(e.duration)).filter { it.isNotEmpty() }.joinToString(" · ")
                Text(pie, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
              }
            }
          }
        }
      }
    },
    confirmButton = {
      TextButton(onClick = alCerrar) { Text("Cerrar") }
    },
    dismissButton = {
      if (seccion != null) TextButton(onClick = { seccion = null }) { Text("Volver") }
    },
  )

  viendo?.let { extra ->
    ReproductorDeExtra(extra) { viendo = null }
  }
}

/**
 * Un extra se ve y ya: ni progreso, ni reanudar, ni Cast. Es un vídeo corto que
 * acompaña a la película, no la película, así que no usa el reproductor grande
 * ni su servicio de sesión de medios.
 */
@Composable
private fun ReproductorDeExtra(extra: Extra, alCerrar: () -> Unit) {
  val contexto = LocalContext.current
  val reproductor = remember {
    val fuente = DataSource.Factory {
      DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(15_000)
        .setReadTimeoutMs(30_000)
        .setDefaultRequestProperties(buildMap { Ajustes.token?.let { put("Authorization", "Bearer $it") } })
        .createDataSource()
    }
    ExoPlayer.Builder(contexto)
      .setMediaSourceFactory(DefaultMediaSourceFactory(fuente))
      .build()
      .apply {
        setMediaItem(MediaItem.fromUri(Api.urlDeExtra(extra.id)))
        prepare()
        playWhenReady = true
      }
  }

  // Sin esto el audio sigue sonando tras cerrar la ventana.
  DisposableEffect(Unit) { onDispose { reproductor.release() } }

  Dialog(onDismissRequest = alCerrar, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
      AndroidView(
        factory = { ctx -> PlayerView(ctx).apply { player = reproductor; useController = true } },
        modifier = Modifier.fillMaxWidth(),
      )
      TextButton(onClick = alCerrar, modifier = Modifier.align(Alignment.TopEnd).padding(12.dp)) {
        Text("Cerrar", color = Color.White)
      }
    }
  }
}
