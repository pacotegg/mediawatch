"""
API para búsqueda y descarga interactiva de subtítulos (SubSource y OpenSubtitles).
Reutiliza la lógica de conexión y extracción de subsfetch.py.
"""

import argparse
import json
import os
import re
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Agregar la ruta de scripts del pipeline para importar subsfetch
_sf = os.environ.get("MEDIAWATCH_SUBSFETCH")
sys.path.append(os.path.dirname(_sf) if _sf else r"C:\scripts\webpanel")
import subsfetch

SS_LANG = {"es": "spanish", "en": "english"}


def buscar_candidatos(video, idiomas=("es", "en")):
    imdb, es_serie, temp, ep = subsfetch.imdb_de(video)
    titulo, anyo = subsfetch.titulo_y_anyo(video)
    nombre_video = os.path.basename(video)

    resultados = []

    # 1. SubSource
    try:
        cfg_ss = subsfetch.cargar_config_subsource()
        if cfg_ss:
            ss = subsfetch.SubSource(cfg_ss)
            if imdb:
                fichas = ss.fichas(imdb=imdb)
            else:
                fichas = ss.fichas(texto=titulo)
                # Filtrar tipo para no mezclar películas con series
                if es_serie:
                    fichas = [f for f in fichas if f.get("type") == "tvseries"]
                else:
                    fichas = [f for f in fichas if f.get("type") != "tvseries"]

                if anyo:
                    mismas = [f for f in fichas if str(f.get("releaseYear")) == str(anyo)]
                    if mismas:
                        fichas = mismas
                    else:
                        tit_norm = re.sub(r"[^a-z0-9]", "", titulo.lower())
                        fichas = [
                            f for f in fichas
                            if tit_norm in re.sub(r"[^a-z0-9]", "", (f.get("title") or "").lower())
                            or re.sub(r"[^a-z0-9]", "", (f.get("title") or "").lower()) in tit_norm
                        ]
                else:
                    tit_norm = re.sub(r"[^a-z0-9]", "", titulo.lower())
                    fichas = [
                        f for f in fichas
                        if tit_norm in re.sub(r"[^a-z0-9]", "", (f.get("title") or "").lower())
                        or re.sub(r"[^a-z0-9]", "", (f.get("title") or "").lower()) in tit_norm
                    ]

            if es_serie:
                propias = [f for f in fichas if f.get("season") == temp]
                resto = [f for f in fichas if f.get("season") in (0, None) and f not in propias]
                fichas = propias + resto
            else:
                fichas = fichas[:2]

            for f in fichas[:2]:
                m_id = f.get("movieId")
                if not m_id:
                    continue
                for idioma in idiomas:
                    ss_idioma = SS_LANG.get(idioma, idioma)
                    lista = ss.subtitulos(m_id, ss_idioma, False)
                    # También forzados si es español
                    if idioma == "es":
                        lista += ss.subtitulos(m_id, ss_idioma, True)

                    for s in lista:
                        sub_id = s.get("subtitleId")
                        if not sub_id:
                            continue
                        rel_list = [r.strip() for r in (s.get("releaseInfo") or []) if r.strip()]
                        if rel_list:
                            rel_info = rel_list[0]
                            if len(rel_list) > 1 and len(rel_info) < 32:
                                rel_info += f" | {rel_list[1]}"
                        else:
                            rel_info = f.get("title", titulo)
                        rel_info = re.sub(r"\s+", " ", rel_info)
                        if len(rel_info) > 70:
                            rel_info = rel_info[:67] + "…"

                        comentario = re.sub(r"\s+", " ", (s.get("commentary") or "").strip())
                        if len(comentario) > 50:
                            comentario = comentario[:47] + "…"
                        
                        puntuacion = 0
                        rat = s.get("rating") or {}
                        if isinstance(rat, dict):
                            good = rat.get("good", 0)
                            bad = rat.get("bad", 0)
                            total = good + bad
                            puntuacion = round((good / total) * 5.0, 1) if total > 0 else 0

                        resultados.append({
                            "id": f"ss:{sub_id}",
                            "provider": "SubSource",
                            "providerId": sub_id,
                            "language": idioma,
                            "languageLabel": "Español" if idioma == "es" else "Inglés",
                            "release": rel_info,
                            "downloads": int(s.get("downloads") or 0),
                            "rating": puntuacion,
                            "forced": bool(s.get("foreignParts")),
                            "hearingImpaired": bool(s.get("hearingImpaired")),
                            "comment": comentario,
                            "matchScore": subsfetch._puntuar_ss(s, nombre_video),
                        })
    except Exception as e:
        sys.stderr.write(f"[subtitles_api] error en SubSource: {e}\n")

    # 2. OpenSubtitles
    try:
        cfg_os = subsfetch.cargar_config()
        if cfg_os and cfg_os.get("api_key"):
            os_api = subsfetch.OpenSubs(cfg_os)
            imdb_num = int(imdb[2:]) if imdb and imdb.startswith("tt") else None
            fps = None

            for idioma in idiomas:
                consultas = []
                if imdb_num:
                    if es_serie and temp is not None and ep is not None:
                        consultas.append({"parent_imdb_id": imdb_num, "season_number": temp, "episode_number": ep, "languages": idioma})
                    else:
                        consultas.append({"imdb_id": imdb_num, "languages": idioma})
                else:
                    q = {"query": titulo, "languages": idioma, "order_by": "download_count"}
                    if anyo:
                        q["year"] = anyo
                    consultas.append(q)

                for q in consultas:
                    cand_os = os_api.buscar(**q)
                    for c in (cand_os or []):
                        attr = c.get("attributes", {})
                        if not imdb_num:
                            feat = attr.get("feature_details", {})
                            feat_title = (feat.get("title") or "").strip()
                            if feat_title:
                                tit_norm = re.sub(r"[^a-z0-9]", "", titulo.lower())
                                feat_norm = re.sub(r"[^a-z0-9]", "", feat_title.lower())
                                if tit_norm not in feat_norm and feat_norm not in tit_norm:
                                    continue

                        fichs = attr.get("files") or []
                        if not fichs:
                            continue
                        fid = fichs[0].get("file_id")
                        if not fid:
                            continue
                        
                        rel = re.sub(r"\s+", " ", (attr.get("release") or fichs[0].get("file_name") or titulo).strip())
                        if len(rel) > 70:
                            rel = rel[:67] + "…"

                        comentario = re.sub(r"\s+", " ", (attr.get("comments") or "").strip())
                        if len(comentario) > 50:
                            comentario = comentario[:47] + "…"

                        rating = float(attr.get("ratings") or 0)
                        
                        resultados.append({
                            "id": f"os:{fid}",
                            "provider": "OpenSubtitles",
                            "providerId": fid,
                            "language": idioma,
                            "languageLabel": "Español" if idioma == "es" else "Inglés",
                            "release": rel,
                            "downloads": int(attr.get("download_count") or 0),
                            "rating": round(rating, 1),
                            "forced": bool(attr.get("foreign_parts_only")),
                            "hearingImpaired": bool(attr.get("hearing_impaired")),
                            "comment": comentario,
                            "matchScore": subsfetch.puntuar(c, fps, nombre_video),
                        })
    except Exception as e:
        sys.stderr.write(f"[subtitles_api] error en OpenSubtitles: {e}\n")

    # Desduplicar y ordenar por matchScore y descargas
    vistos = set()
    unicos = []
    for r in sorted(resultados, key=lambda x: (x["matchScore"], x["downloads"]), reverse=True):
        if r["id"] not in vistos:
            vistos.add(r["id"])
            unicos.append(r)

    # Filtrar resultados con matchScore muy negativo salvo descargas masivas
    unicos = [r for r in unicos if r["matchScore"] >= -20 or r["downloads"] > 500]
    return unicos[:15]


def descargar_candidato(video, provider, sub_id, out_file):
    _, es_serie, temp, ep = subsfetch.imdb_de(video)
    texto = None

    if provider.lower() == "subsource":
        cfg = subsfetch.cargar_config_subsource()
        if not cfg:
            return False, "sin configuración de SubSource"
        ss = subsfetch.SubSource(cfg)
        datos = ss.descargar(int(sub_id))
        if not datos:
            return False, "falló la descarga desde SubSource"
        texto = subsfetch._srt_del_zip(datos, temp, ep)
        if not texto:
            return False, "no se pudo extraer .srt del archivo descargado"

    elif provider.lower() in ("opensubtitles", "opensubs"):
        cfg = subsfetch.cargar_config()
        if not cfg:
            return False, "sin configuración de OpenSubtitles"
        os_api = subsfetch.OpenSubs(cfg)
        ok_login, mot = os_api.login()
        if not ok_login:
            return False, f"login en OpenSubtitles falló: {mot}"
        texto, err = os_api.descargar(int(sub_id))
        if not texto:
            return False, f"descarga falló: {err}"
    else:
        return False, f"proveedor desconocido: {provider}"

    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(texto)

    return True, texto


def main():
    p = argparse.ArgumentParser()
    subp = p.add_subparsers(dest="accion")

    p_buscar = subp.add_parser("buscar")
    p_buscar.add_argument("--video", required=True)
    p_buscar.add_argument("--idiomas", default="es,en")

    p_descargar = subp.add_parser("descargar")
    p_descargar.add_argument("--video", required=True)
    p_descargar.add_argument("--provider", required=True)
    p_descargar.add_argument("--sub-id", required=True)
    p_descargar.add_argument("--out", required=True)

    args = p.parse_args()

    if args.accion == "buscar":
        idiomas = [i.strip() for i in args.idiomas.split(",") if i.strip()]
        res = buscar_candidatos(args.video, idiomas=idiomas)
        print(json.dumps({"ok": True, "candidates": res}, ensure_ascii=True))

    elif args.accion == "descargar":
        ok, res = descargar_candidato(args.video, args.provider, args.sub_id, args.out)
        if ok:
            print(json.dumps({"ok": True, "out": args.out}, ensure_ascii=True))
        else:
            print(json.dumps({"ok": False, "error": res}, ensure_ascii=True))
            sys.exit(1)
    else:
        p.print_help()


if __name__ == "__main__":
    main()
