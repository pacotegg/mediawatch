plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("org.jetbrains.kotlin.plugin.serialization")
}

android {
  namespace = "casa.tvwatch"
  compileSdk = 35

  defaultConfig {
    applicationId = "casa.tvwatch"
    /*
     * Android 8. El móvil de casa lleva 13 o más, así que el suelo podría estar
     * más alto; se deja aquí porque no cuesta nada y permite instalarla en una
     * tableta vieja sin volver a tocar esto.
     */
    minSdk = 26
    targetSdk = 35
    /*
     * Cada APK que se entrega lleva un número nuevo: el segundo sube con
     * cambios pequeños (3.1, 3.2…) y el primero con cambios grandes (4.0).
     * `versionCode` sube siempre en uno: es lo que Android mira para instalar
     * encima. El nombre se ve al pie del menú lateral.
     */
    versionCode = 11
    versionName = "3.8"
  }

  buildFeatures { compose = true }

  buildTypes {
    debug {
      // Los cuatro ABIs: el emulador de este equipo es x86_64, y sin esa
      // librería no se puede probar aquí lo que se le entrega al móvil.
      ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86", "x86_64") }
    }
    release {
      isMinifyEnabled = false
      /*
       * Firmada con la clave de depuración a propósito: esto no va a ninguna
       * tienda, se instala a mano, y la clave es estable en este equipo, así
       * que una versión nueva se instala encima sin perder la sesión.
       */
      signingConfig = signingConfigs.getByName("debug")
      // Solo lo que lleva el móvil: cada ABI de más son 1,2 MB de librería.
      ndk { abiFilters += listOf("arm64-v8a") }
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  // AppCompat solo por Chromecast: el diálogo de elegir aparato es un fragmento
  // y necesita una actividad de AppCompat y su tema.
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("androidx.mediarouter:mediarouter:1.7.0")
  implementation("com.google.android.gms:play-services-cast-framework:21.5.0")
  implementation("androidx.activity:activity-compose:1.9.3")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

  val compose = platform("androidx.compose:compose-bom:2024.11.00")
  implementation(compose)
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-graphics")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-core")
  implementation("androidx.navigation:navigation-compose:2.8.4")

  // Carátulas: caché en memoria y en disco, y cancela la carga al salir de
  // pantalla. Es lo que hace que una rejilla de 1.372 títulos no se atragante.
  implementation("io.coil-kt:coil-compose:2.7.0")

  /*
   * El reproductor. Media3 (ExoPlayer) descodifica Matroska, HEVC y, si el
   * aparato trae el decodificador, AC3 y DD+. Eso es lo que permite mandar el
   * fichero original sin transcodificar: un navegador no abre un MKV y aquí no
   * hay discusión posible.
   */
  implementation("androidx.media3:media3-exoplayer:1.5.0")
  implementation("androidx.media3:media3-ui:1.5.0")
  // Sesión de medios: controles en la pantalla de bloqueo y en la notificación,
  // y que siga sonando con la pantalla apagada.
  implementation("androidx.media3:media3-session:1.5.0")

  /*
   * Decodificadores propios de AC3, DD+, TrueHD y DTS.
   *
   * Muchos móviles no traen licencia Dolby y su `MediaCodecList` no declara
   * ninguno de los dos; entonces el servidor tenía que convertir el audio a
   * AAC estéreo por una tubería de ffmpeg, y con ella los saltos costaban una
   * reapertura. Con esto el aparato lo descodifica solo y el fichero va tal
   * cual, que es lo que hacen Plex o VLC.
   *
   * No está en Maven: es un AAR compilado a mano desde media3 1.5.0 con
   * FFmpeg 6.0.2 (`ac3 eac3 truehd dca flac alac`, solo audio). Si algún día
   * hay que rehacerlo, está en MEDIAWATCH-PROYECTO.md.
   */
  implementation(files("libs/lib-decoder-ffmpeg-release.aar"))

  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
}
