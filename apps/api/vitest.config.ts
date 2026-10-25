import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Les tests utilisent les sources du package partagé, sans build préalable.
    alias: { '@ticketing/shared': resolve(__dirname, '../../packages/shared/src') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Les tests d'intégration partagent la même base : un fichier à la fois.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
