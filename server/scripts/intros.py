"""
Detecta la cabecera (y opcionalmente los creditos) de una temporada.

La idea es la que usan los detectores serios: la cabecera es el unico tramo de
audio que se repite IGUAL en todos los episodios. Se saca una huella acustica
(chromaprint) de cada episodio, se desliza una contra otra y se busca la racha
mas larga de fotogramas que coinciden. Lo que aparece en casi todos los pares,
en posiciones parecidas, es la cabecera.

Uso:
    python intros.py --ficheros lista.json [--ventana 720] [--min-segundos 15]

lista.json: [{"episodeId": 1, "path": "..."}, ...] de una misma temporada.
Devuelve JSON por stdout: [{"episodeId":1,"startS":..,"endS":..,"confianza":..}]
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

FFMPEG = r"C:\Users\HTPC\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"

# chromaprint emite ~8.05 valores por segundo con su configuracion por defecto.
POR_SEGUNDO = 11025.0 / 1024 / 1.3346
BITS_TOLERADOS = 8          # de 32; por encima de esto ya no es el mismo audio
MIN_RACHA_S = 12.0          # una cabecera mas corta que esto no merece boton


POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def huella(path, ventana_s, desde_s=0.0):
    """Huella acustica de un tramo del fichero, como vector de uint32."""
    destino = os.path.join(tempfile.gettempdir(), f"_fp_{os.getpid()}_{abs(hash(path)) % 99999}.bin")
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error"]
    if desde_s > 0:
        cmd += ["-ss", str(desde_s)]
    cmd += ["-t", str(ventana_s), "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", "11025",
            "-f", "chromaprint", "-fp_format", "raw", "-y", destino]
    try:
        subprocess.run(cmd, capture_output=True, timeout=1800)
        if not os.path.isfile(destino) or os.path.getsize(destino) < 64:
            return None
        return np.fromfile(destino, dtype=np.uint32)
    except Exception:
        return None
    finally:
        try:
            os.remove(destino)
        except OSError:
            pass


def distancias(a, b):
    """Distancia de Hamming elemento a elemento entre dos vectores uint32."""
    x = np.bitwise_xor(a, b).view(np.uint8).reshape(-1, 4)
    return POPCOUNT[x].sum(axis=1)


def racha_mas_larga(a, b):
    """Tramo comun mas largo entre dos huellas, probando todos los desfases.

    Devuelve (inicio_en_a, inicio_en_b, longitud) en fotogramas.
    """
    mejor = (0, 0, 0)
    n, m = len(a), len(b)
    for lag in range(-(n - 1), m):
        ia = max(0, -lag)
        ib = max(0, lag)
        largo = min(n - ia, m - ib)
        if largo < MIN_RACHA_S * POR_SEGUNDO:
            continue

        coincide = distancias(a[ia:ia + largo], b[ib:ib + largo]) <= BITS_TOLERADOS

        # Racha mas larga de True, sin bucles de Python.
        if not coincide.any():
            continue
        idx = np.flatnonzero(np.diff(np.concatenate(([0], coincide.view(np.int8), [0]))))
        inicios, finales = idx[0::2], idx[1::2]
        largos = finales - inicios
        k = int(np.argmax(largos))
        if largos[k] > mejor[2]:
            mejor = (ia + int(inicios[k]), ib + int(inicios[k]), int(largos[k]))
    return mejor


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ficheros", required=True)
    p.add_argument("--ventana", type=float, default=720.0)
    p.add_argument("--min-segundos", type=float, default=MIN_RACHA_S)
    p.add_argument("--modo", choices=["cabecera", "creditos"], default="cabecera")
    args = p.parse_args()

    with open(args.ficheros, encoding="utf-8") as f:
        episodios = json.load(f)

    if len(episodios) < 2:
        print(json.dumps({"error": "hacen falta al menos dos episodios para comparar"}))
        return 1

    # Los creditos se buscan en la cola del episodio, asi que la huella arranca
    # ahi y luego hay que devolver los tiempos al reloj del episodio completo.
    ventana = args.ventana if args.modo == "cabecera" else min(args.ventana, 480.0)

    huellas = []
    desplazamientos = {}
    for ep in episodios:
        desde = 0.0
        if args.modo == "creditos":
            duracion = float(ep.get("duration") or 0)
            if duracion <= ventana:
                continue
            desde = duracion - ventana
        h = huella(ep["path"], ventana, desde)
        if h is not None and len(h) > args.min_segundos * POR_SEGUNDO:
            huellas.append((ep["episodeId"], h))
            desplazamientos[ep["episodeId"]] = desde

    if len(huellas) < 2:
        print(json.dumps({"error": "no se pudieron sacar huellas suficientes"}))
        return 1

    # Cada episodio se compara con los siguientes; un tramo que sale en varios
    # pares y siempre por el mismo sitio es la cabecera, no una casualidad.
    tramos = {eid: [] for eid, _ in huellas}
    for i in range(len(huellas)):
        for j in range(i + 1, min(i + 4, len(huellas))):
            ea, ha = huellas[i]
            eb, hb = huellas[j]
            ia, ib, largo = racha_mas_larga(ha, hb)
            if largo >= args.min_segundos * POR_SEGUNDO:
                tramos[ea].append((ia, largo))
                tramos[eb].append((ib, largo))

    salida = []
    for eid, encontrados in tramos.items():
        if not encontrados:
            continue
        # La mediana aguanta mejor un par que se haya emparejado con otra cosa.
        inicio = float(np.median([t[0] for t in encontrados]))
        largo = float(np.median([t[1] for t in encontrados]))
        base = desplazamientos.get(eid, 0.0)
        salida.append({
            "episodeId": eid,
            "tipo": args.modo,
            "startS": round(base + inicio / POR_SEGUNDO, 2),
            "endS": round(base + (inicio + largo) / POR_SEGUNDO, 2),
            "confianza": len(encontrados),
        })

    print(json.dumps(salida, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
