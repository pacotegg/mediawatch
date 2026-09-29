"""
Separa, entre los subtitulos con solape bajo, los que son OTRO EPISODIO de los
que son el contenido correcto con un desfase ENORME. SOLO LEE.

El solape de vocabulario compara el audio con la MISMA ventana de tiempo del
subtitulo. Si sale bajo, rescate_whisper lo dice en su docstring: puede ser otro
contenido o un desfase tan grande que ninguna ventana cae donde toca, y no
distingue las dos. Pero la diferencia lo es todo: lo primero hay que
sustituirlo, lo segundo se arregla desplazando.

Aqui las palabras del audio se buscan en TODO el subtitulo, no en su ventana.
- Si muchas aparecen, y ademas todas con una diferencia de tiempo parecida,
  es el mismo contenido y esa diferencia es el desfase.
- Si casi ninguna aparece en ningun sitio, es otro episodio.

Metodo de marcas de tiempo por palabra de Whisper, anclando SOLO la primera
palabra de cada cue (lo unico que no supone nada sobre como se reparte la voz
dentro del cue). Medido el 26/09/2026: +-0,9 s de error. No basta para
corregir; sobra para clasificar, y para estimar un desfase de minutos.

    python clasificar_contenido_global.py
"""
import argparse
import collections
import importlib.util
import json
import os
import re
import statistics
import subprocess
import sys

MEDIDAS = r"C:\tvwatch\data\verificacion-solo-externo.jsonl"
PISTA_CORRECTA = r"C:\tvwatch\data\solape-pista-correcta.jsonl"
SALIDA = r"C:\tvwatch\data\clasificacion-contenido-global.jsonl"
TRABAJO = r"C:\Media\tmp\clasificar_global"
MODELO = {"es": "medium", "en": "base"}
TS = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->")


def cargar(nombre, ruta):
    spec = importlib.util.spec_from_file_location(nombre, ruta)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def primeras_palabras(texto):
    salida = []
    for bloque in re.split(r"\n\s*\n", texto.replace("\r\n", "\n")):
        m = TS.search(bloque)
        if not m:
            continue
        t = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000
        cuerpo = re.sub(r".*-->.*", "", bloque)
        cuerpo = re.sub(r"^\d+\s*$", "", cuerpo, flags=re.M)
        cuerpo = re.sub(r"<[^>]+>", " ", cuerpo)
        for w in re.findall(r"[a-záéíóúñü']+", cuerpo.lower()):
            if len(w) > 3:
                salida.append((w, t))
                break
    return salida


def candidatos():
    """Los 59 de solape bajo y MISMO idioma, mas los 73 remedidos contra la
    pista correcta. Cada uno con la pista de audio buena."""
    salida = {}
    for l in open(MEDIDAS, encoding="utf-8"):
        d = json.loads(l)
        if not d.get("inmedible") or d.get("solapeWhisper") is None or d["solapeWhisper"] >= 0.15:
            continue
        if d.get("audioIdx") is None:
            continue
        salida[(d["path"], d["external"])] = d
    # Los de la pista correcta SUSTITUYEN a su version medida contra la mala.
    if os.path.isfile(PISTA_CORRECTA):
        for l in open(PISTA_CORRECTA, encoding="utf-8"):
            d = json.loads(l)
            salida[(d["path"], d["external"])] = d
    return list(salida.values())


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--pares", help="JSON con pares concretos a clasificar (para validar)")
    ap.add_argument("--salida", default=SALIDA)
    args = ap.parse_args()
    vse = cargar("vse", r"C:\tvwatch\server\scripts\verificar_subtitulos_externos.py")
    sf = vse.cargar_subsfetch()
    os.makedirs(TRABAJO, exist_ok=True)

    todos = json.load(open(args.pares, encoding="utf-8")) if args.pares else candidatos()
    hechos = set()
    if os.path.isfile(args.salida):
        for l in open(args.salida, encoding="utf-8"):
            d = json.loads(l)
            hechos.add((d["path"], d["external"]))
    pend = [d for d in todos if (d["path"], d["external"]) not in hechos]
    print("a clasificar: %d (ya hechos %d)" % (len(pend), len(hechos)), flush=True)

    from faster_whisper import WhisperModel
    modelos = {}
    for n, d in enumerate(pend, 1):
        idioma = vse.IDIOMA_WHISPER.get((d.get("language") or "").lower())
        fila = {k: d[k] for k in ("path", "external", "language", "audioIdx", "duration") if k in d}
        if not idioma or not os.path.isfile(d["path"]) or not os.path.isfile(d["external"]):
            fila["veredicto"] = "no se puede (idioma o fichero)"
        else:
            if idioma not in modelos:
                modelos[idioma] = WhisperModel(MODELO[idioma], device="cpu", compute_type="int8", cpu_threads=8)
            texto = sf.leer_srt(d["external"]) or ""
            pal_srt = primeras_palabras(texto)
            por_palabra = collections.defaultdict(list)
            for w, t in pal_srt:
                por_palabra[w].append(t)
            # Palabras que se repiten mucho no identifican un momento.
            frecuentes = {w for w, v in por_palabra.items() if len(v) > 3}
            dur = d["duration"]
            pal_audio = []
            for f in (0.2, 0.45, 0.7):
                ini = max(60.0, dur * f)
                if ini + 150 > dur:
                    continue
                clip = os.path.join(TRABAJO, "g_%d.wav" % n)
                subprocess.run([sf.FFMPEG, "-v", "error", "-y", "-ss", str(ini), "-t", "150",
                                "-i", d["path"], "-map", "0:%d" % d["audioIdx"],
                                "-ar", "16000", "-ac", "1", clip], capture_output=True, timeout=600)
                if not os.path.isfile(clip):
                    continue
                segs, _ = modelos[idioma].transcribe(clip, language=idioma, beam_size=1, word_timestamps=True)
                for s in segs:
                    for w in (s.words or []):
                        limpia = re.sub(r"[^a-záéíóúñü']", "", w.word.lower())
                        if len(limpia) > 3:
                            pal_audio.append((limpia, ini + w.start))
                try:
                    os.remove(clip)
                except OSError:
                    pass
            # GLOBAL: la palabra se busca en todo el subtitulo, sin ventana.
            difs = []
            raras = [(w, t) for w, t in pal_audio if w not in frecuentes]
            for w, t in raras:
                if w in por_palabra:
                    difs.append(min((ts - t for ts in por_palabra[w]), key=abs))
            fila.update({"palabras_audio": len(raras), "encontradas": len(difs)})
            if len(raras) < 15:
                fila["veredicto"] = "poco material"
            else:
                tasa = len(difs) / len(raras)
                fila["tasa_encontradas"] = round(tasa, 3)
                if len(difs) >= 12:
                    med = statistics.median(difs)
                    mad = statistics.median([abs(x - med) for x in difs])
                    # Consistentes = casi todas con el mismo desfase.
                    consistentes = sum(1 for x in difs if abs(x - med) <= 3.0)
                    fila.update({"desfase_estimado": round(-med, 1), "mad": round(mad, 2),
                                 "consistentes": consistentes})
                    if consistentes >= 10 and consistentes / len(difs) >= 0.4:
                        fila["veredicto"] = "MISMO CONTENIDO, desfase %+.0f s" % (-med)
                    else:
                        fila["veredicto"] = "OTRO CONTENIDO (palabras sueltas, sin desfase comun)"
                else:
                    fila["veredicto"] = "OTRO CONTENIDO (casi ninguna palabra aparece)"
        with open(args.salida, "a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
        print("  %3d/%d  %-44s %s" % (n, len(pend), os.path.basename(d["external"])[:44],
                                      fila["veredicto"]), flush=True)


if __name__ == "__main__":
    sys.exit(main())
