"""
Vuelve a medir los subtitulos que se midieron contra el audio EQUIVOCADO.

El 26/09/2026 salieron 170 subtitulos ingleses con "solape bajo" que no eran
contenido distinto: `audio_principal` buscaba la pista etiquetada 'eng', no la
encontraba porque ninguna tenia etiqueta, y caia a la primera, que era la
espanyola. Tras etiquetar el audio (etiquetar_idiomas_audio.py, 594 pistas),
ahora la pista inglesa se encuentra.

Para cada uno:
  - si AHORA hay pista del idioma del subtitulo -> se mide contra ella
  - si no la hay -> el contenido de verdad solo tiene audio en otro idioma, y
    el usuario pidio DESCARTARLOS. Descartar es sacarlos de la cola, NO borrar
    nada.
SOLO MIDE. Escribe en data/remedida-idioma-distinto.jsonl, en formato
compatible con reescribir_subtitulos.py para que los arreglables sigan el
mismo camino verificado que los demas.

    python remedir_idioma_distinto.py
"""
import importlib.util
import json
import os
import subprocess
import sys

LISTA = r"C:\Users\HTPC\AppData\Local\Temp\claude\C--tvwatch\a3f56fc0-02a8-4188-88fe-2bd3f00504f9\scratchpad\idioma_distinto.json"
SALIDA = r"C:\tvwatch\data\remedida-idioma-distinto.jsonl"
SUBSFETCH = r"C:\scripts\webpanel\subsfetch.py"


def cargar_sf():
    spec = importlib.util.spec_from_file_location("sf", SUBSFETCH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def pista_del_idioma(sf, path, lang3):
    """Indice ABSOLUTO de la primera pista de audio etiquetada con ese idioma,
    o None si no hay ninguna. Se lee del fichero, que es lo que ha cambiado."""
    r = subprocess.run([sf.FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries",
                        "stream=index:stream_tags=language", "-of", "json", path],
                       capture_output=True, text=True, timeout=120)
    for s in json.loads(r.stdout or "{}").get("streams", []):
        if (s.get("tags", {}).get("language") or "").lower() == lang3:
            return s["index"]
    return None


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    sf = cargar_sf()
    casos = json.load(open(LISTA, encoding="utf-8"))
    hechos = set()
    if os.path.isfile(SALIDA):
        for l in open(SALIDA, encoding="utf-8"):
            d = json.loads(l)
            hechos.add((d["path"], d["external"]))
    pend = [c for c in casos if (c["path"], c["external"]) not in hechos]
    print("a remedir: %d (ya hechos %d)" % (len(pend), len(hechos)), flush=True)

    for i, c in enumerate(pend, 1):
        lang3 = (c.get("language") or "").lower()
        fila = dict(c)
        if not os.path.isfile(c["path"]) or not os.path.isfile(c["external"]):
            fila["estado"] = "no existe"
        else:
            idx = pista_del_idioma(sf, c["path"], lang3)
            if idx is None:
                fila["estado"] = "descartado: no hay audio en %s" % lang3
            else:
                texto = sf.leer_srt(c["external"])
                v = sf.verificar_sync(c["path"], texto, idx, c["duration"])
                fila.update(v)
                fila["audioIdx"] = idx
                fila["estado"] = "medido"
        with open(SALIDA, "a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
        if i % 20 == 0 or i == len(pend):
            print("  %d/%d" % (i, len(pend)), flush=True)


if __name__ == "__main__":
    sys.exit(main())
