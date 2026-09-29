r"""
Mide el desfase entre la pista de audio en castellano y la original (ingles)
de cada pelicula que tenga las dos. SOLO LEE: no toca ningun fichero.

Correlaciona la envolvente de volumen de las dos pistas en 4 tramos de 90 s.
La pista inglesa se toma como referencia porque el usuario confirmo (Up,
29/09/2026) que en ingles va bien y en castellano no. Un desfase constante
en los 4 tramos es un audio castellano de otra fuente, con otra cabecera.

    python medir_desfase_audio.py "E:\Peques" "E:\Pelis Animacion"
Resumen: python medir_desfase_audio.py --resumen
Registro reanudable: data/desfase-audio.jsonl (una linea por pelicula)
"""
import json, os, subprocess, sys, statistics as st
import numpy as np

FF = r"C:\Users\HTPC\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"
FP = r"C:\Users\HTPC\AppData\Local\Microsoft\WinGet\Links\ffprobe.exe"
REG = r"C:\tvwatch\data\desfase-audio.jsonl"
VENTANA = 90
FRACCIONES = (0.15, 0.35, 0.55, 0.75)


def pistas(f):
    o = subprocess.run([FP, "-v", "error", "-show_entries",
                        "format=duration:stream=index,codec_type,channels:stream_tags=language,title",
                        "-of", "json", f], capture_output=True, text=True).stdout
    d = json.loads(o)
    aud = [s for s in d["streams"] if s.get("codec_type") == "audio"]
    def idioma(s): return (s.get("tags") or {}).get("language", "")
    def titulo(s): return ((s.get("tags") or {}).get("title", "")).lower()
    def util(s): return not any(x in titulo(s) for x in ("comment", "descri", "audiodesc"))
    spa = next((s for s in aud if idioma(s) in ("spa", "es", "esl") and util(s)), None)
    eng = next((s for s in aud if idioma(s) in ("eng", "en") and util(s)), None)
    return spa, eng, float(d["format"].get("duration") or 0)


def envolvente(f, idx, ss):
    raw = subprocess.run([FF, "-v", "error", "-ss", str(ss), "-t", str(VENTANA), "-i", f,
                          "-map", "0:%d" % idx, "-ac", "1", "-ar", "4000", "-f", "s16le", "-"],
                         capture_output=True).stdout
    x = np.abs(np.frombuffer(raw, dtype=np.int16).astype(np.float32))
    n = len(x) // 4 * 4
    e = np.convolve(x[:n].reshape(-1, 4).mean(axis=1), np.ones(20) / 20, mode="same")[::10]
    e = e - e.mean()
    s = e.std()
    return e / s if s else e


def desfase(a, b, maxlag=20.0):
    # 20 s y no 5: con 5 el pico de «Solo para sus ojos» (-5,4 s real) se
    # quedaba clavado en el borde del rango y salia como -5,00 exacto.
    # Un resultado igual al maxlag es senyal de recorte, no de medida.
    n = min(len(a), len(b))
    if n < 1000:
        return None
    a, b = a[:n], b[:n]
    c = np.fft.irfft(np.fft.rfft(a, 2 * n) * np.conj(np.fft.rfft(b, 2 * n)))
    L = int(maxlag * 100)
    c = np.concatenate([c[-L:], c[:L + 1]])
    i = int(np.argmax(c))
    return (i - L) / 100.0, float(c[i] / n)


def medir(f):
    spa, eng, dur = pistas(f)
    if not spa or not eng:
        return {"estado": "sin_par"}
    if dur < 600:
        return {"estado": "corta"}
    tramos = []
    for fr in FRACCIONES:
        ss = int(dur * fr)
        r = desfase(envolvente(f, spa["index"], ss), envolvente(f, eng["index"], ss))
        if r:
            tramos.append({"t": ss, "off": r[0], "q": round(r[1], 2)})
    buenos = [t["off"] for t in tramos if t["q"] >= 0.4]
    if len(buenos) < 3:
        return {"estado": "inmedible", "tramos": tramos, "spa": spa["index"], "eng": eng["index"]}
    return {"estado": "medido", "mediana": round(st.median(buenos), 2),
            "dispersion": round(max(buenos) - min(buenos), 2), "tramos": tramos,
            "spa": spa["index"], "eng": eng["index"]}


def hechos():
    if not os.path.isfile(REG):
        return set()
    return {json.loads(l)["ruta"] for l in open(REG, encoding="utf-8") if l.strip()}


def resumen():
    filas = [json.loads(l) for l in open(REG, encoding="utf-8") if l.strip()]
    cuenta = {}
    for f in filas:
        cuenta[f["estado"]] = cuenta.get(f["estado"], 0) + 1
    print(cuenta)
    med = [f for f in filas if f["estado"] == "medido"]
    for f in sorted(med, key=lambda f: f["mediana"]):
        marca = "  <-- DESFASE" if abs(f["mediana"]) >= 0.3 and f["dispersion"] <= 0.3 else ""
        print("%+6.2f s  disp %.2f  %s%s" % (f["mediana"], f["dispersion"], os.path.basename(f["ruta"])[:60], marca))


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if "--resumen" in sys.argv:
        return resumen()
    import sqlite3
    db = sqlite3.connect("file:C:/tvwatch/data/tvwatch.db?mode=ro", uri=True)
    raices = [r.lower().rstrip("\\") + "\\" for r in sys.argv[1:]]
    rutas = [r[0] for r in db.execute("select path from media_files order by path")
             if any(r[0].lower().startswith(x) for x in raices)]
    ya = hechos()
    pend = [r for r in rutas if r not in ya]
    print("peliculas: %d, ya medidas: %d, por medir: %d" % (len(rutas), len(ya), len(pend)), flush=True)
    for n, ruta in enumerate(pend, 1):
        try:
            r = medir(ruta) if os.path.isfile(ruta) else {"estado": "no_existe"}
        except Exception as e:
            r = {"estado": "error", "motivo": str(e)[:200]}
        r["ruta"] = ruta
        with open(REG, "a", encoding="utf-8") as f:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print("%d/%d %s %s" % (n, len(pend), r["estado"], r.get("mediana", "")), flush=True)


if __name__ == "__main__":
    main()
