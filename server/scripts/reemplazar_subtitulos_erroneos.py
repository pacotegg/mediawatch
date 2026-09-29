"""
Busca el subtitulo CORRECTO para los que clasificar_contenido_global.py marco
como de otro contenido. SOLO BUSCA: deja cada candidato en C:\\Media\\tmp y
apunta que habria que apartar. No escribe en E: -no hay ni una linea que lo
haga- porque sustituir ahi necesita el si explicito del usuario, fichero a
fichero.

Diferencia con completar_subtitulos.py: alli el destino estaba VACIO y se podia
copiar. Aqui el destino esta OCUPADO por el subtitulo malo, asi que la decision
de pisarlo no es de un script.

Los forzados se excluyen, y no por capricho: solo subtitulan lo que esta en otro
idioma, asi que apenas coinciden con el audio y el clasificador los marco a
todos como "otro contenido" sin estarlo. Eran 13 de 222 (28/09/2026).

Quien verifica sigue siendo subsfetch.py: busca en biblioteca local, SubSource y
OpenSubtitles, y comprueba cada candidato contra el audio antes de aceptarlo.
Nunca --mux, que remuxearia el MKV.

    python reemplazar_subtitulos_erroneos.py                 (ensenya la cola)
    python reemplazar_subtitulos_erroneos.py --buscar --limite 5
    python reemplazar_subtitulos_erroneos.py --buscar
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

ENTRADA = r"C:\tvwatch\data\clasificacion-contenido-global.jsonl"
REGISTRO = r"C:\tvwatch\data\reemplazar-subtitulos.jsonl"
SUBSFETCH = r"C:\scripts\webpanel\subsfetch.py"
TRABAJO = r"C:\Media\tmp\subs_reemplazo"
PYTHON = sys.executable
PUERTO_TVWATCH = 8730

# Como nombra el idioma el clasificador -> como lo pide subsfetch.
IDIOMA = {"spa": "es", "es": "es", "cas": "es", "eng": "en", "en": "en"}
# Sufijo que escribe subsfetch -> sufijo de la biblioteca (~6.100 ficheros asi).
RENOMBRE = {".es.srt": ".spa.srt", ".en.srt": ".eng.srt"}


def hay_alguien_viendo():
    """Nadie quiere que el disco se ponga a trabajar mientras ve una pelicula."""
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


def cola_pendiente(solo):
    """Un vídeo por entrada, con todos los idiomas que hay que reemplazar."""
    porVideo = {}
    for l in open(ENTRADA, encoding="utf-8"):
        d = json.loads(l)
        if not d.get("veredicto", "").startswith("OTRO CONTENIDO"):
            continue
        if ".forced." in d["external"].lower():
            continue
        idioma = IDIOMA.get((d.get("language") or "").lower())
        if not idioma:
            apunta({"video": d["path"], "externo": d["external"], "estado": "saltado",
                    "motivo": "idioma no reconocido: %r" % d.get("language")})
            continue
        if solo and solo.lower() not in d["path"].lower():
            continue
        v = porVideo.setdefault(d["path"], {"idiomas": [], "malos": []})
        if idioma not in v["idiomas"]:
            v["idiomas"].append(idioma)
        v["malos"].append(d["external"])

    hechos = set()
    if os.path.isfile(REGISTRO):
        for l in open(REGISTRO, encoding="utf-8"):
            d = json.loads(l)
            if d.get("estado") in ("candidato", "sin_resultado") and d.get("video"):
                hechos.add(d["video"])
    return [(v, x["idiomas"], x["malos"]) for v, x in porVideo.items() if v not in hechos]


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--buscar", action="store_true", help="sin esto solo ensenya la cola")
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--solo", default="")
    args = ap.parse_args()

    cola = cola_pendiente(args.solo)
    # Las peliculas primero: una serie con 52 subtitulos malos puede acaparar la
    # tanda entera, y las fuentes tienen mas y mejor cosecha de peliculas.
    cola.sort(key=lambda x: 1 if ("\\series" in x[0].lower() or "\\docuseries\\" in x[0].lower()) else 0)
    if args.limite:
        cola = cola[:args.limite]
    print("videos en cola: %d%s" % (len(cola), "  [BUSCANDO]" if args.buscar else "  [solo ensenyar]"), flush=True)
    if not args.buscar:
        for v, idiomas, malos in cola[:15]:
            print("   %-6s %s" % (",".join(idiomas), os.path.basename(v)[:66]))
        return 0

    os.makedirs(TRABAJO, exist_ok=True)
    conCandidato = 0
    for n, (video, idiomas, malos) in enumerate(cola, 1):
        nombre = os.path.basename(video)
        print("\n%4d/%d  %s  [%s]" % (n, len(cola), nombre[:62], ",".join(idiomas)), flush=True)
        if not os.path.isfile(video):
            apunta({"video": video, "estado": "saltado", "motivo": "no existe"})
            continue

        while hay_alguien_viendo():
            time.sleep(30)

        dest = os.path.join(TRABAJO, hashlib.md5(video.encode("utf-8")).hexdigest()[:12])
        os.makedirs(dest, exist_ok=True)
        # PYTHONIOENCODING: subsfetch imprime el nombre del fichero y en la
        # consola cp1252 un titulo con U+2753 lo tumba a mitad.
        entorno = dict(os.environ, PYTHONIOENCODING="utf-8")
        try:
            r = subprocess.run([PYTHON, SUBSFETCH, video, "--idiomas", ",".join(idiomas), "--out", dest],
                               capture_output=True, text=True, encoding="utf-8", errors="replace",
                               timeout=3600, env=entorno)
            salida = (r.stdout or "") + (r.stderr or "")
        except subprocess.TimeoutExpired:
            salida = "TIMEOUT de subsfetch tras 3600 s"
        with open(os.path.join(dest, "subsfetch.log"), "w", encoding="utf-8") as f:
            f.write(salida)

        base = os.path.splitext(nombre)[0]
        candidatos = []
        for suf_sf, suf_bib in RENOMBRE.items():
            origen = os.path.join(dest, base + suf_sf)
            if not os.path.isfile(origen) or os.path.getsize(origen) == 0:
                continue
            aparta = os.path.join(os.path.dirname(video), base + suf_bib)
            candidatos.append({"nuevo": origen, "iria_a": aparta,
                               "tam": os.path.getsize(origen),
                               "destino_ocupado": os.path.exists(aparta)})
        linea_res = [l for l in salida.splitlines() if l.startswith("RESULTADO")]
        resumen = (linea_res[-1] if linea_res else "")[:110]
        if candidatos:
            conCandidato += 1
            apunta({"video": video, "estado": "candidato", "malos": malos,
                    "candidatos": candidatos, "resumen": resumen})
            print("        CANDIDATO: %s  %s" % (
                ", ".join(os.path.basename(c["nuevo"]) for c in candidatos), resumen))
        else:
            apunta({"video": video, "estado": "sin_resultado", "malos": malos, "resumen": resumen})
            print("        sin candidato  %s" % resumen)

    print("\nvideos con candidato verificado: %d de %d" % (conCandidato, len(cola)))
    print("NADA se ha escrito en E:. La lista esta en %s" % REGISTRO)
    return 0


if __name__ == "__main__":
    sys.exit(main())
