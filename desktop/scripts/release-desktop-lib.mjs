// PACK-05 发布流水线纯函数层（desktop/scripts/release-desktop.mjs 消费；desktop/test/release-desktop-lib.test.ts 锁契约）。
// 产物命名契约／校验和文件格式（与 zip 流水线 scripts/release/build.mjs 同行格式）／
// latest.yml 生成与核验（electron-updater generic provider 最小形状，PACK-04 design §1.2-7）／
// 产物清单完整性（fail-closed：缺任一必备产物即 throw，绝不产出不完整资产集）。
// 注意：desktop 校验和资产名必须为 SHA256SUMS-desktop.txt——UPD-01 zip 更新器按精确名
// 'SHA256SUMS' 取资产且未列出 zip 行即拒绝应用（server/src/update/manifest.ts:136＋api.ts:86），
// 双形态同 Release 共存必须异名（assertChecksumsAssetName 锁死）。
import { createHash } from 'node:crypto'

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const CHECKSUMS_ASSET_NAME = 'SHA256SUMS-desktop.txt'

/** 产物命名契约（派发简报设计决策 1；版本必须三段号，违约即 throw 不猜） */
export function desktopArtifactNames(version) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`版本号必须是三段号（X.Y.Z），收到：${JSON.stringify(version)}`)
  }
  return {
    portableExe: `kline-trainer-desktop-v${version}-windows-x64.exe`,
    setupExe: `kline-trainer-desktop-setup-v${version}-windows-x64.exe`,
    setupBlockmap: `kline-trainer-desktop-setup-v${version}-windows-x64.exe.blockmap`,
    latestYml: 'latest.yml',
    checksums: CHECKSUMS_ASSET_NAME,
  }
}

/** 校验和资产名门：与 UPD-01 精确名资产 SHA256SUMS 冲突即 throw（双形态同 Release 共存约束） */
export function assertChecksumsAssetName(name) {
  if (name !== CHECKSUMS_ASSET_NAME) {
    throw new Error(
      `desktop 校验和资产名必须是 ${CHECKSUMS_ASSET_NAME}（收到 ${JSON.stringify(name)}）；`
      + ` 不得叫 SHA256SUMS——UPD-01 zip 更新器按该精确名取资产，desktop 清单会令 zip 校验失败拒装`,
    )
  }
  return true
}

/** 校验和文件内容：`<64 位小写 hex>  <文件名>\n` 逐行（与 zip 流水线 build.mjs 同行格式），按文件名排序保证确定性 */
export function renderSha256SumsFile(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('校验和清单不能为空')
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || entry.name.length === 0) throw new Error('校验和条目缺少文件名')
    if (typeof entry.sha256Hex !== 'string' || !SHA256_HEX_PATTERN.test(entry.sha256Hex)) {
      throw new Error(`校验和条目 ${entry.name} 的 sha256 不是 64 位小写十六进制`)
    }
  }
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
  return sorted.map(entry => `${entry.sha256Hex}  ${entry.name}\n`).join('')
}

/** latest.yml 生成：electron-updater generic provider 最小形状（PACK-04 冒烟 fixture＋真实 NsisUpdater 已证可解析） */
export function renderLatestYml({ version, fileName, sha512Base64, size, releaseDate }) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`latest.yml 版本必须三段号，收到 ${JSON.stringify(version)}`)
  if (typeof fileName !== 'string' || fileName.length === 0) throw new Error('latest.yml 缺少产物文件名')
  if (typeof sha512Base64 !== 'string' || sha512Base64.length === 0) throw new Error('latest.yml 缺少 sha512')
  if (!Number.isInteger(size) || size < 0) throw new Error('latest.yml size 必须为非负整数')
  if (typeof releaseDate !== 'string' || releaseDate.length === 0) throw new Error('latest.yml 缺少 releaseDate')
  return [
    `version: ${version}`,
    `path: ${fileName}`,
    `sha512: ${sha512Base64}`,
    `releaseDate: '${releaseDate}'`,
    'files:',
    `  - url: ${fileName}`,
    `    sha512: ${sha512Base64}`,
    `    size: ${size}`,
    '',
  ].join('\n')
}

function parseScalar(raw) {
  const value = raw.trim()
  if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * latest.yml 最小 fail-closed 解析器（只认我们生成与 electron-builder 产出的形状；
 * 缺 version/path/sha512/files 任一必需项即 throw，不做部分解读）。
 */
export function parseLatestYml(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('latest.yml 为空')
  const scalar = /^([A-Za-z0-9_]+):\s*(.*)$/
  let version = null
  let path = null
  let sha512 = null
  const files = []
  let currentFile = null
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (line.startsWith('  - ')) {
      const match = scalar.exec(line.slice(4))
      if (match && match[1] === 'url') {
        if (currentFile) files.push(currentFile)
        currentFile = { url: parseScalar(match[2]) }
      }
      continue
    }
    if (line.startsWith('    ')) {
      const match = scalar.exec(line.trim())
      if (match && currentFile) {
        if (match[1] === 'sha512') currentFile.sha512 = parseScalar(match[2])
        if (match[1] === 'size') {
          const size = Number(parseScalar(match[2]))
          if (!Number.isInteger(size) || size < 0) throw new Error(`latest.yml files size 非法：${match[2]}`)
          currentFile.size = size
        }
      }
      continue
    }
    const match = scalar.exec(line)
    if (!match) continue
    if (match[1] === 'version') version = parseScalar(match[2])
    if (match[1] === 'path') path = parseScalar(match[2])
    if (match[1] === 'sha512') sha512 = parseScalar(match[2])
  }
  if (currentFile) files.push(currentFile)
  const problems = []
  if (version === null) problems.push('version')
  if (path === null) problems.push('path')
  if (sha512 === null) problems.push('顶层 sha512')
  if (files.length === 0) problems.push('files')
  for (const file of files) {
    if (!file.url || !file.sha512 || !Number.isInteger(file.size)) {
      problems.push(`files 条目缺 url/sha512/size（${file.url ?? '(匿名)'}）`)
    }
  }
  if (problems.length) throw new Error(`latest.yml 缺少必需字段：${problems.join('、')}`)
  return { version, path, sha512, files }
}

/**
 * latest.yml 对实际产物字节的核验（fail-closed）：版本=发布版本、文件项含目标产物、
 * sha512（base64）与 size 与实际字节一致；任一不符 throw 并指明原因。
 */
export async function verifyLatestYml({ text, expectedVersion, expectedFileName, fileBytes }) {
  const parsed = parseLatestYml(text)
  if (parsed.version !== expectedVersion) {
    throw new Error(`latest.yml 版本不一致：文件 ${parsed.version}，发布 ${expectedVersion}`)
  }
  const entry = parsed.files.find(file => file.url === expectedFileName)
  if (!entry) {
    throw new Error(`latest.yml files 未列出目标产物 ${expectedFileName}（列出：${parsed.files.map(file => file.url).join(', ')}）`)
  }
  const actualSha512 = createHash('sha512').update(fileBytes).digest('base64')
  if (entry.sha512 !== actualSha512) {
    throw new Error(`latest.yml sha512 与 ${expectedFileName} 实际字节不一致（文件 ${entry.sha512}，实际 ${actualSha512}）`)
  }
  if (entry.size !== fileBytes.length) {
    throw new Error(`latest.yml size 与 ${expectedFileName} 实际字节不一致（文件 ${entry.size}，实际 ${fileBytes.length}）`)
  }
  return undefined
}

/**
 * 产物清单完整性＋校验和条目收集：必备项（portable exe＋setup exe＋latest.yml）缺任一即
 * throw（携带缺失名清单）；blockmap 存在才纳入。fs 注入（{ exists, readFile }）供测试替身。
 */
export async function collectChecksumEntries({ version, fs }) {
  const names = desktopArtifactNames(version)
  const required = [names.portableExe, names.setupExe, names.latestYml]
  const optional = [names.setupBlockmap]
  const missing = []
  for (const name of required) {
    if (!(await fs.exists(name))) missing.push(name)
  }
  if (missing.length) {
    throw new Error(`发布产物缺失（先确认 electron-builder 双目标构建成功）：${missing.join(', ')}`)
  }
  const all = [...required]
  for (const name of optional) {
    if (await fs.exists(name)) all.push(name)
  }
  const entries = []
  for (const name of all) {
    const bytes = await fs.readFile(name)
    entries.push({ name, sha256Hex: createHash('sha256').update(bytes).digest('hex'), size: bytes.length })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return entries
}
