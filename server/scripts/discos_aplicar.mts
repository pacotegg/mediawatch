import { readFileSync, writeFileSync } from 'node:fs';
const tm = await import('file:///C:/tvwatch/server/src/scanner/tmdb.ts');
const dir = 'C:/Users/HTPC/AppData/Local/Temp/discos_gen/';
const lista = JSON.parse(readFileSync(dir + 'lista.json', 'utf8')).hechos as { id: number; titulo: string; formato: string }[];
const puestos: any[] = [];
for (const d of lista) {
  try {
    tm.ponerArteDeDatos(d.id, 'discart', readFileSync(dir + d.id + '.webp'));
    puestos.push({ ...d, cuando: new Date().toISOString() });
  } catch (e) { console.log('fallo', d.id, d.titulo, (e as Error).message); }
}
writeFileSync('C:/tvwatch/data/discos-generados.json', JSON.stringify(puestos, null, 1));
console.log('puestos', puestos.length);
