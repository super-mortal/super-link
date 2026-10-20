import tailwindcss from '@tailwindcss/vite';

import { defineConfig } from 'vite';
import path from 'path';

import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@api': path.resolve(__dirname, './src/api'),
      '@utils': path.resolve(__dirname, './src/utils'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://host.docker.internal:' + (process.env.BACKEND_PORT || '8000'),
        changeOrigin: true,
      },
      '/content': {
        target: 'http://host.docker.internal:' + (process.env.BACKEND_PORT || '8000'),
        changeOrigin: true,
      },
    },
  },
});
