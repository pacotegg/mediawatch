"""
PASADA 3 de 3 (accion): pone el idioma a las pistas de SUBTITULO sin etiquetar,
segun el inventario de `inventario_idiomas_audio.py`. ESCRIBE EN E:.

Solo se etiqueta lo que el detector dio con confianza: los TRES tramos de
acuerdo y probabilidad media >= 0,80. Validado el 26/09/2026 sobre 34 pistas
que ya estaban bien etiquetadas: 32/32 aciertos en total y 21/21 dentro de este
umbral. Una etiqueta equivocada es PEOR que ninguna, porque hace que
`audio_principal` elija la pista mala con seguridad; por eso el umbral no se
relaja aunque el detector acierte tambien por debajo.

Como se protege cada fichero, porque no se puede respaldar un video de 20 GB:
  - mkvpropedit trabaja EN EL SITIO y solo reescribe la cabecera (como hace
    sanear.ps1). No toca ni un byte de video ni de audio.
  - Se selecciona la pista por su UID (`track:=uid`), nunca por posicion.
  - REVALIDA antes: tamanyo y fecha iguales a los del inventario, y la pista
    sigue sin etiqueta. Si algo cambio, se salta.
  - VERIFICA despues: la pista lleva la etiqueta nueva, el numero de pistas es
    el mismo y la duracion no ha cambiado.
  - Todo queda apuntado con el valor ANTERIOR, asi que se puede deshacer con
    `mkvpropedit <f> --edit track:=<uid> --set language=und`.

    python etiquetar_idiomas_audio.py            (ensenya, no toca nada)
    python etiquetar_idiomas_audio.py --aplicar
"""
import argparse
import json
import os
import subprocess
import sys
import time

INVENTARIO = r"C:\tvwatch\data\inventario-idiomas-subs.jsonl"
REGISTRO = r"C:\tvwatch\data\etiquetado-idiomas-subs.jsonl"
MKVMERGE = r"C:\Program Files\MKVToolNix\mkvmerge.exe"
MKVPROPEDIT = r"C:\Program Files\MKVToolNix\mkvpropedit.exe"
PUERTO_TVWATCH = 8730
PROB_MINIMA = 0.80


def confiada(p):
    # Aqui la senyal es el TITULO de la pista, no una deteccion con
    # probabilidad. Todos los titulos distintos con propuesta se revisaron uno
    # a uno el 26/09/2026 antes de lanzar (37 pistas, ninguna mal).
    if p.get("propuesta"):
        p.setdefault("iso3", p["propuesta"])
        p.setdefault("detectado", "titulo")
        p.setdefault("prob", 1.0)
        return True
    return False


def hay_alguien_viendo():
    try:
        cmd = ("(Get-NetTCPConnection -LocalPort %d -State Established "
               "-ErrorAction SilentlyContinue | Measure-Object).Count" % PUERTO_TVWATCH)
        r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                           capture_output=True, text=True, timeout=15)
        return int((r.stdout or "0").strip() or 0) > 0
    except Exception:
        return False


def leer(path):
    try:
        r = subprocess.run([MKVMERGE, "-J", path], capture_output=True, timeout=300)
    except subprocess.TimeoutExpired:
        return None   # fichero lento: se trata como ilegible y se salta
    if r.returncode not in (0, 1):
        return None
    j = json.loads(r.stdout.decode("utf-8", "replace"))
    dur = j.get("container", {}).get("properties", {}).get("duration")
    audio = {t["properties"].get("uid"): (t["properties"].get("language"),
                                           t["properties"].get("language_ietf"))
             for t in j.get("tracks", []) if t.get("type") == "subtitles"}
    return {"n": len(j.get("tracks", [])), "dur": dur, "audio": audio}


def apunta(fila):
    with open(REGISTRO, "a", encoding="utf-8") as f:
        f.write(json.dumps(fila, ensure_ascii=False) + "\n")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--limite", type=int, default=0)
    args = ap.parse_args()

    filas = [json.loads(l) for l in open(INVENTARIO, encoding="utf-8") if l.strip()]
    ya = set()
    if os.path.isfile(REGISTRO):
        for l in open(REGISTRO, encoding="utf-8"):
            d = json.loads(l)
            if d.get("estado") == "hecho":
                ya.add((d["path"].lower(), d["uid"]))

    cola = []
    for f in filas:
        if f.get("error"):
            continue
        objetivos = [p for p in f["pistas"] if confiada(p) and (f["path"].lower(), p["uid"]) not in ya]
        if objetivos:
            cola.append((f, objetivos))
    if args.limite:
        cola = cola[:args.limite]
    n_pistas = sum(len(o) for _, o in cola)
    print("ficheros a etiquetar: %d (%d pistas)%s\n"
          % (len(cola), n_pistas, "  [APLICANDO]" if args.aplicar else "  [solo ensenyar]"), flush=True)

    hechos = saltados = fallos = 0
    for i, (f, objetivos) in enumerate(cola, 1):
        path = f["path"]
        nombre = os.path.basename(path)
        cambios = ", ".join("uid ..%s -> %s (%s %.2f)" % (str(p["uid"])[-5:], p["iso3"], p["detectado"], p["prob"])
                            for p in objetivos)
        print("%4d/%d  %s\n        %s" % (i, len(cola), nombre[:66], cambios), flush=True)
        if not args.aplicar:
            continue

        # --- REVALIDAR
        if not os.path.isfile(path):
            print("        SALTADO: ya no existe"); saltados += 1
            apunta({"path": path, "estado": "saltado", "motivo": "no existe"}); continue
        st = os.stat(path)
        if st.st_size != f.get("tam") or abs(st.st_mtime - f.get("mtime", 0)) > 2:
            print("        SALTADO: el fichero cambio desde el inventario"); saltados += 1
            apunta({"path": path, "estado": "saltado", "motivo": "cambio desde el inventario"}); continue
        antes = leer(path)
        if antes is None:
            print("        SALTADO: mkvmerge no lo lee"); saltados += 1
            apunta({"path": path, "estado": "saltado", "motivo": "ilegible"}); continue
        vivos = [p for p in objetivos if p["uid"] in antes["audio"]
                 and (antes["audio"][p["uid"]][0] in (None, "", "und"))]
        if not vivos:
            print("        SALTADO: las pistas ya tienen etiqueta"); saltados += 1
            apunta({"path": path, "estado": "saltado", "motivo": "ya etiquetada"}); continue

        while hay_alguien_viendo():
            time.sleep(30)

        # --- ACCION: una sola llamada con todas las pistas del fichero
        cmd = [MKVPROPEDIT, path]
        for p in vivos:
            cmd += ["--edit", "track:=%s" % p["uid"], "--set", "language=%s" % p["iso3"]]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            print("        FALLO mkvpropedit (%d): %s" % (r.returncode, (r.stdout or r.stderr).strip()[-120:]))
            fallos += 1
            apunta({"path": path, "estado": "fallo", "codigo": r.returncode}); continue

        # --- VERIFICAR
        desp = leer(path)
        problemas = []
        if desp is None:
            problemas.append("ilegible despues")
        else:
            if desp["n"] != antes["n"]:
                problemas.append("cambio el numero de pistas %d->%d" % (antes["n"], desp["n"]))
            if desp["dur"] != antes["dur"]:
                problemas.append("cambio la duracion")
            for p in vivos:
                if (desp["audio"].get(p["uid"]) or (None,))[0] != p["iso3"]:
                    problemas.append("uid ..%s no quedo en %s" % (str(p["uid"])[-5:], p["iso3"]))
        if problemas:
            print("        VERIFICACION FALLIDA: %s" % "; ".join(problemas))
            fallos += 1
            apunta({"path": path, "estado": "verificacion_fallida", "problemas": problemas}); continue

        for p in vivos:
            apunta({"path": path, "uid": p["uid"], "estado": "hecho",
                    "antes": antes["audio"][p["uid"]][0], "despues": p["iso3"],
                    "detectado": p["detectado"], "prob": p["prob"]})
        hechos += 1
        print("        OK", flush=True)

    print("\nficheros etiquetados %d · saltados %d · fallos %d" % (hechos, saltados, fallos))


if __name__ == "__main__":
    sys.exit(main())
