' Lanza la extraccion de subtitulos incrustados SIN ventana. La tarea programada
' «TvWatch-ExtraerSubtitulos» ejecutaba cmd.exe a pelo en la sesion del usuario y, al iniciar sesion,
' dejaba una consola negra vacia abierta mientras duraba (la salida va al log). WScript.Shell con el
' modo 0 es la unica forma fiable de que no salga ni parpadee (igual que TvWatch.vbs, el del vigilante).
' Quien la escribe en E: son los .srt junto al video: solo los de pistas incrustadas que faltan.
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\tvwatch\server"
sh.Run "cmd.exe /s /c """"C:\Program Files\nodejs\node.exe"" src\cli\extraer-subtitulos.ts >> ""C:\tvwatch\data\extraccion-subtitulos.log"" 2>&1""", 0, False
Set sh = Nothing
