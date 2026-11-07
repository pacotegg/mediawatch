import { identificarExtrasBiblioteca } from '../media/extras.ts';

console.log('Iniciando pasada de identificacion de extras en la biblioteca...\n');
const res = await identificarExtrasBiblioteca();

console.log('--------------------------------------------------');
console.log('RESUMEN DE IDENTIFICACION:');
console.log(`- Extras genericos detectados: ${res.totalGenericos}`);
console.log(`- Items / peliculas procesadas: ${res.itemsProcesados}`);
console.log(`- Identificados y actualizados: ${res.identificados}`);
console.log(`- Sin emparejar (requieren revision manual): ${res.totalGenericos - res.identificados}`);
console.log('--------------------------------------------------');

if (res.detalles.length > 0) {
  console.log('\nDetalles de los extras identificados:');
  for (const d of res.detalles) {
    const mins = Math.floor(d.duracion / 60);
    const segs = Math.round(d.duracion % 60).toString().padStart(2, '0');
    console.log(`  * [ID ${d.id}] "${d.tituloViejo}" -> "${d.tituloNuevo}" (${mins}:${segs}) [Fuente: ${d.fuente}]`);
    console.log(`    Fichero: ${d.path}`);
  }
}
