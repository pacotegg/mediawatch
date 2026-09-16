package casa.tvwatch

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import casa.tvwatch.datos.Ajustes
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors
import com.google.common.util.concurrent.ListenableFuture

/**
 * El reproductor de verdad.
 *
 * Antes vivía dentro de la pantalla de reproducción y moría con ella: al
 * apagar la pantalla o cambiar de aplicación la película se paraba, y el
 * sistema no sabía que se estaba viendo nada, así que no había controles en la
 * pantalla de bloqueo ni en la notificación. Para conciertos y documentales de
 * fondo eso es «la aplicación no sirve».
 *
 * Ahora el ExoPlayer vive aquí, en un servicio de sesión de medios. La
 * pantalla se conecta con un `MediaController` y lo maneja igual que antes;
 * el sistema ve la sesión y pone los controles donde toca —bloqueo, ajustes
 * rápidos, reloj, auriculares— sin que haya que dibujar nada.
 */
@UnstableApi
class ReproduccionService : MediaSessionService() {

  private var sesion: MediaSession? = null

  override fun onCreate() {
    super.onCreate()
    Ajustes.iniciar(this)

    /*
     * La sesión va en la cabecera de cada petición, también en las de las
     * carátulas de la notificación. Se construye la fuente cada vez para que
     * un cambio de perfil no deje el servicio con el token viejo.
     */
    val fuente = DataSource.Factory {
      DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        .setConnectTimeoutMs(15_000)
        .setReadTimeoutMs(30_000)
        .setDefaultRequestProperties(buildMap { Ajustes.token?.let { put("Authorization", "Bearer $it") } })
        .createDataSource()
    }

    val reproductor = ExoPlayer.Builder(this)
      .setMediaSourceFactory(DefaultMediaSourceFactory(fuente))
      .setSeekBackIncrementMs(10_000)
      .setSeekForwardIncrementMs(30_000)
      // Que pare cuando suena una llamada o se quitan los auriculares, y que
      // el resto de aplicaciones bajen el volumen mientras: es lo que espera
      // cualquiera de un reproductor.
      .setAudioAttributes(
        AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
        true,
      )
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()

    // Al tocar la notificación se vuelve a la aplicación.
    val volver = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    sesion = MediaSession.Builder(this, reproductor)
      .setBitmapLoader(DataSourceBitmapLoader(MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor()), fuente))
      .setCallback(object : MediaSession.Callback {
        // Los elementos llegan con su URL desde la pantalla; se aceptan tal cual.
        override fun onAddMediaItems(
          mediaSession: MediaSession,
          controller: MediaSession.ControllerInfo,
          mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> = Futures.immediateFuture(mediaItems)
      })
      .apply { if (volver != null) setSessionActivity(volver) }
      .build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = sesion

  /** Si se quita la aplicación de las recientes sin nada sonando, fuera. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    val r = sesion?.player
    if (r == null || !r.playWhenReady || r.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    sesion?.run {
      player.release()
      release()
    }
    sesion = null
    super.onDestroy()
  }
}
