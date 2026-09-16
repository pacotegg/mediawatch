/**
 * Habla con el inspector remoto de la tele y evalúa expresiones dentro de la
 * app. Sirve para ver el diseño real en el televisor en vez de adivinarlo.
 *
 *   node inspect.mjs "expresión JS"
 */

const puerto = process.env.PUERTO || '58113';
const tele = process.env.TELE || '192.168.31.117';
const expresion = process.argv[2] || '1+1';

const lista = await (await fetch(`http://${tele}:${puerto}/json`)).json();
const pagina = lista.find((t) => t.webSocketDebuggerUrl);
if (!pagina) {
  console.error('No hay ninguna página abierta en el inspector');
  process.exit(1);
}

const ws = new WebSocket(pagina.webSocketDebuggerUrl);
let id = 0;
const pendientes = new Map();

const enviar = (method, params) =>
  new Promise((resolve) => {
    const propio = ++id;
    pendientes.set(propio, resolve);
    ws.send(JSON.stringify({ id: propio, method, params }));
  });

ws.addEventListener('message', (evento) => {
  const mensaje = JSON.parse(evento.data);
  if (mensaje.id && pendientes.has(mensaje.id)) {
    pendientes.get(mensaje.id)(mensaje);
    pendientes.delete(mensaje.id);
  }
});

ws.addEventListener('open', async () => {
  // Sin el `await` interno, una expresión asíncrona se serializaba como la
  // promesa en sí y siempre devolvía "{}".
  const respuesta = await enviar('Runtime.evaluate', {
    expression: `Promise.resolve(${expresion}).then(function (v) { return JSON.stringify(v); })`,
    returnByValue: true,
    awaitPromise: true,
  });

  const resultado = respuesta.result?.result;
  if (respuesta.result?.exceptionDetails) {
    console.log('EXCEPCIÓN:', JSON.stringify(respuesta.result.exceptionDetails.exception?.description ?? respuesta.result.exceptionDetails, null, 2));
  } else {
    try {
      console.log(JSON.stringify(JSON.parse(resultado.value), null, 2));
    } catch {
      console.log(resultado?.value ?? resultado);
    }
  }
  ws.close();
  process.exit(0);
});

ws.addEventListener('error', (e) => {
  console.error('No se pudo conectar con el inspector:', e.message ?? e);
  process.exit(1);
});
