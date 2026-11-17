import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :3000; Vite forwards /api to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', sourcemap: true },
});
