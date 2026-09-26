"""
Inventario de los subtitulos que FALTAN de verdad. SOLO LEE.

La base de TvWatch no sirve para esto: guarda el idioma de las pistas
incrustadas pero no su TITULO, y hay muchos rips que dejan el idioma sin
etiquetar y lo ponen solo en el titulo ("espanol", "english"). Contado desde la
base salian 2.551 ficheros sin subtitulo; al probar el primero con subsfetch
resulto tener los tres (espanol, forzado e ingles) etiquetados solo por titulo.

Asi que se usa EXACTAMENTE el criterio de subsfetch: su info_video (ffprobe),
su idioma_de_pista (etiqueta + titulo), su es_forzada, y su lista de codecs
que ya cuentan como resueltos. Lo que sale aqui es lo que subsfetch buscaria.
Mas los .srt EXTERNOS de la carpeta, que subsfetch no mira y la base si.

    python inventario_subtitulos_faltan.py
"""
import importlib.util
import json
import os
import re
import sqlite3
import sys

DB = r"C:\tvwatch\data\tvwatch.db"
SALIDA = r"C:\tvwatch\data\inventario-subtitulos-faltan.jsonl"
RESUELTOS = ("subrip", "ass", "ssa", "mov_text", "text", "hdmv_pgs_subtitle")
IDIOMA_EXT = {"spa": "es", "es": "es", "esp": "es", "cas": "es", "lat": "es",
              "eng": "en", "en": "en"}


def cargar_sf():
    spec = importlib.util.spec_from_file_location("sf", r"C:\scripts\webpanel\subsfetch.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def externos(video):
    """Idiomas de los .srt/.ass externos junto al video (sin contar forzados)."""
    carpeta, base = os.path.dirname(video), os.path.splitext(os.path.basename(video))[0]
    salida = set()
    try:
        nombres = os.listdir(carpeta)
    except OSError:
        return salida
    for n in nombres:
        if not n.lower().endswith((".srt", ".ass", ".ssa")) or not n.startswith(base):
            continue
        partes = n[len(base):].lower().split(".")
        if "forced" in partes:
            continue
        for p in partes:
            if p in IDIOMA_EXT:
                salida.add(IDIOMA_EXT[p])
    return salida


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    sf = cargar_sf()
    db = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    rutas = [r[0] for r in db.execute("SELECT path FROM media_files ORDER BY path")]
    db.close()

    hechos = set()
    if os.path.isfile(SALIDA):
        for l in open(SALIDA, encoding="utf-8"):
            try:
                hechos.add(json.loads(l)["path"])
            except (json.JSONDecodeError, KeyError):
                pass
    pend = [r for r in rutas if r not in hechos]
    print("ficheros: %d -> ya vistos %d -> ahora %d" % (len(rutas), len(hechos), len(pend)), flush=True)

    for i, v in enumerate(pend, 1):
        fila = {"path": v}
        if not os.path.isfile(v):
            fila["error"] = "no existe"
        else:
            try:
                info = sf.info_video(v)
                inc = set()
                for s in info["subs"]:
                    if s["codec"] in RESUELTOS and not sf.es_forzada(s):
                        inc.add(sf.idioma_de_pista(s["lang"], s["title"]))
                ext = externos(v)
                tiene = inc | ext
                fila.update({"incrustados": sorted(inc), "externos": sorted(ext),
                             "falta_es": "es" not in tiene, "falta_en": "en" not in tiene})
            except Exception as e:
                fila["error"] = str(e)[:80]
        with open(SALIDA, "a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
        if i % 250 == 0 or i == len(pend):
            print("  %d/%d" % (i, len(pend)), flush=True)


if __name__ == "__main__":
    sys.exit(main())
