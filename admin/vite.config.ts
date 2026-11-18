/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Dev server: ADMIN_DEV_API is the Django backend the `/api` proxy sends to, ADMIN_DEV_PORT the port to listen on. */
const devApi = process.env.ADMIN_DEV_API ?? 'http://localhost:8000';
const devPort = Number(process.env.ADMIN_DEV_PORT ?? 5174);

export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: devPort,
    strictPort: true,
    proxy: {
      '/api': { target: devApi, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
