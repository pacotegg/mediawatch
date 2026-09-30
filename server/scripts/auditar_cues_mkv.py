r"""
Busca MKV con el indice de saltos (`Cues`) vacio o casi vacio. SOLO LEE.

Un MKV sin indice util no impide reproducirlo, pero cualquier salto obliga a leer
el fichero hasta ese punto: medido el 30/09/2026 con «El reportero», cuyo `Cues`
trae UN solo punto (segundo 0), una rafaga de ffmpeg cuesta 4 s en el minuto 1,
216 s en el 50 y mas de 300 s en el 95. Eso tumbaba el detector de creditos y
hace lento cualquier salto que el servidor resuelva con `-ss`.

No se usa `mkvextract cues` porque recorre el fichero (mas de 25 min para 60), ni
`mkvinfo` sin `-v`, que deja de listar en el primer Cluster. Se lee lo minimo:
el `SeekHead` de los primeros KB dice donde esta el `Cues`, y se mira cuanto
ocupa. Un indice sano son miles de bytes (un punto por cluster, ~10-20 bytes);
el de un fichero degenerado, decenas.

    python auditar_cues_mkv.py                  todos los MKV de la BD
    python auditar_cues_mkv.py "E:\Peliculas"   solo los de una raiz
"""
import os
import sqlite3
import sys

DB = r"C:\tvwatch\data\tvwatch.db"
ID_SEGMENT = 0x18538067
ID_SEEKHEAD = 0x114D9B74
ID_SEEK = 0x4DBB
ID_SEEKID = 0x53AB
ID_SEEKPOS = 0x53AC
ID_CUES = 0x1C53BB6B
# Por debajo de esto no hay indice que valga: un punto de salto ocupa ~10 bytes y
# una pelicula tiene cientos de clusters. Con 200 bytes caben ~15 puntos.
MINIMO_BYTES = 200


def vint(b, i, quitar_marca=True):
    """(valor, longitud) de un entero de longitud variable EBML en b[i:]."""
    primero = b[i]
    n = 1
    mascara = 0x80
    while n <= 8 and not (primero & mascara):
        n += 1
        mascara >>= 1
    if n > 8:
        raise ValueError("vint invalido")
    v = (primero & (mascara - 1)) if quitar_marca else primero
    for k in range(1, n):
        v = (v << 8) | b[i + k]
    return v, n


def id_ebml(b, i):
    """(id, longitud) conservando los bits de marca, como se escriben los ID."""
    v, n = vint(b, i, quitar_marca=False)
    return v, n


def cues_bytes(ruta):
    """Tamano del elemento Cues, o None si no se puede saber (sin SeekHead)."""
    with open(ruta, "rb") as f:
        cab = f.read(65536)
        i = 0
        ident, n = id_ebml(cab, i)          # cabecera EBML
        tam, m = vint(cab, i + n)
        i += n + m + tam
        ident, n = id_ebml(cab, i)          # Segment
        if ident != ID_SEGMENT:
            return None
        tam, m = vint(cab, i + n)
        inicio_datos = i + n + m
        j = inicio_datos
        # El SeekHead suele ser el primer hijo; se recorren unos pocos por si no lo es.
        for _ in range(6):
            ident, n = id_ebml(cab, j)
            tam, m = vint(cab, j + n)
            if ident == ID_SEEKHEAD:
                fin = j + n + m + tam
                k = j + n + m
                while k < fin:
                    e, ne = id_ebml(cab, k)
                    te, me = vint(cab, k + ne)
                    if e == ID_SEEK:
                        sid, spos = None, None
                        q = k + ne + me
                        limite = q + te
                        while q < limite:
                            s, ns = id_ebml(cab, q)
                            ts, ms = vint(cab, q + ns)
                            cuerpo = cab[q + ns + ms: q + ns + ms + ts]
                            if s == ID_SEEKID:
                                sid = int.from_bytes(cuerpo, "big")
                            elif s == ID_SEEKPOS:
                                spos = int.from_bytes(cuerpo, "big")
                            q += ns + ms + ts
                        if sid == ID_CUES and spos is not None:
                            f.seek(inicio_datos + spos)
                            c = f.read(16)
                            ic, nc = id_ebml(c, 0)
                            if ic != ID_CUES:
                                return None
                            tc, _ = vint(c, nc)
                            return tc
                    k += ne + me + te
                return None
            j += n + m + tam
        return None


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raiz = sys.argv[1].lower().rstrip("\\") + "\\" if len(sys.argv) > 1 else None
    db = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    rutas = [r[0] for r in db.execute("SELECT path FROM media_files ORDER BY path") if r[0].lower().endswith(".mkv")]
    if raiz:
        rutas = [p for p in rutas if p.lower().startswith(raiz)]
    malos, desconocidos, bien = [], [], 0
    for p in rutas:
        try:
            b = cues_bytes(p)
        except (OSError, ValueError, IndexError):
            b = None
        if b is None:
            desconocidos.append(p)
        elif b < MINIMO_BYTES:
            malos.append((b, p))
        else:
            bien += 1
    print("MKV revisados: %d | indice sano: %d | INDICE VACIO: %d | sin poder saber: %d"
          % (len(rutas), bien, len(malos), len(desconocidos)))
    for b, p in sorted(malos):
        print("  %4d bytes  %s" % (b, p))
    if desconocidos:
        print("sin SeekHead o ilegible (%d), primeros:" % len(desconocidos))
        for p in desconocidos[:8]:
            print("  ", p)


if __name__ == "__main__":
    main()
