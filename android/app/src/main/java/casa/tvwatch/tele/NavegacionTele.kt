package casa.tvwatch.tele

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Biblioteca
import casa.tvwatch.datos.Cache
import casa.tvwatch.ui.Fondo
import casa.tvwatch.ui.IconoBuscar
import casa.tvwatch.ui.IconoDeBiblioteca
import casa.tvwatch.ui.IconoEstrella
import casa.tvwatch.ui.IconoInicio
import casa.tvwatch.ui.IconoUsuario
import casa.tvwatch.ui.Movimiento
import casa.tvwatch.ui.PantallaReproductor
import casa.tvwatch.ui.Realce
import casa.tvwatch.ui.Texto
import casa.tvwatch.ui.TextoSuave
import casa.tvwatch.ui.TextoTenue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URLDecoder
import java.net.URLEncoder

private object RutasTele {
  const val CONEXION = "conexion"
  const val PORTADA = "portada"
  const val BUSCAR = "buscar"
  const val FAVORITAS = "favoritas"
  const val BIBLIOTECA = "biblioteca/{id}/{nombre}"
  const val FICHA = "ficha/{id}"
  const val REPRODUCTOR = "ver/{fileId}/{itemId}/{episodioId}/{desde}"

  fun biblioteca(id: Int, nombre: String) = "biblioteca/$id/" + URLEncoder.encode(nombre, "UTF-8")
  fun ficha(id: Int) = "ficha/$id"
  fun reproductor(fileId: Int, itemId: Int, episodioId: Int?, desde: Double) =
    "ver/$fileId/$itemId/${episodioId ?: -1}/${desde.toInt()}"
}

/** Ancho de la barra lateral recogida: solo iconos. */
private val RAIL = 72.dp

/**
 * La app en una tele.
 *
 * A la izquierda la barra de Plex: iconos que se despliegan con su nombre al
 * entrar en ella (flecha izquierda desde el contenido). Sale en las pantallas
 * de recorrer; la ficha y el reproductor van a pantalla completa y se sale de
 * ellas con Atrás.
 */
@Composable
fun NavegacionTele() {
  val nav = rememberNavController()
  val entrada by nav.currentBackStackEntryAsState()
  val ruta = entrada?.destination?.route
  val bibliotecaActual = if (ruta == RutasTele.BIBLIOTECA) entrada?.arguments?.getInt("id") else null
  val conBarra = ruta == RutasTele.PORTADA || ruta == RutasTele.BUSCAR || ruta == RutasTele.FAVORITAS || ruta == RutasTele.BIBLIOTECA

  fun aConexion() {
    Ajustes.olvidarSesion()
    Cache.olvidarTodo()
    nav.navigate(RutasTele.CONEXION) { popUpTo(0) }
  }

  fun irA(r: String) {
    if (r == RutasTele.PORTADA) { nav.popBackStack(RutasTele.PORTADA, false); return }
    nav.navigate(r) { popUpTo(RutasTele.PORTADA); launchSingleTop = true }
  }

  Box(Modifier.fillMaxSize().background(Fondo)) {
    NavHost(
      navController = nav,
      startDestination = if (Ajustes.configurado) RutasTele.PORTADA else RutasTele.CONEXION,
      modifier = Modifier.fillMaxSize().padding(start = if (conBarra) RAIL else 0.dp),
      enterTransition = {
        fadeIn(Movimiento.aparecer(240)) + scaleIn(initialScale = 0.95f, animationSpec = Movimiento.aparecer(280))
      },
      exitTransition = {
        fadeOut(Movimiento.aparecer(160)) + scaleOut(targetScale = 1.02f, animationSpec = Movimiento.aparecer(200))
      },
      popEnterTransition = {
        fadeIn(Movimiento.aparecer(200)) + scaleIn(initialScale = 1.02f, animationSpec = Movimiento.aparecer(220))
      },
      popExitTransition = {
        fadeOut(Movimiento.aparecer(160)) + scaleOut(targetScale = 0.95f, animationSpec = Movimiento.aparecer(180))
      },
    ) {
      composable(RutasTele.CONEXION) {
        ConexionTele(alEntrar = { nav.navigate(RutasTele.PORTADA) { popUpTo(0) } })
      }
      composable(RutasTele.PORTADA) {
        PortadaTele(alAbrirFicha = { nav.navigate(RutasTele.ficha(it)) }, alPerderSesion = ::aConexion)
      }
      composable(RutasTele.BUSCAR) {
        BuscarTele(alAbrirFicha = { nav.navigate(RutasTele.ficha(it)) }, alPerderSesion = ::aConexion)
      }
      composable(RutasTele.FAVORITAS) {
        FavoritasTele(alAbrirFicha = { nav.navigate(RutasTele.ficha(it)) }, alPerderSesion = ::aConexion)
      }
      composable(
        RutasTele.BIBLIOTECA,
        arguments = listOf(navArgument("id") { type = NavType.IntType }, navArgument("nombre") { type = NavType.StringType }),
      ) { e ->
        val id = e.arguments?.getInt("id") ?: 0
        val nombre = URLDecoder.decode(e.arguments?.getString("nombre") ?: "", "UTF-8")
        BibliotecaTele(id, nombre, alAbrirFicha = { nav.navigate(RutasTele.ficha(it)) }, alPerderSesion = ::aConexion)
      }
      composable(RutasTele.FICHA, arguments = listOf(navArgument("id") { type = NavType.IntType })) { e ->
        val id = e.arguments?.getInt("id") ?: 0
        FichaTele(
          itemId = id,
          alReproducir = { fileId, episodio, desde -> nav.navigate(RutasTele.reproductor(fileId, id, episodio, desde)) },
          alPerderSesion = ::aConexion,
          alAbrirFicha = { nav.navigate(RutasTele.ficha(it)) },
        )
      }
      composable(
        RutasTele.REPRODUCTOR,
        arguments = listOf(
          navArgument("fileId") { type = NavType.IntType },
          navArgument("itemId") { type = NavType.IntType },
          navArgument("episodioId") { type = NavType.IntType },
          navArgument("desde") { type = NavType.IntType },
        ),
      ) { e ->
        val a = e.arguments!!
        PantallaReproductor(
          fileId = a.getInt("fileId"),
          itemId = a.getInt("itemId"),
          episodioId = a.getInt("episodioId").takeIf { it >= 0 },
          desdeSegundos = a.getInt("desde").toDouble(),
          alSalir = { nav.popBackStack() },
        )
      }
    }

    if (conBarra) {
      BarraLateral(ruta, bibliotecaActual, irA = ::irA, alSalir = ::aConexion)
    }
  }
}

@Composable
private fun BarraLateral(ruta: String?, bibliotecaActual: Int?, irA: (String) -> Unit, alSalir: () -> Unit) {
  var bibliotecas by remember { mutableStateOf(Cache.bibliotecasGuardadas() ?: emptyList()) }
  LaunchedEffect(Unit) {
    try {
      val b = withContext(Dispatchers.IO) { Api.bibliotecas() }
      Cache.guardarBibliotecas(b)
      bibliotecas = b
    } catch (_: Exception) { /* sin bibliotecas en la barra hasta la próxima */ }
  }
  var abierta by remember { mutableStateOf(false) }
  val ancho by animateDpAsState(if (abierta) 250.dp else RAIL, Movimiento.suave(), label = "barra")

  Column(
    Modifier
      .fillMaxHeight()
      .width(ancho)
      .background(
        if (abierta) Brush.horizontalGradient(0f to Color(0xF2050507), 0.85f to Color(0xE6050507), 1f to Color(0x00050507))
        else Brush.horizontalGradient(0f to Color(0xCC050507), 1f to Color(0x00050507)),
      )
      .onFocusChanged { abierta = it.hasFocus }
      .padding(start = 10.dp, top = 36.dp, end = 10.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    EntradaBarra("Buscar", ruta == "buscar", abierta, alPulsar = { irA("buscar") }) { IconoBuscar(it) }
    EntradaBarra("Inicio", ruta == "portada", abierta, alPulsar = { irA("portada") }) { IconoInicio(it) }
    bibliotecas.forEach { b: Biblioteca ->
      EntradaBarra(
        nombre = b.name,
        actual = bibliotecaActual == b.id,
        abierta = abierta,
        alPulsar = { irA(RutasTele.biblioteca(b.id, b.name)) },
      ) { IconoDeBiblioteca(b.name, b.kind, it) }
    }
    EntradaBarra("Favoritas", ruta == "favoritas", abierta, alPulsar = { irA("favoritas") }) {
      IconoEstrella(it, rellena = ruta == "favoritas", tamano = 22.dp)
    }
    Spacer(Modifier.weight(1f))
    if (abierta) {
      val ctx = LocalContext.current
      val ver = remember {
        try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }
      }
      Text(
        (if (Ajustes.perfil.isNotEmpty()) "${Ajustes.perfil}  ·  " else "") + "v$ver",
        color = casa.tvwatch.ui.TextoTenue,
        fontSize = 11.sp,
        modifier = Modifier.padding(start = 14.dp, bottom = 6.dp),
      )
    }
    EntradaBarra("Cambiar de perfil", false, abierta, alPulsar = alSalir) { IconoUsuario(it) }
    Spacer(Modifier.height(20.dp))
  }
}

@Composable
private fun EntradaBarra(
  nombre: String,
  actual: Boolean,
  abierta: Boolean,
  alPulsar: () -> Unit,
  icono: @Composable (Color) -> Unit,
) {
  var foco by remember { mutableStateOf(false) }
  val tinta = when {
    foco -> Color(0xFF111114)
    actual -> Realce
    else -> TextoSuave
  }
  val fondo = when {
    foco -> Color.White
    actual && !abierta -> Color(0x1AE8B04A)
    else -> Color.Transparent
  }
  Row(
    Modifier
      .fillMaxWidth()
      .height(42.dp)
      .enfocable(RoundedCornerShape(100.dp), escala = 1.0f, aro = Color.Transparent, alFoco = { foco = it }, alPulsar = alPulsar)
      .clip(RoundedCornerShape(100.dp))
      .background(fondo)
      .padding(horizontal = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (actual) {
      Box(
        Modifier
          .size(width = 3.dp, height = 18.dp)
          .clip(RoundedCornerShape(2.dp))
          .background(if (foco) Color(0xFF111114) else Realce),
      )
      Spacer(Modifier.width(6.dp))
    } else {
      Spacer(Modifier.width(9.dp))
    }
    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
      icono(tinta)
    }
    AnimatedVisibility(
      visible = abierta,
      enter = fadeIn(Movimiento.aparecer(180)) + slideInHorizontally { -20 },
      exit = fadeOut(Movimiento.aparecer(120)) + slideOutHorizontally { -20 },
    ) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Spacer(Modifier.width(12.dp))
        Text(
          nombre,
          color = if (foco) tinta else if (actual) Realce else Texto,
          fontSize = 15.sp,
          fontWeight = if (actual) FontWeight.SemiBold else FontWeight.Normal,
          maxLines = 1,
        )
      }
    }
  }
}
