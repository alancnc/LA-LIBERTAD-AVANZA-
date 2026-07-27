import { defineConfig } from 'vite';

const apiTarget = process.env.API_URL ?? 'http://localhost:3001';

/**
 * No se usa @vitejs/plugin-react a propósito.
 *
 * Ese plugin aporta React Fast Refresh en desarrollo y transforma el JSX con
 * Babel, y arrastra unos 40 paquetes (todo el árbol de @babel/core). Vite ya
 * compila JSX con esbuild sin necesidad de Babel, así que para esta app el
 * plugin sólo agregaba peso y una dependencia más que puede faltar al instalar.
 *
 * Lo que se pierde: al editar un componente, el módulo se recarga entero en
 * lugar de preservar su estado. Para el tamaño de esta app es un costo menor.
 */
export default defineConfig({
  esbuild: {
    // Runtime automático: no hace falta importar React en cada archivo .tsx.
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  optimizeDeps: {
    esbuildOptions: {
      jsx: 'automatic',
      jsxImportSource: 'react',
    },
  },
  server: {
    port: 5173,
    proxy: {
      // En desarrollo el cliente corre aparte: todo /api va al servidor Express.
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
