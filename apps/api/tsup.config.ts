import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Le package partagé est livré en TypeScript : on l'embarque dans le bundle.
  noExternal: ['@resto/shared'],
});
