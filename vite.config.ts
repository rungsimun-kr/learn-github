import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the built app works both at the domain root and under a
  // GitHub Pages project path like /learn-github/.
  base: './',
  plugins: [react()],
  build: {
    // pdf.js ships a large worker; don't nag about it on every build.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
