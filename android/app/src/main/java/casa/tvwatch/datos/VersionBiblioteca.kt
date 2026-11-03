package casa.tvwatch.datos

import kotlinx.serialization.Serializable

/**
 * «¿Ha cambiado la biblioteca desde que cargué?», en una respuesta de treinta bytes.
 *
 * La portada se guarda en memoria cinco minutos para que ir y volver sea instantáneo y el destacado no salte de
 * película cada vez. El precio era que una película recién añadida no se veía **hasta cerrar la aplicación**: la
 * pantalla lee la caché al componerse y su efecto se salta la petición si ya hay datos.
 *
 * Con esto no hay que elegir entre las dos cosas. Al volver al primer plano se pregunta el sello —que el servidor
 * cambia solo cuando un escaneo ha añadido o retirado algo de verdad— y la caché se tira únicamente si no coincide.
 *
 * En fichero aparte y no en `Api.kt` a propósito: ese fichero lo está tocando otra sesión, y esto no necesita nada
 * de dentro que no sea público.
 */
@Serializable
data class SelloBiblioteca(val version: String = "")

/**
 * El sello de ahora, o cadena vacía si no se pudo preguntar.
 *
 * Vacío cubre tres casos y en los tres hay que dejar la caché como está: sin red, servidor más viejo que no conoce la
 * ruta (404), o sesión caducada. Lo último no se propaga adrede: quien echa de la sesión es la petición de la portada,
 * que sí tiene a quién avisar; esto es una comodidad de fondo y no debe sacar a nadie de la aplicación.
 */
fun pedirSelloBiblioteca(): String =
  runCatching { Api.json.decodeFromString<SelloBiblioteca>(Api.texto("/api/library/version")).version }
    .getOrDefault("")
