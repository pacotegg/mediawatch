/**
 * Fotos de actores que Plex ya tiene y nosotros no. El cruce es por PELÍCULA (la ruta del fichero es la misma en las dos
 * bases) y por nombre exacto del reparto, que es mucho más estricto que buscar un nombre suelto por internet: el 26/10/2026
 * esa búsqueda se equivocó en 57 de 156 fotos (homónimos y páginas de películas).
 */

export type FilaPlex = { file: string; tag: string; url: string };
export type NuestraSinFoto = { path: string; personaId: number; nombre: string };
export type Cruce = { personaId: number; nombre: string; url: string; ruta: string };

/** Sin tildes, mayúsculas ni signos. Un nombre sin letras latinas queda vacío y no se cruza (no se puede comparar así). */
export const clave = (s: string) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const rutaClave = (p: string) => p.replace(/\\/g, '/').toLowerCase();

export function emparejarPlex(plex: FilaPlex[], nuestras: NuestraSinFoto[]): { cruces: Cruce[]; ambiguos: number; enConflicto: number } {
  // Plex: por película, nombre -> foto; un nombre repetido dentro de la misma película no se puede resolver.
  const porPelicula = new Map<string, Map<string, string | null>>();
  for (const r of plex) {
    const k = clave(r.tag);
    if (!k || !r.url) continue;
    const f = rutaClave(r.file);
    if (!porPelicula.has(f)) porPelicula.set(f, new Map());
    const m = porPelicula.get(f)!;
    if (m.has(k) && m.get(k) !== r.url) m.set(k, null);
    else if (!m.has(k)) m.set(k, r.url);
  }
  // Nuestra base: por película, nombre -> personas; dos personas distintas con el mismo nombre en una película tampoco.
  const nuestrasPor = new Map<string, Map<string, Array<NuestraSinFoto>>>();
  for (const n of nuestras) {
    const k = clave(n.nombre);
    if (!k) continue;
    const f = rutaClave(n.path);
    if (!nuestrasPor.has(f)) nuestrasPor.set(f, new Map());
    const m = nuestrasPor.get(f)!;
    m.set(k, [...(m.get(k) ?? []), n]);
  }
  let ambiguos = 0;
  const candidatas = new Map<number, Map<string, Cruce>>();
  for (const [pelicula, nombres] of nuestrasPor) {
    const deEllaPlex = porPelicula.get(pelicula);
    if (!deEllaPlex) continue;
    for (const [k, personas] of nombres) {
      if (!deEllaPlex.has(k)) continue;
      const url = deEllaPlex.get(k);
      const distintas = new Set(personas.map((p) => p.personaId));
      if (!url || distintas.size > 1) { ambiguos++; continue; }
      const p = personas[0];
      if (!candidatas.has(p.personaId)) candidatas.set(p.personaId, new Map());
      candidatas.get(p.personaId)!.set(url, { personaId: p.personaId, nombre: p.nombre, url, ruta: pelicula });
    }
  }
  // La misma persona con fotos distintas según la película: no se sabe cuál es la buena.
  let enConflicto = 0;
  const cruces: Cruce[] = [];
  for (const urls of candidatas.values()) {
    if (urls.size > 1) { enConflicto++; continue; }
    cruces.push([...urls.values()][0]);
  }
  return { cruces, ambiguos, enConflicto };
}
