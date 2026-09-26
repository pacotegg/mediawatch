<!-- Destino: C:\tvwatch\CLAUDE.md -->
<!-- Es el MAPA. El detalle está en MEDIAWATCH-PROYECTO.md (mismo directorio) y en las skills. -->
<!-- No copiar aquí lo que ya está ahí: duplicar es garantizar que un día se contradigan. -->

# Media Watch

Servidor propio de películas y series al estilo Plex/Jellyfin, escrito desde cero. Corre en el
HTPC en `http://192.168.31.16:8730`. Lee la biblioteca ya catalogada por tinyMediaManager en `E:\`
(1.834 títulos, 5.566 ficheros de vídeo) y la sirve a tres clientes.

| Cliente | Carpeta | Stack |
|---|---|---|
| Web | `web/` | React 19 + Vite 6 + Tailwind 4 |
| Tele (Samsung QN93A) | `tv/` | TypeScript plano, ES2016/iife, AVPlay nativo |
| Android | `android/` | Kotlin + Compose + Media3 + Cast |

Se llamó Cineteca, luego TvWatch. El código, el paquete `casa.tvwatch` y el id de Tizen
`Cineteca01.Cineteca` **siguen con los nombres viejos a propósito**: cambiarlos instalaría una
segunda app en la tele.

## Estructura

```
C:\tvwatch                  monorepo npm (workspaces: server, web, tv; android va con Gradle)
├── server/                 API Fastify. Node 26 ejecuta TypeScript SIN COMPILAR
├── web/  tv/  android/     los tres clientes
├── data/                   NO versionado: BD, claves, arte, cachés, logs (3,9 GB)
├── MEDIAWATCH-PROYECTO.md  dosier completo del proyecto
└── vigilar-servidor.ps1    vigilante, arranca desde la carpeta Inicio
```

## Comandos

```bash
cd /c/tvwatch && npm start        # servidor, puerto 8730
npm run dev                       # servidor + web con recarga
npm run build                     # web/dist y tv/dist
npm run scan                      # escanear biblioteca (~30 s)
cd server && npm run arte -- --sustituir
cd server && npm run personas
```

Android (subir `versionCode` y `versionName` **antes**):

```bash
cd /c/tvwatch/android && JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot" \
  /c/gradle/gradle-8.10.2/bin/gradle.bat --no-daemon :app:assembleRelease
```

Para la tele, el comando de Docker completo está en `MEDIAWATCH-PROYECTO.md` §4 y en la skill
`instalar-app-tizen`. No reconstruirlo de memoria.

No hay tests. Se valida ejecutando contra la biblioteca real y mirando `data/server.err`.

## Permiso

**Preguntar antes, actuar tras confirmación. Sin excepciones y sin atajos.** Aquí rige la misma
regla que en todo lo demás: proponer el cambio concreto y esperar el visto bueno.

En el histórico de este proyecto aparece un "hazlo, no me pidas permiso". **Está derogado.** Si
algo parece acordado de antes, se confirma igualmente.

Cinco sitios donde además el error no se deshace. Con estos, decir exactamente qué va a pasar
antes de tocar nada — no significa que estén prohibidos, significa que el aviso y la confirmación
son obligatorios sin excepción, aunque parezca trivial:

- **Borrar cualquier cosa.** Nada de borrado automático. Eliminar solo a mano, en rojo, con
  confirmación y solo admin.
- **Escribir o borrar en `E:\`.** Se puede, pero solo diciendo antes exactamente qué fichero se va
  a crear, mover o borrar, y esperando el sí explícito — nunca como parte de un lote o una
  limpieza automática. El arte generado va a `data/artwork/`, no a la biblioteca; eso no necesita
  aviso porque no toca `E:\`.
- **Instalar o relanzar en la tele.** Puede estar viéndola. Él avisa cuando está libre.
- **Remuxear un fichero real**, incluido `media_files.id = 2912` (Historias de la cripta S06E03,
  timestamps rotos de verdad), que está pendiente de su decisión.
- **El PIN lo elige él**, nunca yo. Restaurar los datos de usuario tocados en pruebas.

## Cómo se trabaja aquí

- **Medir, no suponer.** Ejecutar contra la biblioteca real y enseñar la cifra.
- **Avisar durante las tandas largas**: qué se está haciendo y qué va saliendo.
- **Trabajos en lote = script en segundo plano**, no un botón en la web o la app.
- **Cada APK con número nuevo** (`MediaWatch-<ver>.apk`, 3.x menor / 4.0 mayor), versión visible
  al pie del menú.
- **Mirar las skills y el historial antes de decir "no se puede".**
- Estética: fluida por encima de bonita. Controles del reproductor a los 5 s; en pausa se quedan.
- Las claves de API viven en `data/config.json` y **no se registran en logs**.

## Quirks que muerden

Los de SQLite, ffmpeg/QSV, Tizen y Android están en `MEDIAWATCH-PROYECTO.md` §7, ya pagados.
Leerlo antes de tocar esas zonas. Los que reaparecen más:

- **Dos NULL no son iguales en SQLite**: `ON CONFLICT` no salta sobre una columna nulable.
  `UPDATE … WHERE col IS ?` + insert si `changes === 0`, más índice único parcial.
- **`COALESCE` protege la columna donde se escribe, no las vecinas.** Repetirlo en cada una.
- Una **cadena vacía guardada como marca** ("ya comprobado") es *falsy*: comprobar `!== null`.
- El **entorno de logon no tiene PATH**: ffmpeg, ffprobe y python por ruta absoluta.
- Node 26 ejecuta TS directamente: **una comilla invertida suelta rompe el arranque**.
- Un `spawn` sin `on('error')` **tumba el servidor entero**.
- En la web, `request()`/`post()` mandando `Content-Type` sin cuerpo → **400 mudo**. Ha pasado
  tres veces. La pista está en `data/server.err`, con el mismo mensaje repetido: **mirar el log,
  no solo el código**.
- Antes de "arreglar" una carrera: `node:sqlite` es síncrono. Sin un `await` real entre las dos
  operaciones, no puede entrelazarse.

## Dónde está el resto

- `MEDIAWATCH-PROYECTO.md` — dosier completo: cada fichero y su función, cronología, entorno de
  red, trampas al detalle, pendientes y descartes. **Consultarlo antes de preguntar.**
- Skills: `instalar-app-tizen`, `probar-app-android`, `acceso-externo-tvwatch`, `auditar-tvwatch`,
  `editar-webpanel-sin-romperlo`, `operacion-en-lote-biblioteca`.

## Git

Un único commit (`737dede`, 16/09). Hay cambios sin commitear del 16/09 y del 21/09.
Commits terminados con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
`data/` nunca entra: lleva las claves.
