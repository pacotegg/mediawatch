"""
Pasa los generos de IMDb de comparar_generos_imdb.py a la tabla imdb_generos,
que el escaner usa en vez de los del .nfo (decision del usuario, 26/09/2026).

Escribe en data/tvwatch.db, no en E:. Idempotente: se relanza cada vez que la
comparacion avance, que la cuota de OMDb obliga a hacerla en varios dias.

Una pelicula cuyo IMDb no trae ningun genero traducible NO se carga: sin fila,
el escaner usa los del .nfo y la pelicula nunca se queda sin generos.

Dos formatos de fila, porque la primera version del comparador guardaba el id
de IMDb en "imdb" y luego lo pisaba con la lista de generos:
  - nuevo:  "imdb_id" (id)  +  "generos_imdb" (lista)
  - viejo:  "imdb" (LISTA)  +  sin id  -> el id se recupera por item_id, que es
            estable: las peliculas se identifican por su carpeta.

    python cargar_generos_imdb.py
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone

DB = r"C:\tvwatch\data\tvwatch.db"
ENTRADA = r"C:\tvwatch\data\comparacion-generos-imdb.jsonl"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    filas = [json.loads(l) for l in open(ENTRADA, encoding="utf-8") if l.strip()]
    db = sqlite3.connect(DB, timeout=10)
    db.execute("""CREATE TABLE IF NOT EXISTS imdb_generos (
                    imdb_id TEXT PRIMARY KEY, generos TEXT NOT NULL,
                    crudos TEXT, actualizado TEXT NOT NULL)""")
    id_de_item = dict(db.execute("SELECT id, imdb_id FROM items WHERE imdb_id IS NOT NULL"))
    ahora = datetime.now(timezone.utc).isoformat()

    cargadas = sin_generos = sin_id = errores = 0
    with db:
        for d in filas:
            if d.get("error"):
                errores += 1
                continue
            if "generos_imdb" in d:                       # formato nuevo
                generos, imdb_id = d["generos_imdb"], d.get("imdb_id")
            elif isinstance(d.get("imdb"), list):         # formato viejo
                generos, imdb_id = d["imdb"], id_de_item.get(d.get("item_id"))
            else:
                continue
            if not imdb_id:
                sin_id += 1
                continue
            if not generos:
                sin_generos += 1
                continue
            db.execute("""INSERT INTO imdb_generos (imdb_id, generos, crudos, actualizado)
                          VALUES (?, ?, ?, ?)
                          ON CONFLICT(imdb_id) DO UPDATE SET generos = excluded.generos,
                            crudos = excluded.crudos, actualizado = excluded.actualizado""",
                       (imdb_id, "|".join(generos), ", ".join(d.get("generos_imdb_crudos") or []), ahora))
            cargadas += 1
    total = db.execute("SELECT COUNT(*) FROM imdb_generos").fetchone()[0]
    db.close()
    print("cargadas %d | en la tabla %d | sin genero traducible (manda el .nfo) %d"
          " | sin id recuperable %d | errores de OMDb %d"
          % (cargadas, total, sin_generos, sin_id, errores))


if __name__ == "__main__":
    sys.exit(main())
