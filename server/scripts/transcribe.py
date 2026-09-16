"""
Genera subtitulos transcribiendo el audio con Whisper (faster-whisper, CPU).

Medido en este equipo: ~10x tiempo real con el modelo 'small' en int8 y 14
hilos, o sea unos 13 minutos para una pelicula de dos horas. No da para hacerlo
al vuelo mientras se reproduce; esta pensado como tarea de fondo.

Escribe el .srt junto al video, con el sufijo del idioma, para que el escaner lo
recoja igual que cualquier otro subtitulo externo.

Uso:
    python transcribe.py --video RUTA --audio-index N [--modelo small]
                         [--idioma es] [--salida RUTA.srt]
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

FFMPEG = r"C:\Users\HTPC\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"

# Whisper trabaja a 16 kHz mono; darle mas es tirar tiempo de decodificacion.
TASA = 16000


def extraer_audio(video, indice, destino):
    subprocess.run(
        [FFMPEG, "-v", "error", "-y", "-i", video, "-map", f"0:{indice}",
         "-ac", "1", "-ar", str(TASA), "-c:a", "pcm_s16le", destino],
        capture_output=True, timeout=7200, check=False,
    )
    return os.path.isfile(destino) and os.path.getsize(destino) > 1024


def marca(segundos):
    ms = int(round(segundos * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def escribir_srt(segmentos, destino):
    with open(destino, "w", encoding="utf-8") as f:
        for i, seg in enumerate(segmentos, 1):
            texto = seg["text"].strip()
            if not texto:
                continue
            f.write(f"{i}\n{marca(seg['start'])} --> {marca(seg['end'])}\n{texto}\n\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--audio-index", type=int, default=1)
    p.add_argument("--modelo", default="small")
    p.add_argument("--idioma", default=None, help="es, en... o vacio para detectarlo")
    p.add_argument("--salida")
    p.add_argument("--hilos", type=int, default=14)
    args = p.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({"ok": False, "motivo": "falta faster-whisper (pip install faster-whisper)"}))
        return 1

    wav = os.path.join(tempfile.gettempdir(), f"_tr_{os.getpid()}.wav")
    inicio = time.time()
    try:
        print("Extrayendo audio…", flush=True)
        if not extraer_audio(args.video, args.audio_index, wav):
            print(json.dumps({"ok": False, "motivo": "no se pudo extraer el audio"}))
            return 1

        print(f"Cargando modelo {args.modelo}…", flush=True)
        modelo = WhisperModel(args.modelo, device="cpu", compute_type="int8", cpu_threads=args.hilos)

        print("Transcribiendo…", flush=True)
        segmentos, info = modelo.transcribe(
            wav,
            language=args.idioma or None,
            vad_filter=True,                       # se salta los silencios largos
            beam_size=1,                           # beam mayor apenas mejora y cuesta el doble
            condition_on_previous_text=False,      # evita que un error se arrastre
        )

        recogidos = []
        for seg in segmentos:
            recogidos.append({"start": seg.start, "end": seg.end, "text": seg.text})
            if len(recogidos) % 50 == 0:
                print(f"  {len(recogidos)} frases, minuto {seg.end / 60:.0f}", flush=True)

        # Sin diálogo no se escribe nada: un .srt vacío junto a la película es
        # basura que luego hay que ir a buscar (pasó con un corto mudo de 1928).
        if not recogidos:
            print(json.dumps({
                "ok": False,
                "motivo": "no se detectó diálogo hablado; no se ha escrito ningún fichero",
                "segundos": round(time.time() - inicio, 1),
            }, ensure_ascii=False))
            return 2

        salida = args.salida or os.path.splitext(args.video)[0] + f".{info.language}.ia.srt"
        escribir_srt(recogidos, salida)

        print(json.dumps({
            "ok": True,
            "salida": salida,
            "frases": len(recogidos),
            "idioma": info.language,
            "probabilidad": round(info.language_probability, 2),
            "segundos": round(time.time() - inicio, 1),
        }, ensure_ascii=False))
        return 0
    finally:
        try:
            os.remove(wav)
        except OSError:
            pass


if __name__ == "__main__":
    sys.exit(main())
