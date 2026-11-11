import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['desktop/test/**/*.test.ts'],
    environment: 'node',
    pool: 'threads',
    maxWorkers: 2,
    // TEST-BUDGET-04：desktop 含真实 fs/SQLite/子进程用例，CI 满载时 5s 默认预算不足；
    // 统一 30s，server 套件与本地默认契约不变。断言/用例集合不变。
    testTimeout: 30_000,
  },
})
