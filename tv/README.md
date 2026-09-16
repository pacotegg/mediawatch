# TvWatch para Samsung (Tizen)

Cliente de televisión para el servidor TvWatch del HTPC. Es una app aparte de la web,
no la misma: el QN93A lleva **Tizen 6.0**, cuyo motor ronda Chrome 76 y no entiende ni
Tailwind 4, ni `aspect-ratio`, ni `gap` en flex, ni `:has`, ni `?.`. Aquí todo es CSS
plano sobre un lienzo fijo de 1920×1080 y JavaScript compilado a ES2016.

Pesa 14 KB.

## Lo que la hace valer la pena

Usa **AVPlay**, el reproductor nativo de Tizen, que descodifica MKV, HEVC, AC3 y DTS por
hardware. La tele pide el fichero original (`?raw=1`) y el HTPC no transcodifica **nada**:
ni gasta GPU, ni pierde el audio 5.1, ni recomprime la imagen. Es la mejor calidad
posible y la menor carga para el servidor.

## Probarla sin instalar nada

El servidor la sirve en `http://192.168.31.16:8730/tv/`. Ábrelo en el navegador de la
tele y funciona igual, salvo que usará el reproductor del navegador en vez de AVPlay
(menos formatos). Sirve para ver si la interfaz te convence antes de montar todo lo demás.

## Emparejar

No hay que escribir contraseñas con el mando:

1. La tele muestra un código de seis cifras.
2. En TvWatch desde el móvil u ordenador: **Ajustes → Biblioteca → Emparejar televisión**.
3. Escribes el código y la tele queda conectada a ese perfil, con su propio token.

## Instalarla como app de verdad

Esto necesita cosas que sólo puedes hacer tú, porque van atadas a tu cuenta y a tu tele:

1. **Tizen Studio** con la extensión de TV (unos 3 GB).
   <https://developer.tizen.org/development/tizen-studio/download>
2. **Certificado**: en Tizen Studio, *Tools → Certificate Manager → Samsung → TV*. Pide
   iniciar sesión con tu cuenta Samsung, la misma de la tele.
3. **Modo desarrollador en la tele**: en Apps, pulsa `1 2 3 4 5` con el mando, actívalo y
   escribe la IP del PC (`192.168.31.16`). Reinicia la tele.
4. **Compilar, empaquetar e instalar**:

```bash
cd tv && npm run build
```

Luego, con `tizen` en el PATH (viene en `tizen-studio/tools/ide/bin`):

```bash
tizen build-web -- dist && tizen package -t wgt -s <tu-perfil> -- dist/.buildResult && tizen install -n TvWatch.wgt -t <nombre-de-tu-tele> -- dist/.buildResult
```

Si `sdb connect 192.168.31.x` (la IP de la **tele**) responde, la tele está lista para
recibirla.

## Si algo falla

- **«No se encuentra el servidor»**: la app empaquetada no puede adivinar la IP, usa la
  que lleva por defecto (`192.168.31.16:8730`). Si el HTPC cambia de IP, cámbiala desde
  *Cambiar servidor* con los números del mando, o fija la IP del HTPC en el router.
- **Se ve pero no reproduce**: es señal de que AVPlay no arrancó. Comprueba que el
  privilegio `avplay` sigue en `config.xml`.
- **El mando no navega**: las teclas multimedia hay que registrarlas; eso lo hace
  `nav.ts` al arrancar, y sólo funciona dentro de la app instalada, no en el navegador.
