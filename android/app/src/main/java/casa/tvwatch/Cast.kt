package casa.tvwatch

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.drawable.DrawableCompat
import androidx.mediarouter.app.MediaRouteButton
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Servidor
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider
import com.google.android.gms.cast.framework.media.CastMediaOptions
import com.google.android.gms.cast.framework.media.NotificationOptions
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.cast.framework.media.widget.ExpandedControllerActivity
import com.google.android.gms.common.images.WebImage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * Chromecast.
 *
 * Se usa el receptor por defecto de Google, que reproduce HLS con H.264 y AAC:
 * justo lo que el servidor ya sirve en `/hls/master.m3u8` para ver fuera de
 * casa desde el navegador. Así el Chromecast no necesita nada nuestro
 * instalado y funciona igual en la tele de un amigo.
 *
 * El aparato pide los trozos directamente al servidor, así que el token va en
 * la URL (el servidor lo acepta ahí desde la aplicación de la tele) y la
 * dirección tiene que ser una que el Chromecast alcance: en casa la local, y
 * fuera la pública.
 *
 * Subtítulos: el receptor por defecto acepta pistas WebVTT aparte, así que se
 * le pasan las mismas que usa la aplicación y se eligen desde su pantalla de
 * control. Sonido: por defecto AAC estéreo, que suena en cualquier sitio; con
 * «5.1» activado el servidor manda AC3/DD+ tal cual (con su Atmos si lo trae)
 * y el Chromecast lo pasa por HDMI. Si la tele o la barra no lo descodifican,
 * silencio: por eso es una opción y no lo normal.
 */

/** Lo que el SDK de Cast lee al arrancar, por el `meta-data` del manifiesto. */
class OpcionesDeCast : OptionsProvider {
  override fun getCastOptions(context: Context): CastOptions {
    val aviso = NotificationOptions.Builder()
      .setTargetActivityClassName(ControlDeCast::class.java.name)
      .build()
    val medios = CastMediaOptions.Builder()
      .setNotificationOptions(aviso)
      .setExpandedControllerActivityClassName(ControlDeCast::class.java.name)
      .build()
    return CastOptions.Builder()
      .setReceiverApplicationId("CC1AD845") // el receptor de medios por defecto
      .setCastMediaOptions(medios)
      .setStopReceiverApplicationWhenEndingSession(true)
      .build()
  }

  override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}

/** La pantalla de control mientras se emite: la del SDK, con nuestro tema. */
class ControlDeCast : ExpandedControllerActivity()

object Cast {

  /** La sesión de Chromecast en curso, si la hay. */
  fun sesion(context: Context): CastSession? = try {
    CastContext.getSharedInstance(context).sessionManager.currentCastSession?.takeIf { it.isConnected }
  } catch (e: Exception) {
    // Sin servicios de Google (una tableta china, un emulador pelado) no hay Cast.
    null
  }

  fun emitiendo(context: Context): Boolean = sesion(context) != null

  /**
   * Mandar una película o episodio al Chromecast desde `desde` segundos, y
   * abrir la pantalla de control. El progreso se va apuntando en el servidor
   * cada quince segundos mientras la aplicación siga abierta.
   */
  fun emitir(context: Context, fileId: Int, itemId: Int, episodioId: Int?, titulo: String, desde: Double) {
    val s = sesion(context) ?: return
    val cliente = s.remoteMediaClient ?: return
    val base = Servidor.baseCacheada()
    val token = Ajustes.token ?: return
    val surround = Ajustes.castCincoUno

    // La lista de subtítulos se pide al servidor: fuera del hilo principal.
    CoroutineScope(Dispatchers.Main).launch {
    // Los subtítulos, como pistas aparte. Si esto falla no se emite sin ellos
    // en silencio: se emite igual, que es lo que importa.
    val pistas = try {
      withContext(Dispatchers.IO) { Api.infoDeReproduccion(fileId) }.subtitles.mapIndexed { i, st ->
        com.google.android.gms.cast.MediaTrack.Builder((i + 1).toLong(), com.google.android.gms.cast.MediaTrack.TYPE_TEXT)
          .setSubtype(com.google.android.gms.cast.MediaTrack.SUBTYPE_SUBTITLES)
          .setName(casa.tvwatch.ui.idiomaLegible(st.language) + (if (st.forced) " (forzados)" else ""))
          .setLanguage(st.language ?: "und")
          .setContentType("text/vtt")
          .setContentId("$base/api/play/$fileId/subtitle/${st.id}.vtt?token=$token")
          .build()
      }
    } catch (e: Exception) {
      emptyList()
    }

    val meta = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
      putString(MediaMetadata.KEY_TITLE, titulo)
      addImage(WebImage(Uri.parse(Api.imagen(itemId, "poster", 600) + "&token=$token")))
      addImage(WebImage(Uri.parse(Api.imagen(itemId, "fanart", 1280) + "&token=$token")))
    }
    val info = MediaInfo.Builder("$base/api/play/$fileId/hls/master.m3u8?token=$token" + (if (surround) "&surround=1" else ""))
      .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
      .setContentType("application/x-mpegURL")
      .setMetadata(meta)
      .setMediaTracks(pistas)
      .setTextTrackStyle(
        com.google.android.gms.cast.TextTrackStyle().apply {
          foregroundColor = 0xFFFFFFFF.toInt()
          backgroundColor = 0x66000000
          edgeType = com.google.android.gms.cast.TextTrackStyle.EDGE_TYPE_DROP_SHADOW
          fontScale = 1.1f
        },
      )
      .build()

    cliente.load(
      MediaLoadRequestData.Builder()
        .setMediaInfo(info)
        .setAutoplay(true)
        .setCurrentTime((desde * 1000).toLong())
        .build(),
    )
    apuntarProgreso(cliente, itemId, episodioId)
    context.startActivity(Intent(context, ControlDeCast::class.java))
    }
  }

  private var oyente: RemoteMediaClient.ProgressListener? = null

  private fun apuntarProgreso(cliente: RemoteMediaClient, itemId: Int, episodioId: Int?) {
    oyente?.let { cliente.removeProgressListener(it) }
    val nuevo = RemoteMediaClient.ProgressListener { posicionMs, duracionMs ->
      if (posicionMs > 5_000 && duracionMs > 0) {
        CoroutineScope(Dispatchers.IO).launch {
          try {
            Api.guardarProgreso(itemId, episodioId, posicionMs / 1000.0, duracionMs / 1000.0)
          } catch (e: Exception) { /* al siguiente */ }
        }
      }
    }
    oyente = nuevo
    cliente.addProgressListener(nuevo, 15_000)
  }
}

/**
 * El botón de Cast. Es una vista clásica del SDK —la de Compose no existe— y
 * se esconde sola cuando no hay ningún Chromecast en la red, así que no
 * estorba en casa de nadie que no tenga uno.
 */
@Composable
fun BotonDeCast(modifier: Modifier = Modifier, color: Color = Color.White) {
  AndroidView(
    modifier = modifier,
    factory = { ctx ->
      MediaRouteButton(ctx).also { boton ->
        try {
          CastButtonFactory.setUpMediaRouteButton(ctx.applicationContext, boton)
          // El icono del SDK sale gris oscuro; sobre negro no se ve. Blanco.
          androidx.core.content.ContextCompat.getDrawable(ctx, androidx.mediarouter.R.drawable.mr_button_dark)?.let { d ->
            val teñido = DrawableCompat.wrap(d.mutate())
            DrawableCompat.setTint(teñido, color.toArgb())
            boton.setRemoteIndicatorDrawable(teñido)
          }
        } catch (e: Exception) {
          boton.visibility = android.view.View.GONE
        }
      }
    },
  )
}
