import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Le domaine partagé est consommé depuis ses sources : un seul jeu de règles front/back.
    alias: { '@ticketing/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // En développement, /api est relayé vers l'API ; en production, le reverse proxy fait de même.
    proxy: {
      '/api': { target: 'http://localhost:3000', rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
