// Dirección del servidor tal como se teclea en la tele (sin esquema) -> URL.
// Una IP o `localhost` va por HTTP (red local); un nombre con letras, por HTTPS (dominio público con certificado).

const IP_PUERTO = /^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?$/;

export function quitarEsquema(url: string): string {
  return url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

export function urlServidor(texto: string): string {
  const limpio = quitarEsquema(texto).toLowerCase();
  const local = IP_PUERTO.test(limpio) || /^localhost(:\d{1,5})?$/.test(limpio);
  return (local ? 'http://' : 'https://') + limpio;
}
