"""
PASADA 1 de 3 (inventario): detecta el idioma REAL de las pistas de audio sin
etiquetar. SOLO LEE: no toca ningun fichero de E:.

Por que importa: `audio_principal` busca la pista etiquetada con el idioma del
subtitulo y, si no la encuentra, cae a la primera. El 26/09/2026 eso hizo que
170 subtitulos en ingles se midieran contra audio ESPANYOL -la primera pista, sin
etiqueta- y salieran como "contenido distinto" cuando no lo eran. Los Looney
Tunes tenian cuatro pistas y ninguna etiquetada.

Solo MKV: se etiquetan con mkvpropedit en el sitio (cabecera, milisegundos, como
hace sanear.ps1). Los MP4 exigirian remuxear el fichero entero y quedan fuera.

    python inventario_idiomas_audio.py --probar 3     (solo los 3 primeros)
    python inventario_idiomas_audio.py
"""
import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time

DB = r"C:\tvwatch\data\tvwatch.db"
SALIDA = r"C:\tvwatch\data\inventario-idiomas-audio.jsonl"
TRABAJO = r"C:\Media\tmp\idiomas_audio"
MKVMERGE = r"C:\Program Files\MKVToolNix\mkvmerge.exe"
SUBSFETCH = r"C:\scripts\webpanel\subsfetch.py"

# Whisper devuelve codigos de 2 letras; Matroska usa ISO 639-2 de 3.
A_ISO3 = {"es": "spa", "en": "eng", "fr": "fre", "de": "ger", "it": "ita",
          "pt": "por", "ja": "jpn", "ru": "rus", "zh": "chi", "ca": "cat",
          "ko": "kor", "nl": "dut", "sv": "swe", "pl": "pol"}


def cargar_ffmpeg():
    import importlib.util
    spec = importlib.util.spec_from_file_location("subsfetch", SUBSFETCH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.FFMPEG


def pistas_mkv(path):
    """Pistas de audio segun mkvmerge -J, que es la numeracion que entiende
    mkvpropedit. Se guarda el UID: con el no hay ambiguedad de indices."""
    try:
        r = subprocess.run([MKVMERGE, "-J", path], capture_output=True, timeout=300)
    except subprocess.TimeoutExpired:
        return None   # fichero lento: se apunta como ilegible y se sigue
    if r.returncode not in (0, 1):
        return None
    info = json.loads(r.stdout.decode("utf-8", "replace"))
    dur = (info.get("container", {}).get("properties", {}).get("duration") or 0) / 1e9
    salida = []
    orden = 0
    for t in info.get("tracks", []):
        if t.get("type") != "audio":
            continue
        p = t.get("properties", {})
        salida.append({"id": t["id"], "orden_audio": orden, "uid": p.get("uid"),
                       "lang": p.get("language"), "lang_ietf": p.get("language_ietf"),
                       "nombre": p.get("track_name"), "codec": t.get("codec")})
        orden += 1
    return salida, dur


def sin_etiqueta(p):
    return (p.get("lang") in (None, "", "und")) and (p.get("lang_ietf") in (None, "", "und"))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--probar", type=int, default=0)
    ap.add_argument("--solo", default="")
    args = ap.parse_args()

    ffmpeg = cargar_ffmpeg()
    os.makedirs(TRABAJO, exist_ok=True)

    db = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    rutas = [r[0] for r in db.execute(
        """SELECT DISTINCT f.path FROM audio_tracks a JOIN media_files f ON f.id = a.file_id
           WHERE (a.language IS NULL OR a.language = '' OR lower(a.language) IN ('und','unknown'))
             AND lower(f.path) LIKE '%.mkv' ORDER BY f.path""")]
    db.close()
    if args.solo:
        rutas = [r for r in rutas if args.solo.lower() in r.lower()]

    hechos = set()
    if os.path.isfile(SALIDA):
        for l in open(SALIDA, encoding="utf-8"):
            try:
                hechos.add(json.loads(l)["path"].lower())
            except (json.JSONDecodeError, KeyError):
                pass
    pendientes = [r for r in rutas if r.lower() not in hechos]
    if args.probar:
        pendientes = pendientes[:args.probar]
    print("MKV con alguna pista sin etiquetar: %d -> ya inventariados %d -> ahora %d"
          % (len(rutas), len(hechos), len(pendientes)), flush=True)

    from faster_whisper import WhisperModel
    modelo = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=8)

    for i, path in enumerate(pendientes, 1):
        fila = {"path": path, "pistas": []}
        if not os.path.isfile(path):
            fila["error"] = "no existe"
        else:
            st = os.stat(path)
            fila["tam"], fila["mtime"] = st.st_size, st.st_mtime
            res = pistas_mkv(path)
            if res is None:
                fila["error"] = "mkvmerge no lo lee"
            else:
                pistas, dur = res
                fila["duracion"] = dur
                for p in pistas:
                    if not sin_etiqueta(p):
                        fila["pistas"].append(dict(p, detectado=None, prob=None))
                        continue
                    # TRES tramos de 30 s repartidos por el fichero y votacion. Con
                    # un solo tramo al 40 %, un Looney Tunes de cuatro pistas dio
                    # confianzas de 0,56-0,62 (26/09/2026): en dibujos animados medio
                    # minuto es casi todo musica y efectos. Se suma la probabilidad
                    # que cada tramo da a cada idioma; gana el de mas peso y su
                    # confianza es la media de sus votos.
                    votos = {}
                    tramos = [0.25, 0.5, 0.75] if dur > 240 else [0.0]
                    for k, f in enumerate(tramos):
                        ini = max(30.0, dur * f) if dur > 240 else 0.0
                        clip = os.path.join(TRABAJO, "d_%d_%d_%d.wav" % (i, p["orden_audio"], k))
                        subprocess.run([ffmpeg, "-v", "error", "-y", "-ss", str(ini), "-t", "30",
                                        "-i", path, "-map", "0:a:%d" % p["orden_audio"],
                                        "-ar", "16000", "-ac", "1", clip],
                                       capture_output=True, timeout=300)
                        if not os.path.isfile(clip):
                            continue
                        try:
                            _, info = modelo.transcribe(clip, beam_size=1)
                            votos.setdefault(info.language, []).append(info.language_probability)
                        except Exception:
                            pass
                        try:
                            os.remove(clip)
                        except OSError:
                            pass
                    det, prob, acuerdo = None, None, 0
                    if votos:
                        det = max(votos, key=lambda L: sum(votos[L]))
                        prob = round(sum(votos[det]) / len(votos[det]), 3)
                        acuerdo = len(votos[det])
                    fila["pistas"].append(dict(p, detectado=det, prob=prob, votos=acuerdo,
                                               tramos=len(tramos), iso3=A_ISO3.get(det or ""),
                                               todos={L: [round(x, 2) for x in v] for L, v in votos.items()}))
        with open(SALIDA, "a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
        resumen = " | ".join("a%d:%s%s" % (p["orden_audio"], p.get("detectado") or p.get("lang"),
                                          " %.2f %d/%d" % (p["prob"], p["votos"], p["tramos"])
                                          if p.get("prob") else "")
                             for p in fila["pistas"])
        print("%4d/%d  %s\n        %s" % (i, len(pendientes), os.path.basename(path)[:66],
                                          fila.get("error") or resumen), flush=True)


if __name__ == "__main__":
    sys.exit(main())
