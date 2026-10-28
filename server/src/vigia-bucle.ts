/**
 * Dice DÓNDE se atasca el hilo principal, no solo cuánto.
 *
 * El latido de `index.ts` apunta el retraso cuando el bucle por fin vuelve, y con el servidor muerto 60 s no apunta nada. Aquí un
 * hilo aparte mira un contador que el principal sube cada 250 ms; si lleva más de 1,5 s sin moverse (con 3 s se escapaban los atascos de ~2 s de madrugada), se engancha al hilo principal
 * con el inspector, le pide una pausa y apunta la pila en `data/latido.log` (una vez por atasco). Una llamada nativa que espera
 * (un `node:sqlite` esperando un bloqueo) no se interrumpe: la pausa salta al volver a JS, que es justo la línea que esperó.
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Session } from 'node:inspector';
import { workerData } from 'node:worker_threads';

const { compartido, dir } = workerData as { compartido: SharedArrayBuffer; dir: string };
const marca = new Float64Array(compartido);
const registro = join(dir, 'latido.log');
const apuntar = (t: string) => { try { appendFileSync(registro, `${new Date().toISOString()}  ${t}\n`); } catch { /* nada que hacer */ } };

let apuntado = false;
setInterval(() => {
  const parado = Date.now() - marca[0];
  if (parado < 1500) { apuntado = false; return; }
  if (apuntado) return;
  apuntado = true;
  const s = new Session();
  try {
    s.connectToMainThread();
    s.on('Debugger.paused', (m) => {
      const marcos = (m.params.callFrames as { functionName: string; url: string; location: { lineNumber: number } }[])
        .slice(0, 12).map((f) => `${f.functionName || '(anonima)'} ${f.url.replace(/^file:\/\/\/?/, '').replace(/.*\/server\//, '')}:${f.location.lineNumber + 1}`);
      apuntar(`[pila] hilo principal parado ${Date.now() - marca[0]} ms | ${marcos.join(' < ')}`);
      s.post('Debugger.resume', () => { s.disconnect(); });
    });
    s.post('Debugger.enable', () => { s.post('Debugger.pause'); });
  } catch (e) {
    apuntar(`[pila] no se pudo mirar el hilo principal: ${(e as Error).message}`);
  }
}, 250);
