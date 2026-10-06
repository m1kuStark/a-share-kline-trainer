#!/usr/bin/env node
// PACK-01 便携 exe 打包编排（npm run build:desktop 的最后一棒）。
// 职责：①固化国内镜像 env（ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR——
// 写进脚本而非临时环境，可重复构建）；②打包前 preflight（三产物齐备才进 electron-builder）；
// ③调用 electron-builder（config＝desktop/electron-builder.yml，win portable 目标，
// NSIS 安装器留 PACK-05）。
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||= 'https://npmmirror.com/mirrors/electron-builder-binaries/'

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const REQUIRED = [
  'desktop/dist/main.js',
  'desktop/dist/preload.cjs',
  'server/dist/index.js',
  'web/dist/index.html',
]
const missing = []
for (const path of REQUIRED) {
  if (!(await exists(join(ROOT, path)))) missing.push(path)
}
if (missing.length) {
  console.error(`[package-desktop] missing build inputs: ${missing.join(', ')}; run the earlier build:desktop steps first`)
  process.exit(1)
}

const builderCli = join(ROOT, 'node_modules', 'electron-builder', 'cli.js')
const args = ['--config', 'desktop/electron-builder.yml', '--win', 'portable', '--publish', 'never']
console.log(`[package-desktop] electron-builder ${args.join(' ')}`)
const child = spawn(process.execPath, [builderCli, ...args], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
})
child.once('exit', async (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 0)
  // PACK-04 构建后实证（fail-closed）：resources/app-update.yml 必须入包——electron-updater
  // downloadUpdate 的硬依赖（getOrCreateDownloadHelper 读 updaterCacheDirName；实测无 publish
  // 配置时 v26.15.3 --publish never 不产出该文件）。publish 配置负责产出，此处缺即判构建失败。
  const APP_UPDATE_YML = join(ROOT, 'desktop', 'release', 'win-unpacked', 'resources', 'app-update.yml')
  if (process.exitCode === 0 && !(await exists(APP_UPDATE_YML))) {
    console.error('[package-desktop] FAIL: resources/app-update.yml missing from the package (electron-updater hard dependency); check the publish section of desktop/electron-builder.yml')
    process.exitCode = 1
  } else if (process.exitCode === 0) {
    console.log('[package-desktop] app-update.yml embedded (electron-updater feed config present)')
  }
})
