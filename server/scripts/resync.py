"""
Mide el desfase de un subtitulo contra el audio de la pelicula.

No reimplementa la correlacion: importa la del pipeline (subsfetch.py), que ya
esta probada y trae corregido lo que costo trabajo -- medir contra el CANAL
CENTRAL (en un 5.1 bajado a mono el dialogo se entierra bajo musica y efectos) y
el SIGNO del desfase, que estuvo al reves y duplicaba el error en vez de
corregirlo. Reescribir eso aqui seria repetir los mismos fallos.

Uso:
    python resync.py --video RUTA --audio-index N --duracion SEGS
                     (--srt RUTA | --pista-embebida N)

Devuelve JSON por stdout: {ok, offset_s, sigma, r, motivo}
"""

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

SUBSFETCH = r"C:\scripts\webpanel\subsfetch.py"


def cargar_subsfetch():
    if not os.path.isfile(SUBSFETCH):
        raise SystemExit(json.dumps({"ok": False, "motivo": "no se encuentra subsfetch.py del pipeline"}))
    spec = importlib.util.spec_from_file_location("subsfetch", SUBSFETCH)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def extraer_embebida(sf, video, indice):
    """Saca una pista de subtitulos interna a SRT para poder medirla."""
    destino = os.path.join(tempfile.gettempdir(), f"_resync_{os.getpid()}.srt")
    try:
        subprocess.run(
            [sf.FFMPEG, "-v", "error", "-y", "-i", video, "-map", f"0:{indice}", destino],
            capture_output=True, timeout=600,
        )
        return sf.leer_srt(destino) if os.path.isfile(destino) else None
    finally:
        try:
            os.remove(destino)
        except OSError:
            pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--audio-index", type=int, required=True)
    p.add_argument("--duracion", type=float, required=True)
    p.add_argument("--srt")
    p.add_argument("--pista-embebida", type=int)
    p.add_argument("--max-desfase", type=float, default=60.0)
    args = p.parse_args()

    sf = cargar_subsfetch()

    if args.srt:
        texto = sf.leer_srt(args.srt)
    elif args.pista_embebida is not None:
        texto = extraer_embebida(sf, args.video, args.pista_embebida)
    else:
        texto = None

    if not texto:
        print(json.dumps({"ok": False, "motivo": "no se pudo leer el subtitulo"}))
        return 1

    resultado = sf.verificar_sync(args.video, texto, args.audio_index, args.duracion, max_s=args.max_desfase)
    print(json.dumps(resultado, ensure_ascii=False))
    return 0 if resultado.get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
