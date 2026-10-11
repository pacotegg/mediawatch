import { descargarTodosLosTemas } from '../scanner/themes.ts';

console.log('[temas] Iniciando comprobación y descarga de temas musicales...');
const t0 = Date.now();

const res = await descargarTodosLosTemas((actual, total, titulo) => {
  if (actual % 15 === 0 || actual === total) {
    console.log(`[temas] Progreso: ${actual}/${total} (${Math.round((actual / total) * 100)}%) - ${titulo}`);
  }
});

const segs = Math.round((Date.now() - t0) / 1000);
console.log(`[temas] Terminado en ${segs} s.`);
console.log(`[temas] Total analizados: ${res.total}`);
console.log(`[temas] Ya tenían tema:   ${res.yaEstaban}`);
console.log(`[temas] Nuevos descargados: ${res.descargados}`);
console.log(`[temas] No disponibles:    ${res.fallidos}`);
