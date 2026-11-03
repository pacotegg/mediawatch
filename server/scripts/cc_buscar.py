"""Busca en CoverCentury el disco (Label) de cada pelicula con disco generado. python cc_buscar.py <limite>  -> data/cc-resultados.json (no descarga nada, solo busca)."""
import json, re, sys, time, unicodedata, html, urllib.request, urllib.parse
sys.stdout.reconfigure(encoding='utf-8')
filas = json.load(open(r'C:\Users\HTPC\AppData\Local\Temp\gen_titulos.json', encoding='utf-8'))
lim = int(sys.argv[1]) if len(sys.argv) > 1 else 40
def norm(t): 
    t = unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', t).strip()
def buscar(texto, soort):
    url = 'https://www.covercentury.com/index.php?p=search&s=' + urllib.parse.quote_plus(texto) + '&soort=' + soort
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    t = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
    out = []
    for m in re.finditer(r"<a[^>]*href=['\"](index\.php\?p=(?:dvd|blu-ray|bluray)[^'\"]*&f=[^'\"]+)['\"][^>]*>(.*?)</a>", t, re.S):
        out.append((html.unescape(m.group(1)), html.unescape(re.sub('<[^>]+>', '', m.group(2))).strip()))
    return out
res = []; hits = 0; n = 0
for id_, titulo, orig, anyo in filas:
    if n >= lim: break
    n += 1
    nombres = []
    for x in (orig, titulo):
        if x and norm(x) not in [norm(y) for y in nombres]: nombres.append(x)
    ok = None
    for nom in nombres[:2]:
        for soort in ('blu-ray', 'dvd'):
            try: r = buscar(nom, soort)
            except Exception as ex: r = []
            time.sleep(1.0)
            for href, tx in r:
                m = re.match(r'(.*?)\s+(\d{4})?\s*:\s*Label\s*$', tx)
                if not m: continue
                if norm(m.group(1)) == norm(nom) and (not m.group(2) or not anyo or abs(int(m.group(2)) - int(anyo)) <= 1):
                    ok = {'id': id_, 'titulo': titulo, 'nombre': tx, 'href': href, 'categoria': soort}; break
            if ok: break
        if ok: break
    res.append(ok or {'id': id_, 'titulo': titulo, 'nombre': None})
    if ok: hits += 1
json.dump(res, open(r'C:\Users\HTPC\AppData\Local\Temp\cc-resultados.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{n} titulos buscados, {hits} con disco en CoverCentury')
for r in res:
    if r['nombre']: print(' ', r['titulo'][:40], '->', r['nombre'], r['categoria'])
