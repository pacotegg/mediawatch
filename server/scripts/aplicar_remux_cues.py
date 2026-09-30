r"""
Sustituye en E: peliculas cuyo indice de saltos no sirve por la version arreglada
que esta preparada en C:\Media\remux_cues. ES LO UNICO QUE ESCRIBE EN E:.

Por fichero, y si algo no cuadra se salta ENTERO y se apunta:
  1. Comprobar la version arreglada: existe, su `Cues` ocupa >= 200 bytes y, si hay
     original legible, la duracion no se aparta mas de 10 s.
  2. Respaldar el original en C:\Media\respaldos_cues y comprobar el MD5.
  3. Copiar la nueva junto al original como .sync.tmp y comprobar su MD5.
  4. os.replace: atomico, en ningun instante falta el fichero.

    python aplicar_remux_cues.py                  (ensenya el plan, no toca nada)
    python aplicar_remux_cues.py --aplicar
    python aplicar_remux_cues.py --aplicar --solo dias
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auditar_cues_mkv as cues

FP = r"C:\Users\HTPC\AppData\Local\Microsoft\WinGet\Links\ffprobe.exe"
RESP = r"C:\Media\respaldos_cues"
REG = r"C:\tvwatch\data\aplicar-remux-cues.jsonl"

ITEMS = {
    "dias": (r"E:\Peliculas\D*as de trueno*\*.mkv", r"C:\Media\remux_cues\dias.mkv"),
    "america": (r"E:\Peliculas\*rase una vez en Am*\*.mkv", r"C:\Media\remux_cues\america_ffmpeg.mkv"),
    "reportero": (r"E:\Peliculas\El reportero*\*.mkv", r"C:\Media\remux_cues\reportero_gop.mkv"),
}


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def duracion(p):
    o = subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "json", p],
                       capture_output=True, text=True).stdout
    try:
        return float(json.loads(o)["format"]["duration"])
    except (KeyError, ValueError, TypeError):
        return None


def claves(p):
    o = subprocess.run([FP, "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=flags", "-of", "csv=p=0", p],
                       capture_output=True, text=True).stdout
    return sum(1 for l in o.splitlines() if "K" in l)


def apunta(d):
    d["cuando"] = datetime.now(timezone.utc).isoformat()
    with open(REG, "a", encoding="utf-8") as f:
        f.write(json.dumps(d, ensure_ascii=False) + "\n")


def comprobar(clave, original, nuevo):
    if not os.path.isfile(nuevo):
        return "la version arreglada no esta en C:"
    c = cues.cues_bytes(nuevo)
    if c is None or c < 200:
        return "su indice de saltos sigue vacio (%s bytes)" % c
    if clave == "reportero" and claves(nuevo) < 100:
        return "sigue sin fotogramas clave suficientes"
    d0, d1 = duracion(original), duracion(nuevo)
    if d1 is None:
        return "la version arreglada no tiene duracion"
    if d0 is not None and abs(d0 - d1) > 10:
        return "la duracion se aparta mas de 10 s (%.1f frente a %.1f)" % (d0, d1)
    return None


def hacer(clave):
    patron, nuevo = ITEMS[clave]
    hallados = glob.glob(patron)
    if len(hallados) != 1:
        return False, "el original no es unico: %d coincidencias" % len(hallados)
    original = hallados[0]
    motivo = comprobar(clave, original, nuevo)
    if motivo:
        return False, motivo
    os.makedirs(RESP, exist_ok=True)
    resp = os.path.join(RESP, os.path.basename(original))
    n = 1
    while os.path.exists(resp):
        raiz, ext = os.path.splitext(os.path.join(RESP, os.path.basename(original)))
        resp = "%s (%d)%s" % (raiz, n, ext)
        n += 1
    shutil.copy2(original, resp)
    if md5(resp) != md5(original):
        os.remove(resp)
        return False, "el respaldo no cuadra"
    tmp = original + ".sync.tmp"
    shutil.copy2(nuevo, tmp)
    if md5(tmp) != md5(nuevo):
        os.remove(tmp)
        return False, "la copia a E: no cuadra"
    os.replace(tmp, original)
    apunta({"clave": clave, "estado": "aplicado", "original": original, "respaldo": resp})
    return True, "aplicado; respaldo en " + resp


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    solo = sys.argv[sys.argv.index("--solo") + 1] if "--solo" in sys.argv else None
    claves_a_hacer = [k for k in ITEMS if solo in (None, k)]
    for k in claves_a_hacer:
        patron, nuevo = ITEMS[k]
        hallados = glob.glob(patron)
        print("%-10s original: %s" % (k, os.path.basename(hallados[0])[:60] if len(hallados) == 1 else "%d coincidencias" % len(hallados)))
        print("%-10s nuevo   : %s %s" % ("", nuevo, "(existe)" if os.path.isfile(nuevo) else "(NO EXISTE AUN)"))
        if len(hallados) == 1:
            m = comprobar(k, hallados[0], nuevo)
            print("%-10s comprobacion: %s" % ("", m or "OK"))
    if "--aplicar" not in sys.argv:
        print("\n(no se ha tocado nada; con --aplicar se sustituyen)")
        return
    for k in claves_a_hacer:
        ok, motivo = hacer(k)
        if not ok:
            apunta({"clave": k, "estado": "saltado", "motivo": motivo})
        print("%-10s %s: %s" % (k, "OK" if ok else "SALTADO", motivo), flush=True)


if __name__ == "__main__":
    main()
