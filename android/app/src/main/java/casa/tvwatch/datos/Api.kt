package casa.tvwatch.datos

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.util.concurrent.TimeUnit

/**
 * El servidor de TvWatch, visto desde el móvil.
 *
 * La API ya existía para la web y para la tele, así que aquí no se inventa
 * nada: se declaran los campos que esta aplicación usa y se ignora el resto.
 * `ignoreUnknownKeys` no es pereza — es lo que permite añadir campos en el
 * servidor sin que la aplicación instalada en el móvil deje de arrancar.
 *
 * La sesión viaja como `Authorization: Bearer`, no como cookie: la aplicación
 * corre desde su propio origen y las cookies no le sirven de nada. Las
 * carátulas van por el mismo camino, con un `OkHttpClient` compartido con Coil,
 * así que **el token no aparece nunca en una URL**.
 */
object Api {

  val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

  /** Tiempos cortos: si el servidor no está, hay que decirlo, no esperar. */
  val http: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(6, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    // Con nombre: el servidor apunta desde qué aparato se entra y sin esto
    // la app salía como «Navegador» (el agente por defecto es «okhttp/4»).
    .addInterceptor { cadena ->
      cadena.proceed(cadena.request().newBuilder().header("User-Agent", "MediaWatch Android/" + android.os.Build.VERSION.RELEASE).build())
    }
    .build()

  class FalloDeRed(mensaje: String) : Exception(mensaje)
  class SinSesion : Exception("La sesión ya no vale")

  private fun peticion(ruta: String, cuerpo: String? = null): Request {
    // `Servidor.base()` decide si toca la direccion de casa o la de fuera.
    val b = Request.Builder().url(Servidor.base() + ruta)
    Ajustes.token?.let { b.header("Authorization", "Bearer $it") }
    if (cuerpo != null) b.post(cuerpo.toRequestBody("application/json".toMediaType()))
    return b.build()
  }

  /** Hace la petición y devuelve el cuerpo, o explica en castellano qué pasó. */
  fun texto(ruta: String, cuerpo: String? = null): String {
    val r = try {
      http.newCall(peticion(ruta, cuerpo)).execute()
    } catch (e: Exception) {
      // Se ha caido: que la proxima vez se vuelva a mirar por donde se llega.
      // Es lo que hace que salir de casa con el movil en la mano funcione.
      Servidor.olvidar()
      throw FalloDeRed("No se llega al servidor. ¿Está encendido el ordenador?")
    }
    r.use {
      if (it.code == 401) throw SinSesion()
      val s = it.body?.string() ?: ""
      if (!it.isSuccessful) throw FalloDeRed("El servidor respondió ${it.code}")
      return s
    }
  }

  inline fun <reified T> pedir(ruta: String): T = json.decodeFromString(texto(ruta))

  /* ------------------------------------------------------------- llamadas */

  fun perfiles(): ListaDePerfiles = pedir("/api/users")

  /**
   * Quien es el servidor y cual es su direccion de fuera.
   *
   * La publica solo la entrega dentro de casa, asi que se pregunta al conectar
   * y se guarda: a partir de ahi el movil sabe volver a entrar desde la calle
   * sin que nadie le escriba nada.
   */
  fun quienEs(): QuienEs = pedir("/api/servidor")

  /**
   * Entrar y quedarse con la sesión.
   *
   * El servidor la entrega en una cookie, que es lo que le vale a la web. Aquí
   * no sirve —la aplicación corre desde su propio origen— pero el valor de esa
   * cookie **es** el token de la tabla de sesiones, el mismo que acepta la
   * cabecera `Authorization`. Así que se lee de la respuesta y se guarda. No
   * hace falta tocar el servidor ni pasar por el emparejado con código, que
   * está pensado para aparatos sin teclado.
   */
  fun entrar(userId: Int, pin: String?): Perfil {
    val cuerpo = buildString {
      append("{\"userId\":").append(userId)
      if (!pin.isNullOrBlank()) append(",\"pin\":\"").append(pin).append('"')
      append('}')
    }
    val r = try {
      http.newCall(peticion("/api/auth/login", cuerpo)).execute()
    } catch (e: Exception) {
      throw FalloDeRed("No se llega al servidor. ¿Está encendido el ordenador?")
    }
    r.use {
      val s = it.body?.string() ?: ""
      if (it.code == 401) throw FalloDeRed("PIN incorrecto")
      if (!it.isSuccessful) throw FalloDeRed("El servidor respondió ${it.code}")
      val cookie = it.headers("Set-Cookie").firstOrNull { c -> c.startsWith("cineteca_session=") }
        ?: throw FalloDeRed("El servidor no devolvió ninguna sesión")
      Ajustes.token = cookie.substringAfter('=').substringBefore(';')
      return json.decodeFromString(s)
    }
  }

  fun portada(): Portada = pedir("/api/home")
  fun bibliotecas(): List<Biblioteca> = pedir("/api/libraries")
  fun favoritos(): List<Titulo> = pedir("/api/favorites")
  fun titulos(
    libraryId: Int,
    offset: Int,
    limite: Int,
    orden: String = "title",
    genero: String? = null,
    sinVer: Boolean = false,
  ): Pagina = pedir(
    "/api/items?library=$libraryId&offset=$offset&limit=$limite&sort=$orden" +
      (if (genero != null) "&genre=" + java.net.URLEncoder.encode(genero, "UTF-8") else "") +
      (if (sinVer) "&unwatched=1" else ""),
  )
  fun generos(libraryId: Int): List<Genero> = pedir("/api/genres?library=$libraryId")
  fun sagas(): List<Saga> = pedir("/api/collections")
  fun persona(id: Int): FichaDePersona = pedir("/api/people/$id")
  fun fotoDePersona(id: Int, ancho: Int) = "${Servidor.baseCacheada()}/api/people/$id/thumb?w=$ancho"
  fun fotoDeEpisodio(id: Int, ancho: Int) = "${Servidor.baseCacheada()}/api/episodes/$id/thumb?w=$ancho"
  fun saga(nombre: String): ContenidoDeSaga = pedir("/api/collections/" + java.net.URLEncoder.encode(nombre, "UTF-8").replace("+", "%20"))
  fun ficha(id: Int): Ficha = pedir("/api/items/$id")
  fun buscar(q: String): Resultados = pedir("/api/search?q=" + java.net.URLEncoder.encode(q, "UTF-8"))

  /**
   * Buscar por una frase de la pelicula.
   *
   * El servidor tiene 1,29 millones de frases indexadas de los subtitulos. Es
   * lo que permite encontrar algo recordando solo lo que decian, y al pulsar
   * empieza justo en ese momento.
   */
  fun buscarDialogos(q: String): ResultadosDialogo =
    pedir("/api/search/dialogue?q=" + java.net.URLEncoder.encode(q, "UTF-8"))

  /** Avisos del administrador para este aparato: un mensaje, o «para». */
  fun avisos(): Avisos = pedir("/api/mando")

  /** Manda el texto a la television, que lo recoge en su pantalla de buscar. */
  fun enviarALaTele(texto: String) {
    texto("/api/mando/buscar", "{\"texto\":\"" + texto.replace("\"", "") + "\"}")
  }

  /** «Ver en la tele»: la aplicación de la tele lo recoge y arranca ahí. */
  fun verEnLaTele(fileId: Int, itemId: Int, episodioId: Int?, posicion: Double) {
    texto(
      "/api/mando/reproducir",
      "{\"fileId\":$fileId,\"itemId\":$itemId" +
        (if (episodioId != null) ",\"episodeId\":$episodioId" else "") +
        ",\"position\":${posicion.toInt()}}",
    )
  }

  /*
   * Las imagenes usan la direccion **ya sabida**, sin comprobar nada: esto se
   * llama desde el hilo de la interfaz por cada caratula de la rejilla, y
   * sondear ahi colgaria la pantalla.
   */
  fun imagen(id: Int, tipo: String, ancho: Int) = "${Servidor.baseCacheada()}/api/items/$id/$tipo?w=$ancho"

  /* ------------------------------------------------------- reproducción */

  fun infoDeReproduccion(fileId: Int, sinHevc: Boolean = false, calidad: Calidad = Calidad.ORIGINAL): InfoReproduccion =
    pedir("/api/play/$fileId/info?" + Capacidades.consulta(sinHevc, calidad))

  /**
   * El flujo de vídeo.
   *
   * `raw=1` y **sin `t`**: se pide el fichero entero y se busca dentro con
   * ExoPlayer, que sabe pedir rangos por HTTP. En la televisión hay que pedirle
   * al servidor la película ya cortada porque AVPlay no sabe buscar en un MKV
   * servido por HTTP; aquí sería tirar piedras al propio tejado —cada salto
   * costaría una reapertura y un arranque de ffmpeg— así que no se hace.
   *
   * La excepción es cuando el audio hay que convertirlo: entonces el flujo sale
   * de una tubería de ffmpeg, no tiene rangos, y buscar sí obliga a reabrir.
   */
  fun urlDeFlujo(
    fileId: Int,
    pistaAudio: Int?,
    desdeSegundos: Double = 0.0,
    enCrudo: Boolean = true,
    sinHevc: Boolean = false,
    calidad: Calidad = Calidad.ORIGINAL,
  ): String {
    val partes = StringBuilder("${Servidor.baseCacheada()}/api/play/$fileId/stream?")
    // Sin `raw=1` el servidor deja de servir el fichero tal cual; con `hevc=0`
    // además decide que hay que recodificar el vídeo. Hacen falta las dos.
    if (enCrudo) partes.append("raw=1&")
    partes.append(Capacidades.consulta(sinHevc, calidad))
    if (pistaAudio != null) partes.append("&audio=").append(pistaAudio)
    if (desdeSegundos > 1) partes.append("&t=").append(desdeSegundos.toInt())
    return partes.toString()
  }

  /** Un subtítulo como WebVTT; `desde` resta segundos para flujos cortados. */
  fun urlDeSubtitulo(fileId: Int, trackId: String, desde: Int = 0): String =
    "${Servidor.baseCacheada()}/api/play/$fileId/subtitle/$trackId.vtt" + (if (desde > 0) "?desde=$desde" else "")

  /* --------------------------------------------------------- imagenes */

  fun buscarEnTmdb(titulo: String, kind: String, anio: Int?): ResultadosTmdb {
    val cuerpo = buildString {
      append("{\"query\":\"").append(titulo.replace("\"", "")).append("\",\"kind\":\"").append(kind).append('"')
      if (anio != null) append(",\"year\":").append(anio)
      append('}')
    }
    return json.decodeFromString(texto("/api/enrich/search", cuerpo))
  }

  fun imagenesDe(kind: String, tmdbId: Int): Map<String, List<ImagenDisponible>> =
    pedir("/api/enrich/imagenes/$kind/$tmdbId")

  /** Con `url` a null se suelta la elegida y vuelve la de la carpeta. */
  fun ponerArte(itemId: Int, papel: String, url: String?) {
    val cuerpo = buildString {
      append("{\"itemId\":").append(itemId).append(",\"papel\":\"").append(papel).append('"')
      if (url != null) append(",\"url\":\"").append(url).append('"')
      append('}')
    }
    texto("/api/enrich/arte", cuerpo)
  }

  /** Añadir o quitar de favoritos. */
  fun favorito(itemId: Int, favorito: Boolean) {
    texto("/api/items/$itemId/favorite", "{\"favorite\":$favorito}")
  }

  /** Marcar como vista o como no vista, la película entera o un episodio. */
  fun marcarVista(itemId: Int, vista: Boolean, episodioId: Int? = null) {
    val cuerpo = buildString {
      append("{\"watched\":").append(vista)
      if (episodioId != null) append(",\"episodeId\":").append(episodioId)
      append('}')
    }
    texto("/api/items/$itemId/watched", cuerpo)
  }

  fun guardarProgreso(itemId: Int, episodioId: Int?, posicion: Double, duracion: Double?, vista: Boolean = false) {
    val cuerpo = buildString {
      append("{\"itemId\":").append(itemId)
      if (episodioId != null) append(",\"episodeId\":").append(episodioId)
      append(",\"position\":").append(posicion.toInt())
      if (duracion != null && duracion > 0) append(",\"duration\":").append(duracion.toInt())
      if (vista) append(",\"watched\":true")
      append('}')
    }
    texto("/api/progress", cuerpo)
  }
}

/* ------------------------------------------------------------- los datos */

@Serializable
data class Perfil(
  val id: Int,
  val name: String,
  val color: String? = null,
  @SerialName("is_admin") val esAdmin: Int = 0,
  @SerialName("has_pin") val tienePin: Int = 0,
)

@Serializable
data class QuienEs(val nombre: String = "Media Watch", val publica: String = "")

@Serializable
data class ListaDePerfiles(val users: List<Perfil> = emptyList(), val setupNeeded: Boolean = false)

@Serializable
data class Biblioteca(val id: Int, val name: String, val kind: String, val count: Int = 0)

@Serializable
data class Genero(val id: Int, val name: String, val count: Int = 0)

@Serializable
data class Saga(
  val name: String,
  val count: Int = 0,
  @SerialName("first_year") val firstYear: Int? = null,
  @SerialName("last_year") val lastYear: Int? = null,
  @SerialName("poster_id") val posterId: Int? = null,
  @SerialName("fanart_id") val fanartId: Int? = null,
  val seen: Int = 0,
)

@Serializable
data class ContenidoDeSaga(val name: String, val items: List<Titulo> = emptyList())

@Serializable
data class Titulo(
  val id: Int,
  val kind: String = "movie",
  val title: String,
  val year: Int? = null,
  val rating: Double? = null,
  val runtime: Double? = null,
  @SerialName("has_poster") val tienePoster: Int = 0,
  @SerialName("has_fanart") val tieneFondo: Int = 0,
  @SerialName("has_logo") val tieneLogo: Int = 0,
  @SerialName("library_name") val biblioteca: String? = null,
  val position: Double? = null,
  @SerialName("progressDuration") val duracionVista: Double? = null,
  /** Solo en la ficha de una persona: a quién interpreta. */
  val character: String? = null,
  val watched: Int? = null,
  val plot: String? = null,
) {
  /** Cuánto se lleva visto, de 0 a 1. Cero si no se ha empezado. */
  val avance: Float
    get() {
      val total = duracionVista ?: (runtime?.times(60) ?: 0.0)
      val p = position ?: 0.0
      return if (total > 0 && p > 0) (p / total).coerceIn(0.0, 1.0).toFloat() else 0f
    }
}

@Serializable
data class Pagina(val total: Int, val items: List<Titulo>)

@Serializable
data class FilaPortada(val key: String, val title: String, val kind: String, val items: List<Titulo>)

@Serializable
data class Portada(val hero: List<Titulo> = emptyList(), val rows: List<FilaPortada> = emptyList())

@Serializable
data class Nota(val fuente: String, val valor: Double, val maximo: Int, val etiqueta: String)

@Serializable
data class Fichero(
  val id: Int,
  @SerialName("episode_id") val episodioId: Int? = null,
  val duration: Double? = null,
  val height: Int? = null,
  val width: Int? = null,
  @SerialName("video_codec") val codec: String? = null,
  val hdr: String? = null,
  val size: Long? = null,
)

@Serializable
data class Episodio(
  val id: Int,
  val season: Int,
  val episode: Int,
  val title: String? = null,
  val plot: String? = null,
  val runtime: Double? = null,
  @SerialName("has_thumb") val tieneFoto: Int = 0,
  @SerialName("file_id") val ficheroId: Int? = null,
)

@Serializable
data class Progreso(
  @SerialName("episode_id") val episodioId: Int? = null,
  val position: Double = 0.0,
  val duration: Double? = null,
  val watched: Int = 0,
)

@Serializable
data class Persona(val id: Int, val name: String, val role: String, val character: String? = null, @SerialName("has_thumb") val tieneFoto: Int = 0)

@Serializable
data class Ficha(
  val id: Int,
  val kind: String,
  val title: String,
  val year: Int? = null,
  val plot: String? = null,
  val tagline: String? = null,
  val runtime: Double? = null,
  val mpaa: String? = null,
  val rating: Double? = null,
  val genres: List<String> = emptyList(),
  val ratings: List<Nota> = emptyList(),
  val cast: List<Persona> = emptyList(),
  val files: List<Fichero> = emptyList(),
  val episodes: List<Episodio> = emptyList(),
  val progress: List<Progreso> = emptyList(),
  val favorite: Int = 0,
  @SerialName("has_fanart") val tieneFondo: Int = 0,
  @SerialName("has_logo") val tieneLogo: Int = 0,
  @SerialName("has_poster") val tienePoster: Int = 0,
  /** El disco redondo (carátula del Blu-ray): gira en la pausa del reproductor. */
  @SerialName("has_discart") val tieneDisco: Int = 0,
)

@Serializable
data class PistaAudio(
  val id: Int,
  val codec: String = "",
  val language: String? = null,
  val channels: Int? = null,
  val title: String? = null,
  val atmos: Boolean = false,
  val compatible: Boolean = true,
)

@Serializable
data class PistaSubtitulo(
  val id: String,
  val language: String? = null,
  val title: String? = null,
  val forced: Boolean = false,
  val source: String = "embedded",
)

@Serializable
data class Video(
  val codec: String? = null,
  val width: Int = 0,
  val height: Int = 0,
  val fps: Double = 0.0,
  val hdr: String? = null,
)

@Serializable
data class Capitulo(val start: Double = 0.0, val title: String = "")

/** Cabecera o créditos detectados; `kind` es «intro» o «credits». */
@Serializable
data class RangoSalto(val kind: String, @SerialName("start_s") val desde: Double, @SerialName("end_s") val hasta: Double)

@Serializable
data class Plan(
  val mode: String = "direct",
  /** «copy» o «encode»; es lo que decide si el vídeo se puede pedir en crudo. */
  val videoAction: String = "copy",
  val audioAction: String = "copy",
  val reasons: List<String> = emptyList(),
) {
  /** El vídeo vale tal cual: se puede pedir el fichero y buscar dentro. */
  val videoDirecto: Boolean get() = videoAction != "encode"
}

@Serializable
data class InfoReproduccion(
  val fileId: Int,
  val title: String = "",
  val duration: Double = 0.0,
  val container: String = "",
  val size: Long = 0,
  val bitrate: Long = 0,
  val video: Video? = null,
  val plan: Plan = Plan(),
  val audio: List<PistaAudio> = emptyList(),
  val subtitles: List<PistaSubtitulo> = emptyList(),
  val chapters: List<Capitulo> = emptyList(),
  val skip: List<RangoSalto> = emptyList(),
)

@Serializable
data class ImagenDisponible(
  val url: String,
  val vista: String,
  val ancho: Int = 0,
  val alto: Int = 0,
  val idioma: String = "",
  val voto: Double = 0.0,
)

@Serializable
data class PropuestaTmdb(
  val tmdbId: Int,
  val title: String = "",
  val year: Int? = null,
)

@Serializable
data class ResultadosTmdb(val results: List<PropuestaTmdb> = emptyList())

@Serializable
data class Dialogo(
  val itemId: Int,
  val title: String = "",
  val year: Int? = null,
  val fileId: Int,
  val episodeId: Int? = null,
  val season: Int? = null,
  val episode: Int? = null,
  val startMs: Long = 0,
  val snippet: String = "",
)

@Serializable
data class EstadisticasDialogo(val frases: Long = 0)

@Serializable
data class Avisos(val mensaje: String? = null, val parar: Boolean = false)

@Serializable
data class ResultadosDialogo(
  val hits: List<Dialogo> = emptyList(),
  val stats: EstadisticasDialogo = EstadisticasDialogo(),
)

@Serializable
data class PersonaBusqueda(val id: Int, val name: String, val count: Int = 0, @SerialName("has_thumb") val tieneFoto: Int = 0)

@Serializable
data class DetalleDePersona(
  val biography: String? = null,
  val birthday: String? = null,
  val deathday: String? = null,
  val birthplace: String? = null,
)

@Serializable
data class FichaDePersona(
  val id: Int,
  val name: String,
  @SerialName("has_thumb") val tieneFoto: Int = 0,
  val detalle: DetalleDePersona? = null,
  val credits: List<Titulo> = emptyList(),
)

@Serializable
data class Resultados(val items: List<Titulo> = emptyList(), val people: List<PersonaBusqueda> = emptyList())
