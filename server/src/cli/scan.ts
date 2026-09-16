import { config } from '../config.ts';
import { scanAll } from '../scanner/scan.ts';
import { db } from '../db.ts';

const started = Date.now();
console.log(`Bibliotecas configuradas: ${config.libraries.map((l) => l.name).join(', ')}`);

let lastLine = '';
const results = scanAll((p) => {
  const line = `  ${p.library}: ${p.done}/${p.total}`;
  if (line !== lastLine) {
    process.stdout.write(`\r${line.padEnd(70)}`);
    lastLine = line;
  }
});

process.stdout.write('\r'.padEnd(72) + '\r');
for (const r of results) console.log(`  ${r.name.padEnd(16)} ${r.count}`);

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM items WHERE kind='movie')  AS peliculas,
    (SELECT COUNT(*) FROM items WHERE kind='show')   AS series,
    (SELECT COUNT(*) FROM episodes)                  AS episodios,
    (SELECT COUNT(*) FROM media_files)               AS ficheros,
    (SELECT COUNT(*) FROM people)                    AS personas,
    (SELECT COUNT(*) FROM genres)                    AS generos
`).get();

console.log('\nTotales:', counts);
console.log(`Tiempo: ${((Date.now() - started) / 1000).toFixed(1)}s`);
