import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
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
