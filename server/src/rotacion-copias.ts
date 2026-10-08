/**
 * Qué copias de seguridad de la base de datos se quedan.
 *
 * El nombre lleva la fecha (`tvwatch-AAAA-MM-DD-HH-MM-SS.db`, en UTC), así que
 * ordenar por nombre es ordenar por tiempo.
 *
 * Se hace una copia en cada arranque del servidor y este se reinicia varias
 * veces al día: con «las N últimas» todas acababan siendo de hoy y no quedaba
 * ninguna de ayer (08/10/2026). Se conserva la más reciente de cada uno de los
 * últimos `dias` días, más las `ultimas` últimas sean del día que sean.
 */
export function copiasAConservar(nombres: string[], dias = 7, ultimas = 3): Set<string> {
  const orden = [...nombres].sort();
  const conservar = new Set(ultimas > 0 ? orden.slice(-ultimas) : []);
  const porDia = new Map<string, string>();
  // 'tvwatch-' son 8 caracteres y 'AAAA-MM-DD' otros 10
  for (const f of orden) porDia.set(f.slice(8, 18), f);
  for (const f of [...porDia.values()].slice(-dias)) conservar.add(f);
  return conservar;
}
