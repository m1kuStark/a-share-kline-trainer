import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
import { runtime } from './e2e/runtime'

// Playwright 真实事件用户旅程（六幕）。前置：npm run build:journey（server/dist + web/dist journey 构建含测试钩子）。
// 浏览器：系统 Edge channel（免下载）；断言纪律：优先 window.__trainerChart 状态断言，截图仅存档。
// --list remains available without starting any server; actual execution requires the owned manifest.
const run = process.env.TRAINER_RUN_MANIFEST ? runtime() : null
const artifacts = run?.artifactsDir ?? '.runs/discovery'
export default defineConfig({
  testDir: 'e2e',
  globalSetup: 'e2e/global-setup.ts',
  use: {
    baseURL: run?.baseURL,
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    // 全量 journey 在 Windows 上逐动作 DOM trace 会滚成数百 MB 并反过来拖慢/卡住长测；
    // 默认关闭 trace（失败仍有 only-on-failure 截图；单测/定向调试可设 TRAINER_TRACE=on）。
    trace: process.env.TRAINER_TRACE === 'on' ? 'retain-on-failure' : 'off',
  },
  // 全量 journey 在 Windows/Node24 上约 40 分钟，机器满载时页面启动/保存状态偶发超过默认 5s；
  // 统一等待预算提到 15s（显式更短/更长的用例自带 timeout 不受影响），断言不变。
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 1,
  reporter: [['list'], ['json', { outputFile: join(artifacts, 'browser-results.json') }], ['html', { open: 'never', outputFolder: join(artifacts, 'html') }]],
  outputDir: join(artifacts, 'test-results'),
})
