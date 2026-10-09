# Android: audio y subtítulos en la ficha y en Cast (3.37 – 3.42)

Para quien continúe (Claude o Gemini). Estado a 09/10/2026.

## DÓNDE LO DEJO (leer primero)
Última versión publicada: **3.42** (GitHub release `v3.38`, APK en `web/public` y `web/dist`, `instalar.html` apuntando a ella). Todo está commiteado y empujado.

**Lo único que queda por hacer es probar en un móvil real con Chromecast** (yo no tengo dispositivo):
1. Cast: el botón de audio del control ampliado (hueco 1, `ControlDeCast`) y que el cambio recargue el stream en la posición actual; subtítulos de Cast tras elegirlos en la ficha.
2. Una serie: elegir audio/subtítulo en la ficha y reproducir un episodio (reproductor y Cast) — solo está compilado, no visto.
Si algo falla, arreglarlo en `Cast.kt` / `Pistas.kt` / `ui/Ficha.kt`; las pistas y el reproductor tienen tests en `src/test/.../PistasTest.kt` (11).

**SIGUIENTE (pedido el 09/10/2026, sin empezar, pendiente de OK al diseño): «También en X plataforma» para cualquier usuario.** Hoy está fijo para las tres plataformas del dueño (`PLATAFORMAS` en `server/src/media/plataformas.ts`: Movistar+, Prime, Apple TV+) y es global. No hay «cuentas» que conectar: los datos son de TMDb/JustWatch por región (ES) y las plataformas van con DRM, así que basta que cada perfil **marque a qué está suscrito**. Diseño propuesto: (1) ampliar el catálogo (Netflix, Disney+, Max, SkyShowtime, Filmin, Rakuten TV…; **verificar cada `provider_id` de TMDb con `/watch/providers/movie?watch_region=ES` y cada `source_id` de Watchmode con `/sources/?regions=ES` antes de escribirlos**) y re-ejecutar el refresco de `item_plataformas`; (2) guardar por usuario sus plataformas (tabla o `preferences`) y filtrar `dondeVer`/`/api/plataformas` por el perfil que pregunta; el perfil del dueño arranca con sus tres y los demás sin ninguna hasta elegir; (3) Android: Ajustes → «Mis plataformas» con interruptores (la tele, después). Cuidado: Watchmode gratuito = 2.500 llamadas/mes y se llama solo al pulsar.

**Decisiones del usuario (no reabrir):**
- Los subtítulos **no tienen ajuste por defecto**: se eligen en la ficha o durante la reproducción y empiezan apagados. Por eso se **borraron** `modoSubtitulos` e `idiomaSubtitulosPreferido` de `Ajustes.kt`. No añadir ajustes de subtítulos.
- El idioma de audio preferido (Ajustes → «Idioma de audio») sí se queda.
- La tele no necesita recibir la elección de pistas desde el móvil.
- Se olvida la Samsung de 2024.
- Los iconos de la ficha (Audio/Subtítulos) van en **todo lo que tenga fichero**, series incluidas.

**Qué es «audio múltiple en Cast»:** el HLS que el servidor da a Cast lleva **una sola pista de audio** (`...master.m3u8?...&audio=<id>`: el servidor elige una al generarlo). Por eso cambiar de audio en Cast hace pedir otro HLS y recargar (corte breve). Un cambio sin corte exigiría que el servidor generase un HLS con **todas** las pistas de audio declaradas (`#EXT-X-MEDIA TYPE=AUDIO`) y que Cast cambiara de pista sin recargar. Es un cambio en `server/src/media/hls.ts`, no en la app; **no hace falta** si el corte breve vale.

**Otros pendientes verificados el 09/10/2026:**
- **luzapp** (`ComparadorLuz-Semanal`): la ejecución del 08/10 abortó (`ABORTADO: hay cambios fuera de los ficheros de datos publicos`, por `AGENTS.md`). Hoy `git status` solo muestra los dos JSON de datos permitidos, así que la del 10/10 09:00 debería pasar. **No ejecutada para comprobarlo** (publicaría). Mirar `C:\luzapp\actualizar-semanal.log` el 10/10. Ojo: la tarea usa `powershell.exe` (5.1), no pwsh 7.
- **Caddy, retardo de 30 s al arrancar:** no verificable sin administrador (la tarea que lo lanza es de SYSTEM y `Get-ScheduledTask`/`schtasks` no la muestran; Caddy cuelga de `svchost`). Hecho comprobado en una sesión anterior: si el IP de Tailscale (`bind` del Caddyfile) aún no existe al arrancar, Caddy falla y **cae también el dominio público**; se recuperó solo en ~1 min. Se puede dejar así (el coste es ~1 min de corte tras reiniciar); el retardo solo lo acortaría.
- **Instalador de Intel Arc** `C:\Users\HTPC\Downloads\gfx_win_101.9034.exe`: la herramienta denegó el `rm`; hay que borrarlo a mano.
- MediaBox: el usuario ya instaló el APK con la corrección de colores.

## Qué pedía el usuario
1. La ficha de la app Android debe parecerse a la de la tele (Tizen): **solo «Reproducir» lleva texto**; el resto de acciones son iconos redondos con su nombre debajo.
2. Poder elegir **audio y subtítulos desde la ficha**, como en la tele.
3. En el control ampliado de **Cast** debe haber selector de audio, como ya había de subtítulos.

## Qué hay hecho en 3.37
| Pieza | Fichero (`android/app/src/main/java/casa/tvwatch/`) |
|---|---|
| Iconos y selector (portados de `tv/src/main.ts`, `ACCIONES`) | `ui/AccionesDeFicha.kt` |
| Ficha: botón Reproducir, fila de iconos, etiquetas de lo elegido, diálogos | `ui/Ficha.kt` |
| Regla de elección de audio + buzón de un solo uso ficha→reproductor/Cast | `datos/Pistas.kt` (`Pistas`, `EleccionDePistas`) |
| Reproductor recoge la elección y aplica subtítulo inicial | `ui/Reproductor.kt` (`buscarSubtitulo`) |
| Cast: `&audio=<id>` en la URL HLS, botón de audio en el control ampliado | `Cast.kt` (`emitir`, `cambiarAudio`, `ControlDeCast`), `res/values/cast.xml`, `res/drawable/ic_audio_cast.xml`, `res/values/themes.xml` |
| Ajustes: fila «Idioma de audio» (spa / orig) | `ui/AjustesPantalla.kt` |
| Tests (9) de la regla de audio | `src/test/.../PistasTest.kt` |

Regla de audio (`Pistas.elegirAudio`): elegida a mano > preferida («spa» → español) > primera compatible > primera. Cast ignora la compatibilidad de códec (el servidor transcodifica).

## Lo que se encontró
- La preferencia `idiomaAudioPreferido` existía pero **nadie la leía**. Ahora sí.
- `modoSubtitulos` / `idiomaSubtitulosPreferido`: eran código muerto; **borrados** (decisión del usuario).
- El HLS de Cast lleva **una sola pista de audio** (`...master.m3u8?...&surround=1&audio=<streamIndex>`): cambiar de audio en Cast **recarga el stream** en la posición actual (corte breve).

## Verificado
- `gradle :app:testDebugUnitTest` → 11 tests, 0 fallos.
- Emulador con servidor aislado (copia de la BD, puerto 8731): ficha con iconos, selector de audio (cambia la etiqueta a «Inglés · EAC3 5.1…»), fila de etiquetas. **Cast no se pudo probar** (sin dispositivo): solo compila. Hipótesis sin medir: que el botón del control ampliado aparezca en el hueco 1 y recargue bien.

## 3.38 (09/10/2026)
- **Series:** la ficha muestra Audio/Subtítulos con las pistas del próximo episodio por ver (o el primero). Lo elegido se guarda **por idioma** en memoria (`EleccionDePistas.DeSerie`, vive mientras la app esté abierta) y reproductor y Cast lo aplican a cualquier episodio de ese título (`Pistas.elegirAudio(..., idioma=)`, `Pistas.subtituloParecido`). Verificado en emulador solo que los iconos y las etiquetas salen; **no probado** reproducir un episodio con la elección puesta.
- **Reordenar menú (3.39):** arrastrando en el propio menú lateral, sin pantalla en Ajustes (`ui/Menu.kt`): pulsación larga en una entrada → modo edición (ojo abierto/tachado para esconder, «Listo» para salir; las escondidas se ven atenuadas solo en edición). Cada grupo (secciones / bibliotecas) se ordena aparte; «Ajustes» ni se mueve ni se esconde. Claves como en la tele (`inicio`, `buscar`, `favoritos`, `descargas`, `sagas`, `plataformas`, `lib-<id>`), guardadas en `Ajustes.ordenMenu` / `menuOcultos` (local al móvil; son `mutableIntStateOf`-observables). Verificado en emulador: arrastre, ojo, «Listo», persistencia y repintado en vivo del menú y de los atajos de la portada.
- **3.40, arrastre:** los gestos van en UNA columna fija (dentro del scroll del menú) con una tabla de límites por fila, y el menú se desplaza solo cerca de los bordes. Antes el gesto estaba en cada fila y **Compose cancela un gesto cuando mueve la fila** al reordenar: solo se podía saltar de uno en uno (en emulador con eventos rápidos no se veía; con eventos lentos, sí). Verificado: Animación recorrió 8 puestos en un solo arrastre lento.
- **3.40, destacado (`Portada.kt`):** «Buscar» sacado del pager (se deslizaba con cada página) y `clipToBounds` en la tarjeta (el zoom del fondo asomaba por los lados y por debajo).
- **3.41, destacado:** el `HorizontalPager` se sustituyó por `Crossfade` (700 ms) con un gesto de arrastre horizontal que cambia de película; el deslizamiento dejaba dos fotogramas a medias con textos cortados. Verificado en emulador (fundido a medias y asentado).
- **3.42:** el botón de la ficha dice «Reanudar · 31:25 · faltan 2 h 28 min» (total del fichero o, si no, la duración de la ficha). Solo en la app Android; la tele no lo tiene.
- **App de la tele (`tv/src/main.ts`), 09/10/2026, SIN INSTALAR en la tele** (el puerto sdb 26101 no contestaba): (a) «Reanudar 31:25 · faltan 2 h 29 min» (`textoQueFalta`); (b) Audio/Subtítulos también en la ficha de series, con lo elegido guardado por idioma (`seleccionSerie`, `resolverSerie`, `recordarSerie`), aplicado al reproducir cualquier episodio y al cambiar de pista en el reproductor. Verificado en navegador contra el servidor aislado (`/tv/`): la etiqueta «Reanudar … faltan» y el cambio de audio en la ficha de una serie; **no** verificado en el reproductor (AVPlay no existe en el navegador). `tsc` y `vite build` pasan. El servidor ya sirve el build nuevo en `/tv/` (el `dist` no va en git). Para instalarla en la tele: skill `instalar-app-tizen`. La tele no tiene el orden de menú por arrastre (usa «Reordenar el menú» con botones, con el mando).
- Por hacer: el orden no se comparte entre móvil y tele (la tele lo guarda en su localStorage).

## Limitaciones conocidas (por hacer)
- «En la tele» (mando a Tizen) no transmite la elección de pistas: aceptado por el usuario.
- Subtítulo elegido → se busca por heurística (idioma + forzados); si hay dos del mismo idioma puede escoger otro.
- Audio múltiple real en Cast requeriría HLS con `EXT-X-MEDIA` en el servidor (cambio grande).

## Referencias en la app de la tele
`tv/src/main.ts`: `ACCIONES` (~l.90), botones de la ficha (~1448-1470), etiquetas (~1676-1712), panel de pistas (~2018-2062). Si se cambia un icono allí, cambiarlo en `AccionesDeFicha.kt`.

## Cómo probar sin móvil
1. Copiar `src/`, `package.json` y la última copia de `data/copias/*.db` a una carpeta de trabajo; `config.json` con puerto 8731; enlazar `node_modules`. **Nunca tocar `data/` real.**
2. En la copia, `UPDATE users SET pin=NULL, pin_len=NULL WHERE name='Ernesto'`.
3. Lanzar `node src/index.ts` ahí; en el emulador, servidor `10.0.2.2:8731`.
4. Recetas del emulador: skill `probar-app-android`.

## Trampas de esta sesión
- Un proceso lanzado desde la sesión de la herramienta **muere con ella** (así cayó el servidor 16 h: 502). Lanzar procesos duraderos por **WMI**, o dejar que los reviva el vigilante (`vigilar-servidor.ps1`, arranca al iniciar sesión).
- La herramienta de edición convierte ` / ` en caracteres reales y rompe regex; `node --check` no lo detecta. Escribir con `chr(92)+'u2028'` y probar importando.
- Publicar: tag, `gh release create --verify-tag`, copiar el APK a `web/public` **y** `web/dist`, cambiar `instalar.html` en ambos, verificar tamaño contra el dominio real.
