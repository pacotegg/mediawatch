package casa.tvwatch.ui

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import android.content.pm.ActivityInfo
import android.view.ViewGroup
import android.view.WindowManager
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import casa.tvwatch.BotonDeCast
import casa.tvwatch.ReproduccionService
import com.google.common.util.concurrent.MoreExecutors
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Calidad
import casa.tvwatch.datos.Servidor
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Cache
import casa.tvwatch.datos.Capacidades
import casa.tvwatch.datos.Episodio
import casa.tvwatch.datos.InfoReproduccion
import casa.tvwatch.datos.RangoSalto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * El reproductor.
 *
 * Esta es la pieza que justifica que TvWatch sea una aplicación y no una página
 * web con un icono. ExoPlayer descodifica Matroska, HEVC y —si el aparato trae
 * el decodificador— AC3 y DD+, así que **el servidor manda el fichero original
 * y no transcodifica nada**: ni gasta CPU ni pierde calidad. Un navegador no
 * abre un MKV, y ahí no hay vuelta de hoja.
 *
 * Dos decisiones que no son evidentes:
 *
 * 1. **Se busca dentro del flujo, no reabriendo.** El fichero se pide entero y
 *    ExoPlayer pide el trozo que necesita por rangos HTTP. En la televisión hay
 *    que hacerlo al revés —AVPlay no sabe buscar en un MKV servido por HTTP— y
 *    cada salto cuesta reabrir; aquí sería estropear lo que ya funciona.
 * 2. **Salvo cuando hay que convertir el audio.** Si el aparato no lee la pista
 *    (un DTS, un TrueHD), el flujo viene de una tubería de ffmpeg, que no
 *    admite rangos: entonces sí, buscar significa volver a pedirlo desde el
 *    segundo que toque. Se nota, y por eso solo se hace cuando no queda otra.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
fun PantallaReproductor(
  fileId: Int,
  itemId: Int,
  episodioId: Int?,
  desdeSegundos: Double,
  alSalir: () -> Unit,
) {
  val contexto = LocalContext.current

  /*
   * Qué se está viendo. Empieza siendo lo que llegó por la ruta y cambia al
   * encadenar episodios. Se hace aquí, sin navegar: navegando, la pantalla
   * vieja se deshacía **después** de que la nueva arrancara y le paraba el
   * reproductor y le devolvía la orientación a vertical.
   */
  var actual by remember { mutableStateOf(Triple(fileId, episodioId, desdeSegundos)) }

  /*
   * El reproductor vive en `ReproduccionService`; aquí se pide un mando para
   * él. Es lo que hace que la película siga con la pantalla apagada y que el
   * sistema pinte los controles en la pantalla de bloqueo. Tarda unos
   * milisegundos en llegar; mientras, negro.
   */
  var mando by remember { mutableStateOf<MediaController?>(null) }
  DisposableEffect(Unit) {
    val futuro = MediaController.Builder(
      contexto,
      SessionToken(contexto, ComponentName(contexto, ReproduccionService::class.java)),
    ).buildAsync()
    futuro.addListener({ mando = runCatching { futuro.get() }.getOrNull() }, MoreExecutors.directExecutor())
    onDispose {
      // Salir de la pantalla es dejar de ver: se para y se suelta el mando.
      // El servicio sigue vivo por si se vuelve a dar a reproducir.
      mando?.let { it.stop(); it.clearMediaItems() }
      MediaController.releaseFuture(futuro)
      mando = null
    }
  }

  // En Android 13 y posteriores la notificación con los controles necesita
  // permiso. Sin él la película se ve igual; solo falta la notificación.
  val pedirAviso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
  LaunchedEffect(Unit) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(contexto, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      pedirAviso.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
  }

  val r = mando
  if (r == null) {
    Box(Modifier.fillMaxSize().background(Color.Black))
    return
  }
  Reproduciendo(r, actual.first, itemId, actual.second, actual.third, alSalir) { fichero, episodio ->
    actual = Triple(fichero, episodio, 0.0)
  }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
private fun Reproduciendo(
  reproductor: Player,
  fileId: Int,
  itemId: Int,
  episodioId: Int?,
  desdeSegundos: Double,
  alSalir: () -> Unit,
  alSiguiente: (fileId: Int, episodioId: Int) -> Unit,
) {
  val contexto = LocalContext.current
  val actividad = contexto as? Activity

  /*
   * El episodio que viene después, si esto es una serie. Se busca en la ficha
   * —que casi siempre está ya en memoria— por temporada y número: el
   * siguiente con fichero. Con él, «Saltar créditos» pasa a ser «Siguiente
   * episodio» y al acabar se encadena solo, como en cualquier plataforma.
   */
  var siguiente by remember(fileId) { mutableStateOf<Episodio?>(null) }
  /** Y el de antes, para el botón de «anterior» de los controles. */
  var anterior by remember(fileId) { mutableStateOf<Episodio?>(null) }
  /** Si el título tiene disco (la carátula redonda), para enseñarlo en la pausa. */
  var tieneDisco by remember(itemId) { mutableStateOf(Cache.fichaGuardada(itemId)?.tieneDisco == 1) }
  LaunchedEffect(fileId) {
    try {
      val ficha = Cache.fichaGuardada(itemId) ?: withContext(Dispatchers.IO) { Api.ficha(itemId) }.also { Cache.guardarFicha(it) }
      tieneDisco = ficha.tieneDisco == 1
      if (episodioId == null) return@LaunchedEffect
      val orden = ficha.episodes.sortedWith(compareBy({ it.season }, { it.episode }))
      val i = orden.indexOfFirst { it.id == episodioId }
      if (i >= 0) {
        siguiente = orden.drop(i + 1).firstOrNull { it.ficheroId != null }
        anterior = orden.take(i).lastOrNull { it.ficheroId != null }
      }
    } catch (e: Exception) { /* sin episodios vecinos ni disco, y ya */ }
  }
  /** Segundos que faltan para encadenar; nulo mientras no ha terminado. */
  var cuentaAtras by remember(fileId) { mutableStateOf<Int?>(null) }

  var info by remember(fileId) { mutableStateOf<InfoReproduccion?>(null) }
  var fallo by remember(fileId) { mutableStateOf("") }
  var pistaAudio by remember(fileId) { mutableStateOf<Int?>(null) }
  var menuAbierto by remember { mutableStateOf(false) }
  /*
   * Cómo encaja el vídeo. Sin clave en el `remember` y guardado en Ajustes:
   * es una manía de la persona, no de la película. Quien elige «rellenar»
   * para quitarse las bandas negras lo quiere en la siguiente también, y en
   * el episodio que encadena detrás.
   */
  var encaje by remember { mutableStateOf(Encaje.guardado()) }
  var tramoALaVista by remember { mutableStateOf<RangoSalto?>(null) }
  var controlesVisibles by remember { mutableStateOf(true) }
  /** Cada toque en los controles vuelve a contar los 5 s antes de esconderlos. */
  var ultimoToque by remember { mutableStateOf(0L) }
  var enMarcha by remember { mutableStateOf(false) }
  var cargando by remember { mutableStateOf(true) }
  /** La posición en segundos de película entera, para la barra. */
  var posicionUi by remember { mutableStateOf(0.0) }
  /** Mientras se arrastra la barra: a dónde se va a ir, en segundos. */
  var arrastre by remember { mutableStateOf<Double?>(null) }

  fun tocar() { ultimoToque = System.currentTimeMillis(); controlesVisibles = true }
  val tramosSaltados = remember(fileId) { mutableSetOf<String>() }

  /*
   * Desfase de subtítulos, en milisegundos y con signo. Lo aplica el servidor
   * al generar el VTT, así que va en la URL: cambiarlo obliga a rehacer el
   * `MediaItem`, igual que cambiar de calidad. Por eso no se recarga en cada
   * pulsación sino cuando se deja de tocar (ver el `LaunchedEffect` de más
   * abajo). Es por fichero, no una manía de la persona como el encaje: un
   * `.srt` va corrido o no va corrido.
   */
  var retardoSubsMs by remember(fileId) { mutableStateOf(0) }

  /** Con el audio o el vídeo convertidos el flujo no admite rangos: buscar es reabrir. */
  var porTuberia by remember(fileId) { mutableStateOf(false) }
  /** En qué segundo empieza el flujo por tubería que está sonando: su posición 0. */
  var desdeDeLaTuberia by remember(fileId) { mutableStateOf(desdeSegundos) }
  /** El vídeo se puede pedir tal cual; falso obliga a que el servidor lo recodifique. */
  var videoEnCrudo by remember(fileId) { mutableStateOf(true) }
  /** Cuántas veces se ha reintentado bajando de exigencia tras un fallo. */
  var rescates by remember(fileId) { mutableStateOf(0) }
  /** Se le ha dicho al servidor que aquí no se lee HEVC, para que lo recodifique. */
  var sinHevc by remember(fileId) { mutableStateOf(false) }
  /** La calidad pedida a mano: la de casa o la de fuera, según por dónde se entró. */
  var calidad by remember(fileId) { mutableStateOf(Calidad.actual()) }

  /**
   * Lo que se manda al reproductor: la URL y, con ella, el título y la
   * carátula, que es lo que el sistema enseña en la pantalla de bloqueo.
   *
   * Y los subtítulos, aparte. Solo cuando el vídeo se recodifica: ahí el
   * servidor los quita (`-sn`) y hay que pedirlos uno a uno como WebVTT. Las
   * tuberías que copian el vídeo —cambiar el audio, cortar en un segundo— los
   * llevan dentro (`-map 0:s?`), así que pedirlos era pagar dos veces: cada
   * uno obliga al servidor a recorrer el MKV entero (medido: 106 s en un 4K)
   * y ExoPlayer no arranca hasta que bajan todos.
   *
   * `desde` sí depende de la tubería, no de la recodificación: un flujo
   * cortado empieza en cero y los .srt de al lado irían adelantados.
   */
  fun elemento(url: String): MediaItem {
    val subs = (info?.subtitles ?: emptyList())
      .filter { !videoEnCrudo || it.source == "external" }
      .map { st ->
        val desde = if (porTuberia) desdeDeLaTuberia.toInt() else 0
        MediaItem.SubtitleConfiguration.Builder(Uri.parse(Api.urlDeSubtitulo(fileId, st.id, desde, retardoSubsMs)))
          .setMimeType(MimeTypes.TEXT_VTT)
          .setLanguage(st.language)
          .setLabel(idiomaLegible(st.language) + (if (st.forced) " (forzados)" else "") + (if (st.source == "external") " · fichero" else ""))
          .setSelectionFlags(if (st.forced) C.SELECTION_FLAG_FORCED else 0)
          .build()
      }
    return MediaItem.Builder()
      .setUri(url)
      .setSubtitleConfigurations(subs)
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(info?.title ?: "Media Watch")
          .setArtist("Media Watch")
          .setArtworkUri(Uri.parse(Api.imagen(itemId, "poster", 400)))
          .build(),
      )
      .build()
  }

  /* --------------------------------------------- pantalla y orientación */

  DisposableEffect(Unit) {
    val ventana = actividad?.window
    ventana?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    actividad?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    val controlador = ventana?.let { WindowInsetsControllerCompat(it, it.decorView) }
    controlador?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    controlador?.hide(WindowInsetsCompat.Type.systemBars())
    onDispose {
      ventana?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      actividad?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      controlador?.show(WindowInsetsCompat.Type.systemBars())
    }
  }

  /* ----------------------------------------------------------- arrancar */

  /**
   * Preguntar al servidor cómo va a servir el fichero con lo que se le pide
   * ahora (códecs, HEVC sí o no, calidad) y arrancar desde `desde`. Se usa al
   * empezar y cada vez que se cambia la calidad, que puede convertir un flujo
   * directo en uno por tubería o al revés.
   */
  suspend fun cargar(desde: Double) {
    try {
      var i = withContext(Dispatchers.IO) { Api.infoDeReproduccion(fileId, sinHevc, calidad) }

      /*
       * HEVC de 10 bits en un aparato que solo tiene el perfil de 8.
       *
       * Es el caso de casi todo el 4K de la biblioteca, y no se ve venir por la
       * altura ni por la lista de códecs: el decodificador está y dice que
       * llega a 4K, pero rechaza el perfil. Se mira aquí, con el fichero ya
       * identificado, y si toca se vuelve a preguntar diciendo que no hay HEVC
       * para que el servidor lo recodifique de una vez, en vez de arrancar,
       * fallar y arrancar otra vez.
       */
      val diezBits = i.video?.let { v ->
        v.codec == "hevc" && (v.hdr != null || Capacidades.hevcDiezBits.not())
      } ?: false
      if (diezBits && !Capacidades.hevcDiezBits && !sinHevc) {
        sinHevc = true
        i = withContext(Dispatchers.IO) { Api.infoDeReproduccion(fileId, sinHevc = true, calidad = calidad) }
      }
      info = i
      // La pista que se pone al empezar: la primera que el aparato sepa leer.
      // Si ninguna vale, la primera y que el servidor la convierta. Al
      // recargar por un cambio de calidad se conserva la que ya estaba.
      val elegida = i.audio.firstOrNull { it.id == pistaAudio }
        ?: i.audio.firstOrNull { it.compatible } ?: i.audio.firstOrNull()
      pistaAudio = elegida?.id
      /*
       * El servidor ya ha decidido, con lo que este aparato le ha contado de
       * sus decodificadores, si el vídeo le vale tal cual. Si no —un HEVC 4K en
       * un móvil que solo llega a 1080p— se le pide recodificado, y entonces el
       * flujo sale por tubería: no admite rangos y buscar obliga a reabrir.
       */
      videoEnCrudo = i.plan.videoDirecto
      porTuberia = !videoEnCrudo || (elegida != null && !elegida.compatible)

      desdeDeLaTuberia = desde
      val url = Api.urlDeFlujo(fileId, elegida?.id, if (porTuberia) desde else 0.0, videoEnCrudo, sinHevc, calidad)
      /*
       * «Reanudar» arrancaba siempre desde el principio. Causa: `seekTo()`
       * justo después de `prepare()` compite con el propio `MatroskaExtractor`,
       * que en cuanto ve el primer Cluster salta él solo al final del fichero
       * a por el `Cues` y vuelve —el mismo mecanismo de MEDIAWATCH-PROYECTO.md
       * §4—; nuestro salto llegaba antes de que hubiera un mapa de búsqueda de
       * verdad y se perdía. `setMediaItem(item, posición)` es la forma oficial
       * de decir dónde empezar: el reproductor la incorpora al preparar el
       * período, no como una corrección a destiempo.
       */
      if (!porTuberia && desde > 1) {
        reproductor.setMediaItem(elemento(url), (desde * 1000).toLong())
      } else {
        reproductor.setMediaItem(elemento(url))
      }
      reproductor.prepare()
      reproductor.playWhenReady = true
    } catch (e: Exception) {
      fallo = e.message ?: "No se pudo empezar."
    }
  }

  LaunchedEffect(fileId) { cargar(desdeSegundos) }

  /*
   * Distingue «el usuario ha movido el desfase» de «acabo de abrir la
   * película» o «he leído el desfase guardado». Sin esto, el efecto de más
   * abajo recargaría la película para dejarla como ya estaba.
   */
  var primeraPasada by remember(fileId) { mutableStateOf(true) }

  /*
   * El desfase que se dejó guardado la última vez, antes de que nadie toque
   * nada. Si hay varias pistas con desfase se coge el mayor en valor
   * absoluto: casi siempre hay una sola, y equivocarse aquí solo significa
   * que el usuario lo reajusta.
   */
  LaunchedEffect(fileId) {
    val guardados = withContext(Dispatchers.IO) { Api.desfasesDeSubtitulos(fileId) }
    val mayor = guardados.values.maxByOrNull { kotlin.math.abs(it) } ?: 0
    if (mayor != 0) {
      // Cargar lo guardado no es que el usuario haya tocado nada: sin volver a
      // armar `primeraPasada`, el efecto de abajo lo tomaría por un cambio y
      // recargaría la película entera a los 700 ms de abrirla, para dejarla
      // exactamente como ya estaba.
      primeraPasada = true
      retardoSubsMs = mayor
    }
  }

  /*
   * Aplicar el desfase cuando se deja de tocar, no en cada pulsación: cambia
   * la URL del subtítulo y eso obliga a rehacer el `MediaItem`, que
   * rebufferiza. Con 700 ms se puede ajustar de seguido y solo recarga una
   * vez al final.
   */
  LaunchedEffect(retardoSubsMs) {
    if (primeraPasada) { primeraPasada = false; return@LaunchedEffect }
    delay(700)
    val donde = (if (porTuberia) desdeDeLaTuberia else 0.0) + reproductor.currentPosition / 1000.0
    cargar(donde)
    // Que se recuerde para la próxima. Si no es administrador el servidor lo
    // rechaza y no pasa nada: el desfase sigue puesto en esta reproducción.
    val pista = info?.subtitles?.firstOrNull { it.source == "external" }?.id
    if (pista != null) withContext(Dispatchers.IO) { Api.guardarDesfaseSubtitulo(fileId, pista, retardoSubsMs) }
  }

  /* ------------------------------------- guardar el progreso y los saltos */

  val duracionConocida = info?.duration ?: 0.0
  val desfase = if (porTuberia) desdeDeLaTuberia else 0.0

  LaunchedEffect(fileId, porTuberia) {
    while (true) {
      delay(5_000)
      val enSegundos = desfase + reproductor.currentPosition / 1000.0
      if (reproductor.isPlaying && enSegundos > 5) {
        // Cada quince segundos, no cada uno: es lo que basta para no perder el
        // sitio y no llena la base de escrituras.
        if (((enSegundos.toInt()) % 15) < 6) {
          try {
            withContext(Dispatchers.IO) {
              Api.guardarProgreso(itemId, episodioId, enSegundos, duracionConocida)
            }
          } catch (e: Exception) { /* ya se reintentará al siguiente */ }
        }
      }
      // ¿Estamos dentro de una cabecera o de los créditos detectados?
      val i = info
      tramoALaVista = i?.skip?.firstOrNull { r ->
        enSegundos >= r.desde && enSegundos < r.hasta - 1 && (r.kind + r.desde) !in tramosSaltados
      }
    }
  }

  val alSalirActual by rememberUpdatedState(alSalir)
  val ambito = androidx.compose.runtime.rememberCoroutineScope()

  fun salir() {
    val enSegundos = desfase + reproductor.currentPosition / 1000.0
    val total = duracionConocida
    reproductor.pause()
    if (enSegundos > 5) {
      ambito.launch {
        try {
          withContext(Dispatchers.IO) {
            Api.guardarProgreso(itemId, episodioId, enSegundos, total)
          }
        } catch (e: Exception) { /* da igual: se sale igualmente */ }
        alSalirActual()
      }
    } else {
      alSalirActual()
    }
  }

  /*
   * Avisos del administrador: un mensaje que se enseña ocho segundos, o
   * «para», que saca del reproductor. Se pregunta cada cinco segundos; sin
   * red no pasa nada.
   */
  var mensajeAdmin by remember { mutableStateOf("") }
  LaunchedEffect(fileId) {
    while (true) {
      delay(5_000)
      try {
        val a = withContext(Dispatchers.IO) { Api.avisos() }
        if (!a.mensaje.isNullOrBlank()) {
          mensajeAdmin = a.mensaje
          launch { delay(8_000); mensajeAdmin = "" }
        }
        if (a.parar) {
          mensajeAdmin = ""
          android.widget.Toast.makeText(contexto, "El administrador ha parado la reproducción", android.widget.Toast.LENGTH_LONG).show()
          salir()
        }
      } catch (e: Exception) { /* sin red, sin avisos */ }
    }
  }

  /** Dar por visto este episodio y pasar al siguiente. */
  var encadenando by remember(fileId) { mutableStateOf(false) }
  fun pasarAlSiguiente() {
    val sig = siguiente ?: return
    val fichero = sig.ficheroId ?: return
    if (encadenando) return
    encadenando = true
    cuentaAtras = null
    reproductor.pause()
    ambito.launch {
      try {
        withContext(Dispatchers.IO) { Api.guardarProgreso(itemId, episodioId, duracionConocida, duracionConocida, vista = true) }
      } catch (e: Exception) { /* se pasa igual */ }
      alSiguiente(fichero, sig.id)
    }
  }

  /**
   * Cambiar de episodio a mano, con los botones de los controles.
   *
   * No es `pasarAlSiguiente`: aquel da el episodio por visto, que es lo
   * correcto cuando se acaba solo o se saltan los créditos. Pulsar «siguiente»
   * a los diez minutos no significa haberlo visto, así que aquí solo se guarda
   * por dónde ibas y se cambia.
   */
  fun irAEpisodio(ep: Episodio?) {
    val destino = ep ?: return
    val fichero = destino.ficheroId ?: return
    if (encadenando) return
    encadenando = true
    cuentaAtras = null
    val donde = desfase + reproductor.currentPosition / 1000.0
    reproductor.pause()
    ambito.launch {
      try {
        withContext(Dispatchers.IO) { Api.guardarProgreso(itemId, episodioId, donde, duracionConocida) }
      } catch (e: Exception) { /* se cambia igual */ }
      alSiguiente(fichero, destino.id)
    }
  }

  LaunchedEffect(cuentaAtras) {
    val c = cuentaAtras ?: return@LaunchedEffect
    if (c <= 0) { pasarAlSiguiente(); return@LaunchedEffect }
    delay(1_000)
    if (cuentaAtras == c) cuentaAtras = c - 1
  }

  /** Volver a pedir la película por tubería cortada en `segundos`. */
  fun reabrir(segundos: Double) {
    desdeDeLaTuberia = segundos
    cargando = true
    reproductor.setMediaItem(elemento(Api.urlDeFlujo(fileId, pistaAudio, segundos, videoEnCrudo, sinHevc, calidad)))
    reproductor.prepare()
    reproductor.playWhenReady = true
  }

  /**
   * Por tubería, saltar es reabrir, y reabrir es arrancar un ffmpeg en el
   * servidor. Tres toques seguidos en «+30» eran tres ffmpeg en dos segundos y
   * el reproductor ahogándose entre ellos: se espera medio segundo de calma y
   * se reabre una sola vez en el punto final.
   */
  var saltoPendiente by remember(fileId) { mutableStateOf<Double?>(null) }
  LaunchedEffect(saltoPendiente) {
    val destino = saltoPendiente ?: return@LaunchedEffect
    delay(450)
    saltoPendiente = null
    reabrir(destino)
  }

  /**
   * Llevar a un punto por el camino que funcione con este flujo.
   *
   * Los MKV de la biblioteca sí traen `Cues` —`mkvinfo` sin `-v` los oculta
   * por colocarse al final del fichero, después del primer `Cluster`, donde
   * deja de listar; comprobado recorriendo el EBML a mano, no con esa salida
   * (MEDIAWATCH-PROYECTO.md §4)—, así que en el caso normal `isCurrentMediaItemSeekable`
   * da `true` en cuanto el extractor termina su propio salto de ida y vuelta al
   * `Cues`. Esto es la red de seguridad para cuando no: un fichero sin índice,
   * o un salto pedido antes de que ese viaje haya terminado. Ahí ExoPlayer da
   * el flujo por no-buscable y un salto reiniciaría la lectura desde el
   * principio; se pide al servidor ya cortado, igual que en la tele. Desde ese
   * momento el flujo es una tubería de verdad (`copia-desde`), así que las
   * posiciones pasan a ir con desfase.
   */
  fun irA(segundos: Double) {
    if (!porTuberia && reproductor.isCurrentMediaItemSeekable) {
      reproductor.seekTo((segundos * 1000).toLong())
      return
    }
    porTuberia = true
    saltoPendiente = segundos
  }

  /*
   * Vigilante. Si tras reabrir el flujo se queda cargando más de veinte
   * segundos —el ffmpeg no arrancó, la red se cortó a medias— se reintenta
   * una vez en el mismo punto, y a la segunda se dice claramente en vez de
   * dejar la pantalla en negro.
   */
  var reintentosDeCarga by remember(fileId) { mutableStateOf(0) }
  LaunchedEffect(cargando, desdeDeLaTuberia) {
    if (!cargando) return@LaunchedEffect
    delay(20_000)
    if (!cargando || fallo.isNotEmpty()) return@LaunchedEffect
    if (reintentosDeCarga < 1) {
      reintentosDeCarga++
      val donde = if (porTuberia) desdeDeLaTuberia else reproductor.currentPosition / 1000.0
      if (porTuberia) reabrir(donde) else { reproductor.prepare(); reproductor.playWhenReady = true }
    } else {
      fallo = "El servidor no manda vídeo. Puede estar ocupado o sin red."
    }
  }

  /*
   * Red de seguridad.
   *
   * Por bien que se pregunte al aparato, siempre habrá un fichero que el
   * decodificador rechace: un perfil raro, un HDR que no traga, un fallo del
   * propio códec. Antes de dejar al usuario mirando una pantalla negra con un
   * error en inglés, se vuelve a pedir la película recodificada por el
   * servidor, que es algo que cualquier aparato reproduce. Solo una vez: si
   * también falla eso, entonces sí hay algo que contar.
   */
  DisposableEffect(reproductor) {
    val oyente = object : Player.Listener {
      override fun onPlaybackStateChanged(estado: Int) {
        cargando = estado == Player.STATE_BUFFERING
        // Solo si lo que ha terminado es este fichero: al encadenar, el
        // «terminado» del anterior puede llegar con el siguiente ya puesto.
        val esEste = reproductor.currentMediaItem?.localConfiguration?.uri?.toString()?.contains("/play/$fileId/") == true
        if (estado == Player.STATE_ENDED && esEste && siguiente != null && cuentaAtras == null) cuentaAtras = 5
      }
      override fun onIsPlayingChanged(isPlaying: Boolean) { enMarcha = isPlaying }
      /*
       * Un salto mueve la barra en el acto, sin esperar al siguiente tic del
       * reloj. Son 250 ms de nada, pero al arrastrar se notan: sueltas el dedo
       * y el número tiene que estar ya donde lo has dejado.
       */
      override fun onPositionDiscontinuity(
        anterior: Player.PositionInfo,
        nueva: Player.PositionInfo,
        motivo: Int,
      ) {
        if (arrastre == null) {
          posicionUi = (if (porTuberia) desdeDeLaTuberia else 0.0) + nueva.positionMs / 1000.0
        }
      }
      override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
        val donde = desfase + reproductor.currentPosition / 1000.0
        if (rescates == 0) {
          /*
           * Quitar `raw=1` no basta: si el servidor cree que el vídeo va
           * directo, lo sirve tal cual igualmente. Hay que decirle además que
           * este aparato no lee HEVC, y entonces sí lo recodifica.
           */
          rescates = 1
          sinHevc = true
          videoEnCrudo = false
          porTuberia = true
          reabrir(donde)
          return
        }
        fallo = "Este móvil no puede con este vídeo: " + (error.errorCodeName ?: "fallo del reproductor")
      }
    }
    reproductor.addListener(oyente)
    onDispose { reproductor.removeListener(oyente) }
  }

  androidx.activity.compose.BackHandler { if (menuAbierto) menuAbierto = false else salir() }

  // Se esconden solos a los 5 s del último toque, como en la tele, y solo si
  // está sonando: en pausa se quedan, que es cuando uno quiere verlos.
  LaunchedEffect(controlesVisibles, ultimoToque, enMarcha) {
    if (!controlesVisibles || !enMarcha) return@LaunchedEffect
    delay(5_000)
    if (arrastre == null) controlesVisibles = false
  }
  /*
   * El reloj de la barra. Corre **siempre**, no solo mientras se ven los
   * controles.
   *
   * Atado a `controlesVisibles` se quedaba clavado después de un salto: los
   * controles seguían en pantalla, pero la barra y el tiempo no se movían
   * hasta esconderlos y volver a sacarlos, que era lo que arrancaba otro
   * bucle. Lo más probable es que al tocar justo cuando tocaba esconderlos,
   * el estado iba a `false` y volvía a `true` dentro del mismo fotograma:
   * Compose junta las dos en una, la clave del efecto no cambia y la corrutina
   * se queda cancelada con los controles a la vista. Corriendo siempre no hay
   * forma de que pase, y lo que cuesta es leer una posición cada 250 ms.
   *
   * El desfase se lee aquí dentro y no fuera: si se captura al arrancar, un
   * cambio a tubería lo deja con el valor viejo y la barra miente.
   */
  LaunchedEffect(Unit) {
    while (true) {
      if (arrastre == null) {
        posicionUi = (if (porTuberia) desdeDeLaTuberia else 0.0) + reproductor.currentPosition / 1000.0
      }
      delay(250)
    }
  }

  /* ------------------------------------------------------------ pantalla */

  Box(Modifier.fillMaxSize().background(Color.Black)) {
    AndroidView(
      modifier = Modifier.fillMaxSize(),
      factory = { ctx ->
        PlayerView(ctx).apply {
          player = reproductor
          /*
           * Sin los controles de ExoPlayer: los de aquí abajo son propios.
           * No es por estética (también): cuando el vídeo sale por tubería
           * ExoPlayer no sabe cuánto dura, y su barra de tiempo se queda muerta.
           * Los nuestros saben la duración por el servidor y en qué segundo
           * empieza la tubería, así que se puede saltar a cualquier punto.
           */
          useController = false
          // Al reabrir el flujo (saltar por tubería, cambiar calidad) se
          // queda el último fotograma en vez de un negro hasta que llega el
          // primero del nuevo. Con la ruleta encima, se entiende que carga.
          setKeepContentOnPlayerReset(true)
          layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
          )
        }
      },
      // El encaje se aplica aquí y no en `factory`: la vista se crea una vez
      // y esto tiene que volver a pasar cada vez que se elige otro en el menú.
      update = { vista -> vista.resizeMode = encaje.modo },
    )

    // Un toque en el vídeo enseña o esconde los controles.
    Box(
      Modifier
        .fillMaxSize()
        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
          if (controlesVisibles) controlesVisibles = false else tocar()
        },
    )

    AnimatedVisibility(
      visible = mensajeAdmin.isNotEmpty(),
      enter = fadeIn(Movimiento.aparecer(250)),
      exit = fadeOut(Movimiento.aparecer(300)),
      modifier = Modifier.align(Alignment.TopCenter).padding(top = 56.dp),
    ) {
      Column(
        Modifier
          .clip(RoundedCornerShape(16.dp))
          .background(Color(0xCC000000))
          .padding(horizontal = 22.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Text("MENSAJE DEL ADMINISTRADOR", color = Realce, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(4.dp))
        Text(mensajeAdmin, color = Color.White, fontSize = 16.sp)
      }
    }

    if ((cargando || saltoPendiente != null) && fallo.isEmpty()) {
      CircularProgressIndicator(color = Realce, modifier = Modifier.align(Alignment.Center).size(44.dp), strokeWidth = 3.dp)
    }

    AnimatedVisibility(
      visible = controlesVisibles,
      enter = fadeIn(Movimiento.aparecer(200)),
      exit = fadeOut(Movimiento.aparecer(250)),
      modifier = Modifier.fillMaxSize(),
    ) {
      Controles(
        disco = if (tieneDisco && !cargando && cuentaAtras == null) recordarUrl(itemId, "discart", 600) else null,
        enMarcha = enMarcha,
        posicion = arrastre ?: posicionUi,
        duracion = duracionConocida,
        alPausar = { tocar(); if (reproductor.isPlaying) reproductor.pause() else reproductor.play() },
        alSaltar = { seg ->
          tocar()
          val base = saltoPendiente ?: (desfase + reproductor.currentPosition / 1000.0)
          val destino = (base + seg).coerceIn(0.0, maxOf(0.0, duracionConocida - 2))
          posicionUi = destino
          irA(destino)
        },
        alArrastrar = { seg -> tocar(); arrastre = seg },
        // Nunca al segundo exacto del final: por tubería eso es pedir un
        // flujo vacío. Dos segundos antes se ve el final y termina solo.
        alSoltar = { val destino = arrastre; arrastre = null; if (destino != null) irA(destino.coerceAtMost(maxOf(0.0, duracionConocida - 2))) },
        /*
         * En un episodio, los botones de los lados cambian de episodio; en una
         * película saltan 10 s y 30 s. Poner anterior/siguiente en una
         * película sería dejar dos botones muertos, y poner ±30 en una serie
         * obliga a salir para cambiar de capítulo.
         */
        esEpisodio = episodioId != null,
        alAnterior = if (anterior != null) ({ tocar(); irAEpisodio(anterior) }) else null,
        alSiguienteEpisodio = if (siguiente != null) ({ tocar(); irAEpisodio(siguiente) }) else null,
      )
    }

    /*
     * Arriba a la izquierda, la flecha de salir y el titulo; a la derecha,
     * Pistas. Aparecen y se van con los controles del reproductor, con el
     * mismo fundido, para que sean una sola cosa y no dos capas.
     *
     * La flecha hace lo mismo que Atras del sistema, pero esta a la vista: con
     * los gestos de Android escondidos en pantalla completa, no todo el mundo
     * sabe que deslizar desde el borde sale del video.
     */
    AnimatedVisibility(
      visible = controlesVisibles,
      enter = fadeIn(Movimiento.aparecer(200)),
      exit = fadeOut(Movimiento.aparecer(250)),
      modifier = Modifier.align(Alignment.TopStart),
    ) {
      Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Box(
          Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(24.dp))
            .clickable { salir() },
          contentAlignment = Alignment.Center,
        ) {
          Text("‹", color = Color.White, fontSize = 36.sp)
        }
        Text(
          info?.title ?: "",
          color = Color.White,
          fontSize = 15.sp,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f).padding(end = 12.dp),
        )
        BotonDeCast(Modifier.size(40.dp).padding(end = 4.dp))
        // La rueda dentada de siempre, sin pastilla ni texto: es el gesto que
        // ya está aprendido y deja el hueco para el título, que es lo que
        // interesa leer. Zona de toque de 48 dp aunque el dibujo mida 24.
        Box(
          Modifier
            .padding(end = 4.dp)
            .size(48.dp)
            .clip(RoundedCornerShape(100.dp))
            .clickable { menuAbierto = true },
          contentAlignment = Alignment.Center,
        ) {
          Icon(
            Icons.Default.Settings,
            contentDescription = "Opciones",
            tint = Color.White,
            modifier = Modifier.size(24.dp),
          )
        }
      }
    }

    /*
     * Saltar cabecera. Aparece solo dentro del tramo detectado y se quita al
     * pulsarlo, que es el gesto que la gente ya tiene aprendido de Netflix.
     */
    tramoALaVista?.let { tramo ->
      val encadena = tramo.kind == "credits" && siguiente != null
      Text(
        if (encadena) "Siguiente episodio" else if (tramo.kind == "credits") "Saltar créditos" else "Saltar cabecera",
        color = Color.Black,
        fontSize = 15.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
          .align(Alignment.BottomEnd)
          .padding(end = 24.dp, bottom = 96.dp)
          .clip(RoundedCornerShape(10.dp))
          .background(Color.White)
          .clickable {
            tramosSaltados += tramo.kind + tramo.desde
            tramoALaVista = null
            if (encadena) pasarAlSiguiente() else irA(tramo.hasta)
          }
          .padding(horizontal = 20.dp, vertical = 12.dp),
      )
    }

    cuentaAtras?.let { c ->
      val sig = siguiente
      Box(Modifier.fillMaxSize().background(Color(0xAA000000)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Text("Siguiente episodio", color = TextoSuave, fontSize = 13.sp)
          Spacer(Modifier.height(6.dp))
          Text(
            if (sig != null) "T${sig.season}E${sig.episode}" + (sig.title?.let { " \u00b7 $it" } ?: "") else "",
            color = Color.White,
            fontSize = 18.sp,
            fontWeight = FontWeight.SemiBold,
          )
          Spacer(Modifier.height(18.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
              "Reproducir ya \u00b7 $c",
              color = Color.Black,
              fontSize = 15.sp,
              fontWeight = FontWeight.SemiBold,
              modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(Realce)
                .clickable { pasarAlSiguiente() }
                .padding(horizontal = 20.dp, vertical = 12.dp),
            )
            Text(
              "Quedarme",
              color = Color.White,
              fontSize = 15.sp,
              modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0x33FFFFFF))
                .clickable { cuentaAtras = null }
                .padding(horizontal = 20.dp, vertical = 12.dp),
            )
          }
        }
      }
    }

    if (fallo.isNotEmpty()) {
      Box(Modifier.fillMaxSize().background(Color(0xCC000000)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Text(fallo, color = Color.White, fontSize = 15.sp)
          Spacer(Modifier.height(16.dp))
          Text(
            "Reintentar",
            color = Realce,
            fontSize = 15.sp,
            modifier = Modifier.clickable {
              fallo = ""
              reintentosDeCarga = 0
              val donde = if (porTuberia) desdeDeLaTuberia else reproductor.currentPosition / 1000.0
              if (porTuberia) reabrir(donde) else { reproductor.prepare(); reproductor.playWhenReady = true }
            }.padding(12.dp),
          )
          Text(
            "Volver",
            color = Realce,
            fontSize = 15.sp,
            modifier = Modifier.clickable { salir() }.padding(12.dp),
          )
        }
      }
    }

    if (menuAbierto) {
      MenuDePistas(
        info = info,
        reproductor = reproductor,
        pistaAudioActual = pistaAudio,
        alElegirAudio = { id, compatible ->
          menuAbierto = false
          if (id != pistaAudio) {
            val donde = desfase + reproductor.currentPosition / 1000.0
            pistaAudio = id
            porTuberia = !compatible || !videoEnCrudo
            desdeDeLaTuberia = donde
            // Mismo motivo que en cargar(): setMediaItem(item, posición), no
            // seekTo() después de prepare().
            val elem = elemento(Api.urlDeFlujo(fileId, id, if (porTuberia) donde else 0.0, videoEnCrudo, sinHevc, calidad))
            if (!porTuberia && donde > 1) {
              reproductor.setMediaItem(elem, (donde * 1000).toLong())
            } else {
              reproductor.setMediaItem(elem)
            }
            reproductor.prepare()
            reproductor.playWhenReady = true
          }
        },
        encajeActual = encaje,
        alElegirEncaje = { encaje = it; Encaje.recordar(it) },
        calidadActual = calidad,
        alElegirCalidad = { c ->
          menuAbierto = false
          if (c != calidad) {
            val donde = desfase + reproductor.currentPosition / 1000.0
            calidad = c
            Calidad.recordar(c)
            ambito.launch { cargar(donde) }
          }
        },
        retardoSubsMs = retardoSubsMs,
        // El menú no se cierra: así se ve el número moverse y se puede
        // ajustar de seguido. La recarga la dispara el efecto con retardo.
        alCambiarRetardoSubs = { retardoSubsMs = it },
        alCerrar = { menuAbierto = false },
      )
    }
  }
}

/**
 * Los controles: pausa en el centro, y abajo la barra en una sola línea con el
 * tiempo a un lado y lo que queda al otro. Sin más botones: lo demás está en
 * «Pistas».
 *
 * Lo que hay a los lados de la pausa depende de qué se esté viendo: en una
 * película, saltar 10 s y 30 s; en un episodio, cambiar de episodio. Poner
 * anterior/siguiente en una película serían dos botones muertos, y poner ±30
 * en una serie obliga a salirse para cambiar de capítulo.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun Controles(
  /** La carátula redonda del disco, si la hay: se enseña quieta encima de la barra. */
  disco: String?,
  enMarcha: Boolean,
  posicion: Double,
  duracion: Double,
  alPausar: () -> Unit,
  alSaltar: (Double) -> Unit,
  alArrastrar: (Double) -> Unit,
  alSoltar: () -> Unit,
  esEpisodio: Boolean,
  alAnterior: (() -> Unit)?,
  alSiguienteEpisodio: (() -> Unit)?,
) {
  Box(Modifier.fillMaxSize()) {
    // Un velo suave arriba y abajo para que se lean los textos sobre cualquier fotograma.
    Box(
      Modifier.fillMaxSize().background(
        Brush.verticalGradient(0f to Color(0x88000000), 0.3f to Color.Transparent, 0.7f to Color.Transparent, 1f to Color(0xAA000000)),
      ),
    )

    /*
     * Los de los lados van sin el c\u00edrculo gris detr\u00e1s: el dibujo blanco sobre
     * el v\u00eddeo se lee igual y la pantalla queda mucho m\u00e1s limpia. La zona de
     * toque sigue siendo de 60 dp aunque el dibujo mida la mitad.
     */
    Row(
      Modifier.align(Alignment.Center),
      horizontalArrangement = Arrangement.spacedBy(48.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      if (esEpisodio) {
        BotonDeControl(activo = alAnterior != null, alPulsar = alAnterior ?: {}) {
          IconoEpisodio(haciaDelante = false, color = it, tamano = 30.dp)
        }
      } else {
        BotonDeControl(alPulsar = { alSaltar(-10.0) }) {
          Text("\u221210", color = it, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
      }

      // El de en medio s\u00ed lleva aro: es el que se busca a ciegas.
      Box(
        Modifier
          .size(76.dp)
          .clip(RoundedCornerShape(100.dp))
          .border(2.dp, Color(0xE6FFFFFF), RoundedCornerShape(100.dp))
          .clickable(onClick = alPausar),
        contentAlignment = Alignment.Center,
      ) {
        if (enMarcha) {
          Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.size(6.dp, 26.dp).clip(RoundedCornerShape(2.dp)).background(Color.White))
            Box(Modifier.size(6.dp, 26.dp).clip(RoundedCornerShape(2.dp)).background(Color.White))
          }
        } else {
          Icon(Icons.Default.PlayArrow, contentDescription = "Reproducir", tint = Color.White, modifier = Modifier.size(40.dp))
        }
      }

      if (esEpisodio) {
        BotonDeControl(activo = alSiguienteEpisodio != null, alPulsar = alSiguienteEpisodio ?: {}) {
          IconoEpisodio(haciaDelante = true, color = it, tamano = 30.dp)
        }
      } else {
        BotonDeControl(alPulsar = { alSaltar(30.0) }) {
          Text("+30", color = it, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
      }
    }

    Column(
      Modifier
        .align(Alignment.BottomCenter)
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
      // El disco, quieto y a la izquierda, justo encima de la barra: va y viene
      // con los controles y en pausa se queda con ellos. Girando distraía.
      if (disco != null) {
        Imagen(
          disco,
          null,
          Modifier.padding(start = 6.dp, bottom = 10.dp).size(116.dp).graphicsLayer { shadowElevation = 30f },
          escala = ContentScale.Fit,
        )
      }
      val tope = if (duracion > 0) duracion.toFloat() else 1f
      // Barra fina y un punto ámbar: la de Material es un dedo de gorda y
      // lleva un tope al final que no significa nada aquí.
      val fraccion = if (tope > 0) (posicion.toFloat().coerceIn(0f, tope) / tope) else 0f
      /*
       * Tiempo, barra y lo que queda, los tres en la misma línea y de lado a
       * lado. Antes la barra iba arriba y los tiempos debajo: ocupaba el doble
       * de alto y tapaba más película para decir lo mismo.
       */
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(tiempo(posicion), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Slider(
          value = posicion.toFloat().coerceIn(0f, tope),
          onValueChange = { alArrastrar(it.toDouble()) },
          onValueChangeFinished = alSoltar,
          valueRange = 0f..tope,
          enabled = duracion > 0,
          // La zona de arrastre es todo el alto del Slider, no el pulgar: con
          // los 48 dp de serie, en apaisado y tan abajo, se escapaba.
          modifier = Modifier.weight(1f).height(64.dp).padding(horizontal = 12.dp),
          thumb = {
            Box(Modifier.size(24.dp).clip(RoundedCornerShape(100.dp)).background(if (duracion > 0) Realce else Color.Transparent))
          },
          track = {
            Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(Color(0x55FFFFFF))) {
              Box(Modifier.fillMaxWidth(fraccion).height(4.dp).background(Realce))
            }
          },
        )
        Text(
          if (duracion > 0) "\u2212" + tiempo(duracion - posicion) else "",
          color = Color(0xCCFFFFFF),
          fontSize = 13.sp,
        )
      }
    }
  }
}

/** Uno de los dos botones de los lados: dibujo blanco, sin fondo, y 60 dp de toque. */
@Composable
private fun BotonDeControl(
  activo: Boolean = true,
  alPulsar: () -> Unit,
  contenido: @Composable (Color) -> Unit,
) {
  Box(
    Modifier.size(60.dp).clip(RoundedCornerShape(100.dp)).clickable(enabled = activo, onClick = alPulsar),
    contentAlignment = Alignment.Center,
  ) {
    // Apagado en vez de escondido: en el primer y el último episodio el botón
    // sigue ahí y los tres del centro no bailan de sitio.
    contenido(if (activo) Color.White else Color(0x59FFFFFF))
  }
}

/**
 * Anterior y siguiente episodio: un triángulo y una barra.
 *
 * Dibujados y no `Icons.Default.SkipNext`, que **no existe**:
 * `material-icons-core` trae 50 iconos y ese no está. El paquete extendido son
 * megas para dos triángulos, y aquí no hay R8 que los pode
 * (`isMinifyEnabled = false`).
 */
@Composable
private fun IconoEpisodio(haciaDelante: Boolean, color: Color, tamano: androidx.compose.ui.unit.Dp) {
  Canvas(Modifier.size(tamano)) {
    val t = size.minDimension
    val alto = t * 0.62f
    val arriba = (t - alto) / 2f
    val barra = t * 0.13f
    val punta = Path()
    if (haciaDelante) {
      punta.moveTo(t * 0.12f, arriba)
      punta.lineTo(t * 0.66f, t / 2f)
      punta.lineTo(t * 0.12f, arriba + alto)
      drawRect(color, topLeft = Offset(t * 0.74f, arriba), size = Size(barra, alto))
    } else {
      punta.moveTo(t * 0.88f, arriba)
      punta.lineTo(t * 0.34f, t / 2f)
      punta.lineTo(t * 0.88f, arriba + alto)
      drawRect(color, topLeft = Offset(t * 0.13f, arriba), size = Size(barra, alto))
    }
    punta.close()
    drawPath(punta, color)
  }
}

private fun tiempo(seg: Double): String {
  val t = maxOf(0, seg.toInt())
  val h = t / 3600; val m = (t % 3600) / 60; val s = t % 60
  return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/**
 * Cómo se encaja el vídeo en la pantalla.
 *
 * Los tres que trae Media3 y que son los que ofrece cualquier reproductor.
 * «Ajustar» es lo correcto y lo que viene puesto: respeta la proporción y deja
 * las bandas negras que tenga. Los otros dos son para el que prefiere llenar
 * la pantalla del móvil a costa de algo, y conviene que el nombre lo diga:
 * uno recorta imagen y el otro deforma a la gente.
 */
private enum class Encaje(val etiqueta: String, val modo: Int) {
  // «Original» y no «Ajustar a la pantalla»: es el nombre que dice claramente
  // por dónde se vuelve después de probar Rellenar o Estirar.
  AJUSTAR("Original", AspectRatioFrameLayout.RESIZE_MODE_FIT),
  RELLENAR("Rellenar · recorta los bordes", AspectRatioFrameLayout.RESIZE_MODE_ZOOM),
  ESTIRAR("Estirar · deforma la imagen", AspectRatioFrameLayout.RESIZE_MODE_FILL);

  companion object {
    fun guardado(): Encaje = entries.firstOrNull { it.name == Ajustes.encajeVideo } ?: AJUSTAR
    fun recordar(e: Encaje) { Ajustes.encajeVideo = e.name }
  }
}

/**
 * Elegir pista de audio y de subtítulos.
 *
 * El audio se pide al servidor —puede haber pistas que el aparato no lee y hay
 * que convertirlas— mientras que los subtítulos ya vienen dentro del fichero y
 * los cambia ExoPlayer al vuelo, sin cortar la imagen.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable
private fun MenuDePistas(
  info: InfoReproduccion?,
  reproductor: Player,
  pistaAudioActual: Int?,
  alElegirAudio: (Int, Boolean) -> Unit,
  calidadActual: Calidad,
  alElegirCalidad: (Calidad) -> Unit,
  encajeActual: Encaje,
  alElegirEncaje: (Encaje) -> Unit,
  retardoSubsMs: Int,
  alCambiarRetardoSubs: (Int) -> Unit,
  alCerrar: () -> Unit,
) {
  Box(
    Modifier
      .fillMaxSize()
      .background(Color(0xCC000000))
      .clickable { alCerrar() },
    contentAlignment = Alignment.Center,
  ) {
    Column(
      Modifier
        .fillMaxWidth(0.72f)
        .clip(RoundedCornerShape(16.dp))
        .background(Color(0xFF16161C))
        .verticalScroll(rememberScrollState())
        .padding(20.dp),
      verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
      Text("Audio", color = Texto, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
      Spacer(Modifier.height(6.dp))
      info?.audio?.forEach { a ->
        val nombre = buildString {
          append(idiomaLegible(a.language))
          append(" · ")
          append(if (a.atmos) "Dolby Atmos" else a.codec.uppercase())
          when (a.channels) {
            8 -> append(" 7.1"); 6 -> append(" 5.1"); 2 -> append(" 2.0")
          }
        }
        Column(
          Modifier
            .fillMaxWidth()
            .clickable { alElegirAudio(a.id, a.compatible) }
            .padding(vertical = 9.dp),
        ) {
          Text(
            (if (a.id == pistaAudioActual) "✓  " else "     ") + nombre,
            color = if (a.id == pistaAudioActual) Realce else Texto,
            fontSize = 14.sp,
          )
          if (!a.compatible) {
            Text(
              "      este móvil no la lee: el servidor la convierte",
              color = TextoTenue,
              fontSize = 11.sp,
            )
          }
        }
      }

      Spacer(Modifier.height(14.dp))
      Text("Subtítulos", color = Texto, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
      Spacer(Modifier.height(6.dp))

      val subtitulos = remember(reproductor.currentTracks) { pistasDeTexto(reproductor.currentTracks) }
      Text(
        "     Desactivados",
        color = Texto,
        fontSize = 14.sp,
        modifier = Modifier
          .fillMaxWidth()
          .clickable {
            reproductor.trackSelectionParameters = reproductor.trackSelectionParameters
              .buildUpon()
              .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
              .build()
            alCerrar()
          }
          .padding(vertical = 9.dp),
      )
      subtitulos.forEach { (grupo, indice, etiqueta) ->
        Text(
          "     $etiqueta",
          color = Texto,
          fontSize = 14.sp,
          modifier = Modifier
            .fillMaxWidth()
            .clickable {
              reproductor.trackSelectionParameters = reproductor.trackSelectionParameters
                .buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(TrackSelectionOverride(grupo.mediaTrackGroup, indice))
                .build()
              alCerrar()
            }
            .padding(vertical = 9.dp),
        )
      }
      if (subtitulos.isEmpty()) {
        Text("     Este fichero no trae ninguno", color = TextoTenue, fontSize = 12.sp)
      }

      /*
       * Desfase. Solo se enseña si hay algún subtítulo en fichero aparte: los
       * incrustados viajan dentro del MKV cuando el vídeo va en crudo y el
       * servidor no los toca, así que enseñar el ajuste ahí sería ofrecer un
       * botón que no hace nada. Y es justo donde no hace falta: el que va
       * corrido casi siempre es el `.srt` descargado.
       */
      if (info?.subtitles?.any { it.source == "external" } == true) {
        Spacer(Modifier.height(10.dp))
        Row(
          Modifier.fillMaxWidth().padding(start = 18.dp, end = 4.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text("Desfase", color = TextoTenue, fontSize = 13.sp, modifier = Modifier.weight(1f))
          Text(
            "−",
            color = Texto,
            fontSize = 22.sp,
            modifier = Modifier
              .clickable { alCambiarRetardoSubs((retardoSubsMs - 100).coerceAtLeast(-10_000)) }
              .padding(horizontal = 14.dp, vertical = 6.dp),
          )
          Text(
            if (retardoSubsMs == 0) "0,0 s" else String.format("%+.1f s", retardoSubsMs / 1000.0).replace('.', ','),
            color = if (retardoSubsMs == 0) TextoTenue else Realce,
            fontSize = 14.sp,
          )
          Text(
            "+",
            color = Texto,
            fontSize = 22.sp,
            modifier = Modifier
              .clickable { alCambiarRetardoSubs((retardoSubsMs + 100).coerceAtMost(10_000)) }
              .padding(horizontal = 14.dp, vertical = 6.dp),
          )
        }
        Text(
          "     Si van adelantados, súbelo; si van atrasados, bájalo.",
          color = TextoTenue,
          fontSize = 11.sp,
        )
      }

      // Tamaño de pantalla. No toca el vídeo ni al servidor: solo cómo lo
      // encaja la vista, así que el cambio es instantáneo y no corta nada.
      Spacer(Modifier.height(14.dp))
      Text("Tamaño de pantalla", color = Texto, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
      Spacer(Modifier.height(6.dp))
      Encaje.entries.forEach { e ->
        Text(
          (if (e == encajeActual) "✓  " else "     ") + e.etiqueta,
          color = if (e == encajeActual) Realce else Texto,
          fontSize = 14.sp,
          modifier = Modifier
            .fillMaxWidth()
            .clickable { alElegirEncaje(e); alCerrar() }
            .padding(vertical = 9.dp),
        )
      }

      /*
       * Calidad a mano. Lo que Plex llama «Original / 8 Mb/s / 4 Mb/s»: fuera
       * de casa, con datos, es la diferencia entre ver y esperar. Se recuerda
       * por separado para casa y para fuera.
       */
      Spacer(Modifier.height(14.dp))
      Text("Calidad", color = Texto, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
      Text(
        if (Servidor.enCasa()) "para cuando estás en casa" else "para cuando estás fuera",
        color = TextoTenue,
        fontSize = 11.sp,
      )
      Spacer(Modifier.height(6.dp))
      Calidad.entries.forEach { c ->
        Text(
          (if (c == calidadActual) "\u2713  " else "     ") + c.etiqueta,
          color = if (c == calidadActual) Realce else Texto,
          fontSize = 14.sp,
          modifier = Modifier
            .fillMaxWidth()
            .clickable { alElegirCalidad(c) }
            .padding(vertical = 9.dp),
        )
      }
      info?.let { i ->
        if (i.bitrate > 0) {
          val alto = i.video?.let { v -> v.height.toString() + "p \u00b7 " } ?: ""
          Text(
            "     Este fichero: " + alto + String.format("%.1f Mb/s", i.bitrate / 1_000_000.0) +
              (if (i.plan.mode == "transcode") "  \u00b7  ahora recodificado" else "  \u00b7  ahora tal cual"),
            color = TextoTenue,
            fontSize = 11.sp,
          )
        }
      }
    }
  }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
private fun pistasDeTexto(pistas: Tracks): List<Triple<Tracks.Group, Int, String>> {
  val salida = mutableListOf<Triple<Tracks.Group, Int, String>>()
  for (grupo in pistas.groups) {
    if (grupo.type != C.TRACK_TYPE_TEXT) continue
    for (i in 0 until grupo.length) {
      if (!grupo.isTrackSupported(i)) continue
      val f = grupo.getTrackFormat(i)
      val etiqueta = f.label ?: idiomaLegible(f.language)
      salida += Triple(grupo, i, etiqueta)
    }
  }
  return salida
}

/** Los códigos ISO que traen los ficheros, en castellano. */
fun idiomaLegible(codigo: String?): String {
  if (codigo.isNullOrBlank()) return "Sin marcar"
  return when (codigo.lowercase().take(3)) {
    "spa", "es", "esp" -> "Español"
    "eng", "en" -> "Inglés"
    "cat", "ca" -> "Catalán"
    "fre", "fra", "fr" -> "Francés"
    "ger", "deu", "de" -> "Alemán"
    "ita", "it" -> "Italiano"
    "por", "pt" -> "Portugués"
    "jpn", "ja" -> "Japonés"
    "rus", "ru" -> "Ruso"
    "chi", "zho", "zh" -> "Chino"
    "kor", "ko" -> "Coreano"
    else -> codigo
  }
}
