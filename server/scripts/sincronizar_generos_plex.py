"""
Lleva a Plex los generos de IMDb, igual que ya hace el escaner de TvWatch.
Decision del usuario (26/09/2026): Plex tenia el mismo problema -Carrie y
Arrastrame al infierno en "Suspense", que es su palabra para Thriller-.

Como, y por que asi:
  - Se ESCRIBE por la API local de Plex, nunca en su base: escribir a mano en
    su sqlite mientras Plex la tiene abierta la corrompe. Se LEE de su base, en
    solo lectura, como hace plex-sync.ts.
  - El token es el .LocalAdminToken que Plex regenera en cada arranque: se lee
    del fichero cada vez y no se guarda ni se imprime nunca.
  - Sintaxis comprobada contra el servidor real con Carrie antes de usarla:
    genre[i].tag.tag anyade, genre[].tag.tag- quita, genre.locked=1 bloquea
    para que el agente de Plex no lo vuelva a pisar al refrescar.
  - Se traduce al VOCABULARIO DE PLEX, no al de TvWatch: Plex dice "Suspense"
    y no "Thriller", "Action" y no "Accion". Empujar nuestras palabras habria
    creado etiquetas nuevas junto a las suyas y partido cada genero en dos.
  - Se parte del IMDb EN CRUDO: Plex si tiene Biography y Sport, asi que alli
    esos generos no se pierden.
  - Una pelicula sin ningun genero traducible NO se toca.
  - Todo queda apuntado con los generos ANTERIORES. Para deshacer una: quitar
    el bloqueo y refrescar sus metadatos en Plex.

    python sincronizar_generos_plex.py                    (ensenya, no toca)
    python sincronizar_generos_plex.py --aplicar --solo Carrie
    python sincronizar_generos_plex.py --aplicar
"""
import argparse
import json
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

TVWATCH_DB = r"C:\tvwatch\data\tvwatch.db"
PLEX_DB = r"C:\Users\HTPC\AppData\Local\Plex Media Server\Plug-in Support\Databases\com.plexapp.plugins.library.db"
PLEX_TOKEN = r"C:\Users\HTPC\AppData\Local\Plex Media Server\.LocalAdminToken"
PLEX = "http://127.0.0.1:32400"
REGISTRO = r"C:\tvwatch\data\sincronizar-generos-plex.jsonl"

# IMDb en crudo -> la etiqueta que Plex YA usa (leidas de su base el 26/09/2026).
IMDB_A_PLEX = {
    "Action": "Action", "Adventure": "Adventure", "Animation": "Animación",
    "Biography": "Biography", "Comedy": "Comedia", "Crime": "Crimen",
    "Documentary": "Documental", "Drama": "Drama", "Family": "Familia",
    "Fantasy": "Fantasía", "Film-Noir": "Film-Noir", "History": "Historia",
    "Horror": "Terror", "Music": "Música", "Musical": "Musical",
    "Mystery": "Misterio", "Romance": "Romance", "Sci-Fi": "Ciencia ficción",
    "Sport": "Sport", "Thriller": "Suspense", "War": "Bélica",
    "Western": "Western", "Short": "Short",
}


def token():
    with open(PLEX_TOKEN, encoding="utf-8") as f:
        return f.read().strip()


def leer_generos(tok, rk):
    req = urllib.request.Request("%s/library/metadata/%s?X-Plex-Token=%s" % (PLEX, rk, tok),
                                 headers={"Accept": "application/json"})
    m = json.loads(urllib.request.urlopen(req, timeout=30).read())["MediaContainer"]["Metadata"][0]
    return ([g["tag"] for g in m.get("Genre", [])],
            "genre" in [f["name"] for f in m.get("Field", []) if f.get("locked")])


def escribir(tok, sid, rk, poner, quitar):
    params = [("type", "1"), ("id", str(rk))]
    params += [("genre[%d].tag.tag" % i, g) for i, g in enumerate(poner)]
    if quitar:
        params.append(("genre[].tag.tag-", ",".join(quitar)))
    params += [("genre.locked", "1"), ("X-Plex-Token", tok)]
    url = "%s/library/sections/%s/all?%s" % (PLEX, sid, urllib.parse.urlencode(params))
    return urllib.request.urlopen(urllib.request.Request(url, method="PUT"), timeout=30).status


def apunta(fila):
    with open(REGISTRO, "a", encoding="utf-8") as f:
        f.write(json.dumps(fila, ensure_ascii=False) + "\n")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--solo", default="")
    args = ap.parse_args()

    tv = sqlite3.connect("file:%s?mode=ro" % TVWATCH_DB, uri=True)
    pelis = tv.execute("""SELECT DISTINCT f.path, i.title, g.crudos
                            FROM items i JOIN libraries l ON l.id = i.library_id
                            JOIN media_files f ON f.item_id = i.id
                            JOIN imdb_generos g ON g.imdb_id = i.imdb_id
                           WHERE l.name = 'Películas'""").fetchall()
    tv.close()
    px = sqlite3.connect("file:%s?mode=ro" % PLEX_DB, uri=True)
    por_ruta = {}
    for ruta, rk, sid, gen in px.execute(
            """SELECT mp.file, mi.id, mi.library_section_id, mi.tags_genre FROM media_parts mp
                 JOIN media_items m ON m.id = mp.media_item_id
                 JOIN metadata_items mi ON mi.id = m.metadata_item_id
                WHERE mi.metadata_type = 1"""):
        por_ruta[(ruta or "").lower()] = (rk, sid, [g for g in (gen or "").split("|") if g])
    px.close()

    cola, sin_plex, sin_generos, iguales = [], 0, 0, 0
    vistos = set()   # una pelicula en dos ficheros es UNA ficha en Plex
    for ruta, titulo, crudos in pelis:
        if args.solo and args.solo.lower() not in titulo.lower():
            continue
        p = por_ruta.get(ruta.lower())
        if not p:
            sin_plex += 1
            continue
        if p[0] in vistos:
            continue
        vistos.add(p[0])
        objetivo = []
        for g in (crudos or "").split(","):
            t = IMDB_A_PLEX.get(g.strip())
            if t and t not in objetivo:
                objetivo.append(t)
        if not objetivo:
            sin_generos += 1
            continue
        rk, sid, actuales = p
        # tags_genre es una CACHE RECORTADA de Plex (guarda 2 generos de 3-5,
        # visto el 26/09/2026): solo sirve para la vista previa. Al aplicar se
        # leen los reales por la API y se decide con esos.
        if not args.aplicar and set(actuales) == set(objetivo):
            iguales += 1
            continue
        cola.append((titulo, rk, sid, actuales, objetivo))
    print("peliculas con generos de IMDb: %d | no estan en Plex: %d | sin genero traducible: %d"
          " | ya iguales: %d | A CAMBIAR: %d%s"
          % (len(pelis), sin_plex, sin_generos, iguales, len(cola),
             "  [APLICANDO]" if args.aplicar else "  [solo ensenyar]"), flush=True)
    if not args.aplicar:
        for t, rk, sid, a, o in cola[:12]:
            print("   %-40s %s  ->  %s" % (t[:40], a, o))
        return 0

    tok = token()
    hechos = fallos = 0
    for n, (titulo, rk, sid, actuales, objetivo) in enumerate(cola, 1):
        try:
            actuales, bloqueado = leer_generos(tok, rk)
            if set(actuales) == set(objetivo) and bloqueado:
                hechos += 1
                continue
            quitar = [g for g in actuales if g not in objetivo]
            escribir(tok, sid, rk, objetivo, quitar)
            despues, bloqueado = leer_generos(tok, rk)
        except Exception as e:
            fallos += 1
            apunta({"titulo": titulo, "rk": rk, "estado": "fallo", "error": str(e)[:100]})
            continue
        bien = set(despues) == set(objetivo) and bloqueado
        apunta({"titulo": titulo, "rk": rk, "sid": sid, "estado": "hecho" if bien else "no_cuadra",
                "antes": actuales, "despues": despues, "objetivo": objetivo, "bloqueado": bloqueado})
        if bien:
            hechos += 1
        else:
            fallos += 1
            print("   NO CUADRA %s: pedido %s, quedo %s, bloqueado=%s" % (titulo, objetivo, despues, bloqueado))
        if n % 100 == 0:
            print("  %d/%d" % (n, len(cola)), flush=True)
        time.sleep(0.05)
    print("\nhechas %d · fallos o sin cuadrar %d" % (hechos, fallos))
    return 0


if __name__ == "__main__":
    sys.exit(main())
