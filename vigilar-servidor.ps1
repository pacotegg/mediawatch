<#
  Vigilante de TvWatch.

  El servidor no esta registrado como servicio -hace falta ser administrador y
  esta sesion no lo es-, asi que se arranca al iniciar sesion y se revisa cada
  15 segundos. Vive en la carpeta de Inicio del usuario.

  Cosas aprendidas a base de que fallara:

  1. (08/09) **No usar `-RedirectStandardOutput` de `Start-Process`.** Trunca el
     fichero en cada intento, asi que al caerse el servidor se perdia justo el
     motivo. Se lanza a traves de `cmd /c` con `>>`, que anade.
  2. (08/09) **Registrar tambien los fallos**, y comprobar si de verdad arranco.
     Con todo en silencio, el vigilante apunto "levantando" cada minuto durante
     horas sin que arrancara nada y sin decir por que.
  3. (08/09) **Mantener vivo el mutex.** Si nadie lo referencia, el recolector de
     .NET se lo lleva, el candado se suelta y acaban corriendo dos vigilantes.
  4. (13/09) **Ruta absoluta a node.exe.** En el entorno con el que arranca la
     sesion `node` no esta en el PATH: el servidor estuvo cinco dias caido y el
     vigilante apuntando "node no se reconoce" cada minuto. Regla del HTPC
     desde el principio: rutas absolutas, nunca el PATH. Aqui no se cumplio.
  5. (13/09) **`cmd /s /c "..."`.** Al poner la ruta entre comillas, `cmd /c`
     a secas se comia la primera y la ultima comilla y salia con codigo 1 sin
     ejecutar nada.
  6. (08/10) **Que exista el proceso no es que funcione.** Antes "vivo" era "hay
     un node.exe con index.ts" y "levantado" se apuntaba a los 8 s sin mas: un
     servidor colgado -proceso vivo, puerto abierto, sin contestar a nada, el
     sintoma documentado en index.ts- contaba como sano. Ahora se pregunta a
     GET /api/salud (publico, solo devuelve {"ok":true} tras un SELECT 1).
  7. (08/10) **Un log sin fecha engana.** server.err se abre en modo anadir y un
     SyntaxError de hace dias se tomo por el de un reinicio sano. Ahora cada
     arranque rota server.log y server.err a *.AAAAMMDD-HHMMSS (se guardan 5) y
     el servidor pone la hora en cada linea: lo que hay en server.err es de este
     arranque.
  8. (08/10) **Freno.** Con el codigo roto reintentaba cada ~23 s para siempre
     (1005 "NO arranco" en la racha larga). Tras 5 fallos seguidos espera 60 s;
     tras 8, 300 s. Y no mata por cuelgue mas de 6 veces por hora, para que un
     fallo del propio chequeo no deje un bucle de reinicios de un servidor sano.

  Se puede cargar con `. .\vigilar-servidor.ps1` (punto delante) para probar las
  funciones sin que arranque el bucle ni coja el candado.
#>
param(
  [string]$Raiz = 'C:\tvwatch\server',
  [string]$Logs = 'C:\tvwatch\data',
  [int]$Puerto = 8730
)

$node = 'C:\Program Files\nodejs\node.exe'
$registro = Join-Path $Logs 'vigilante.log'
$salida = Join-Path $Logs 'server.log'
$errores = Join-Path $Logs 'server.err'
$urlSalud = "http://127.0.0.1:$Puerto/api/salud"

$FallosParaMatar = 3      # comprobaciones seguidas sin respuesta, con el proceso vivo
$MaxMuertesPorHora = 6    # tope de kills por cuelgue; mas alla solo se avisa
$EsperaArranque = 40      # segundos que se le dan a un arranque para contestar
$CopiasDeLog = 5          # rotaciones de server.log y de server.err que se conservan

function Apuntar($texto) {
  "$(Get-Date -Format s)  $texto" | Out-File -Append -Encoding utf8 $registro
}

function Test-ServidorVivo {
  $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
       Where-Object { $_.CommandLine -like '*index.ts*' }
  return [bool]$p
}

function Test-Responde {
  try {
    $r = Invoke-WebRequest -Uri $urlSalud -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    return ($r.StatusCode -eq 200 -and $r.Content -match '"ok"\s*:\s*true')
  } catch {
    return $false
  }
}

function Get-Pausa([int]$seguidos) {
  if ($seguidos -ge 8) { return 300 }
  if ($seguidos -ge 5) { return 60 }
  return 0
}

function Rotar-Logs {
  $marca = Get-Date -Format 'yyyyMMdd-HHmmss'
  foreach ($f in @($salida, $errores)) {
    if ((Test-Path -LiteralPath $f) -and ((Get-Item -LiteralPath $f).Length -gt 0)) {
      try {
        Move-Item -LiteralPath $f -Destination ($f + '.' + $marca) -ErrorAction Stop
      } catch {
        Apuntar ('no se pudo rotar ' + (Split-Path $f -Leaf) + ': ' + $_.Exception.Message)
      }
    }
    $viejas = @(Get-ChildItem -Path ($f + '.*') -File -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -Skip $CopiasDeLog)
    foreach ($v in $viejas) { Remove-Item -LiteralPath $v.FullName -Force -ErrorAction SilentlyContinue }
  }
}

function Matar-Servidor {
  $ps = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
          Where-Object { $_.CommandLine -like '*index.ts*' })
  foreach ($p in $ps) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}

# Devuelve 'ok:<segundos>', 'murio' (el proceso desaparecio) o 'mudo' (vive y no contesta).
function Iniciar-Servidor {
  Rotar-Logs
  $orden = "`"$node`" src\index.ts >> `"$salida`" 2>> `"$errores`""
  # `/s` y comillas exteriores: sin ellas, cmd le quita la primera y la
  # ultima comilla a una orden que empieza por ruta entrecomillada, la ruta
  # se rompe y cmd sale con codigo 1 sin ejecutar nada ni decir por que.
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/s', '/c', ('"' + $orden + '"') `
    -WorkingDirectory $Raiz -WindowStyle Hidden -ErrorAction Stop
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $EsperaArranque) {
    Start-Sleep -Seconds 2
    if (-not (Test-ServidorVivo)) { return 'murio' }
    if (Test-Responde) { return ('ok:' + [int]((Get-Date) - $t0).TotalSeconds) }
  }
  return 'mudo'
}

if ($MyInvocation.InvocationName -ne '.') {
  $candado = New-Object System.Threading.Mutex($false, 'Local\TvWatchVigilante')
  if (-not $candado.WaitOne(0)) { exit 0 }

  if (-not (Test-Path $node)) {
    Apuntar "no existe $node; sin eso no hay servidor"
    exit 1
  }

  Apuntar 'vigilante en marcha'

  $seguidos = 0   # arranques fallidos seguidos
  $fallos = 0     # comprobaciones seguidas sin respuesta con el servidor vivo
  $muertes = @()  # cuando se mato por cuelgue (ultima hora)

  while ($true) {
    # El mutex tiene que seguir referenciado o .NET lo recoge y suelta el candado.
    [void]$candado.GetType()

    if (-not (Test-ServidorVivo)) {
      $fallos = 0
      Apuntar 'servidor caido, levantando'
      try {
        $res = Iniciar-Servidor
        if ($res -like 'ok:*') {
          Apuntar ('levantado: contesta /api/salud a los ' + $res.Substring(3) + ' s')
          $seguidos = 0
        } else {
          $seguidos++
          if ($res -eq 'mudo') {
            Apuntar "arranco pero NO contesta /api/salud en $EsperaArranque s; mirar server.err (fallos seguidos: $seguidos)"
          } else {
            Apuntar "NO arranco: el proceso murio; mirar server.err (fallos seguidos: $seguidos)"
          }
          $pausa = Get-Pausa $seguidos
          if ($pausa -gt 0) {
            Apuntar "freno: espero $pausa s antes de reintentar"
            Start-Sleep -Seconds $pausa
          }
        }
      } catch {
        $seguidos++
        Apuntar ('fallo al lanzarlo: ' + $_.Exception.Message)
      }
    } elseif (Test-Responde) {
      $fallos = 0
    } else {
      $fallos++
      Apuntar "vivo pero sin respuesta de /api/salud ($fallos de $FallosParaMatar)"
      if ($fallos -ge $FallosParaMatar) {
        $fallos = 0
        $limite = (Get-Date).AddHours(-1)
        $muertes = @($muertes | Where-Object { $_ -gt $limite })
        if ($muertes.Count -ge $MaxMuertesPorHora) {
          Apuntar ('colgado, pero ya se mato ' + $muertes.Count + ' veces en la ultima hora: no lo toco, mirar a mano')
        } else {
          Apuntar 'colgado: lo mato para que se relance'
          Matar-Servidor
          $muertes += (Get-Date)
        }
      }
    }
    Start-Sleep -Seconds 15
  }
}
