r"""
Corrige el desfase del audio castellano con mkvmerge --sync. Dos fases:

  --preparar   remux a C:\Media\remux_sync y comprobacion. NO toca E:.
  --aplicar    respalda el original en C:\Media\respaldos_sync (MD5), copia el
               nuevo junto al original con nombre temporal, comprueba su MD5 y
               lo pone en su sitio con os.replace (atomico: en ningun instante
               falta el fichero). ES LO UNICO QUE ESCRIBE EN E:.

Lista y retardos salen de data/desfase-audio.jsonl (medir_desfase_audio.py).
Retardo = -mediana: si el castellano va 0,67 s adelantado se retrasa +670 ms.
"""
import hashlib, json, os, shutil, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import medir_desfase_audio as m

MK = r"C:\Program Files\MKVToolNix\mkvmerge.exe"
MEDIDAS = r"C:\tvwatch\data\desfase-audio.jsonl"
REG = r"C:\tvwatch\data\corregir-desfase-audio.jsonl"
STAGE = r"C:\Media\remux_sync"
RESP = r"C:\Media\respaldos_sync"
# Heavy Metal 2000 queda fuera: dispersion 0,25 s entre tramos, no es un desfase firme.
EXCLUIR = ("Heavy Metal 2000",)


def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def apunta(d):
    with open(REG, "a", encoding="utf-8") as f:
        f.write(json.dumps(d, ensure_ascii=False) + "\n")


def lista():
    out = []
    for l in open(MEDIDAS, encoding="utf-8"):
        d = json.loads(l)
        if (d["estado"] == "medido" and abs(d["mediana"]) >= 0.3 and d["dispersion"] <= 0.15
                and not any(x in d["ruta"] for x in EXCLUIR)):
            out.append({"ruta": d["ruta"], "ms": int(round(-d["mediana"] * 100)) * 10, "spa": d["spa"]})
    return out


def hechas(estado):
    if not os.path.isfile(REG):
        return set()
    return {json.loads(l)["ruta"] for l in open(REG, encoding="utf-8") if json.loads(l).get("estado") == estado}


def nombre_stage(ruta):
    return os.path.join(STAGE, hashlib.md5(ruta.encode("utf-8")).hexdigest()[:10] + ".mkv")


def resumen_pistas(f):
    o = subprocess.run([m.FP, "-v", "error", "-show_entries", "format=duration:stream=index,codec_name",
                        "-show_chapters", "-of", "json", f], capture_output=True, text=True).stdout
    d = json.loads(o)
    return float(d["format"]["duration"]), [s["codec_name"] for s in d["streams"]], len(d.get("chapters", []))


def preparar(t):
    os.makedirs(STAGE, exist_ok=True)
    dest = nombre_stage(t["ruta"])
    if os.path.exists(dest):
        os.remove(dest)
    r = subprocess.run([MK, "-q", "-o", dest, "--sync", "%d:%d" % (t["spa"], t["ms"]), t["ruta"]],
                       capture_output=True, text=True)
    if r.returncode not in (0, 1) or not os.path.isfile(dest):
        return False, "mkvmerge fallo: " + (r.stdout + r.stderr)[:200]
    d0, p0, c0 = resumen_pistas(t["ruta"])
    d1, p1, c1 = resumen_pistas(dest)
    # La duracion se mueve EXACTAMENTE lo que se desplaza el audio, y en su
    # signo: al retrasarlo la pista acaba mas tarde y alarga el contenedor; al
    # adelantarlo, lo acorta. Con el tope fijo de 1 s se rechazaron dos remux
    # sanos el 29/09/2026 -«La busqueda» (-1050 ms -> -1,05 s) y «Juego de
    # Tronos» S07E01 (+1980 ms -> +1,98 s)-, con pistas y capitulos identicos.
    # Lo que no se relaja: pistas, capitulos y el residuo de sincronia.
    margen = abs(t["ms"]) / 1000.0 + 0.5
    if p0 != p1 or c0 != c1 or abs(d1 - d0) > margen:
        return False, ("no conserva pistas/capitulos/duracion "
                       "(dur %+.2f s, margen %.2f s)" % (d1 - d0, margen))
    med = m.medir(dest)
    if med["estado"] != "medido" or abs(med["mediana"]) > 0.06:
        return False, "sigue desfasado tras el remux: %s" % med.get("mediana")
    return True, "residuo %+.2f s" % med["mediana"]


def aplicar(t):
    stage = nombre_stage(t["ruta"])
    if not os.path.isfile(stage):
        return False, "no esta preparado"
    if not os.path.isfile(t["ruta"]):
        return False, "el original ya no esta"
    os.makedirs(RESP, exist_ok=True)
    resp = os.path.join(RESP, os.path.basename(t["ruta"]))
    n = 1
    while os.path.exists(resp):
        raiz, ext = os.path.splitext(os.path.join(RESP, os.path.basename(t["ruta"])))
        resp = "%s (%d)%s" % (raiz, n, ext)
        n += 1
    shutil.copy2(t["ruta"], resp)
    if md5(resp) != md5(t["ruta"]):
        os.remove(resp)
        return False, "el respaldo no cuadra"
    tmp = t["ruta"] + ".sync.tmp"
    shutil.copy2(stage, tmp)
    if md5(tmp) != md5(stage):
        os.remove(tmp)
        return False, "la copia a E: no cuadra"
    os.replace(tmp, t["ruta"])
    apunta({"ruta": t["ruta"], "estado": "aplicado", "ms": t["ms"], "respaldo": resp})
    # El remux de C: ya no hace falta: esta en E: y el original en respaldos. Se
    # comprueba que lo de E: cuadra con el stage ANTES de tirar el stage, para no
    # quedarse sin ninguna de las dos copias buenas.
    limpio = limpiar_stage(t["ruta"])
    return True, "aplicado, respaldo en %s%s" % (resp, "" if limpio else " (stage NO borrado)")


def limpiar_stage(ruta):
    """Borra el remux de C: solo si el de E: existe y pesa lo mismo."""
    stage = nombre_stage(ruta)
    if not os.path.isfile(stage):
        return True
    if not os.path.isfile(ruta) or os.path.getsize(ruta) != os.path.getsize(stage):
        return False
    os.remove(stage)
    return not os.path.exists(stage)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    fase = "aplicar" if "--aplicar" in sys.argv else "preparar" if "--preparar" in sys.argv else None
    ts = lista()
    if "--limpiar" in sys.argv:
        libre = 0
        for r in hechas("aplicado"):
            st = nombre_stage(r)
            tam = os.path.getsize(st) if os.path.isfile(st) else 0
            if limpiar_stage(r) and tam:
                libre += tam
                print("borrado el stage de %s" % os.path.basename(r)[:55])
            elif tam:
                print("NO se borra el stage de %s: lo de E: no cuadra" % os.path.basename(r)[:55])
        print("liberados %.1f GB de %s" % (libre / 2**30, STAGE))
        return
    if fase is None:
        for t in ts:
            print("%+5d ms  %s" % (t["ms"], os.path.basename(t["ruta"])))
        return
    listas = hechas("preparado")
    hechos = hechas("aplicado")
    for n, t in enumerate(ts, 1):
        if t["ruta"] in hechos:
            continue
        if fase == "preparar" and t["ruta"] in listas and os.path.isfile(nombre_stage(t["ruta"])):
            continue
        if fase == "aplicar" and t["ruta"] not in listas:
            print("%d/%d SALTADA (no preparada) %s" % (n, len(ts), os.path.basename(t["ruta"])), flush=True)
            continue
        ok, motivo = (preparar if fase == "preparar" else aplicar)(t)
        if fase == "preparar":
            apunta({"ruta": t["ruta"], "estado": "preparado" if ok else "fallo_preparar", "motivo": motivo, "ms": t["ms"]})
        elif not ok:
            apunta({"ruta": t["ruta"], "estado": "fallo_aplicar", "motivo": motivo})
        print("%d/%d %s %s: %s" % (n, len(ts), "OK" if ok else "FALLO", os.path.basename(t["ruta"]), motivo), flush=True)


if __name__ == "__main__":
    main()
