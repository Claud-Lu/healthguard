import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const proxyTarget = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3100';

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },
  resolve: {
    alias: {
      '@health-guard/sdk-web': fileURLToPath(new URL('../../packages/sdk-web/src/index.ts', import.meta.url))
    }
  },
  server: {
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false
      }
    }
  }
});
