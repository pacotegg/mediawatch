# Android: audio y subtítulos en la ficha y en Cast (3.37)

Para quien continúe (Claude o Gemini). Estado a 09/10/2026.

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
- `modoSubtitulos` e `idiomaSubtitulosPreferido` **siguen sin usarse**.
- El HLS de Cast lleva **una sola pista de audio** (`...master.m3u8?...&surround=1&audio=<streamIndex>`): cambiar de audio en Cast **recarga el stream** en la posición actual (corte breve).

## Verificado
- `gradle :app:testDebugUnitTest` → 11 tests, 0 fallos.
- Emulador con servidor aislado (copia de la BD, puerto 8731): ficha con iconos, selector de audio (cambia la etiqueta a «Inglés · EAC3 5.1…»), fila de etiquetas. **Cast no se pudo probar** (sin dispositivo): solo compila. Hipótesis sin medir: que el botón del control ampliado aparezca en el hueco 1 y recargue bien.

## 3.38 (09/10/2026)
- **Series:** la ficha muestra Audio/Subtítulos con las pistas del próximo episodio por ver (o el primero). Lo elegido se guarda **por idioma** en memoria (`EleccionDePistas.DeSerie`, vive mientras la app esté abierta) y reproductor y Cast lo aplican a cualquier episodio de ese título (`Pistas.elegirAudio(..., idioma=)`, `Pistas.subtituloParecido`). Verificado en emulador solo que los iconos y las etiquetas salen; **no probado** reproducir un episodio con la elección puesta.
- **Reordenar menú:** `ui/OrdenDelMenu.kt`, claves como en la tele (`inicio`, `buscar`, `favoritos`, `descargas`, `sagas`, `plataformas`, `lib-<id>`); se guarda en `Ajustes.ordenMenu` / `menuOcultos` (local al móvil, no se sincroniza con el servidor). «Ajustes» no se puede esconder. Verificado en emulador: el orden y lo escondido persisten y se reflejan en menú y atajos tras reabrir; el repintado en vivo con el menú abierto **no se vio**.
- Por hacer: el orden no se comparte entre móvil y tele (la tele lo guarda en su localStorage).

## Limitaciones conocidas (por hacer)
- «En la tele» (mando a Tizen) **no transmite** la elección de pistas.
- Subtítulo elegido → se busca por heurística (idioma + forzados); si hay dos del mismo idioma puede escoger otro.
- Audio múltiple real en Cast requeriría HLS con `EXT-X-MEDIA` en el servidor (cambio grande).
- Usar `modoSubtitulos` / `idiomaSubtitulosPreferido` (ver arriba).

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
