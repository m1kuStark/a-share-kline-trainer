import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts'],
    environment: 'node',
    // Preserve the same assertions/concurrency without Windows fork IPC failures.
    // Tests that need their own cwd launch a real child instead of mutating a worker.
    pool: 'threads',
    // Windows/Node24 并行满载时真实子进程清理/临时 git 夹具偶发争用（2026-11-07 门禁实证）；
    // 收紧到 2 个 worker 稳定门禁，断言与测试集合不变。
    maxWorkers: 2,
  },
})
