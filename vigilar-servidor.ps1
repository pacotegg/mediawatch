<#
  Vigilante de TvWatch.

  El servidor no esta registrado como servicio —hace falta ser administrador y
  esta sesion no lo es—, asi que se arranca al iniciar sesion y se revisa cada
  minuto. Vive en la carpeta de Inicio del usuario.

  Cosas aprendidas a base de que fallara:

  1. (08/09) **No usar `-RedirectStandardOutput` de `Start-Process`.** Trunca el
     fichero en cada intento, asi que al caerse el servidor se perdia justo el
     motivo. Se lanza a traves de `cmd /c` con `>>`, que anade.
  2. (08/09) **Registrar tambien los fallos**, y comprobar a los 8 s si de verdad
     arranco. Con todo en silencio, el vigilante apunto «levantando» cada minuto
     durante horas sin que arrancara nada y sin decir por que.
  3. (08/09) **Mantener vivo el mutex.** Si nadie lo referencia, el recolector de
     .NET se lo lleva, el candado se suelta y acaban corriendo dos vigilantes.
  4. (13/09) **Ruta absoluta a node.exe.** En el entorno con el que arranca la
     sesion `node` no esta en el PATH: el servidor estuvo cinco dias caido y el
     vigilante apuntando «"node" no se reconoce» cada minuto. Regla del HTPC
     desde el principio: rutas absolutas, nunca el PATH. Aqui no se cumplio.
  5. (13/09) **`cmd /s /c "..."`.** Al poner la ruta entre comillas, `cmd /c`
     a secas se comia la primera y la ultima comilla y salia con codigo 1 sin
     ejecutar nada.
#>
$node = 'C:\Program Files\nodejs\node.exe'
$raiz = 'C:\tvwatch\server'
$logs = 'C:\tvwatch\data'
$registro = Join-Path $logs 'vigilante.log'
$salida = Join-Path $logs 'server.log'
$errores = Join-Path $logs 'server.err'

$candado = New-Object System.Threading.Mutex($false, 'Local\TvWatchVigilante')
if (-not $candado.WaitOne(0)) { exit 0 }

function Apuntar($texto) {
  "$(Get-Date -Format s)  $texto" | Out-File -Append -Encoding utf8 $registro
}

function Test-ServidorVivo {
  $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
       Where-Object { $_.CommandLine -like '*index.ts*' }
  return [bool]$p
}

if (-not (Test-Path $node)) {
  Apuntar "no existe $node; sin eso no hay servidor"
  exit 1
}

Apuntar 'vigilante en marcha'

while ($true) {
  # El mutex tiene que seguir referenciado o .NET lo recoge y suelta el candado.
  [void]$candado.GetType()

  if (-not (Test-ServidorVivo)) {
    Apuntar 'servidor caido, levantando'
    try {
      $orden = "`"$node`" src\index.ts >> `"$salida`" 2>> `"$errores`""
      # `/s` y comillas exteriores: sin ellas, cmd le quita la primera y la
      # ultima comilla a una orden que empieza por ruta entrecomillada, la ruta
      # se rompe y cmd sale con codigo 1 sin ejecutar nada ni decir por que.
      Start-Process -FilePath 'cmd.exe' -ArgumentList '/s', '/c', ('"' + $orden + '"') `
        -WorkingDirectory $raiz -WindowStyle Hidden -ErrorAction Stop
      Start-Sleep -Seconds 8
      if (Test-ServidorVivo) { Apuntar 'levantado' } else { Apuntar 'NO arranco; mirar server.err' }
    } catch {
      Apuntar ("fallo al lanzarlo: " + $_.Exception.Message)
    }
  }
  Start-Sleep -Seconds 60
}
