# PowerShell 7. Diagnóstico del HTPC, SOLO LECTURA, a data\diagnostico.json. Va en una tarea programada como SYSTEM
# («MediaWatch diagnóstico», cada 6 h) porque parte de esto pide administrador (exclusiones del antivirus) y el
# registro de eventos no se puede leer desde la sesión de Claude. No cambia nada del sistema: solo consulta y escribe
# ese JSON (por temporal + renombrado, para que nunca se lea uno a medias).
param([string]$Destino = (Join-Path $PSScriptRoot '..\..\data\diagnostico.json'), [int]$Dias = 7)
$ErrorActionPreference = 'Continue'
Start-Transcript -LiteralPath (Join-Path $PSScriptRoot '..\..\data\diagnostico.log') -Force | Out-Null
try {
  $desde = (Get-Date).AddDays(-$Dias)
  $ev = {
    param($filtro, $max)
    Get-WinEvent -FilterHashtable $filtro -MaxEvents $max -ErrorAction SilentlyContinue | ForEach-Object {
      [pscustomobject]@{
        hora = $_.TimeCreated.ToString('o'); id = $_.Id; origen = $_.ProviderName; nivel = $_.Level
        texto = (($_.Message -replace '\s+', ' ') + '').Substring(0, [Math]::Min(300, ($_.Message + '').Length))
      }
    }
  }
  # Apagados inesperados (41), cierres sucios (6008), reinicios pedidos y por quién (1074), pantallazos (1001).
  $apagados = & $ev @{ LogName = 'System'; Id = 41, 6008, 1074, 1001; StartTime = $desde } 100
  # Errores de hardware (WHEA): se agrupan por día y aparato, que en una tormenta son miles.
  $whea = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = $desde } -ErrorAction SilentlyContinue |
    Group-Object { $_.TimeCreated.ToString('yyyy-MM-dd') + ' ' + (($_.Message -split "`n" | Where-Object { $_ -match 'principal|Primary' } | Select-Object -First 1) -replace '\s+', ' ') } |
    ForEach-Object { [pscustomobject]@{ clave = $_.Name; veces = $_.Count } }
  # Errores críticos y de nivel error del sistema, agrupados por origen e id.
  $errores = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1, 2; StartTime = $desde } -ErrorAction SilentlyContinue |
    Group-Object { "$($_.ProviderName) $($_.Id)" } | Sort-Object Count -Descending | Select-Object -First 25 |
    ForEach-Object { [pscustomobject]@{ clave = $_.Name; veces = $_.Count; ultimo = $_.Group[0].TimeCreated.ToString('o') } }
  # Caídas de programas (node, ffmpeg, Caddy, pwsh...).
  $caidas = & $ev @{ LogName = 'Application'; Id = 1000, 1002; StartTime = $desde } 50

  $mp = Get-MpPreference -ErrorAction SilentlyContinue
  $gpu = Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ nombre = $_.Name; driver = $_.DriverVersion; fecha = "$($_.DriverDate)" } }
  $pendiente = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or
    (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
  $os = Get-CimInstance Win32_OperatingSystem

  $datos = [pscustomobject]@{
    generado = (Get-Date).ToUniversalTime().ToString('o'); dias = $Dias
    encendidoDesde = $os.LastBootUpTime.ToString('o'); reinicioPendiente = $pendiente
    apagados = @($apagados); whea = @($whea); erroresSistema = @($errores); caidasProgramas = @($caidas)
    antivirus = [pscustomobject]@{ exclusionesRuta = @($mp.ExclusionPath); exclusionesProceso = @($mp.ExclusionProcess) }
    graficas = @($gpu)
  }
  $tmp = "$Destino.tmp"
  [System.IO.File]::WriteAllText($tmp, ($datos | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))
  Move-Item -Force -LiteralPath $tmp -Destination $Destino
} finally {
  Stop-Transcript | Out-Null
}
