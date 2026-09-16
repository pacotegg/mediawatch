/*
 * Service worker mínimo, y a propósito.
 *
 * Solo existe para dos cosas: que Android deje instalar la aplicación y que
 * abrirla sin servidor no acabe en la pantalla de dinosaurio. No cachea vídeo:
 * las descargas para ver sin conexión se bajan como ficheros normales, que es
 * lo único que aguanta varios gigas en un móvil.
 *
 * Los ficheros de /assets/ llevan un hash en el nombre, así que su contenido no
 * cambia nunca y se pueden servir desde la caché sin miedo. Todo lo demás va a
 * la red primero: si se sirviera la caché antes, una versión nueva del servidor
 * tardaría días en llegar al móvil.
 */
const CACHE = 'tvwatch-v1';
const BASICOS = ['/', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  // Nada de tocar la API ni el vídeo: son datos vivos y ficheros enormes.
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/assets/')) {
    evento.respondWith(
      caches.match(peticion).then(
        (guardada) =>
          guardada ||
          fetch(peticion).then((res) => {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(peticion, copia));
            return res;
          }),
      ),
    );
    return;
  }

  evento.respondWith(
    fetch(peticion)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(peticion, copia));
        return res;
      })
      .catch(() => caches.match(peticion).then((g) => g || caches.match('/'))),
  );
});
