package casa.tvwatch.datos

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Abrir la app de una plataforma (Movistar+, Prime, Apple TV+), o ir directo a un
 * título dentro de ella.
 *
 * Aquí no se reproduce nada: esos servicios van cifrados con DRM y solo las
 * sirve su propia app. Y no se codifican nombres de paquete: cambian según el
 * aparato y el país, y en la tele Samsung la de Prime tenía un duplicado
 * «-dummy» con el mismo nombre. Se busca entre las apps con icono por el nombre
 * que ve el usuario.
 *
 * El nombre se compara **normalizado** (solo letras y dígitos, en minúsculas). La
 * primera versión buscaba «apple tv» con un espacio normal y en un móvil con la
 * app instalada no la encontraba: los nombres de Apple suelen llevar un espacio
 * no separable (U+00A0), que no es el mismo carácter.
 */
object AppsDePlataforma {
  /** Nombres normalizados que identifican cada plataforma. */
  private val nombres = mapOf(
    "movistar" to listOf("movistar"),
    "prime" to listOf("primevideo", "amazonprime"),
    "apple" to listOf("appletv"),
  )

  /** Raíz para listar candidatas cuando no se encuentra la app: qué hay parecido. */
  private val raices = mapOf("movistar" to "movistar", "prime" to "prime", "apple" to "apple")

  private fun normalizar(s: String) = s.lowercase().filter { it.isLetterOrDigit() }

  private data class Candidata(val etiqueta: String, val paquete: String)

  private fun aplicaciones(contexto: Context): List<Candidata> {
    val pm = contexto.packageManager
    val salida = mutableListOf<Candidata>()
    for (categoria in listOf(Intent.CATEGORY_LAUNCHER, Intent.CATEGORY_LEANBACK_LAUNCHER)) {
      val intento = Intent(Intent.ACTION_MAIN).addCategory(categoria)
      for (info in pm.queryIntentActivities(intento, 0)) {
        salida += Candidata(info.loadLabel(pm).toString(), info.activityInfo.packageName)
      }
    }
    return salida
  }

  /** El paquete de esa plataforma si está instalada, o null. */
  fun paqueteDe(contexto: Context, clave: String): String? {
    val palabras = nombres[clave] ?: return null
    for (c in aplicaciones(contexto)) {
      // Un duplicado de marcador de posición no es la app de verdad.
      if (c.paquete.endsWith("-dummy") || c.paquete.endsWith(".dummy")) continue
      val n = normalizar(c.etiqueta)
      if (palabras.any { n.contains(it) }) return c.paquete
    }
    return null
  }

  /**
   * Por qué no se pudo, para el aviso. Cuando la app no aparece, se listan las
   * candidatas parecidas con su paquete: así el usuario (o yo) ve qué está viendo
   * el sistema en vez de un «no está instalada» que quizá no es verdad.
   */
  private fun motivoNoEncontrada(contexto: Context, clave: String, nombre: String): String {
    val raiz = raices[clave] ?: return "$nombre no está instalada en este aparato"
    val parecidas = aplicaciones(contexto)
      .filter { normalizar(it.etiqueta).contains(raiz) || it.paquete.lowercase().contains(raiz) }
      .distinctBy { it.paquete }
      .take(3)
    return if (parecidas.isEmpty()) {
      "$nombre no está instalada en este aparato"
    } else {
      "No reconozco $nombre. Veo: " + parecidas.joinToString("; ") { "«${it.etiqueta}» (${it.paquete})" }
    }
  }

  private fun lanzar(contexto: Context, intento: Intent): Boolean =
    try {
      contexto.startActivity(intento.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: ActivityNotFoundException) {
      false
    } catch (e: SecurityException) {
      false
    }

  /**
   * Abre la app de la plataforma. Devuelve `null` si se abrió, o el motivo del
   * fallo, listo para enseñárselo al usuario.
   */
  fun abrir(contexto: Context, clave: String, nombre: String): String? {
    val paquete = paqueteDe(contexto, clave) ?: return motivoNoEncontrada(contexto, clave, nombre)
    val pm = contexto.packageManager
    val intento = pm.getLaunchIntentForPackage(paquete) ?: pm.getLeanbackLaunchIntentForPackage(paquete)
      ?: return "$nombre está instalada ($paquete) pero no tiene pantalla de inicio"
    return if (lanzar(contexto, intento)) null else "$nombre ($paquete) no se dejó abrir"
  }

  /**
   * Va directo al título con el enlace que dio el servidor (Watchmode), que es
   * una URL web universal: `tv.apple.com/…`, `app.primevideo.com/detail?gti=…`,
   * `wl.movistarplus.es/ficha/?id=…`. Se intenta primero dentro de la app de la
   * plataforma; si esa app no reclama esa URL se deja que decida el sistema
   * (que puede abrir otra app o el navegador); y si nada la abre, se abre la app
   * a secas. Devuelve `null` si se abrió algo, o el motivo del fallo.
   */
  /**
   * Lo que hace un toque, con toda la cadena de planes:
   *  1. enlace directo de Watchmode, dentro de la app de la plataforma;
   *  2. si Watchmode no conoce el título, la página de TMDb (ahí se pulsa el logo
   *     de la plataforma y JustWatch lleva a la app: un toque más, pero al título);
   *  3. si tampoco hay eso, la app a secas.
   * Devuelve `null` si se abrió algo, o el motivo del fallo. `avisar` recibe un
   * texto informativo cuando se cae al plan B, para que no parezca un error.
   */
  fun abrirConRespaldo(
    contexto: Context,
    clave: String,
    nombre: String,
    enlace: casa.tvwatch.datos.EnlaceDirecto?,
    avisar: (String) -> Unit,
  ): String? {
    val url = enlace?.url
    if (url != null) return abrirTitulo(contexto, clave, nombre, url)
    val respaldo = enlace?.respaldo.orEmpty()
    if (respaldo.isNotEmpty() && lanzar(contexto, Intent(Intent.ACTION_VIEW, Uri.parse(respaldo)))) {
      avisar("Sin enlace directo a $nombre: toca su logotipo en la página")
      return null
    }
    return abrir(contexto, clave, nombre)
  }

  fun abrirTitulo(contexto: Context, clave: String, nombre: String, url: String): String? {
    val uri = Uri.parse(url)
    val paquete = paqueteDe(contexto, clave)
    if (paquete != null && lanzar(contexto, Intent(Intent.ACTION_VIEW, uri).setPackage(paquete))) return null
    if (lanzar(contexto, Intent(Intent.ACTION_VIEW, uri))) return null
    return abrir(contexto, clave, nombre)
  }
}
