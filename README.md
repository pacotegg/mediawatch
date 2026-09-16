# TvWatch

Servidor de películas y series propio, al estilo de Plex/Infuse pero sin depender de
ningún servicio externo. Lee la biblioteca de `E:\`, sirve el vídeo por la red local y
transcodifica sólo cuando el dispositivo que mira no puede reproducir el fichero tal cual.

## Arrancar

```bash
npm start
```

Queda en `http://localhost:8730` y, desde otros equipos de casa, en
`http://<ip-del-equipo>:8730`.

Para desarrollar, con recarga en caliente del frontend:

```bash
npm run dev
```

## Cómo está montado

| Carpeta  | Qué hay |
|----------|---------|
| `server/` | API en Node + TypeScript (Fastify). Node ejecuta el TypeScript directamente, sin compilar. |
| `web/`    | Interfaz en React + Vite. `npm run build` la deja en `web/dist`, que el servidor sirve solo. |
| `data/`   | Base de datos SQLite, configuración, carátulas descargadas y caché de miniaturas. |

### La biblioteca no se scrapea: se lee

Las fichas de `E:\` ya las generó tinyMediaManager, con `.nfo`, carátulas, fondos,
logos y fotos del reparto. El escáner lee todo eso del disco, así que la biblioteca
entera se indexa en unos 30 segundos y funciona sin conexión a internet.

TMDb sólo entra en juego cuando tú lo pides, para rellenar huecos.

### Reproducción

El servidor decide por cada reproducción, según lo que el navegador dice que sabe
descodificar:

- **Directa** — el fichero se envía tal cual, con saltos nativos. Coste cero.
- **Remultiplexado** — se copia el vídeo y sólo se recodifica el audio (p. ej. un MKV
  con HEVC y AC3 hacia un navegador que admite HEVC). Casi gratis.
- **Transcodificación** — recodifica el vídeo por GPU. En este equipo, unas 6 veces más
  rápido que el tiempo real.

Al transcodificar, la línea de tiempo del stream empieza en cero, así que los saltos
se hacen pidiendo el stream desde otro punto y los subtítulos se desplazan para no
descuadrarse.

### Ajustes que hacen algo

Todo lo que hay en Ajustes está conectado de verdad: la calidad máxima, la mezcla a
estéreo y la normalización de volumen cambian los parámetros de ffmpeg; el idioma
preferido elige pista al abrir el vídeo; el aspecto de los subtítulos redefine `::cue`.

**Detección de hardware**: prueba cada codificador codificando de verdad un trozo de
una película tuya. Que ffmpeg traiga `h264_qsv` compilado no significa que el driver
funcione, y una muestra sintética miente: con un patrón de prueba, `libx264` marcaba
48× tiempo real y con una película de verdad marca 3,9×.

### Sagas

Los `.nfo` ya traían el campo `<set>`, así que las 117 colecciones con más de un
título (James Bond con 26, la Saga del Infinito con 22) salen sin pedir nada a nadie.
Se ven en *Sagas* y al final de cada ficha, siempre en orden cronológico.

### Miniaturas de la barra de tiempo

Al pasar el ratón por la barra aparece el fotograma de ese momento. Se generan la
primera vez que se abre una película, en unos 30 segundos, decodificando **sólo
fotogramas clave**: 17 veces más rápido que decodificarlo todo.

Los tiempos de cada miniatura los da el propio ffmpeg mientras genera, no el índice del
contenedor. En una película de prueba el contenedor declaraba 1489 fotogramas clave y
el decodificador entregaba 1391: emparejar unos con otros desplazaría toda la tira.

### Metadatos que faltan

El scraper de TMDb **nunca escribe solo**. Propone, marca la confianza de cada
coincidencia (exacta si venía el `tmdbid` en el NFO, probable por título y año, o
dudosa) y tú aplicas o corriges buscando otra. Una coincidencia equivocada
sobrescribiría datos buenos.

### Subtítulos

Reutiliza `subsfetch.py` del pipeline: busca primero en tu propia biblioteca, luego en
OpenSubtitles por hash del fichero, y verifica la sincronía contra el canal central del
audio antes de aceptar nada. Si no puede demostrar que encaja, lo rechaza.

**Sincronía**: el reproductor mide el desfase de un subtítulo contra el audio con la
misma correlación del pipeline y lo corrige solo. Si no puede demostrarlo (subtítulo de
otro montaje, o a otra velocidad) lo dice y te deja ajustarlo a mano con `G` y `H`. El
audio también se puede desplazar, desde el menú de pistas.

**Por IA**: cuando no hay nada que descargar, Whisper transcribe el audio. Unas 10 veces
el tiempo real con el modelo equilibrado, 22 con el rápido. Transcribe lo que se habla:
**no traduce**, así que de un audio inglés salen subtítulos en inglés.

### Modo noche

Al bajar un 5.1 a estéreo, el canal central —donde vive el diálogo— queda enterrado.
«Diálogos realzados» lo sube 7,7 dB medidos; «Modo noche» además comprime, subiendo el
diálogo 13,2 dB y estrechando la diferencia entre escena tranquila y escena fuerte de
11,1 a 7,3 dB. Las dos llevan limitador para no saturar.

### Búsqueda por frase de diálogo

Un índice de texto completo sobre los subtítulos: casi un millón de frases, construido en
15 segundos. Busca sin tildes y al pulsar un resultado la película arranca en esa frase.

### Saltar cabeceras

La cabecera es el único tramo de audio idéntico en todos los episodios de una temporada,
así que se encuentra comparando huellas acústicas (chromaprint) entre episodios. En una
serie de 39 episodios tardó dos minutos y acertó los 39; comprobado además comparando
fotogramas, que salieron idénticos (3 sobre 255 de diferencia, frente a 69 fuera de la
cabecera).

## Atajos del reproductor

| Tecla | Acción |
|-------|--------|
| `Espacio` / `K` | Pausa |
| `←` / `→` | Salto corto (configurable) |
| `Mayús` + `←` / `→` | Salto largo |
| `↑` / `↓` | Volumen |
| `F` | Pantalla completa |
| `M` | Silenciar |
| `Esc` | Salir |
| `/` | Buscar (fuera del reproductor) |
