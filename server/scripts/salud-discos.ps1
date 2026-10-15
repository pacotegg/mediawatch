# PowerShell 7. Vuelca los datos SMART de todos los discos a data\salud-discos.json, que lee el servidor de Media Watch para
# los avisos de Ajustes -> Mantenimiento. smartctl necesita administrador para abrir los discos, y el servidor
# no lo es: por eso esto va aparte, en una tarea programada (ver MEDIAWATCH-PROYECTO.md).
#
# `-n standby`: un disco dormido NO se despierta para esto (se apunta como "en reposo" y se mira la vez siguiente).
param([string]$Destino = (Join-Path $PSScriptRoot '..\..\data\salud-discos.json'))
$ErrorActionPreference = 'Stop'
# Registro de la última ejecución: la tarea corre como SYSTEM y, sin esto, si falla no se sabe por qué.
Start-Transcript -LiteralPath (Join-Path $PSScriptRoot '..\..\data\salud-discos.log') -Force | Out-Null
try {
$smart = 'C:\Program Files\smartmontools\bin\smartctl.exe'
$destino = $Destino

$scan = & $smart --scan -j | ConvertFrom-Json
$discos = @()
foreach ($d in $scan.devices) {
  $salida = & $smart -j -a -n standby -d $d.type $d.name
  try { $discos += ($salida | Out-String | ConvertFrom-Json) } catch { }
}

# Sin BOM: lo lee otro proceso. Y por temporal + renombrado, para que el servidor nunca lea uno a medias.
$tmp = "$destino.tmp"
$json = [pscustomobject]@{ generado = (Get-Date).ToUniversalTime().ToString('o'); discos = $discos } | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($tmp, $json, [System.Text.UTF8Encoding]::new($false))
Move-Item -Force -LiteralPath $tmp -Destination $destino
} finally {
  Stop-Transcript | Out-Null
}
