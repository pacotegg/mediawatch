# Reglas propias para R8 (activado en la 3.85 para reducir el APK).
#
# Chromecast encuentra su proveedor de opciones por el nombre escrito en el
# manifiesto (OPTIONS_PROVIDER_CLASS_NAME), que R8 no ve: sin esto lo quitaría o
# lo renombraría y la app se cerraría al pulsar el botón de enviar.
-keep class casa.tvwatch.OpcionesDeCast { <init>(); }

# Las trazas de los fallos que llegan al registro del servidor, legibles.
-keepattributes SourceFile,LineNumberTable
