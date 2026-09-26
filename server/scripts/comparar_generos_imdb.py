"""
Compara los generos que puso tinyMediaManager (sacados de TMDb, en los .nfo)
con los de IMDb (via OMDb, la misma API que TvWatch ya usa para las notas).
SOLO LEE Y CONSULTA: no toca la base ni ningun fichero de E:.

El usuario ve peliculas en generos que no les tocan pero no tenia un ejemplo a
mano. La carpeta no dice nada del genero de una pelicula de adultos, asi que
hace falta una fuente independiente: IMDb, que es la referencia que reconoce
casi todo el mundo. Donde TMDb pone un genero que IMDb no, ahi esta lo
sospechoso.

Cuota: OMDb gratis son ~1.000 consultas al dia, y TvWatch la comparte para las
notas. Por eso es reanudable y se para SOLO al llegar al limite.

La clave se lee de data/config.json y no se imprime nunca.

    python comparar_generos_imdb.py
"""
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DB = r"C:\tvwatch\data\tvwatch.db"
CONFIG = r"C:\tvwatch\data\config.json"
SALIDA = r"C:\tvwatch\data\comparacion-generos-imdb.jsonl"
BIBLIOTECAS = ("Películas",)

# IMDb (ingles) -> vocabulario de la biblioteca (TMDb en castellano).
# None = IMDb lo usa pero aqui no existe equivalente: no cuenta en ningun lado.
IMDB_A_ES = {
    "Action": "Acción", "Adventure": "Aventura", "Animation": "Animación",
    "Comedy": "Comedia", "Crime": "Crimen", "Documentary": "Documental",
    "Drama": "Drama", "Family": "Familiar", "Fantasy": "Fantasía",
    "History": "Histórica", "Horror": "Terror", "Music": "Música",
    "Musical": "Música", "Mystery": "Misterio", "Romance": "Romántica",
    "Sci-Fi": "Ciencia Ficción", "Thriller": "Thriller", "War": "Bélica",
    "Western": "Oeste", "Film-Noir": "Crimen",
    "Biography": None, "Sport": None, "News": None, "Reality-TV": None,
    "Talk-Show": None, "Game-Show": None, "Short": None, "Adult": None,
}
# Variantes de la biblioteca que son el MISMO genero, para no dar por
# discrepancia una simple diferencia de nombre.
SINONIMO = {"Aventuras": "Aventura", "Familia": "Familiar", "Kids": "Familiar",
            "Suspenso": "Thriller", "Suspense": "Thriller"}
# Generos de TMDb sin equivalente en IMDb: no se pueden contrastar.
SIN_CONTRASTE = {"Película de Televisión"}


def pedir_omdb(clave, imdb):
    url = "http://www.omdbapi.com/?" + urllib.parse.urlencode({"i": imdb, "apikey": clave})
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return {"Response": "False", "Error": "HTTP %d" % e.code}
    except Exception as e:
        return {"Response": "False", "Error": str(e)[:60]}


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    clave = (json.load(open(CONFIG, encoding="utf-8")).get("omdbApiKey") or "").strip()
    if not clave:
        print("sin omdbApiKey en data/config.json")
        return 1

    db = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    marcas = ",".join("?" * len(BIBLIOTECAS))
    pelis = db.execute(
        """SELECT i.id, i.title, i.year, i.imdb_id,
                  (SELECT group_concat(g.name, '|') FROM item_genres ig
                     JOIN genres g ON g.id = ig.genre_id WHERE ig.item_id = i.id)
             FROM items i JOIN libraries l ON l.id = i.library_id
            WHERE l.name IN (%s) AND i.imdb_id IS NOT NULL AND i.imdb_id != ''
            ORDER BY i.title""" % marcas, BIBLIOTECAS).fetchall()
    db.close()

    hechos = set()
    if os.path.isfile(SALIDA):
        for l in open(SALIDA, encoding="utf-8"):
            try:
                hechos.add(json.loads(l)["item_id"])
            except (json.JSONDecodeError, KeyError):
                pass
    pend = [p for p in pelis if p[0] not in hechos]
    print("peliculas: %d -> ya consultadas %d -> ahora %d" % (len(pelis), len(hechos), len(pend)), flush=True)

    for n, (iid, titulo, anyo, imdb, gen) in enumerate(pend, 1):
        r = pedir_omdb(clave, imdb)
        if r.get("Response") == "False" and "limit" in (r.get("Error") or "").lower():
            print("\nCUOTA DE OMDb AGOTADA tras %d consultas. Se sigue manyana." % (n - 1), flush=True)
            return 0
        # "imdb_id" y "generos_imdb" con nombres DISTINTOS: la primera version
        # guardaba el id en "imdb" y luego lo pisaba con la lista de generos
        # (26/09/2026), y el id de 1.000 filas hubo que recuperarlo por item_id.
        fila = {"item_id": iid, "titulo": titulo, "anyo": anyo, "imdb_id": imdb}
        if r.get("Response") != "True":
            fila["error"] = r.get("Error") or "sin respuesta"
        else:
            nuestros = {SINONIMO.get(g, g) for g in (gen or "").split("|") if g} - SIN_CONTRASTE
            crudos = [x.strip() for x in (r.get("Genre") or "").split(",") if x.strip()]
            de_imdb = {IMDB_A_ES[x] for x in crudos if IMDB_A_ES.get(x)}
            fila.update({
                "imdb_titulo": r.get("Title"), "imdb_anyo": r.get("Year"),
                "generos_imdb_crudos": crudos,
                "nuestros": sorted(nuestros), "generos_imdb": sorted(de_imdb),
                "sobran": sorted(nuestros - de_imdb),   # los "no deberian estar"
                "faltan": sorted(de_imdb - nuestros),
            })
        with open(SALIDA, "a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
        if n % 100 == 0 or n == len(pend):
            print("  %d/%d" % (n, len(pend)), flush=True)
        time.sleep(0.15)
    return 0


if __name__ == "__main__":
    sys.exit(main())
