"""
Recalcula el solape de Whisper de los subtitulos remedidos contra la pista de
audio CORRECTA.

El solape que tenian se calculo transcribiendo la pista ESPANYOLA -la primera,
porque el audio no estaba etiquetado- para comparar con un subtitulo INGLES, asi
que salia bajo por construccion y la primera puerta del rescate los dejaba
fuera. Ahora que el audio esta etiquetado, se transcribe la pista del idioma del
subtitulo. Reutiliza `rescate_whisper` de verificar_subtitulos_externos.py tal
cual, sin copiarla.

Escribe filas en el MISMO formato que verificacion-solo-externo.jsonl, para
pasarlas al rescate con `rescatar_inmedibles.py --medidas <esta salida>`.

    python solape_pista_correcta.py
"""
import importlib.util
import json
import os
import sys

ENTRADA = r"C:\tvwatch\data\remedida-idioma-distinto.jsonl"
SALIDA = r"C:\tvwatch\data\solape-pista-correcta.jsonl"
# Medido el 26/09/2026: en ingles `base` rinde como `medium` y es 7x mas rapido.
MODELO = {"es": "medium", "en": "base"}


def cargar(nombre, ruta):
    spec = importlib.util.spec_from_file_location(nombre, ruta)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    vse = cargar("vse", r"C:\tvwatch\server\scripts\verificar_subtitulos_externos.py")
    sf = vse.cargar_subsfetch()
    filas = [json.loads(l) for l in open(ENTRADA, encoding="utf-8") if l.strip()]
    casos = [d for d in filas if d.get("estado") == "medido" and not d.get("ok")]
    print("a recalcular: %d" % len(casos), flush=True)

    from faster_whisper import WhisperModel
    modelos = {}
    for i, d in enumerate(casos, 1):
        idioma = vse.IDIOMA_WHISPER.get((d.get("language") or "").lower())
        if not idioma:
            continue
        if idioma not in modelos:
            modelos[idioma] = WhisperModel(MODELO[idioma], device="cpu", compute_type="int8", cpu_threads=8)
        texto = sf.leer_srt(d["external"])
        solape = vse.rescate_whisper(sf, modelos[idioma], d["path"], texto,
                                     d["audioIdx"], idioma, d["duration"])
        fila = dict(d)
        fila["solapeWhisper"] = solape
        fila["inmedible"] = True
        fila["solape_sobre"] = "pista correcta (%s)" % d.get("language")
        with open(SALIDA, "a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
        print("  %3d/%d  solape %s  %s" % (i, len(casos), solape, os.path.basename(d["external"])[:55]), flush=True)


if __name__ == "__main__":
    sys.exit(main())
