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
// PORT-UPD-01 追加（INSTALL-01 后仅存 migrate 部分）：migrate-v127.zip（tools/migrate-v127/dist
//   打包，纯 Node STORE 型 zip 写入器，零新依赖）——v1.2.7 数据迁入唯一入口，不动。
// 可测纯函数在 release-desktop-lib.mjs（desktop/test/release-desktop-lib.test.ts 锁契约）；
// 本文件导出（buildStoredZip/collectMigrateZipEntries）由 desktop/test/portable-updater-release.test.ts
// 锁定，编排形态由同文件 INSTALL-01 源码契约锁定。
// 绝不发布任何 GitHub Release/资产（上传由维护者按 docs/release/desktop-release-manual.md 手动进行）。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  desktopArtifactNames,
  assertChecksumsAssetName,
  renderSha256SumsFile,
  renderReleaseManifest,
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

// ===== PORT-UPD-01：migrate-v127.zip 纯 Node STORE 型 zip 写入器（零新依赖） =====

const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function zipCrc32(data) {
  let crc = 0xFFFFFFFF
  for (const byte of data) crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function assertZipEntryName(name) {
  if (typeof name !== 'string' || name.length === 0) throw new Error(`zip 条目名为空`)
  if (name.includes('\\')) throw new Error(`不安全的 zip 条目（反斜杠分隔）：${name}`)
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name)) throw new Error(`不安全的 zip 条目（绝对路径）：${name}`)
  const segments = name.split('/')
  if (segments.some(segment => segment === '..' || segment === '')) {
    throw new Error(`不安全的 zip 条目（路径遍历或空段）：${name}`)
  }
  return name
}

/**
 * STORE（无压缩）zip 构建：local header + 数据 + central directory + EOCD，UTF-8 名称位，
 * 固定 DOS 时间戳（1980-01-01）保证可复现。写入器正确性由 server UPD-01 zip 读取器
 * （listZipEntries/readZipEntry，强制 CRC 校验）在测试中独立验证。
 */
export function buildStoredZip(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('zip 条目不能为空')
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    assertZipEntryName(entry?.name)
    if (!Buffer.isBuffer(entry.data)) throw new Error(`zip 条目 ${entry.name} 的 data 不是 Buffer`)
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const crc = zipCrc32(entry.data)
    const size = entry.data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)      // version needed
    local.writeUInt16LE(0x0800, 6)  // general purpose flags: UTF-8 名称
    local.writeUInt16LE(0, 8)       // method: store
    local.writeUInt16LE(0, 10)      // mod time
    local.writeUInt16LE(0x21, 12)   // mod date: 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)   // compressed size
    local.writeUInt32LE(size, 22)   // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)      // extra length
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)    // version made by
    central.writeUInt16LE(20, 6)    // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(size, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)    // extra length
    central.writeUInt16LE(0, 32)    // comment length
    central.writeUInt16LE(0, 34)    // disk number start
    central.writeUInt16LE(0, 36)    // internal attributes
    central.writeUInt32LE(0, 38)    // external attributes
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, entry.data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + size
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)    // central directory 起始偏移
  eocd.writeUInt16LE(0, 20)         // comment length
  return Buffer.concat([...locals, centralBuf, eocd])
}

/** 收集迁移工具 dist 树为 zip 条目（migrate-v127/<相对路径>，正斜杠，按名排序）；空目录 fail-closed */
export async function collectMigrateZipEntries(distDir) {
  const files = []
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await walk(distDir)
  if (files.length === 0) throw new Error(`迁移工具目录为空：${distDir}（先运行 node tools/migrate-v127/build.mjs）`)
  const entries = []
  for (const file of files) {
    const rel = relative(distDir, file).split(sep).join('/')
    entries.push({ name: `migrate-v127/${rel}`, data: await readFile(file) })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return entries
}

async function main() {
  const REQUIRED = [
    'desktop/dist/main.js',
    'desktop/dist/preload.cjs',
    'server/dist/index.js',
    'web/dist/index.html',
    // PORT-UPD-01：migrate-v127.zip 的输入（构建命令：node tools/migrate-v127/build.mjs）
    'tools/migrate-v127/dist/migrate-v127/export-v127.cjs',
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

  // ② c PORT-UPD-01（P3）：migrate-v127.zip——tools/migrate-v127/dist 打包，供 Release 附带
  const migrateDist = join(ROOT, 'tools', 'migrate-v127', 'dist', 'migrate-v127')
  const migrateEntries = await collectMigrateZipEntries(migrateDist)
  await mkdir(OUT_DIR, { recursive: true })
  const migrateZipPath = join(OUT_DIR, 'migrate-v127.zip')
  await writeFile(migrateZipPath, buildStoredZip(migrateEntries))
  console.log(`[release-desktop] migrate-v127.zip written (${migrateEntries.length} entries, stored zip)`)

  // ③ 产物清单完整性＋校验和（覆盖全部 desktop 产物；行格式同 zip 流水线；含 PORT-UPD-01 migrate zip）
  const fsAdapter = {
    exists: async name => exists(join(OUT_DIR, name)),
    readFile: async name => readFile(join(OUT_DIR, name)),
  }
  const entries = await collectChecksumEntries({ version, fs: fsAdapter })
  // PORT-UPD-01：migrate-v127.zip 纳入校验和清单（lib 的 collectChecksumEntries 不含它，此处追加）
  const migrateZipBytes = await readFile(migrateZipPath)
  entries.push({ name: 'migrate-v127.zip', sha256Hex: createHash('sha256').update(migrateZipBytes).digest('hex'), size: migrateZipBytes.length })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  const sumsPath = join(OUT_DIR, names.checksums)
  const sumsBytes = Buffer.from(renderSha256SumsFile(entries), 'utf8')
  await writeFile(sumsPath, sumsBytes)

  // ===== GAP2-RELCHECK：release-manifest.json（上传后核对的对表基准） =====
  // 覆盖全部上传资产（校验和文件本身也是上传资产之一，一并列入；清单自身除外）。
  const manifestText = renderReleaseManifest({
    version,
    entries: [...entries, { name: names.checksums, size: sumsBytes.length, sha256Hex: createHash('sha256').update(sumsBytes).digest('hex') }],
    generatedAt: new Date().toISOString(),
  })
  await writeFile(join(OUT_DIR, 'release-manifest.json'), manifestText, 'utf8')

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
