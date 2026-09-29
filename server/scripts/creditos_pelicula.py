"""
Créditos de una película por el texto que sube, con sus escenas extra.

Los créditos rodados son texto sobre negro que se desplaza hacia arriba a
velocidad constante, y casi nada más en una película lo hace. Se toman ráfagas
cortas de fotogramas seguidos y se busca el desplazamiento vertical que explica
cada fotograma a partir del anterior. Medido sobre 10 películas con los créditos
marcados en sus capítulos: 0 falsos positivos en 391 ráfagas de cuerpo de
película, y sube en el 33-100 % de las ráfagas de créditos (los rótulos fijos no
suben).

Cada ráfaga cae en una de tres clases:
  S  el texto sube.
  C  tarjeta: fondo casi negro (>= 85 % de píxeles < 8), sin desplazamiento.
  E  escena: cualquier otra cosa.
Una escena son >= 2 ráfagas E seguidas. Los créditos son lo que queda entre las
escenas; un rango por bloque. Así el botón de saltar lleva a la escena y solo el
último bloque termina la película, como Plex y el Intro Skipper de Jellyfin.

Limitación conocida, medida: el texto sube DESPUÉS de las primeras tarjetas y de
los créditos sobre imágenes, así que el inicio sale 1-4 minutos más tarde que en
un capítulo de créditos. Es lo bastante para ofrecer el botón, no para acertar
el segundo exacto.

Salida (última línea de stdout): JSON
  {"rangos": [{"start_s": .., "end_s": ..}], "escenas": [{"start_s": .., "end_s": ..}],
   "muestras": N}
o {"error": "..."} con código de salida 1 si no se puede analizar.
"""
import argparse
import json
import subprocess
import sys

import numpy as np

W, H, FPS, RAFAGA_S, MAX_S = 320, 180, 8, 1.5, 12
PASO_GRUESO = 60.0
PASO_DENSO = 10.0
UMBRAL_TARJETA = 0.85
MIN_ESCENA_RAFAGAS = 2
MIN_RANGO_S = 20.0
# Prioridad baja: la biblioteca vive en un disco mecánico compartido con la reproducción.
BELOW_NORMAL = 0x00004000


def rafaga(ffmpeg, path, t):
    try:
        r = subprocess.run(
            [ffmpeg, "-hide_banner", "-v", "error", "-ss", str(int(t)), "-t", str(RAFAGA_S), "-i", path,
             "-an", "-sn", "-vf", f"fps={FPS},scale={W}:{H},format=gray", "-f", "rawvideo", "-"],
            capture_output=True, timeout=120, creationflags=BELOW_NORMAL)
    except subprocess.TimeoutExpired:
        return None
    n = len(r.stdout) // (W * H)
    if n < 4:
        return None
    return np.frombuffer(r.stdout[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.float32)


def medir(fr):
    """(sube, neg8): fracción de pares de fotogramas que suben, y de píxeles casi negros."""
    mad0s, ratios, shifts = [], [], []
    for a, b in zip(fr[:-1], fr[1:]):
        m0 = float(np.abs(a - b).mean())
        mad0s.append(m0)
        if m0 < 0.35:
            continue
        mejor, ms = 1e9, 0
        for s in range(1, MAX_S + 1):
            d = float(np.abs(a[s:, :] - b[: H - s, :]).mean())
            if d < mejor:
                mejor, ms = d, s
        ratios.append(mejor / m0)
        shifts.append(ms)
    sube = 0.0
    if ratios:
        sm = int(np.median(shifts))
        sube = sum(1 for r, s in zip(ratios, shifts) if r < 0.6 and abs(s - sm) <= 1) / max(1, len(mad0s))
    mid = fr[len(fr) // 2]
    return sube, float((mid < 8).mean())


class Sonda:
    def __init__(self, ffmpeg, path):
        self.ffmpeg, self.path, self.n = ffmpeg, path, 0
        self.cache = {}

    def clase(self, t):
        t = round(t, 1)
        if t in self.cache:
            return self.cache[t]
        fr = rafaga(self.ffmpeg, self.path, t)
        self.n += 1
        if fr is None:
            c = None
        else:
            sube, neg8 = medir(fr)
            c = "S" if sube >= 0.5 else ("C" if neg8 >= UMBRAL_TARJETA else "E")
        self.cache[t] = c
        return c


def afinar(sonda, t_a, t_b):
    """Primer instante del lado de `t_b`, entre dos ráfagas de distinto tipo (escena / no
    escena), con ~2,5 s de precisión."""
    esc_a = sonda.clase(t_a) == "E"
    lo, hi = t_a, t_b
    for _ in range(2):
        medio = (lo + hi) / 2
        c = sonda.clase(medio)
        if c is None:
            break
        if (c == "E") == esc_a:
            lo = medio
        else:
            hi = medio
    return hi


def analizar(ffmpeg, path, dur, desde=None):
    sonda = Sonda(ffmpeg, path)

    # Pase grueso: ¿hay texto que sube en el último tramo? Si el fichero trae un
    # último capítulo, `desde` lo acota y el pase cuesta una décima parte.
    if desde is None:
        desde = max(0.6 * dur, dur - 30 * 60)
    desde = min(max(desde, 0.4 * dur), dur - 60)
    primera_s = None
    t = desde
    grueso = []
    while t < dur - 3:
        grueso.append((t, sonda.clase(t)))
        t += PASO_GRUESO
    for i, (t, c) in enumerate(grueso):
        if c == "S" and any(c2 == "S" for _, c2 in grueso[i + 1: i + 4]):
            primera_s = t
            break
    if primera_s is None:
        return {"rangos": [], "escenas": [], "muestras": sonda.n}

    # Pase denso desde una ráfaga gruesa antes del primer texto hasta el final.
    t0 = max(desde, primera_s - PASO_GRUESO)
    pts = []
    t = t0
    while t < dur - 2:
        pts.append((t, sonda.clase(t)))
        t += PASO_DENSO
    pts = [(t, c) for t, c in pts if c is not None]
    if not pts:
        return {"rangos": [], "escenas": [], "muestras": sonda.n}

    # Inicio: primera ráfaga S, retrocediendo por las tarjetas contiguas.
    i0 = next((i for i, (_, c) in enumerate(pts) if c == "S"), None)
    if i0 is None:
        return {"rangos": [], "escenas": [], "muestras": sonda.n}
    while i0 > 0 and pts[i0 - 1][1] in ("C", "S"):
        i0 -= 1
    pts = pts[i0:]

    # Escenas: >= MIN_ESCENA_RAFAGAS ráfagas E seguidas.
    escenas = []
    i = 0
    while i < len(pts):
        if pts[i][1] != "E":
            i += 1
            continue
        j = i
        while j + 1 < len(pts) and pts[j + 1][1] == "E":
            j += 1
        if j - i + 1 >= MIN_ESCENA_RAFAGAS:
            ini = pts[i][0]
            if i > 0:
                ini = afinar(sonda, pts[i - 1][0], pts[i][0])
            if j + 1 < len(pts):
                fin = afinar(sonda, pts[j][0], pts[j + 1][0])
            else:
                fin = dur
            escenas.append((ini, fin))
        i = j + 1

    # Créditos = el hueco entre escenas.
    rangos = []
    cursor = pts[0][0]
    for ini, fin in escenas:
        if ini - cursor >= MIN_RANGO_S:
            rangos.append((cursor, ini))
        cursor = fin
    if dur - cursor >= MIN_RANGO_S:
        rangos.append((cursor, dur))

    return {
        "rangos": [{"start_s": round(a, 1), "end_s": round(b, 1)} for a, b in rangos],
        "escenas": [{"start_s": round(a, 1), "end_s": round(b, 1)} for a, b in escenas],
        "muestras": sonda.n,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ffmpeg", required=True)
    p.add_argument("--fichero", required=True)
    p.add_argument("--duracion", type=float, required=True)
    p.add_argument("--desde", type=float, default=None)
    a = p.parse_args()
    if a.duracion < 20 * 60:
        print(json.dumps({"error": "duración menor de 20 min: no se analiza"}))
        sys.exit(1)
    try:
        print(json.dumps(analizar(a.ffmpeg, a.fichero, a.duracion, a.desde)))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
