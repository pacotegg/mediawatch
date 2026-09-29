"""
Coloca en E: los subtitulos que reemplazar_subtitulos_erroneos.py encontro, y
aparta los malos. ESTO SI ESCRIBE EN E:, con permiso expreso del usuario dado
el 29/09/2026 sobre la lista fichero a fichero.

Orden por fichero, y no se salta ninguno:
  1. Revalidar: el video sigue ahi, el candidato existe y no esta vacio, y el
     malo sigue siendo el que se enseño. Entre la lista y ahora el disco pudo
     cambiar; aqui ya se perdieron dos peliculas por dar eso por hecho.
  2. Respaldar el malo en C:\\Media\\respaldos_srt y comprobar el MD5 de la copia.
  3. Borrar el malo de E: SOLO si el respaldo cuadra byte a byte.
  4. Copiar el nuevo y comprobar su MD5 contra el de la carpeta de trabajo.
Si algo no cuadra en cualquier paso, ese fichero se salta entero y se apunta.

Dos grupos, tal como se le enseñaron:
  A - el nuevo ocupa el sitio exacto del malo.
  B - el malo se llama con otra convencion (.en.srt, .eng.sdh.srt): el nuevo
      entra con SU nombre y el viejo se aparta aparte, porque si no quedarian
      dos subtitulos del mismo idioma, uno bueno y uno malo.

    python aplicar_reemplazo_subtitulos.py                  (ensenya el plan)
    python aplicar_reemplazo_subtitulos.py --aplicar --limite 2
    python aplicar_reemplazo_subtitulos.py --aplicar
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone

ENTRADA = r"C:\tvwatch\data\reemplazar-subtitulos.jsonl"
REGISTRO = r"C:\tvwatch\data\aplicar-reemplazo-subtitulos.jsonl"
RESPALDOS = r"C:\Media\respaldos_srt"


def md5(p):
    with open(p, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def idioma_de(nombre):
    n = nombre.lower()
    return "es" if (".spa." in n or ".es." in n or ".esp." in n or ".cas." in n) else "en"


def apunta(fila):
    fila["cuando"] = datetime.now(timezone.utc).isoformat()
    with open(REGISTRO, "a", encoding="utf-8") as f:
        f.write(json.dumps(fila, ensure_ascii=False) + "\n")


def respaldar(origen):
    """Copia a los respaldos con nombre libre y comprueba el MD5. Devuelve la copia."""
    os.makedirs(RESPALDOS, exist_ok=True)
    base = os.path.basename(origen)
    destino = os.path.join(RESPALDOS, base)
    n = 1
    while os.path.exists(destino):
        raiz, ext = os.path.splitext(base)
        destino = os.path.join(RESPALDOS, "%s (%d)%s" % (raiz, n, ext))
        n += 1
    shutil.copy2(origen, destino)
    if md5(destino) != md5(origen):
        raise RuntimeError("el respaldo no cuadra con el original")
    return destino


def plan():
    """Un trabajo por candidato: que entra, que se aparta y de que grupo es."""
    trabajos = []
    for l in open(ENTRADA, encoding="utf-8"):
        d = json.loads(l)
        if d.get("estado") != "candidato":
            continue
        for c in d["candidatos"]:
            destino = c["iria_a"]
            exacto = [m for m in d["malos"] if m.lower() == destino.lower()]
            otros = [m for m in d["malos"]
                     if m.lower() != destino.lower() and idioma_de(m) == idioma_de(destino)]
            trabajos.append({
                "video": d["video"],
                "nuevo": c["nuevo"],
                "destino": destino,
                "apartar": exacto + otros,
                "grupo": "A" if exacto else "B",
            })
    return trabajos


def hacer(t):
    """Devuelve (hecho, motivo). No toca nada si algo no cuadra."""
    if not os.path.isfile(t["video"]):
        return False, "el video ya no esta"
    if not os.path.isfile(t["nuevo"]) or os.path.getsize(t["nuevo"]) == 0:
        return False, "el candidato ya no esta o esta vacio"

    # Se aparta primero, para no dejar dos del mismo idioma en ningun momento.
    for malo in t["apartar"]:
        if not os.path.isfile(malo):
            apunta({"video": t["video"], "estado": "nada_que_apartar", "fichero": malo})
            continue
        try:
            copia = respaldar(malo)
        except Exception as e:
            return False, "no se pudo respaldar %s: %s" % (os.path.basename(malo), e)
        os.remove(malo)
        if os.path.exists(malo):
            return False, "no se pudo apartar %s" % os.path.basename(malo)
        apunta({"video": t["video"], "estado": "apartado", "fichero": malo, "respaldo": copia})

    if os.path.exists(t["destino"]):
        return False, "el destino sigue ocupado tras apartar: %s" % os.path.basename(t["destino"])
    shutil.copy2(t["nuevo"], t["destino"])
    if not os.path.isfile(t["destino"]) or md5(t["destino"]) != md5(t["nuevo"]):
        return False, "la copia del nuevo no cuadra"
    apunta({"video": t["video"], "estado": "puesto", "destino": t["destino"],
            "origen": t["nuevo"], "tam": os.path.getsize(t["destino"]), "grupo": t["grupo"]})
    return True, "puesto"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--limite", type=int, default=0)
    args = ap.parse_args()

    trabajos = plan()
    hechos = set()
    if os.path.isfile(REGISTRO):
        for l in open(REGISTRO, encoding="utf-8"):
            d = json.loads(l)
            if d.get("estado") == "puesto" and d.get("destino"):
                hechos.add(d["destino"].lower())
    trabajos = [t for t in trabajos if t["destino"].lower() not in hechos]
    if args.limite:
        trabajos = trabajos[:args.limite]

    a = sum(1 for t in trabajos if t["grupo"] == "A")
    print("por hacer: %d  (grupo A %d, grupo B %d)%s"
          % (len(trabajos), a, len(trabajos) - a,
             "  [APLICANDO EN E:]" if args.aplicar else "  [solo ensenyar]"), flush=True)
    if not args.aplicar:
        for t in trabajos[:10]:
            print("  %s  %s  <- aparta %d" % (t["grupo"], os.path.basename(t["destino"])[:56], len(t["apartar"])))
        return 0

    bien = mal = 0
    for n, t in enumerate(trabajos, 1):
        hecho, motivo = hacer(t)
        if hecho:
            bien += 1
        else:
            mal += 1
            apunta({"video": t["video"], "estado": "saltado", "motivo": motivo, "destino": t["destino"]})
        print("%3d/%d  %s  %-46s %s" % (n, len(trabajos), t["grupo"],
                                        os.path.basename(t["destino"])[:46],
                                        "OK" if hecho else "SALTADO: " + motivo), flush=True)
    print("\npuestos %d · saltados %d" % (bien, mal))
    print("respaldos en %s" % RESPALDOS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
