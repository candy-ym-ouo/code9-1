import { defineConfig, devices } from '@playwright/test';

/**
 * 端到端用例对着一个**已经在跑**的服务端 + 前端产物。
 * 用法：
 *   npm run build                 # 生成 apps/web/dist
 *   npm start                     # 后端在 3000 端口同时托管前端产物
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
    ...devices['Desktop Chrome'],
  },
});
