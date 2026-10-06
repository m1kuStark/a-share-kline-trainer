#!/usr/bin/env node
// PACK-01 开发窗口启动器：DESKTOP_DEV_URL 模式（不内嵌服务）。
// 配套 npm run dev:desktop＝concurrently(dev:server tsx watch 8787 + dev:web vite 5173 + 本脚本)；
// 页面 /api 经 vite 代理指向 dev:server（web/vite.config.ts 冻结口径）。
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
process.env.DESKTOP_DEV_URL ||= 'http://127.0.0.1:5173'

const electronCli = join(ROOT, 'node_modules', 'electron', 'cli.js')
const child = spawn(process.execPath, [electronCli, ROOT], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
})
child.once('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 0)
})
