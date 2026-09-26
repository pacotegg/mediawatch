"""
Paso 2 del arreglo de subtitulos externos: REESCRIBE los .srt que
verificar_subtitulos_externos.py demostro desincronizados.

Escribe en E:, asi que:
  - No hace NADA sin --aplicar. Por defecto solo ensenya lo que haria.
  - Respaldo ANTES de tocar, y FUERA de E: (en C:\\Media\\respaldos_srt). Una
    copia al lado vive dentro de la biblioteca que escanea Plex y no la recoge
    ningun barrido del pipeline.
  - REVALIDA cada fichero justo antes de escribirlo: entre la medida y ahora el
    disco ha podido cambiar. Si el desfase ya no es el medido, se salta.
  - VERIFICA despues de escribir: vuelve a medir el fichero ya escrito y, si no
    ha quedado bien, LO DESHACE desde el respaldo.
  - Conserva la codificacion original. Un .srt en Latin-1 se reescribe en
    Latin-1: cambiarla es un cambio que nadie ha pedido.

    python reescribir_subtitulos.py --lista lista.json --grupo A
    python reescribir_subtitulos.py --lista lista.json --grupo A --aplicar
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime

SUBSFETCH = r"C:\scripts\webpanel\subsfetch.py"
RESPALDOS = r"C:\Media\respaldos_srt"
REGISTRO = r"C:\tvwatch\data\reescritura-subtitulos.jsonl"
PUERTO_TVWATCH = 8730

TS = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")
CODECS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")


def cargar_subsfetch():
    spec = importlib.util.spec_from_file_location("subsfetch", SUBSFETCH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def leer_con_codec(path):
    """Como subsfetch.leer_srt, pero DEVOLVIENDO el codec que funciono, para
    poder reescribir despues en el mismo."""
    for enc in CODECS:
        try:
            with open(path, encoding=enc) as f:
                return f.read(), enc
        except (UnicodeDecodeError, LookupError):
            continue
    return None, None


def hay_alguien_viendo():
    try:
        cmd = ("(Get-NetTCPConnection -LocalPort %d -State Established "
               "-ErrorAction SilentlyContinue | Measure-Object).Count" % PUERTO_TVWATCH)
        r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                           capture_output=True, text=True, timeout=15)
        return int((r.stdout or "0").strip() or 0) > 0
    except Exception:
        return False


def apunta(fila):
    with open(REGISTRO, "a", encoding="utf-8") as f:
        f.write(json.dumps(fila, ensure_ascii=False) + "\n")


def main():
    # La consola de Windows es cp1252 y la biblioteca tiene titulos con
    # caracteres que ahi no existen ("Pero... quien mato a Harry" lleva un
    # U+2753). Sin esto, el print del nombre lanza UnicodeEncodeError y ABORTA
    # el lote a mitad: paso el 26/09/2026 tras tres ficheros. No se perdio nada
    # -peto antes de tocar el cuarto-, pero un lote que muere por un nombre es
    # un lote que hay que relanzar a mano y mirar que quedo hecho.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    p = argparse.ArgumentParser()
    p.add_argument("--lista", required=True)
    p.add_argument("--grupo", default="A")
    p.add_argument("--aplicar", action="store_true")
    p.add_argument("--limite", type=int, default=0, help="tocar como mucho N ficheros")
    p.add_argument("--solo", default="", help="subcadena: solo los que la contengan")
    args = p.parse_args()

    sf = cargar_subsfetch()
    datos = json.load(open(args.lista, encoding="utf-8"))
    cola = datos[args.grupo]
    if args.solo:
        cola = [d for d in cola if args.solo.lower() in d["external"].lower()]
    if args.limite:
        cola = cola[:args.limite]

    os.makedirs(RESPALDOS, exist_ok=True)
    modo = "  [APLICANDO]" if args.aplicar else "  [solo ensenyar, no se toca nada]"
    print("grupo %s: %d ficheros%s\n" % (args.grupo, len(cola), modo), flush=True)

    hechos = fallos = saltados = 0
    for i, d in enumerate(cola, 1):
        ext = d["external"]
        nombre = os.path.basename(ext)
        offset = d.get("offset_s") or 0.0
        factor = d.get("factor") or 1.0
        cab = "%3d/%d  %s" % (i, len(cola), nombre[:64])

        if not os.path.isfile(ext):
            print(cab + "\n     SALTADO: ya no existe")
            saltados += 1
            apunta({"external": ext, "estado": "saltado", "motivo": "no existe"})
            continue

        texto, codec = leer_con_codec(ext)
        if texto is None:
            print(cab + "\n     SALTADO: no se puede decodificar")
            saltados += 1
            apunta({"external": ext, "estado": "saltado", "motivo": "no decodifica"})
            continue

        # REVALIDAR: volver a medir antes de tocar nada.
        while hay_alguien_viendo():
            time.sleep(30)
        v = sf.verificar_sync(d["path"], texto, d["audioIdx"], d["duration"])
        if not v.get("ok"):
            print(cab + "\n     SALTADO: ya no se demuestra (%s)" % v.get("motivo"))
            saltados += 1
            apunta({"external": ext, "estado": "saltado", "motivo": "revalidacion fallida"})
            continue
        off_ahora = v.get("offset_s") or 0.0
        fac_ahora = v.get("factor") or 1.0
        if abs(off_ahora - offset) > 0.3 or fac_ahora != factor:
            print(cab + "\n     SALTADO: la medida cambio (%+.2f -> %+.2f s)" % (offset, off_ahora))
            saltados += 1
            apunta({"external": ext, "estado": "saltado", "motivo": "medida cambiada",
                    "antes": offset, "ahora": off_ahora})
            continue

        # `offset_s` YA es "cuanto hay que desplazar el subtitulo para que
        # cuadre" (subsfetch.py:404), y el factor se pasa tal cual: es
        # exactamente lo que hace subsfetch._aceptar. Invertir el signo -como
        # hacia la primera version de esto- duplica el desfase en vez de
        # corregirlo; lo cazo la verificacion posterior el 26/09/2026, sobre
        # copias en C:\Media y sin tocar un solo fichero de E:.
        print(cab + "\n     %s  desfase %+.2fs  factor %s  -> desplazar %+.0f ms"
              % (codec, off_ahora, fac_ahora, off_ahora * 1000.0), flush=True)
        if not args.aplicar:
            continue

        sello = datetime.now().strftime("%Y%m%d-%H%M%S")
        respaldo = os.path.join(RESPALDOS, "%s_%d_%s" % (sello, os.getpid(), nombre))
        shutil.copy2(ext, respaldo)
        if not os.path.isfile(respaldo) or os.path.getsize(respaldo) != os.path.getsize(ext):
            print("     ABORTADO: el respaldo no cuadra")
            fallos += 1
            apunta({"external": ext, "estado": "abortado", "motivo": "respaldo malo"})
            continue

        # El motor es el de subsfetch, el mismo que usa el pipeline al muxear.
        # Reimplementarlo aqui fue el error original: un segundo motor que se
        # desincroniza del primero es justo lo que este proyecto evita.
        nuevo = sf.desplazar_srt(texto, off_ahora * 1000.0, fac_ahora)
        tmp = respaldo + ".tmp"
        with open(tmp, "w", encoding=codec, newline="") as f:
            f.write(nuevo)
        shutil.move(tmp, ext)

        # VERIFICAR lo escrito. Si no ha quedado bien, deshacer.
        texto2, _ = leer_con_codec(ext)
        v2 = sf.verificar_sync(d["path"], texto2, d["audioIdx"], d["duration"])
        off2 = v2.get("offset_s")
        # Se acepta si queda cuadrado... o si ha mejorado tanto que es
        # evidente. La ventana de busqueda de verificar_sync son +-60 s
        # (subsfetch.py, "pico en el borde de la ventana"), asi que un desfase
        # mayor sale MEDIDO como 60 exactos: al aplicar 60 quedan los segundos
        # que faltaban. El 26/09/2026 dos ficheros pasaron de 60 s a 1,5 y 2,8
        # y se deshicieron por exigir <0,35, devolviendolos a estar 60 s
        # descuadrados. Aceptar la mejora grande y dejar que una segunda pasada
        # remate es mejor que tirar el trabajo.
        cuadrado = v2.get("ok") and off2 is not None and abs(off2) < 0.35
        mejora = (v2.get("ok") and off2 is not None and abs(off_ahora) > 1.0
                  and abs(off2) <= abs(off_ahora) * 0.25 and abs(off2) < 5.0)
        bien = cuadrado or mejora
        if bien:
            nota = "" if cuadrado else "  [MEJORA, pide otra pasada]"
            print("     OK  ahora %+.2fs (%.1f sigma)%s  respaldo: %s"
                  % (off2, v2.get("sigma") or 0, nota, os.path.basename(respaldo)))
            hechos += 1
            apunta({"external": ext, "estado": "hecho", "antes": off_ahora, "despues": off2,
                    "cuadrado": bool(cuadrado), "sigma": v2.get("sigma"),
                    "codec": codec, "respaldo": respaldo})
        else:
            shutil.copy2(respaldo, ext)
            print("     DESHECHO: tras escribir daba ok=%s offset=%s — restaurado"
                  % (v2.get("ok"), off2))
            fallos += 1
            apunta({"external": ext, "estado": "deshecho", "antes": off_ahora,
                    "despues": off2, "respaldo": respaldo})

    print("\nhechos %d · deshechos/fallos %d · saltados %d" % (hechos, fallos, saltados))
    if args.aplicar:
        print("respaldos en %s\nregistro en %s" % (RESPALDOS, REGISTRO))


if __name__ == "__main__":
    sys.exit(main())
