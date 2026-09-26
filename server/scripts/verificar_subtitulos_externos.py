"""
Mide (sin tocar nada de E:) la sincronia de los subtitulos externos que NO
tienen un incrustado equivalente con el que compararse -los "solo externo" que
ya identifico comparar-subtitulos.ts-. Usa el subsfetch.py arreglado el
25/09/2026 (canal segun numero de canales, velocidad, Silero VAD como segunda
opinion).

Solo MIDE. El paso 2 (reescribir_subtitulos.py) lee este JSONL y aplica lo que
de verdad haga falta, con su propio respaldo y su propia verificacion -misma
separacion en pasadas que pide la skill de operaciones en lote: inventario,
comprobacion, accion, nunca una sola pasada.

Reanudable: cada fila se apunta segun sale y al arrancar se salta lo ya hecho.

    python verificar_subtitulos_externos.py --probar   (cuenta, no mide)
    python verificar_subtitulos_externos.py
"""
import argparse, importlib.util, json, os, re, sqlite3, subprocess, sys, tempfile, time
from collections import Counter

SUBSFETCH = r"C:\scripts\webpanel\subsfetch.py"
DB = r"C:\tvwatch\data\tvwatch.db"
COMPARACION = r"C:\tvwatch\data\comparacion-subtitulos.jsonl"
SALIDA = r"C:\tvwatch\data\verificacion-solo-externo.jsonl"
PUERTO_TVWATCH = 8730

# Codigo de 3 letras (el que guarda TvWatch) -> codigo de 2 que pide Whisper.
IDIOMA_WHISPER = {"spa": "es", "eng": "en"}

VACIAS = {
    "es": set("de la el en y a los que se las un una por con no su para al lo como mas pero "
              "sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta "
              "hay donde quien desde todo nos durante todos uno les ni contra otros ese eso "
              "ante ellos esto mi antes algunos".split()),
    "en": set("the a an is was were to of and in that it he she they you i we my his her their "
              "this on for with as at be are not no do did so if but or what who when where how "
              "just like get got have has had can could will would there here".split()),
}


def hay_alguien_viendo():
    """Mismo criterio que `media/ocupado.ts` del servidor, pero sin ningun
    puente Python-Node que no existe: se mira si hay alguna conexion
    establecida al puerto del servidor. No hay ningun modulo 'media.ocupado'
    importable desde Python -TvWatch es Node-, asi que se comprueba tal cual
    se hizo a mano durante toda esta sesion (Get-NetTCPConnection)."""
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-NetTCPConnection -LocalPort {PUERTO_TVWATCH} -State Established "
             f"-ErrorAction SilentlyContinue | Measure-Object).Count"],
            capture_output=True, text=True, timeout=15)
        return int((r.stdout or "0").strip() or 0) > 0
    except Exception:
        return False  # si no se puede comprobar, no bloquear el lote por eso


def cargar_subsfetch():
    spec = importlib.util.spec_from_file_location("subsfetch", SUBSFETCH)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def candidatos():
    """Los fileId 'solo externo' que ya identifico la comparacion, con su
    ruta de video y de subtitulo sacadas de la base -no se reinventa el
    idioma ni la ruta, se leen de donde ya estan."""
    vistos = set()
    ids = []
    if os.path.isfile(COMPARACION):
        with open(COMPARACION, encoding="utf-8") as f:
            for linea in f:
                linea = linea.strip()
                if not linea:
                    continue
                try:
                    d = json.loads(linea)
                except json.JSONDecodeError:
                    continue
                if d.get("sinPareja") and d["fileId"] not in vistos:
                    vistos.add(d["fileId"])
                    ids.append(d["fileId"])

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    salida = []
    for fid in ids:
        fila = db.execute("SELECT path, duration FROM media_files WHERE id = ?", (fid,)).fetchone()
        if not fila:
            continue
        path, dur = fila
        for sid, lang, ext, forced in db.execute(
            "SELECT id, language, external, forced FROM sub_tracks WHERE file_id = ? "
            "AND external IS NOT NULL AND lower(external) LIKE '%.srt'", (fid,)
        ).fetchall():
            salida.append({"fileId": fid, "path": path, "duration": dur,
                            "trackId": sid, "language": lang, "external": ext, "forced": bool(forced)})
    db.close()
    return salida


def clave(d):
    """La clave de reanudacion: las DOS RUTAS, en minusculas.

    Antes era (fileId, trackId), y trackId es `sub_tracks.id` -un
    autoincremental-. Cada escaneo borra esas filas y las reinserta con ids
    nuevos, asi que la clave caducaba sola: medido el 26/09/2026, de 1.183
    medidas ya hechas seguian existiendo CERO, y el maximo id vivo (1.448.513)
    estaba 9.000 por encima del maximo medido (1.439.506). El lote se reanudaba
    desde el principio y repetia horas de CPU. Las rutas no cambian con el
    escaneo, asi que emparejan las 1.183 tal cual.
    """
    return ((d.get("path") or "").lower(), (d.get("external") or "").lower())


def ya_medidos():
    if not os.path.isfile(SALIDA):
        return set()
    vistos = set()
    with open(SALIDA, encoding="utf-8") as f:
        for linea in f:
            try:
                d = json.loads(linea)
            except json.JSONDecodeError:
                continue
            k = clave(d)
            if k[0] and k[1]:
                vistos.add(k)
    return vistos


def audio_principal(sf, path, idioma_srt=None):
    """El indice ABSOLUTO de audio que corresponde al SRT. Antes se cogia
    siempre el primero sin mirar el idioma: en esta biblioteca el espanol va
    primero en la mayoria de ficheros con dos pistas, asi que un srt en
    ingles se media contra audio en espanol. Comprobado el 25/09/2026 con
    "Pesadillas" S02E20: cambiar de pista no arreglo la sincronia de ESE
    fichero en concreto (2.4 -> 2.7 sigma, seguia sin demostrarse), pero es un
    emparejamiento real que hay que tener bien para el resto -1.067 ficheros
    con srt en ingles y mas de un idioma de audio-. Si el idioma del srt no
    aparece en ninguna pista, se cae a la primera, igual que antes."""
    r = subprocess.run([sf.FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries",
                        "stream=index:stream_tags=language", "-of", "json", path],
                       capture_output=True, text=True, timeout=60)
    streams = json.loads(r.stdout or "{}").get("streams", [])
    if not streams:
        return None
    if idioma_srt:
        for s in streams:
            if (s.get("tags", {}).get("language") or "").lower() == idioma_srt.lower():
                return s["index"]
    return streams[0]["index"]


def _palabras(texto, idioma_whisper):
    vacias = VACIAS.get(idioma_whisper, set())
    return [w for w in re.findall(r"[a-záéíóúñü]+", texto.lower()) if w not in vacias and len(w) > 2]


def _cues_en_ventana(srt_texto, ini_s, fin_s):
    salida = []
    for bloque in re.split(r"\n\s*\n", srt_texto.replace("\r\n", "\n")):
        m = re.search(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->", bloque)
        if not m:
            continue
        t = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000
        if ini_s <= t <= fin_s:
            texto = re.sub(r"^\d+\s*$", "", bloque, flags=re.M)
            texto = re.sub(r".*-->.*", "", texto)
            salida.append(texto.strip())
    return " ".join(salida)


def rescate_whisper(sf, modelo, path, srt_texto, audio_idx, idioma_whisper, duracion):
    """Red de rescate para lo que el de voz no puede demostrar (~15-20% de los
    casos, medido). No mide desfase: transcribe 2-3 tramos de 90 s y compara
    el solape de palabras contra el .srt en esa misma ventana nominal. Un
    solape alto dice "es el mismo contenido, el de voz dio un falso negativo
    -confirmado el 25/09/2026 con un episodio de Pesadillas muy cargado de
    ambiente y poco dialogo, 66-97% de solape en tres tramos-. Uno bajo dice
    "otro contenido (episodio distinto) o un desfase tan grande que ningun
    tramo cae donde toca"; no distingue esas dos sin mirar mas, y no lo
    intenta: solo mide y deja la decision a quien lea el resultado.
    Devuelve None si no hay bastante texto en ningun tramo para juzgar."""
    if duracion < 90:
        return None
    tramos = sorted({max(30, duracion * 0.2), max(60, duracion * 0.5), max(90, duracion * 0.75)})
    clip = os.path.join(tempfile.gettempdir(), f"_wh_{os.getpid()}.wav")
    solapes = []
    for ini in tramos:
        if ini + 90 > duracion:
            continue
        try:
            subprocess.run([sf.FFMPEG, "-v", "error", "-y", "-ss", str(ini), "-t", "90", "-i", path,
                            "-map", f"0:{audio_idx}", "-ar", "16000", "-ac", "1", clip],
                           capture_output=True, timeout=120)
        except subprocess.TimeoutExpired:
            continue
        if not os.path.isfile(clip):
            continue
        try:
            segmentos, _ = modelo.transcribe(clip, language=idioma_whisper, beam_size=1)
            texto_audio = " ".join(s.text for s in segmentos)
        finally:
            try:
                os.remove(clip)
            except OSError:
                pass
        texto_srt_tramo = _cues_en_ventana(srt_texto, ini, ini + 90)
        pa = Counter(_palabras(texto_audio, idioma_whisper))
        ps = Counter(_palabras(texto_srt_tramo, idioma_whisper))
        total = sum(pa.values())
        if total >= 5:
            solapes.append(sum((pa & ps).values()) / total)
    if not solapes:
        return None
    return round(sum(solapes) / len(solapes), 3)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--probar", action="store_true")
    args = p.parse_args()

    todos = candidatos()
    hechos = ya_medidos()
    pendientes = [c for c in todos if clave(c) not in hechos]
    print(f"{len(todos)} pistas 'solo externo' -> ya medidas {len(hechos)} -> pendientes {len(pendientes)}", flush=True)
    if args.probar:
        print("Modo prueba: no se mide nada.")
        return

    sf = cargar_subsfetch()
    modelo = None  # perezoso: solo se carga si de verdad hace falta rescate

    for i, c in enumerate(pendientes, 1):
        while hay_alguien_viendo():
            time.sleep(30)
        texto = sf.leer_srt(c["external"])
        if not texto:
            resultado = {"error": "no se pudo leer el srt externo"}
        else:
            idx = audio_principal(sf, c["path"], c.get("language"))
            if idx is None:
                resultado = {"error": "sin pista de audio"}
            else:
                t0 = time.time()
                v = sf.verificar_sync(c["path"], texto, idx, c["duration"])
                v["segundos"] = round(time.time() - t0, 1)
                v["audioIdx"] = idx

                if v.get("inmedible"):
                    idioma_wh = IDIOMA_WHISPER.get(c.get("language") or "")
                    if idioma_wh:
                        if modelo is None:
                            from faster_whisper import WhisperModel
                            modelo = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=12)
                        t1 = time.time()
                        solape = rescate_whisper(sf, modelo, c["path"], texto, idx, idioma_wh, c["duration"])
                        if solape is not None:
                            v["solapeWhisper"] = solape
                            v["segundosWhisper"] = round(time.time() - t1, 1)
                resultado = v
        with open(SALIDA, "a", encoding="utf-8") as f:
            f.write(json.dumps({**c, **resultado}, ensure_ascii=False) + "\n")
        if i % 25 == 0 or i == len(pendientes):
            print(f"  {i}/{len(pendientes)}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
