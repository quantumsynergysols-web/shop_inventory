import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :3000; Vite forwards /api to it.
// WEB_BASE=/app/ when the app is served under /app (Vercel, next to the product website); / otherwise.
export default defineConfig({
  base: process.env.WEB_BASE ?? '/',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  preview: { port: 4173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', sourcemap: true },
});
