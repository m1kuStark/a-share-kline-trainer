// 注：无 shebang——本脚本仅经 `npm run release:desktop`（node desktop/scripts/release-desktop.mjs）
// 调用；且 desktop/test/portable-updater-release.test.ts 直接 import 本文件的导出，
// shebang 会使 vitest（esbuild）解析报 Invalid token（repo 惯例＝可测代码放无 shebang 的文件）。
// PACK-05＋INSTALL-01 发布流水线编排（npm run release:desktop）：
//   镜像 env → 预检 → electron-builder 单目标（nsis，--publish never 绝不触 GitHub；
//   portable 目标已随 INSTALL-01 退役——v1.3.0 发布形态仅 NSIS 向导式安装包，2026-10-11
//   用户拍板，矩阵行 INSTALL-NSIS-ASSISTED；latest.yml 不再追加便携条目——原便携条目
//   扩展函数已删除，存量便携 exe 检查更新将 fail-closed 拒装、提示改走安装器，符合拍板）
//   → fail-closed 核验链（app-update.yml 入包/setup exe 命名/latest.yml 版本+sha512+size/
//     陈旧便携产物不得混入/校验和资产名）
//   → SHA256SUMS-desktop.txt → 产物目录打印。
// UIUX-release（2026-10-16 用户拍板 v1.2.7 弃用）：PORT-UPD-01 的 （已退役产物） 产物与其
// zip 写入器/目录收集器整体退役移除（迁移工具目录已删除，详见 CHANGELOG 第六轮条目）。
// 可测纯函数在 release-desktop-lib.mjs（desktop/test/release-desktop-lib.test.ts 锁契约）；
// 编排形态由 portable-updater-release.test.ts 的 INSTALL-01 源码契约锁定。
// 绝不发布任何 GitHub Release/资产（上传由维护者按 docs/release/desktop-release-manual.md 手动进行）。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  desktopArtifactNames,
  assertChecksumsAssetName,
  renderSha256SumsFile,
  renderLatestYml,
  verifyLatestYml,
  collectChecksumEntries,
  findStaleBuildInputs,
} from './release-desktop-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// TRAINER_RELEASE_OUT_DIR（相对 ROOT）：可选输出目录覆盖——默认 desktop/release。
// 用途：默认目录被句柄占用（残留进程 cwd/杀毒扫描）时绕开锁定继续发布（2026-10-11
// win-unpacked EBUSY 实例）；产物目录只是落点，latest.yml/sha 校验逻辑相对 OUT_DIR 不变。
const OUT_DIR = process.env.TRAINER_RELEASE_OUT_DIR?.trim()
  ? join(ROOT, process.env.TRAINER_RELEASE_OUT_DIR.trim())
  : join(ROOT, 'desktop', 'release')

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

  // RELEASE-DIST-STALENESS（2026-10-17 用户验收实证）：existence 拦不住陈旧 dist——
  // 旧构建静默入包，装机后 UI 改动"未生效"。任一域 source 新于 dist 即 fail-closed 拒打包。
  const stale = await findStaleBuildInputs([
    { name: 'web/dist（web/src 有更新）', sourceDir: join(ROOT, 'web', 'src'), artifactDir: join(ROOT, 'web', 'dist') },
    { name: 'server/dist（server/src 有更新）', sourceDir: join(ROOT, 'server', 'src'), artifactDir: join(ROOT, 'server', 'dist') },
    { name: 'desktop/dist（desktop/src 有更新）', sourceDir: join(ROOT, 'desktop', 'src'), artifactDir: join(ROOT, 'desktop', 'dist') },
  ])
  if (stale.length) {
    console.error(`[release-desktop] FAIL: stale build inputs: ${stale.join(', ')}; rerun the corresponding build (npm run build:web / build:server / build:desktop:main) before packaging`)
    process.exit(1)
  }

  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const version = packageJson.version
  const names = desktopArtifactNames(version)
  assertChecksumsAssetName(names.checksums)

  const builderCli = join(ROOT, 'node_modules', 'electron-builder', 'cli.js')
  const args = ['--config', 'desktop/electron-builder.yml', '--win', 'nsis', '--publish', 'never']
  if (process.env.TRAINER_RELEASE_OUT_DIR?.trim()) args.push('--config.directories.output=' + process.env.TRAINER_RELEASE_OUT_DIR.trim())
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
  // 路径跟随 OUT_DIR（TRAINER_RELEASE_OUT_DIR 覆盖时核验同一输出目录，不回看默认目录）
  const appUpdateYml = join(OUT_DIR, 'win-unpacked', 'resources', 'app-update.yml')
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

  // ② b INSTALL-01：便携产物退役——不再读取/核验便携 exe、不再给 latest.yml 追加便携条目。
  //     fail-closed 反向门：输出目录残留同名便携产物（早期双目标运行的遗留）即判发布失败，
  //     绝不让无清单覆盖的陈旧便携 exe 混在产物目录里冒充本版发布资产。
  const stalePortablePath = join(OUT_DIR, names.portableExe)
  if (await exists(stalePortablePath)) {
    console.error(`[release-desktop] FAIL: stale portable artifact present: ${names.portableExe} (portable target retired by INSTALL-01; delete it from the output dir and re-run)`)
    process.exit(1)
  }

  // UIUX-release 2026-10-16：（已退役产物） 产物随 v1.2.7 迁移能力退役移除
  // （用户拍板 v1.2.7 弃用；迁移工具目录与 zip 写入器一并下线）。

  // ③ 产物清单完整性＋校验和（覆盖全部 desktop 产物；行格式同 zip 流水线）
  const fsAdapter = {
    exists: async name => exists(join(OUT_DIR, name)),
    readFile: async name => readFile(join(OUT_DIR, name)),
  }
  const entries = await collectChecksumEntries({ version, fs: fsAdapter })
  entries.sort((a, b) => a.name.localeCompare(b.name))
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
