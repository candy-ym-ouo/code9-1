import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname, '../..'), '');
  const target = env.VITE_API_TARGET || 'http://localhost:3000';
  return {
    plugins: [react()],
    resolve: {
      alias: {
        // 直接指向共享层源码，避免 node_modules 里的 TS 不被处理
        '@flil/shared': path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
      },
    },
    build: { outDir: 'dist', sourcemap: false },
  };
});
