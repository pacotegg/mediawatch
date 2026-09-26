"""
Rescate de los subtitulos que el detector de voz NO puede demostrar.

Estos no se pueden verificar con `verificar_sync` ni antes ni despues -por eso
son "inmedible"-, asi que no valen las reglas del paso 2. Aqui la seguridad se
construye con TRES puertas independientes, y solo se escribe si pasan las tres:

  1. CONTENIDO. Solo ficheros cuyo solape de vocabulario con la transcripcion
     de Whisper sea >= 0.30: prueba de que el subtitulo es de ESTE contenido y
     no de otro episodio. Sin esto no hay desplazamiento que valga.

  2. FORMA. alass con --no-split y --disable-fps-guessing, o sea el minimo que
     puede hacer: un desplazamiento uniforme. Se exige rango interno ~0 y una
     magnitud acotada. Medido el 26/09/2026: en cuanto se le deja partir o
     adivinar framerate, alass inventa alineaciones en los ficheros de senyal
     debil -rangos de hasta 1.318 s, subtitulos destrozados-. Un rango > 0 aqui
     suele ser el recorte en cero de un desplazamiento negativo absurdo.

  3. CORROBORACION. El desfase que propone alass se compara con el que sale de
     las marcas de tiempo por palabra de Whisper. Ese metodo tiene +-0,9 s de
     error medido -no sirve para CORREGIR- pero sobra para confirmar si un
     -3,33 s es real o inventado. Si las dos cifras no se parecen, no se toca.

    python rescatar_inmedibles.py            (ensenya, no toca nada)
    python rescatar_inmedibles.py --aplicar
"""
import argparse
import collections
import importlib.util
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import time
from datetime import datetime

SUBSFETCH = r"C:\scripts\webpanel\subsfetch.py"
ALASS = r"C:\scripts\bin\alass\alass-cli.exe"
MEDIDAS = r"C:\tvwatch\data\verificacion-solo-externo.jsonl"
RESPALDOS = r"C:\Media\respaldos_srt"
REGISTRO = r"C:\tvwatch\data\rescate-inmedibles.jsonl"
TRABAJO = r"C:\Media\tmp\rescate_srt"

SOLAPE_MINIMO = 0.30
DESPLAZAMIENTO_MINIMO = 0.5      # por debajo, no hay nada que arreglar
DESPLAZAMIENTO_MAXIMO = 60.0     # por encima, sospechoso: no se toca
RANGO_MAXIMO = 0.30              # tiene que ser uniforme
DISCREPANCIA_MAXIMA = 1.5        # margen para el +-0,9 s del metodo de palabras

TS = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")
TS_INI = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->")
CODECS = (("utf-8-sig", "utf-8"), ("utf-8", "utf-8"), ("cp1252", "windows-1252"), ("latin-1", "windows-1252"))
# Medido el 26/09/2026 sobre 46 clips: en espanyol `medium` dobla los aciertos
# de `base` (0.286 vs 0.189 de solape medio); en ingles `base` ya va bien y
# `medium` cuesta 7x para +0,02. distil-large-v3.5 quedo descartado: transcribe
# el audio espanyol AL INGLES aunque se le pase language='es'.
MODELO = {"es": "medium", "en": "base"}


def cargar_subsfetch():
    spec = importlib.util.spec_from_file_location("subsfetch", SUBSFETCH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def leer_con_codec(path):
    for py, alass in CODECS:
        try:
            with open(path, encoding=py) as f:
                return f.read(), py, alass
        except (UnicodeDecodeError, LookupError):
            continue
    return None, None, None


def tiempos_de(texto):
    return [int(a) * 3600 + int(b) * 60 + int(c) + int(d) / 1000
            for a, b, c, d in TS_INI.findall(texto)]


def primeras_palabras(texto):
    """[(palabra, segundo_inicio_cue)], solo la primera palabra util de cada
    cue: es el unico punto donde el tiempo del subtitulo coincide de verdad con
    el inicio del habla (ver la nota del prototipo del 26/09/2026)."""
    salida = []
    for bloque in re.split(r"\n\s*\n", texto.replace("\r\n", "\n")):
        m = TS.search(bloque)
        if not m:
            continue
        ini = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000
        cuerpo = re.sub(r".*-->.*", "", bloque)
        cuerpo = re.sub(r"^\d+\s*$", "", cuerpo, flags=re.M)
        cuerpo = re.sub(r"<[^>]+>", " ", cuerpo)
        for w in re.findall(r"[a-záéíóúñü']+", cuerpo.lower()):
            if len(w) > 3:
                salida.append((w, ini))
                break
    return salida


def desfase_por_palabras(pal_audio, pal_srt, ventana=180.0):
    por_palabra = collections.defaultdict(list)
    for w, t in pal_srt:
        por_palabra[w].append(t)
    frecuentes = {w for w, v in por_palabra.items() if len(v) > 3}
    difs = []
    for w, t in pal_audio:
        if w in frecuentes or w not in por_palabra:
            continue
        cands = [ts - t for ts in por_palabra[w] if abs(ts - t) <= ventana]
        if cands:
            difs.append(min(cands, key=abs))
    if len(difs) < 12:
        return None
    mediana = statistics.median(difs)
    return {"offset": round(-mediana, 2),
            "mad": round(statistics.median([abs(d - mediana) for d in difs]), 2),
            "n": len(difs)}


def offset_whisper(sf, modelo, d, texto, idioma):
    dur, idx = d["duration"], d["audioIdx"]
    pal_audio = []
    for f in (0.2, 0.4, 0.6, 0.8):
        ini = max(60, dur * f)
        if ini + 180 > dur:
            continue
        clip = os.path.join(TRABAJO, "r_%d_%d.wav" % (d["fileId"], int(ini)))
        if not os.path.isfile(clip):
            subprocess.run([sf.FFMPEG, "-v", "error", "-y", "-ss", str(ini), "-t", "180",
                            "-i", d["path"], "-map", "0:%d" % idx, "-ar", "16000", "-ac", "1", clip],
                           capture_output=True, timeout=600)
        if not os.path.isfile(clip):
            continue
        segs, _ = modelo.transcribe(clip, language=idioma, beam_size=1, word_timestamps=True)
        for s in segs:
            for w in (s.words or []):
                limpia = re.sub(r"[^a-záéíóúñü]", "", w.word.lower())
                if len(limpia) > 3:
                    pal_audio.append((limpia, ini + w.start))
        try:
            os.remove(clip)
        except OSError:
            pass
    return desfase_por_palabras(pal_audio, primeras_palabras(texto))


def candidatos(medidas=MEDIDAS):
    vistos, salida = set(), []
    for linea in open(medidas, encoding="utf-8"):
        linea = linea.strip()
        if not linea:
            continue
        d = json.loads(linea)
        clave = (d.get("path", "").lower(), (d.get("external") or "").lower())
        if clave in vistos:
            continue
        vistos.add(clave)
        if not d.get("inmedible") or d.get("ok"):
            continue
        if (d.get("solapeWhisper") or 0) < SOLAPE_MINIMO:
            continue
        if d.get("audioIdx") is None or not os.path.isfile(d.get("external") or ""):
            continue
        if (d.get("language") or "") not in ("spa", "eng"):
            continue
        salida.append(d)
    return salida


def apunta(fila):
    with open(REGISTRO, "a", encoding="utf-8") as f:
        f.write(json.dumps(fila, ensure_ascii=False) + "\n")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    p = argparse.ArgumentParser()
    p.add_argument("--aplicar", action="store_true")
    p.add_argument("--limite", type=int, default=0)
    p.add_argument("--medidas", default=MEDIDAS,
                   help="fichero de medidas; por defecto la verificacion original")
    args = p.parse_args()

    sf = cargar_subsfetch()
    os.makedirs(TRABAJO, exist_ok=True)
    os.makedirs(RESPALDOS, exist_ok=True)

    cola = candidatos(args.medidas)
    if args.limite:
        cola = cola[:args.limite]
    print("candidatos (inmedible + solape >= %.2f): %d%s\n"
          % (SOLAPE_MINIMO, len(cola), "  [APLICANDO]" if args.aplicar else "  [solo ensenyar]"), flush=True)

    # --- PUERTA 2: alass, que es barato. Solo los que la pasen llegan a Whisper.
    pasan = []
    for i, d in enumerate(cola, 1):
        nombre = os.path.basename(d["external"])
        texto, py_enc, alass_enc = leer_con_codec(d["external"])
        if texto is None:
            print("%3d/%d  %s\n     SALTADO: no decodifica" % (i, len(cola), nombre[:60]))
            continue
        salida = os.path.join(TRABAJO, "alass_%d_%d.srt" % (d["fileId"], d["trackId"]))
        subprocess.run([ALASS, "--no-split", "--disable-fps-guessing",
                        "--encoding-inc", alass_enc, d["path"], d["external"], salida],
                       capture_output=True, text=True, timeout=1800)
        if not os.path.isfile(salida):
            print("%3d/%d  %s\n     SALTADO: alass no produjo salida" % (i, len(cola), nombre[:60]))
            continue
        nuevo, _, _ = leer_con_codec(salida)
        a, b = tiempos_de(texto), tiempos_de(nuevo or "")
        if len(a) != len(b) or not a:
            print("%3d/%d  %s\n     SALTADO: cambia el numero de cues (%d -> %d)"
                  % (i, len(cola), nombre[:60], len(a), len(b)))
            continue
        difs = [y - x for x, y in zip(a, b)]
        desp, rango = statistics.median(difs), max(difs) - min(difs)
        motivo = None
        if rango > RANGO_MAXIMO:
            motivo = "no es uniforme (rango %.2fs)" % rango
        elif abs(desp) < DESPLAZAMIENTO_MINIMO:
            motivo = "ya esta bien (%.2fs)" % desp
        elif abs(desp) > DESPLAZAMIENTO_MAXIMO:
            motivo = "desplazamiento absurdo (%.1fs)" % desp
        print("%3d/%d  %s" % (i, len(cola), nombre[:60]))
        if motivo:
            print("     descartado: %s" % motivo)
            apunta({"external": d["external"], "estado": "descartado", "motivo": motivo,
                    "alass": round(desp, 2), "rango": round(rango, 2)})
            continue
        print("     alass propone %+.2fs (uniforme)  -> a corroborar" % desp, flush=True)
        pasan.append((d, texto, py_enc, salida, desp))

    print("\npasan la puerta de alass: %d de %d\n" % (len(pasan), len(cola)), flush=True)
    if not pasan:
        return
    if not args.aplicar:
        print("(modo ensenyar: no se corrobora ni se escribe)")
        return

    # --- PUERTA 3: corroboracion con Whisper. Se carga un modelo por idioma.
    from faster_whisper import WhisperModel
    hechos = rechazados = 0
    for idioma in ("es", "en"):
        grupo = [x for x in pasan if MODELO.get({"spa": "es", "eng": "en"}.get(x[0]["language"])) and
                 {"spa": "es", "eng": "en"}[x[0]["language"]] == idioma]
        if not grupo:
            continue
        print("cargando %s para %s (%d ficheros)..." % (MODELO[idioma], idioma, len(grupo)), flush=True)
        modelo = WhisperModel(MODELO[idioma], device="cpu", compute_type="int8", cpu_threads=8)
        for d, texto, py_enc, salida, desp in grupo:
            nombre = os.path.basename(d["external"])
            t0 = time.time()
            r = offset_whisper(sf, modelo, d, texto, idioma)
            seg = time.time() - t0
            if r is None:
                print("  %s\n     RECHAZADO: Whisper no da bastantes emparejamientos (%.0fs)" % (nombre[:58], seg))
                rechazados += 1
                apunta({"external": d["external"], "estado": "rechazado",
                        "motivo": "sin corroboracion", "alass": round(desp, 2)})
                continue
            discrepa = abs(r["offset"] - desp)
            if discrepa > DISCREPANCIA_MAXIMA:
                print("  %s\n     RECHAZADO: alass %+.2fs vs palabras %+.2fs (discrepan %.2fs, n=%d)"
                      % (nombre[:58], desp, r["offset"], discrepa, r["n"]))
                rechazados += 1
                apunta({"external": d["external"], "estado": "rechazado", "motivo": "discrepan",
                        "alass": round(desp, 2), "palabras": r["offset"], "n": r["n"]})
                continue

            sello = datetime.now().strftime("%Y%m%d-%H%M%S")
            respaldo = os.path.join(RESPALDOS, "rescate_%s_%s" % (sello, nombre))
            shutil.copy2(d["external"], respaldo)
            if not os.path.isfile(respaldo) or os.path.getsize(respaldo) != os.path.getsize(d["external"]):
                print("  %s\n     ABORTADO: el respaldo no cuadra" % nombre[:58])
                continue
            # La salida de alass se reescribe con la codificacion original.
            nuevo, _, _ = leer_con_codec(salida)
            tmp = respaldo + ".tmp"
            with open(tmp, "w", encoding=py_enc, newline="") as f:
                f.write(nuevo)
            shutil.move(tmp, d["external"])
            print("  %s\n     RESCATADO %+.2fs  (palabras %+.2fs, discrepan %.2fs, n=%d, %.0fs)"
                  % (nombre[:58], desp, r["offset"], discrepa, r["n"], seg), flush=True)
            hechos += 1
            apunta({"external": d["external"], "estado": "rescatado", "alass": round(desp, 2),
                    "palabras": r["offset"], "mad": r["mad"], "n": r["n"], "codec": py_enc,
                    "respaldo": respaldo, "solapeWhisper": d.get("solapeWhisper")})
        del modelo

    print("\nrescatados %d · rechazados %d" % (hechos, rechazados))
    print("NOTA: estos NO estan verificados por medida de audio -son inmedibles-.")
    print("Estan CORROBORADOS por dos metodos independientes. Respaldos en %s" % RESPALDOS)


if __name__ == "__main__":
    sys.exit(main())
