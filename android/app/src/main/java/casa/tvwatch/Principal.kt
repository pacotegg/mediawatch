package casa.tvwatch

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import casa.tvwatch.datos.Api
import casa.tvwatch.datos.Cache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import casa.tvwatch.datos.Ajustes
import casa.tvwatch.ui.Destino
import casa.tvwatch.ui.Fondo
import casa.tvwatch.ui.Menu
import casa.tvwatch.ui.Movimiento
import casa.tvwatch.ui.PantallaBiblioteca
import casa.tvwatch.ui.PantallaBuscar
import casa.tvwatch.ui.PantallaConexion
import casa.tvwatch.ui.PantallaFavoritas
import casa.tvwatch.ui.PantallaFicha
import casa.tvwatch.ui.PantallaPersona
import casa.tvwatch.ui.PantallaPortada
import casa.tvwatch.ui.PantallaReproductor
import casa.tvwatch.ui.PantallaSaga
import casa.tvwatch.ui.PantallaSagas
import casa.tvwatch.ui.nombreDeSaga
import casa.tvwatch.ui.PantallaSelectorDeArte
import casa.tvwatch.ui.TemaTvWatch
import casa.tvwatch.ui.Texto
import kotlinx.coroutines.launch
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * La aplicación.
 *
 * Una sola actividad y navegación de Compose, que es lo que hace que el botón
 * Atrás del sistema funcione como espera cualquiera sin escribir nada: vuelve
 * a la pantalla anterior y, en la primera, sale.
 *
 * Alrededor de todo va el menú lateral: las tres rayas arriba a la izquierda
 * en las pantallas de recorrer la biblioteca, y arrastrar desde el borde en
 * cualquiera menos el reproductor y la de conectar.
 */
class Principal : AppCompatActivity() {

  override fun onCreate(estado: Bundle?) {
    super.onCreate(estado)
    enableEdgeToEdge()
    Ajustes.iniciar(this)
    /*
     * Chromecast se inicializa aquí, en onCreate, y no cuando se pinta el
     * botón: el SDK engancha la búsqueda de aparatos al ciclo de vida de la
     * actividad, y si se inicializa después de onResume no busca nada hasta
     * la siguiente vez que la aplicación pase a primer plano. Es el motivo
     * clásico de «el botón está pero no encuentra nada». Sin servicios de
     * Google no hay Cast y no pasa nada.
     */
    try { com.google.android.gms.cast.framework.CastContext.getSharedInstance(this) } catch (e: Exception) { /* sin Cast */ }

    setContent {
      TemaTvWatch {
        val nav = rememberNavController()
        Navegacion(nav)
      }
    }
  }
}

private object Rutas {
  const val CONEXION = "conexion"
  const val PORTADA = "portada"
  const val BIBLIOTECA = "biblioteca/{id}/{nombre}"
  const val FICHA = "ficha/{id}"
  const val REPRODUCTOR = "ver/{fileId}/{itemId}/{episodioId}/{desde}"
  const val ARTE = "arte/{id}/{kind}/{titulo}/{anio}"
  const val BUSCAR = "buscar"
  const val FAVORITAS = "favoritas"
  const val SAGAS = "sagas"
  const val SAGA = "saga/{nombre}"
  const val PERSONA = "persona/{id}"

  fun saga(nombre: String) = "saga/" + URLEncoder.encode(nombre, "UTF-8")

  fun biblioteca(id: Int, nombre: String) =
    "biblioteca/$id/" + URLEncoder.encode(nombre, "UTF-8")

  fun ficha(id: Int) = "ficha/$id"

  // El episodio va como -1 cuando no lo hay: la navegación de Compose no sabe
  // pasar nulos por la ruta y un centinela es más claro que un parámetro suelto.
  fun reproductor(fileId: Int, itemId: Int, episodioId: Int?, desde: Double) =
    "ver/$fileId/$itemId/${episodioId ?: -1}/${desde.toInt()}"

  fun arte(id: Int, kind: String, titulo: String, anio: Int?) =
    "arte/$id/$kind/" + URLEncoder.encode(titulo, "UTF-8") + "/" + (anio ?: -1)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Navegacion(nav: NavHostController) {
  val inicio = if (Ajustes.configurado) Rutas.PORTADA else Rutas.CONEXION
  val contexto = LocalContext.current
  val cajon = rememberDrawerState(DrawerValue.Closed)
  val ambito = rememberCoroutineScope()
  val entradaActual by nav.currentBackStackEntryAsState()
  val rutaActual = entradaActual?.destination?.route
  val bibliotecaActual = if (rutaActual == Rutas.BIBLIOTECA) entradaActual?.arguments?.getInt("id") else null

  /** Se pierde la sesión: a la pantalla de conexión, y sin dejar volver atrás. */
  fun aConexion() {
    Ajustes.olvidarSesion()
    nav.navigate(Rutas.CONEXION) { popUpTo(0) }
  }

  /**
   * Ir desde el menú. Siempre encima de la portada y sin repetir: si se pulsa
   * «Películas» tres veces no se apilan tres bibliotecas, y Atrás desde
   * cualquier sitio del menú vuelve al inicio.
   */
  fun irA(destino: Destino) {
    ambito.launch { cajon.close() }
    fun encimaDeLaPortada(ruta: String) = nav.navigate(ruta) {
      popUpTo(Rutas.PORTADA)
      launchSingleTop = true
    }
    when (destino) {
      Destino.Inicio -> nav.popBackStack(Rutas.PORTADA, inclusive = false)
      Destino.Buscar -> encimaDeLaPortada(Rutas.BUSCAR)
      Destino.Favoritas -> encimaDeLaPortada(Rutas.FAVORITAS)
      Destino.Sagas -> encimaDeLaPortada(Rutas.SAGAS)
      is Destino.Biblioteca -> encimaDeLaPortada(Rutas.biblioteca(destino.id, destino.nombre))
      Destino.Salir -> aConexion()
    }
  }

  fun abrirMenu() { ambito.launch { cajon.open() } }

  /**
   * Darle a reproducir. Si hay un Chromecast conectado, va para allá y se
   * abre su pantalla de control; si no, el reproductor de aquí.
   */
  fun reproducir(fileId: Int, itemId: Int, episodioId: Int?, desde: Double) {
    if (Cast.emitiendo(contexto)) {
      val titulo = Cache.fichaGuardada(itemId)?.title
      if (titulo != null) {
        Cast.emitir(contexto, fileId, itemId, episodioId, titulo, desde)
      } else {
        ambito.launch {
          val t = try { withContext(Dispatchers.IO) { Api.ficha(itemId) }.title } catch (e: Exception) { "Media Watch" }
          Cast.emitir(contexto, fileId, itemId, episodioId, t, desde)
        }
      }
      return
    }
    nav.navigate(Rutas.reproductor(fileId, itemId, episodioId, desde))
  }

  ModalNavigationDrawer(
    drawerState = cajon,
    // Ni viendo una película ni antes de entrar: ahí el borde no es un menú.
    gesturesEnabled = rutaActual != Rutas.REPRODUCTOR && rutaActual != Rutas.CONEXION,
    scrimColor = Color(0x99000000),
    drawerContent = { Menu(rutaActual, bibliotecaActual, ::irA) },
  ) {
  Box(Modifier.fillMaxSize().background(Fondo)) {
    /*
     * Cómo entra y sale cada pantalla.
     *
     * Ni el deslizamiento lateral de Android ni nada estridente: la pantalla
     * nueva **aparece creciendo desde un 96 %** mientras la de debajo se apaga
     * un poco. Es el gesto del Apple TV y de iOS al abrir una ficha, y es lo que
     * hace que abrir una película parezca que la película se acerca en vez de
     * que una pantalla empuja a otra.
     *
     * Al volver, lo mismo del revés y más rápido: volver siempre tiene que
     * parecer más ligero que entrar.
     */
    NavHost(
      navController = nav,
      startDestination = inicio,
      enterTransition = {
        fadeIn(Movimiento.aparecer(260)) +
          scaleIn(initialScale = 0.96f, animationSpec = Movimiento.aparecer(320))
      },
      exitTransition = { fadeOut(Movimiento.aparecer(180)) + scaleOut(targetScale = 1.02f, animationSpec = Movimiento.aparecer(220)) },
      popEnterTransition = { fadeIn(Movimiento.aparecer(200)) + scaleIn(initialScale = 1.015f, animationSpec = Movimiento.aparecer(240)) },
      popExitTransition = { fadeOut(Movimiento.aparecer(160)) + scaleOut(targetScale = 0.97f, animationSpec = Movimiento.aparecer(200)) },
    ) {

      composable(Rutas.CONEXION) {
        PantallaConexion(alEntrar = {
          nav.navigate(Rutas.PORTADA) { popUpTo(0) }
        })
      }

      composable(Rutas.PORTADA) {
        Pantalla(titulo = "Media Watch", nav = nav, conVolver = false, alMenu = ::abrirMenu) {
          PantallaPortada(
            alAbrirFicha = { nav.navigate(Rutas.ficha(it)) },
            alAbrirBiblioteca = { id, nombre -> nav.navigate(Rutas.biblioteca(id, nombre)) },
            alBuscar = { nav.navigate(Rutas.BUSCAR) },
            alPerderSesion = { aConexion() },
          )
        }
      }

      composable(
        Rutas.BIBLIOTECA,
        arguments = listOf(
          navArgument("id") { type = NavType.IntType },
          navArgument("nombre") { type = NavType.StringType },
        ),
      ) { entrada ->
        val id = entrada.arguments?.getInt("id") ?: 0
        val nombre = URLDecoder.decode(entrada.arguments?.getString("nombre") ?: "", "UTF-8")
        Pantalla(titulo = nombre, nav = nav, alMenu = ::abrirMenu) {
          PantallaBiblioteca(
            libraryId = id,
            nombre = nombre,
            alAbrirFicha = { nav.navigate(Rutas.ficha(it)) },
            alPerderSesion = { aConexion() },
          )
        }
      }

      composable(Rutas.FAVORITAS) {
        Pantalla(titulo = "Favoritas", nav = nav, alMenu = ::abrirMenu) {
          PantallaFavoritas(
            alAbrirFicha = { nav.navigate(Rutas.ficha(it)) },
            alPerderSesion = { aConexion() },
          )
        }
      }

      composable(Rutas.SAGAS) {
        Pantalla(titulo = "Sagas", nav = nav, alMenu = ::abrirMenu) {
          PantallaSagas(
            alAbrirSaga = { nav.navigate(Rutas.saga(it)) },
            alPerderSesion = { aConexion() },
          )
        }
      }

      composable(
        Rutas.SAGA,
        arguments = listOf(navArgument("nombre") { type = NavType.StringType }),
      ) { entrada ->
        val nombre = URLDecoder.decode(entrada.arguments?.getString("nombre") ?: "", "UTF-8")
        Pantalla(titulo = nombreDeSaga(nombre), nav = nav) {
          PantallaSaga(
            nombre = nombre,
            alAbrirFicha = { nav.navigate(Rutas.ficha(it)) },
            alPerderSesion = { aConexion() },
          )
        }
      }

      composable(
        Rutas.FICHA,
        arguments = listOf(navArgument("id") { type = NavType.IntType }),
      ) { entrada ->
        val id = entrada.arguments?.getInt("id") ?: 0
        Pantalla(titulo = "", nav = nav) {
          PantallaFicha(
            itemId = id,
            alReproducir = { fileId, episodioId, desde -> reproducir(fileId, id, episodioId, desde) },
            alCambiarImagenes = { kind, titulo, anio -> nav.navigate(Rutas.arte(id, kind, titulo, anio)) },
            alPerderSesion = { aConexion() },
            alAbrirPersona = { nav.navigate("persona/$it") },
          )
        }
      }

      composable(Rutas.BUSCAR) {
        Pantalla(titulo = "Buscar", nav = nav, alMenu = ::abrirMenu) {
          PantallaBuscar(
            alAbrirFicha = { nav.navigate(Rutas.ficha(it)) },
            alReproducirDesde = { fileId, itemId, episodioId, desde -> reproducir(fileId, itemId, episodioId, desde) },
            alPerderSesion = { aConexion() },
            alAbrirPersona = { nav.navigate("persona/$it") },
          )
        }
      }

      composable(
        Rutas.PERSONA,
        arguments = listOf(navArgument("id") { type = NavType.IntType }),
      ) { entrada ->
        Pantalla(titulo = "", nav = nav) {
          PantallaPersona(
            personaId = entrada.arguments?.getInt("id") ?: 0,
            alAbrirFicha = { nav.navigate(Rutas.ficha(it)) },
            alPerderSesion = { aConexion() },
          )
        }
      }

      composable(
        Rutas.ARTE,
        arguments = listOf(
          navArgument("id") { type = NavType.IntType },
          navArgument("kind") { type = NavType.StringType },
          navArgument("titulo") { type = NavType.StringType },
          navArgument("anio") { type = NavType.IntType },
        ),
      ) { entrada ->
        val a = entrada.arguments!!
        Pantalla(titulo = "Imágenes", nav = nav) {
          PantallaSelectorDeArte(
            itemId = a.getInt("id"),
            kind = a.getString("kind") ?: "movie",
            titulo = URLDecoder.decode(a.getString("titulo") ?: "", "UTF-8"),
            anio = a.getInt("anio").takeIf { it > 0 },
            alTerminar = { nav.popBackStack() },
          )
        }
      }

      /*
       * El reproductor va sin el marco común: ni barra de título ni flecha.
       * A pantalla completa y punto, que es lo que se espera al darle a play.
       */
      composable(
        Rutas.REPRODUCTOR,
        arguments = listOf(
          navArgument("fileId") { type = NavType.IntType },
          navArgument("itemId") { type = NavType.IntType },
          navArgument("episodioId") { type = NavType.IntType },
          navArgument("desde") { type = NavType.IntType },
        ),
      ) { entrada ->
        val a = entrada.arguments!!
        val episodio = a.getInt("episodioId").takeIf { it >= 0 }
        PantallaReproductor(
          fileId = a.getInt("fileId"),
          itemId = a.getInt("itemId"),
          episodioId = episodio,
          desdeSegundos = a.getInt("desde").toDouble(),
          alSalir = { nav.popBackStack() },
        )
      }
    }
  }
  }

  /*
   * Atrás con el menú abierto lo cierra, y nada más. Sin esto se quedaba
   * abierto y por debajo se volvía a la portada, que es lo peor de las dos
   * cosas. Va **después** del cajón: el último manejador registrado es el que
   * gana, y la navegación registra el suyo dentro del NavHost.
   */
  BackHandler(enabled = cajon.isOpen) { ambito.launch { cajon.close() } }
}

/**
 * Marco común: barra arriba con el título y, a la izquierda, la flecha de
 * volver o las tres rayas del menú.
 *
 * En la portada no hay adónde volver, así que van las rayas. En biblioteca,
 * buscar y favoritas se llega tanto desde el menú como desde la portada, y por
 * eso llevan las dos cosas: la flecha a la izquierda y el menú a la derecha.
 * La ficha va sin título porque ya lleva el logotipo de la película dentro;
 * poner el nombre otra vez arriba sería decirlo dos veces.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Pantalla(
  titulo: String,
  nav: NavHostController,
  conVolver: Boolean = true,
  alMenu: (() -> Unit)? = null,
  contenido: @Composable () -> Unit,
) {
  Scaffold(
    containerColor = Fondo,
    topBar = {
      TopAppBar(
        title = {
          Text(
            titulo,
            color = Texto,
            style = MaterialTheme.typography.headlineSmall,
          )
        },
        navigationIcon = {
          if (conVolver) {
            IconButton(onClick = { nav.popBackStack() }) {
              // Un galón fino, no una flecha gruesa: es el que usa iOS y el que
              // no compite con el contenido.
              Text("‹", color = Texto, fontSize = 32.sp)
            }
          } else if (alMenu != null) {
            BotonDeMenu(alMenu)
          }
        },
        actions = {
          BotonDeCast(Modifier.size(40.dp))
          if (conVolver && alMenu != null) BotonDeMenu(alMenu)
        },
        colors = TopAppBarDefaults.topAppBarColors(
          containerColor = Color.Transparent,
          titleContentColor = Texto,
        ),
      )
    },
  ) { relleno ->
    Box(Modifier.fillMaxSize().padding(top = relleno.calculateTopPadding())) {
      contenido()
    }
  }
}

@Composable
private fun BotonDeMenu(alMenu: () -> Unit) {
  IconButton(onClick = alMenu) {
    Icon(Icons.Default.Menu, contentDescription = "Menú", tint = Texto)
  }
}
