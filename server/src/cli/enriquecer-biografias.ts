/**
 * Enriquecer biografías de actores en segundo plano.
 *
 * Busca biografías ricas y completas en inglés en TMDb y TheTVDB para los
 * actores que tienen biografía vacía, escueta (<150 caracteres) o en inglés,
 * y las traduce al español de España con Gemini Flash (sin asteriscos ni negritas).
 *
 * Guarda el resultado en `people_details`, por lo que la app de la tele, la web
 * y el móvil cargan la biografía al instante (en 1 ms) desde SQLite local sin
 * retardos de red.
 *
 * Uso:
 *   node src/cli/enriquecer-biografias.ts --limite 20    (prueba corta)
 *   node src/cli/enriquecer-biografias.ts                (todas las pendientes)
 *   node src/cli/enriquecer-biografias.ts --forzar       (revisa también existentes)
 */
import { config } from '../config.ts';
import { db } from '../db.ts';
import { esTextoEnIngles, traducirConGemini } from '../scanner/people.ts';
import { biografiaPersonaTvdb, buscarPersonaTvdb } from '../scanner/tvdb.ts';

const args = process.argv.slice(2);
const limiteIdx = args.indexOf('--limite');
const limite = limiteIdx !== -1 ? Number(args[limiteIdx + 1]) : Infinity;
const forzar = args.includes('--forzar');

let sigue = true;
process.on('SIGINT', () => {
  console.log('\n[biografías] Detención solicitada por el usuario (SIGINT). Saliendo limpiamente...');
  sigue = false;
});

const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

type PersonaFila = {
  id: number;
  name: string;
  tmdb_id: number | null;
  imdb_id: string | null;
  tvdb_id: number | null;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  birthplace: string | null;
};

type FichaTmdb = {
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  imdb_id: string | null;
};

async function consultarTmdb(tmdbId: number, idioma: string): Promise<FichaTmdb | null> {
  if (!config.tmdbApiKey) return null;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/person/${tmdbId}?api_key=${config.tmdbApiKey}&language=${idioma}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as FichaTmdb;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Enriquecedor de biografías de actores ===\n');

  // Seleccionar actores que necesitan enriquecimiento
  const condicion = forzar
    ? '1=1'
    : `(d.biography IS NULL OR length(d.biography) < 150 OR d.biography LIKE '%born %' OR d.biography LIKE '%is an actor%')`;

  const candidatas = db
    .prepare(
      `SELECT p.id, p.name, d.tmdb_id, d.imdb_id, d.tvdb_id, d.biography, d.birthday, d.deathday, d.birthplace
       FROM people p
       JOIN people_details d ON d.person_id = p.id
       WHERE ${condicion}
       ORDER BY (SELECT COUNT(*) FROM item_people ip WHERE ip.person_id = p.id) DESC, p.id ASC`
    )
    .all() as PersonaFila[];

  const lista = candidatas.slice(0, limite);
  console.log(`Actores candidatos a enriquecer: ${lista.length} (de ${candidatas.length} detectados)${forzar ? ' [modo forzar]' : ''}\n`);

  if (lista.length === 0) {
    console.log('No hay biografías pendientes.');
    return;
  }

  const stmtActualizar = db.prepare(`
    UPDATE people_details
    SET biography = ?,
        birthday = COALESCE(birthday, ?),
        deathday = COALESCE(deathday, ?),
        birthplace = COALESCE(birthplace, ?),
        imdb_id = COALESCE(imdb_id, ?),
        tvdb_id = COALESCE(tvdb_id, ?),
        fetched_at = ?
    WHERE person_id = ?
  `);

  let actualizadas = 0;
  let traducidas = 0;
  let yaEspanolRica = 0;
  let sinDatos = 0;
  let fallosTraduccion = 0;

  for (let i = 0; i < lista.length && sigue; i++) {
    const p = lista[i];
    const etiqueta = `[${i + 1}/${lista.length}] ${p.name}`;
    let bioElegida: string | null = null;
    let origen = '';
    let nuevoCumple: string | null = null;
    let nuevaMuerte: string | null = null;
    let nuevoLugar: string | null = null;
    let nuevoImdb: string | null = null;
    let nuevoTvdb: number | null = p.tvdb_id;

    // 1. Intentar con TMDb si tenemos tmdb_id
    if (p.tmdb_id) {
      const fichaEs = await consultarTmdb(p.tmdb_id, config.tmdbLanguage || 'es-ES');
      const fichaEn = await consultarTmdb(p.tmdb_id, 'en-US');

      if (fichaEs || fichaEn) {
        nuevoCumple = fichaEs?.birthday || fichaEn?.birthday || null;
        nuevaMuerte = fichaEs?.deathday || fichaEn?.deathday || null;
        nuevoLugar = fichaEs?.place_of_birth || fichaEn?.place_of_birth || null;
        nuevoImdb = fichaEs?.imdb_id || fichaEn?.imdb_id || null;

        const bioEs = fichaEs?.biography?.trim() || '';
        const bioEn = fichaEn?.biography?.trim() || '';

        // Criterio de selección inteligente:
        // Si español es rica (> 250 caracteres) y no es notablemente más corta que la inglesa:
        if (bioEs.length > 250 && bioEn.length <= bioEs.length * 1.8) {
          bioElegida = bioEs;
          origen = `TMDb ES (${bioEs.length} chars)`;
          yaEspanolRica++;
        } else if (bioEn.length > 180) {
          // La inglesa es mucho más rica o la española es escueta/vacía
          origen = `TMDb EN (${bioEn.length} chars)`;
          const trad = await traducirConGemini(bioEn);
          if (trad) {
            bioElegida = trad;
            traducidas++;
          } else {
            fallosTraduccion++;
            // Si la traducción falló y había algo en español, dejamos lo español
            bioElegida = bioEs.length > 30 ? bioEs : bioEn;
          }
        } else if (bioEs.length > 0) {
          bioElegida = bioEs;
          origen = `TMDb ES corta (${bioEs.length} chars)`;
        }
      }
    }

    // 2. Si sigue sin biografía y tenemos TheTVDB disponible
    if (!bioElegida && config.tvdbApiKey) {
      let tvdbId = p.tvdb_id;
      if (!tvdbId && (p.imdb_id || nuevoImdb)) {
        try {
          const resTvdb = await buscarPersonaTvdb(p.name, (p.imdb_id || nuevoImdb)!);
          if (resTvdb?.id) {
            tvdbId = resTvdb.id;
            nuevoTvdb = tvdbId;
          }
        } catch {}
      }

      if (tvdbId) {
        try {
          const bioTvdb = await biografiaPersonaTvdb(tvdbId);
          if (bioTvdb && bioTvdb.biografia.length > 80) {
            if (bioTvdb.idioma === 'es' || !esTextoEnIngles(bioTvdb.biografia)) {
              bioElegida = bioTvdb.biografia;
              origen = `TVDB ES (${bioElegida.length} chars)`;
            } else {
              origen = `TVDB EN (${bioTvdb.biografia.length} chars)`;
              const trad = await traducirConGemini(bioTvdb.biografia);
              if (trad) {
                bioElegida = trad;
                traducidas++;
              } else {
                bioElegida = bioTvdb.biografia;
              }
            }
          }
        } catch {}
      }
    }

    // 3. Guardar si obtuvimos biografía o metadatos nuevos
    if (bioElegida) {
      const ahora = new Date().toISOString();
      stmtActualizar.run(
        bioElegida,
        nuevoCumple,
        nuevaMuerte,
        nuevoLugar,
        nuevoImdb,
        nuevoTvdb,
        ahora,
        p.id
      );
      actualizadas++;
      console.log(`${etiqueta} -> ${origen} -> Guardada (${bioElegida.length} chars)`);
    } else {
      sinDatos++;
      console.log(`${etiqueta} -> Sin biografía disponible en TMDb ni TVDB`);
    }

    // Pausa suave para respetar rate-limits (4 req/segundo máx)
    await espera(300);
  }

  console.log('\n=== Resumen ===');
  console.log(`Total procesados: ${actualizadas + sinDatos}`);
  console.log(`Biografías actualizadas: ${actualizadas}`);
  console.log(`  - Traducidas de inglés con Gemini: ${traducidas}`);
  console.log(`  - Ya ricas en español: ${yaEspanolRica}`);
  console.log(`Sin datos disponibles: ${sinDatos}`);
  if (fallosTraduccion > 0) console.log(`Fallos de traducción: ${fallosTraduccion}`);
}

main().catch((err) => {
  console.error('[biografías] Error:', err);
  process.exit(1);
});
