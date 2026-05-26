import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.API_PROXY_TARGET || 'http://127.0.0.1:3100';
  const apiPrefix = env.VITE_HEALTHGUARD_API_BASE || '/api';

  return {
    base: env.VITE_BASE_PATH || '/',
    define: {
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
    },
    server: {
      proxy: {
        [apiPrefix]: {
          target: proxyTarget,
          changeOrigin: true,
          secure: false
        }
      }
    }
  };
});
