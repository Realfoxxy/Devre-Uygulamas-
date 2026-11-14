/// <reference types="vitest/config" />
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Yayın sürümüne Content-Security-Policy ekler: script, font ve çalışan (worker) yalnızca
 * sitenin kendi kaynaklarından yüklenir. Geliştirme sunucusu satır içi betik kullandığı
 * için yalnızca derlemede uygulanır.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'devre-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 650 },
  test: { include: ['tests/**/*.test.ts'] },
});
