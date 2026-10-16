import { detectarPeliculas, jobPeliculas, resumenPeliculas } from '../media/creditos-detector.ts';

async function main() {
  console.log('[MediaWatch] Iniciando detección local de créditos en películas...');
  const resumenAntes = resumenPeliculas();
  console.log(`Estado actual: ${resumenAntes.analizadas} analizadas (${resumenAntes.conCreditos} con créditos).`);

  let total: number;
  try {
    total = detectarPeliculas();
  } catch (err) {
    console.error('No se pudo iniciar la detección:', (err as Error).message);
    process.exit(1);
  }

  if (total === 0) {
    console.log('No hay películas pendientes por analizar.');
    process.exit(0);
  }

  console.log(`Se han encontrado ${total} películas pendientes. Analizando fotogramas...`);

  // Esperar a que comience la ejecución
  await new Promise((r) => setTimeout(r, 500));

  let ultimaActual = '';
  while (jobPeliculas.running) {
    if (jobPeliculas.actual && jobPeliculas.actual !== ultimaActual) {
      ultimaActual = jobPeliculas.actual;
      const estado = jobPeliculas.esperando ? ' (en pausa: reproduciendo)' : '';
      console.log(`[${jobPeliculas.hechas + 1}/${jobPeliculas.total}] «${jobPeliculas.actual}»${estado} | Encontrados: ${jobPeliculas.conCreditos}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (jobPeliculas.error) {
    console.error('El trabajo terminó con error:', jobPeliculas.error);
  } else {
    const resumenDespues = resumenPeliculas();
    console.log('\n--- DETECCIÓN LOCAL FINALIZADA ---');
    console.log(`Películas procesadas: ${jobPeliculas.hechas}`);
    console.log(`Créditos encontrados en esta pasada: ${jobPeliculas.conCreditos}`);
    console.log(`Total acumulado en BD: ${resumenDespues.analizadas} analizadas (${resumenDespues.conCreditos} con créditos).`);
  }
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
