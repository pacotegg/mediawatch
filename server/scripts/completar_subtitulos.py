"""
Busca y anyade los subtitulos que FALTAN, usando subsfetch.py tal cual (la
herramienta de la casa: biblioteca local -> SubSource -> OpenSubtitles, y todo
verificado y corregido contra el audio antes de aceptarlo).

Por que no se deja a subsfetch escribir en E: directamente:
  - subsfetch.py escribe el .srt final con open(p, "w") SIN mirar si existe
    (linea ~1122): si el destino esta, lo machaca.
  - Su comprobacion de "ya lo tiene" solo mira los subtitulos INCRUSTADOS, no
    los .srt externos que hay al lado.
  - Nunca se usa --mux: remuxea el MKV entero, y eso es una linea roja.
Asi que subsfetch escribe en una carpeta de trabajo en C: (una por video) y
este script coloca cada .srt en su carpeta de E: SOLO si alli no hay ya ningun
subtitulo externo de ese idioma. Copia, no mueve: la carpeta de trabajo queda
como constancia de lo que se puso.

Nombres: se traducen a la convencion de la biblioteca (.spa.srt / .eng.srt,
~6.100 ficheros asi), no a la de subsfetch (.es.srt / .en.srt, ~540).

    python completar_subtitulos.py                 (ensenya la cola)
    python completar_subtitulos.py --aplicar --limite 5
    python completar_subtitulos.py --aplicar
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

INVENTARIO = r"C:\tvwatch\data\inventario-subtitulos-faltan.jsonl"
REGISTRO = r"C:\tvwatch\data\completar-subtitulos.jsonl"
SUBSFETCH = r"C:\scripts\webpanel\subsfetch.py"
TRABAJO = r"C:\Media\tmp\subs_staging"
PYTHON = sys.executable
PUERTO_TVWATCH = 8730

# sufijo que escribe subsfetch -> sufijo de la biblioteca
RENOMBRE = {".es.srt": ".spa.srt", ".en.srt": ".eng.srt",
            ".es.forced.srt": ".spa.forced.srt", ".en.forced.srt": ".eng.forced.srt"}
# como reconocer un externo YA existente de cada idioma (no forzado)
SUFIJOS_IDIOMA = {"es": (".spa.srt", ".es.srt", ".esp.srt", ".cas.srt", ".spa.ass", ".es.ass"),
                  "en": (".eng.srt", ".en.srt", ".eng.ass", ".en.ass")}


def hay_alguien_viendo():
    try:
        cmd = ("(Get-NetTCPConnection -LocalPort %d -State Established "
               "-ErrorAction SilentlyContinue | Measure-Object).Count" % PUERTO_TVWATCH)
        r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                           capture_output=True, text=True, timeout=15)
        return int((r.stdout or "0").strip() or 0) > 0
    except Exception:
        return False


def ya_hay_externo(video, idioma):
    """True si junto al video ya existe un subtitulo externo de ese idioma
    (sin contar forzados). Se mira el DISCO en el momento, no el inventario."""
    carpeta = os.path.dirname(video)
    base = os.path.splitext(os.path.basename(video))[0].lower()
    try:
        nombres = os.listdir(carpeta)
    except OSError:
        return True   # si no se puede mirar, no se escribe
    for n in nombres:
        nl = n.lower()
        if not nl.startswith(base) or ".forced." in nl:
            continue
        if any(nl.endswith(s) for s in SUFIJOS_IDIOMA[idioma]):
            return True
    return False


def md5(p):
    with open(p, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


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
    ap.add_argument("--solo", default="")
    args = ap.parse_args()

    cola = []
    for l in open(INVENTARIO, encoding="utf-8"):
        d = json.loads(l)
        if d.get("error"):
            continue
        idiomas = [i for i, falta in (("es", d.get("falta_es")), ("en", d.get("falta_en"))) if falta]
        if idiomas and (not args.solo or args.solo.lower() in d["path"].lower()):
            cola.append((d["path"], idiomas))
    hechos = set()
    if os.path.isfile(REGISTRO):
        for l in open(REGISTRO, encoding="utf-8"):
            d = json.loads(l)
            if d.get("video"):
                hechos.add(d["video"])
    cola = [(v, i) for v, i in cola if v not in hechos]
    # Conciertos al FINAL: casi no hay dialogo, asi que la verificacion contra
    # el audio los rechazara casi todos. No se excluyen -algunos son
    # documentales, como "Making of S&M"-, pero no deben ir por delante de
    # peliculas y series, que es donde de verdad sirve un subtitulo.
    # Y en general, lo de mas valor primero. Medido el 26/09/2026: de 2.520
    # ficheros sin algun subtitulo, 1.124 son dibujos infantiles doblados
    # (Series Peques), para los que las fuentes casi no tienen nada; las
    # peliculas y documentales son donde de verdad aparece cosecha.
    def prioridad(v):
        v = v.lower()
        if "\\conciertos\\" in v:
            return 3
        if "\\series peques\\" in v:
            return 2
        if "\\series\\" in v or "\\docuseries\\" in v:
            return 1
        return 0
    cola.sort(key=lambda x: prioridad(x[0]))
    if args.limite:
        cola = cola[:args.limite]
    print("videos en cola: %d%s" % (len(cola), "  [APLICANDO]" if args.aplicar else "  [solo ensenyar]"), flush=True)
    if not args.aplicar:
        for v, i in cola[:15]:
            print("   %s  %s" % (",".join(i), os.path.basename(v)[:70]))
        return

    os.makedirs(TRABAJO, exist_ok=True)
    total_puestos = 0
    for n, (video, idiomas) in enumerate(cola, 1):
        nombre = os.path.basename(video)
        print("\n%4d/%d  %s  [%s]" % (n, len(cola), nombre[:62], ",".join(idiomas)), flush=True)
        if not os.path.isfile(video):
            apunta({"video": video, "estado": "saltado", "motivo": "no existe"}); continue
        # Se vuelve a mirar el disco: entre el inventario y ahora puede haber
        # aparecido un externo.
        idiomas = [i for i in idiomas if not ya_hay_externo(video, i)]
        if not idiomas:
            print("        ya tiene externo de todo lo que faltaba: nada que hacer")
            apunta({"video": video, "estado": "saltado", "motivo": "ya tiene externo"}); continue

        while hay_alguien_viendo():
            time.sleep(30)

        dest = os.path.join(TRABAJO, hashlib.md5(video.encode("utf-8")).hexdigest()[:12])
        os.makedirs(dest, exist_ok=True)
        # PYTHONIOENCODING: subsfetch imprime el nombre del fichero, y en la
        # consola cp1252 de Windows un titulo con U+2753 lanza UnicodeEncodeError
        # y lo tumba a mitad (paso el 26/09/2026 en reescribir_subtitulos.py).
        entorno = dict(os.environ, PYTHONIOENCODING="utf-8")
        r = subprocess.run([PYTHON, SUBSFETCH, video, "--idiomas", ",".join(idiomas), "--out", dest],
                           capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=3600, env=entorno)
        salida = (r.stdout or "") + (r.stderr or "")
        # El detalle completo se guarda: sin el, un "no se consiguio nada" no
        # dice si no habia candidatos, si no se pudieron descargar o si la
        # verificacion los rechazo, y averiguarlo obligaba a repetir la busqueda.
        with open(os.path.join(dest, "subsfetch.log"), "w", encoding="utf-8") as f:
            f.write(salida)
        cuota_os_agotada = "CUOTA DIARIA AGOTADA" in salida

        base = os.path.splitext(nombre)[0]
        puestos = []
        for suf_sf, suf_bib in RENOMBRE.items():
            origen = os.path.join(dest, base + suf_sf)
            if not os.path.isfile(origen) or os.path.getsize(origen) == 0:
                continue
            idioma = "es" if suf_sf.startswith(".es") else "en"
            forzado = ".forced." in suf_sf
            destino = os.path.join(os.path.dirname(video), base + suf_bib)
            # NUNCA sobrescribir. Ni el nombre exacto ni otro externo del idioma.
            if os.path.exists(destino) or (not forzado and ya_hay_externo(video, idioma)):
                print("        NO SE PONE %s: ya existe algo en destino" % suf_bib)
                apunta({"video": video, "estado": "no_puesto", "motivo": "destino ocupado",
                        "destino": destino})
                continue
            shutil.copy2(origen, destino)
            if not os.path.isfile(destino) or md5(destino) != md5(origen):
                print("        ERROR al copiar %s" % suf_bib)
                apunta({"video": video, "estado": "error_copia", "destino": destino}); continue
            puestos.append(suf_bib)
            apunta({"video": video, "estado": "puesto", "destino": destino,
                    "tam": os.path.getsize(destino), "copia_en": origen})
        total_puestos += len(puestos)
        linea_res = [l for l in salida.splitlines() if l.startswith("RESULTADO")]
        print("        %s  %s" % ("PUESTOS: " + ", ".join(puestos) if puestos else "nada puesto",
                                  (linea_res[-1] if linea_res else "")[:70]), flush=True)
        if not puestos:
            apunta({"video": video, "estado": "sin_resultado",
                    "resumen": (linea_res[-1] if linea_res else "")[:120]})
        if cuota_os_agotada:
            print("        (OpenSubtitles sin cupo hoy; SubSource y la biblioteca siguen)")

    print("\nsubtitulos anyadidos: %d" % total_puestos)


if __name__ == "__main__":
    sys.exit(main())
