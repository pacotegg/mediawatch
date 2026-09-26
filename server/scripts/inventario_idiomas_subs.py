"""
PASADA 1 (inventario) del etiquetado de SUBTITULOS incrustados sin idioma.
SOLO LEE.

Muchos rips dejan las pistas de subtitulo sin etiqueta de idioma y lo ponen
solo en el titulo ("espanol", "english", "espanol forzado"). El 26/09/2026 una
pelicula que la base daba por "sin ningun subtitulo" tenia los tres asi. TvWatch
y Plex los ensenyan como "desconocido" y no saben cual ofrecer.

El idioma se deduce del TITULO con un criterio ESTRICTO -palabras completas, no
subcadenas-: `idioma_de_pista` de subsfetch busca "eng" o "spa" dentro del
texto, que sirve para decidir si algo esta resuelto pero es demasiado laxo para
ESCRIBIR una etiqueta. Aqui un titulo que no case con claridad se queda sin
proponer, y todos los titulos distintos se revisan antes de etiquetar.

    python inventario_idiomas_subs.py
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
import unicodedata

DB = r"C:\tvwatch\data\tvwatch.db"
SALIDA = r"C:\tvwatch\data\inventario-idiomas-subs.jsonl"
MKVMERGE = r"C:\Program Files\MKVToolNix\mkvmerge.exe"

# Palabras que identifican el idioma. Se comparan contra el titulo YA
# normalizado (sin tildes, en minusculas, reparado el mojibake tipico).
PALABRAS = {
    "spa": {"espanol", "castellano", "spanish", "latino", "latinoamericano", "espanhol"},
    "eng": {"english", "ingles", "eng"},
    "cat": {"catala", "catalan", "catalan"},
    "fre": {"frances", "french", "francais"},
    "ger": {"aleman", "german", "deutsch"},
    "ita": {"italiano", "italian"},
    "por": {"portugues", "portuguese"},
}


def normalizar(t):
    t = t or ""
    # Mojibake tipico de UTF-8 leido como Latin-1 ("espaÃ±ol" -> "español").
    try:
        rep = t.encode("latin-1").decode("utf-8")
        if rep != t:
            t = rep
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    t = unicodedata.normalize("NFKD", t.lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def proponer(titulo):
    palabras = set(re.findall(r"[a-z]+", normalizar(titulo)))
    hits = {L for L, ps in PALABRAS.items() if palabras & ps}
    # Si el titulo nombra DOS idiomas ("english / espanol") no se adivina.
    return next(iter(hits)) if len(hits) == 1 else None


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    db = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    rutas = [r[0] for r in db.execute(
        "SELECT path FROM media_files WHERE lower(path) LIKE '%.mkv' ORDER BY path")]
    db.close()
    hechos = set()
    if os.path.isfile(SALIDA):
        for l in open(SALIDA, encoding="utf-8"):
            try:
                hechos.add(json.loads(l)["path"])
            except (json.JSONDecodeError, KeyError):
                pass
    pend = [r for r in rutas if r not in hechos]
    print("MKV: %d -> ya vistos %d -> ahora %d" % (len(rutas), len(hechos), len(pend)), flush=True)

    for i, v in enumerate(pend, 1):
        fila = {"path": v, "pistas": []}
        if not os.path.isfile(v):
            fila["error"] = "no existe"
        else:
            st = os.stat(v)
            fila["tam"], fila["mtime"] = st.st_size, st.st_mtime
            # Un fichero puede tardar mucho en leerse (Interstellar IMAX, 4K,
            # paso de 120 s el 26/09/2026). Sin capturar esto, UN fichero lento
            # tumbaba el inventario entero; ahora se apunta y se sigue.
            try:
                r = subprocess.run([MKVMERGE, "-J", v], capture_output=True, timeout=300)
            except subprocess.TimeoutExpired:
                r = None
            if r is None:
                fila["error"] = "mkvmerge tardo mas de 300 s"
            elif r.returncode not in (0, 1):
                fila["error"] = "mkvmerge no lo lee"
            else:
                j = json.loads(r.stdout.decode("utf-8", "replace"))
                for t in j.get("tracks", []):
                    if t.get("type") != "subtitles":
                        continue
                    p = t.get("properties", {})
                    if (p.get("language") or "und") not in ("und", ""):
                        continue
                    fila["pistas"].append({
                        "uid": p.get("uid"), "titulo": p.get("track_name"),
                        "codec": t.get("codec"), "forzada": bool(p.get("forced_track")),
                        "propuesta": proponer(p.get("track_name"))})
        if fila["pistas"] or fila.get("error"):
            with open(SALIDA, "a", encoding="utf-8") as f:
                f.write(json.dumps(fila, ensure_ascii=False) + "\n")
        else:
            with open(SALIDA, "a", encoding="utf-8") as f:
                f.write(json.dumps({"path": v, "pistas": []}, ensure_ascii=False) + "\n")
        if i % 500 == 0 or i == len(pend):
            print("  %d/%d" % (i, len(pend)), flush=True)


if __name__ == "__main__":
    sys.exit(main())
