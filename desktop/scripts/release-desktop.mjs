#!/usr/bin/env node
// PACK-05 发布流水线编排（npm run release:desktop）：
//   镜像 env → 预检 → electron-builder 双目标（nsis＋portable，--publish never 绝不触 GitHub）
//   → fail-closed 核验链（app-update.yml 入包/双 exe 命名/latest.yml 版本+sha512+size/校验和资产名）
//   → SHA256SUMS-desktop.txt → 产物目录打印。
// 可测纯函数在 release-desktop-lib.mjs（desktop/test/release-desktop-lib.test.ts 锁契约）。
// 绝不发布任何 GitHub Release/资产（上传由维护者按 docs/release/desktop-release-manual.md 手动进行）。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  desktopArtifactNames,
  assertChecksumsAssetName,
  renderSha256SumsFile,
  renderLatestYml,
  verifyLatestYml,
  collectChecksumEntries,
} from './release-desktop-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = join(ROOT, 'desktop', 'release')

// 与 package-desktop.mjs 同款国内镜像固化（NSIS 工具链下载走 electron-builder-binaries 镜像）
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

async function main() {
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
    console.error(`[release-desktop] missing build inputs: ${missing.join(', ')}; run npm run build:desktop first`)
    process.exit(1)
  }

  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const version = packageJson.version
  const names = desktopArtifactNames(version)
  assertChecksumsAssetName(names.checksums)

  const builderCli = join(ROOT, 'node_modules', 'electron-builder', 'cli.js')
  const args = ['--config', 'desktop/electron-builder.yml', '--win', 'nsis', 'portable', '--publish', 'never']
  console.log(`[release-desktop] version=${version}`)
  console.log(`[release-desktop] electron-builder ${args.join(' ')}`)
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [builderCli, ...args], { cwd: ROOT, stdio: 'inherit', env: process.env })
    child.once('exit', (exitCode, signal) => resolve(signal ? 1 : (exitCode ?? 0)))
  })
  if (code !== 0) {
    console.error(`[release-desktop] electron-builder failed (exit ${code})`)
    process.exit(code || 1)
  }

  // ===== fail-closed 核验链（任一失败即判发布失败，绝不产出不完整资产集） =====

  // ① PACK-04 回退方案：resources/app-update.yml 必须入包（downloadUpdate 硬依赖）
  const appUpdateYml = join(ROOT, 'desktop', 'release', 'win-unpacked', 'resources', 'app-update.yml')
  if (!(await exists(appUpdateYml))) {
    console.error('[release-desktop] FAIL: resources/app-update.yml missing from the package (electron-updater hard dependency)')
    process.exit(1)
  }
  console.log('[release-desktop] app-update.yml embedded (electron-updater feed config present)')

  // ② latest.yml：electron-builder 产出则核验后采用；未产出则按同一形状显式生成（双路径同一核验）
  const latestPath = join(OUT_DIR, names.latestYml)
  const setupPath = join(OUT_DIR, names.setupExe)
  const setupBytes = await readFile(setupPath).catch(() => null)
  if (setupBytes === null) {
    console.error(`[release-desktop] FAIL: NSIS setup exe missing: ${names.setupExe}`)
    process.exit(1)
  }
  if (await exists(latestPath)) {
    await verifyLatestYml({
      text: await readFile(latestPath, 'utf8'),
      expectedVersion: version,
      expectedFileName: names.setupExe,
      fileBytes: setupBytes,
    })
    console.log('[release-desktop] latest.yml produced by electron-builder and verified against the setup exe bytes')
  } else {
    await writeFile(latestPath, renderLatestYml({
      version,
      fileName: names.setupExe,
      sha512Base64: createHash('sha512').update(setupBytes).digest('base64'),
      size: setupBytes.length,
      releaseDate: new Date().toISOString(),
    }), 'utf8')
    await verifyLatestYml({
      text: await readFile(latestPath, 'utf8'),
      expectedVersion: version,
      expectedFileName: names.setupExe,
      fileBytes: setupBytes,
    })
    console.log('[release-desktop] latest.yml generated explicitly (electron-builder did not emit it) and verified')
  }

  // ③ 产物清单完整性＋校验和（覆盖全部 desktop 产物；行格式同 zip 流水线）
  const fsAdapter = {
    exists: async name => exists(join(OUT_DIR, name)),
    readFile: async name => readFile(join(OUT_DIR, name)),
  }
  const entries = await collectChecksumEntries({ version, fs: fsAdapter })
  const sumsPath = join(OUT_DIR, names.checksums)
  await writeFile(sumsPath, renderSha256SumsFile(entries), 'utf8')

  // ===== 产物目录打印（名称＋体积＋sha256 前缀） =====
  console.log('\n[release-desktop] artifacts:')
  for (const entry of entries) {
    console.log(`  ${entry.name}  ${(entry.size / 1024 / 1024).toFixed(1)} MB  sha256:${entry.sha256Hex.slice(0, 12)}…`)
  }
  console.log(`  ${names.checksums}  written (covers all desktop artifacts above)`)
  console.log(`\n[release-desktop] output dir: ${OUT_DIR}`)
  console.log('[release-desktop] publishing steps: see docs/release/desktop-release-manual.md (manual GitHub Release upload; latest.yml must be uploaded with its exact name)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`[release-desktop] ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
