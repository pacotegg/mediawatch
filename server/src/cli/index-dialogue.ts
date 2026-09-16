import { dialogueStats, indexDialogue } from '../scanner/dialogue.ts';

const language = process.argv[2] ?? 'spa';
console.log(`Indexando diálogos (idioma: ${language || 'todos'})…`);

const started = Date.now();
let last = '';
indexDialogue(language === 'todos' ? '' : language, (p) => {
  const line = `  ${p.done}/${p.total} ficheros · ${p.cues.toLocaleString('es-ES')} frases`;
  if (line !== last) {
    process.stdout.write(`\r${line.padEnd(70)}`);
    last = line;
  }
});

process.stdout.write('\r'.padEnd(72) + '\r');
console.log('Totales:', dialogueStats());
console.log(`Tiempo: ${((Date.now() - started) / 1000).toFixed(1)}s`);
