import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    ...(process.env.VITE_HTTPS === 'true' ? [basicSsl()] : []),
    react(),
    VitePWA({
      registerType: 'prompt',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: false, // Use existing manifest.json
      injectManifest: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,json,wasm,ico,png,svg,woff,woff2}'],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
