import { defineConfig, type Plugin } from 'vite';

/**
 * Una app de Tizen no se carga por http, y con `crossorigin` el navegador
 * aplica comprobaciones CORS a su propio fichero local: el script no llega a
 * ejecutarse y la app se queda en negro. Se quita el atributo y se sirve como
 * script clásico, que además evita depender de módulos ES en un motor de 2019.
 */
function paraTizen(): Plugin {
  return {
    name: 'cineteca-tizen',
    transformIndexHtml(html) {
      return (
        html
          .replace(/\s+crossorigin/g, '')
          // `defer` no es decorativo: un script de módulo se aplaza solo, pero
          // uno clásico en <head> correría antes de que exista <div id="app">.
          .replace(/type="module"/g, 'defer')
          // La hoja de estilos se enlaza aquí, después de que Vite procese el
          // HTML: si la ve, con salida `iife` la empotra dentro del JS, y la
          // política de seguridad de Tizen descarta los estilos en línea.
          .replace('</head>', '  <link rel="stylesheet" href="./app.css">\n  </head>')
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [paraTizen()],
  build: {
    // El QN93A lleva Tizen 6.0, cuyo motor ronda Chrome 76: eso es anterior a
    // `?.`, `??` y `Array.prototype.at`, así que todo se compila hacia abajo.
    target: 'es2016',
    outDir: 'dist',
    assetsInlineLimit: 100000,
    cssTarget: 'chrome76',
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
  server: { port: 5274 },
});
