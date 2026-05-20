import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },
  resolve: {
    alias: {
      '@healthguard/sdk-web': fileURLToPath(new URL('../../packages/sdk-web/src/index.ts', import.meta.url))
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true
      }
    }
  }
});
