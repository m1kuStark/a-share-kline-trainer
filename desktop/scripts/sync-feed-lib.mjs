// CN-FEED-01（矩阵行 RELEASE-CN-FEED-SYNC）：国内发布目录同步脚本·纯函数层。
// desktop/scripts/sync-feed.mjs 消费；desktop/test/sync-feed-lib.test.ts 锁契约。
// 产出『国内发布目录』（dist-cn-feed/）：latest.yml（url/path 改写为镜像绝对 URL、
// sha512/size 原样）＋UPD HTTP manifest 同形状 JSON（GitHub Releases latest API 字段
// 子集，server/src/update/manifest.ts fetchUpdateManifest 消费契约）＋复制 setup exe/
// blockmap/zip/SHA256SUMS/migrate-v127.zip；产出后自校验 fail-closed。
// 零外部凭证依赖：本脚本不触网不上传（上传动作由 orchestrator 经托管控制台完成）。
// 同步义务：manifest.json 文件名＝server/src/update/manifest.ts cnMirrorManifestUrl；
// latest.yml 文件名＝electron-updater GenericProvider 向镜像 feed URL（desktop/src/cn-feed.ts
// cnMirrorFeedUrl，目录形态 <base>/）请求的 <base>/latest.yml（改名/移位需两处＋本脚本）。
// 注：无 shebang——repo 惯例＝可测代码放无 shebang 的文件（vitest/esbuild 解析约束）。
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { desktopArtifactNames, parseLatestYml } from './release-desktop-lib.mjs'

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
export const CN_FEED_MANIFEST_NAME = 'manifest.json'
export const CN_FEED_OUTPUT_DIR_NAME = 'dist-cn-feed'
const ZIP_CHECKSUMS_NAME = 'SHA256SUMS'

/** 镜像 base 校验：http(s) URL、无查询串/锚点；返回尾斜杠归一值（违约即 throw 不猜） */
export function assertMirrorBase(url) {
  if (typeof url !== 'string' || url.trim() === '') throw new Error('镜像 base URL 不能为空')
  const trimmed = url.trim()
  if (!/^https?:\/\/\S+$/.test(trimmed)) {
    throw new Error(`镜像 base URL 必须是 http(s) URL，收到：${JSON.stringify(url)}`)
  }
  if (/[?#]/.test(trimmed)) {
    throw new Error(`镜像 base URL 不得携带查询串或锚点，收到：${trimmed}`)
  }
  return trimmed.replace(/\/+$/, '')
}

function joinUrl(base, fileName) {
  return `${base}/${fileName}`
}

/** 流式哈希（发布产物可达上百 MB，不整读入内存） */
async function hashFile(path, algorithm) {
  const hash = createHash(algorithm)
  await pipeline(createReadStream(path), hash)
  return hash.digest(algorithm === 'sha512' ? 'base64' : 'hex')
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * releaseNotes 行（MIRROR-URL-FIX v1.3.3 随热修带上，RELEASE-CN-FEED-SYNC 行为增强）：
 * desktop 链「更新内容」区来自 electron-updater UpdateInfo.releaseNotes（generic provider
 * 把 latest.yml 顶层标量透传，desktop/src/update-adapter.ts normalizeReleaseNotes 消费
 * string 形态）；GitHub 源的 notes 来自 Release body，镜像源此前无此字段导致更新内容空。
 * 值＝--notes 参数；无则空串（字段自描述）。单引号 YAML 标量：内部单引号加倍转义、
 * 换行折叠为空格（单引号标量不含裸换行）。
 */
function releaseNotesLine(notes) {
  const folded = String(notes ?? '').replace(/\r?\n/g, ' ')
  return `releaseNotes: '${folded.replace(/'/g, "''")}'`
}

/**
 * latest.yml 镜像改写：`path:` 与 `files[].url:` 值改写为 <base>/<文件名> 绝对 URL；
 * 注入/替换顶层 `releaseNotes:`（见 releaseNotesLine）；其余行（sha512/size/releaseDate 等）
 * 逐字保留（行级改写，不经解析重渲染，杜绝字段丢失）。
 * 先 parseLatestYml 校验输入合法（fail-closed）；已是绝对 URL 的行保持原样（幂等重跑）。
 */
export function rewriteLatestYmlForMirror(text, mirrorBase, notes = '') {
  const base = assertMirrorBase(mirrorBase)
  parseLatestYml(text) // 输入必须是可解析的 latest.yml，否则 throw
  const scalarValue = raw => {
    const value = raw.trim()
    if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
      return value.slice(1, -1)
    }
    return value
  }
  const absolutize = raw => {
    const value = scalarValue(raw)
    if (/^https?:\/\//.test(value)) return value // 已是绝对 URL（幂等）
    return joinUrl(base, value)
  }
  const notesLine = releaseNotesLine(notes)
  let notesEmitted = false
  const lines = text.split(/\r?\n/).map(line => {
    const pathMatch = /^(\s*path:\s*)(.*)$/.exec(line)
    if (pathMatch) return `${pathMatch[1]}${absolutize(pathMatch[2])}`
    const urlMatch = /^(\s*-\s*url:\s*)(.*)$/.exec(line)
    if (urlMatch) return `${urlMatch[1]}${absolutize(urlMatch[2])}`
    if (/^releaseNotes:\s/.test(line)) { // 已有顶层行 → 原位替换（幂等）
      notesEmitted = true
      return notesLine
    }
    return line
  })
  if (!notesEmitted) {
    // 无既有行 → 插到顶层 version: 行之后（parseLatestYml 已保证 version 在，兜底 push 到末尾）
    const versionIndex = lines.findIndex(line => /^version:\s/.test(line))
    if (versionIndex >= 0) lines.splice(versionIndex + 1, 0, notesLine)
    else lines.push(notesLine)
  }
  return lines.join('\n')
}

/**
 * UPD HTTP manifest 同形状 JSON（GitHub Releases latest API 字段子集）：
 * {tag_name:'v<版本>', name, body:发布说明, assets:[{name, browser_download_url, size}]}。
 * assets 按名排序（确定性输出）；consumer＝server/src/update/manifest.ts fetchUpdateManifest
 * （zip 资产按 /^kline-trainer-v…-windows-x64\.zip$/ 精确匹配＋SHA256SUMS 按名）。
 */
export function renderCnManifestJson({ version, notes, mirrorBase, assets }) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`manifest 版本必须三段号，收到 ${JSON.stringify(version)}`)
  const base = assertMirrorBase(mirrorBase)
  if (!Array.isArray(assets) || assets.length === 0) throw new Error('manifest 资产清单不能为空')
  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string' || asset.name.length === 0) throw new Error('manifest 资产缺少文件名')
    if (!Number.isInteger(asset.size) || asset.size < 0) throw new Error(`manifest 资产 ${asset.name} 的 size 必须为非负整数`)
  }
  // 字节序排序（默认 .sort()）：跨环境确定（localeCompare 随 ICU 排序规则漂移）
  const sorted = [...assets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const manifest = {
    tag_name: `v${version}`,
    name: `v${version}`,
    body: typeof notes === 'string' ? notes : '',
    assets: sorted.map(asset => ({ name: asset.name, browser_download_url: joinUrl(base, asset.name), size: asset.size })),
  }
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** 从 latest.yml 解析版本推导全部资产名（版本唯一真相源＝源 latest.yml） */
function cnFeedAssetNames(version) {
  const desktop = desktopArtifactNames(version)
  return {
    setupExe: desktop.setupExe,
    setupBlockmap: desktop.setupBlockmap,
    zip: `kline-trainer-v${version}-windows-x64.zip`,
    checksums: ZIP_CHECKSUMS_NAME,
    latestYml: 'latest.yml',
    manifest: CN_FEED_MANIFEST_NAME,
  }
}

/**
 * 产出国内发布目录（编排）：
 * ① 校验镜像 base＋解析源 latest.yml（版本真相源）→ 资产名；
 * ② fail-closed 必备检查（setup exe/zip/SHA256SUMS；blockmap 存在才纳入；migrate-v127.zip 已随 v1.2.7 迁移退役移除）；
 * ③ 输出目录安全（不存在→建；空或本脚本产物 latest.yml→清空重产；非本脚本产物→拒绝）；
 * ④ 写改写版 latest.yml＋manifest.json＋复制资产；
 * ⑤ 自校验 verifyCnFeedOutput。
 */
export async function runCnFeedSync({ releaseDir, mirrorBase, notes = '', outDir }) {
  const base = assertMirrorBase(mirrorBase)
  const sourceYmlPath = join(releaseDir, 'latest.yml')
  const sourceYmlText = await readFile(sourceYmlPath, 'utf8')
  const parsed = parseLatestYml(sourceYmlText)
  const names = cnFeedAssetNames(parsed.version)

  const required = [names.setupExe, names.zip, names.checksums]
  const optional = [names.setupBlockmap]
  const missing = []
  for (const name of required) {
    if (!(await pathExists(join(releaseDir, name)))) missing.push(name)
  }
  if (missing.length) {
    throw new Error(`发布产物目录缺少必备产物（先完成 release:desktop 与 zip 发布物构建）：${missing.join(', ')}`)
  }
  const copyNames = [...required]
  for (const name of optional) {
    if (await pathExists(join(releaseDir, name))) copyNames.push(name)
  }

  const target = outDir ?? join(dirname(releaseDir.replace(/[\\/]+$/, '')), CN_FEED_OUTPUT_DIR_NAME)
  if (await pathExists(target)) {
    const existing = await readdir(target)
    if (existing.length > 0 && !existing.includes('latest.yml')) {
      throw new Error(`输出目录已存在且非本脚本产物（未见 latest.yml），拒绝执行：${target}`)
    }
    await rm(target, { recursive: true, force: true })
  }
  await mkdir(target, { recursive: true })

  await writeFile(join(target, 'latest.yml'), rewriteLatestYmlForMirror(sourceYmlText, base, notes), 'utf8')
  const assetSizes = []
  for (const name of copyNames) {
    await copyFile(join(releaseDir, name), join(target, name))
    assetSizes.push({ name, size: (await stat(join(target, name))).size })
  }
  await writeFile(join(target, names.manifest), renderCnManifestJson({
    version: parsed.version,
    notes,
    mirrorBase: base,
    assets: assetSizes,
  }), 'utf8')

  await verifyCnFeedOutput({ releaseDir, outDir: target, mirrorBase: base })
  const files = [...copyNames, 'latest.yml', names.manifest].sort()
  return { outDir: target, files, version: parsed.version }
}

/**
 * 产出自校验（fail-closed，任一不符 throw 并指明原因）：
 * - latest.yml 可解析＋path/全部 files url 前缀＝<base>/＋sha512/size 与输出 setup exe 实际字节一致；
 * - manifest.json 可解析＋tag_name 与 latest.yml 版本一致＋zip/SHA256SUMS 资产在位（绝对 URL＋size 与实际字节一致）；
 * - 每个资产文件在位；复制文件 sha256 与源目录一致（校验和与源一致）；
 * - SHA256SUMS 内部一致：zip 行校验和＝输出 zip 实际 sha256。
 */
export async function verifyCnFeedOutput({ releaseDir, outDir, mirrorBase }) {
  const base = assertMirrorBase(mirrorBase)
  const outYmlText = await readFile(join(outDir, 'latest.yml'), 'utf8')
  const parsed = parseLatestYml(outYmlText)
  const names = cnFeedAssetNames(parsed.version)

  if (!parsed.path.startsWith(`${base}/`)) {
    throw new Error(`输出 latest.yml path 未指向镜像前缀 ${base}/：${parsed.path}`)
  }
  // MIRROR-URL-FIX（v1.3.3）：releaseNotes 字段必须在位（desktop 链「更新内容」区消费）
  if (!/^releaseNotes:/m.test(outYmlText)) {
    throw new Error('输出 latest.yml 缺少 releaseNotes 字段（desktop 更新内容展示依赖）')
  }
  for (const file of parsed.files) {
    if (!file.url.startsWith(`${base}/`)) {
      throw new Error(`输出 latest.yml files url 未指向镜像前缀 ${base}/：${file.url}`)
    }
  }
  const setupPath = join(outDir, names.setupExe)
  if (!(await pathExists(setupPath))) throw new Error(`输出目录缺少 setup exe：${names.setupExe}`)
  const setupBytes = await stat(setupPath)
  const setupSha512 = await hashFile(setupPath, 'sha512')
  const setupEntry = parsed.files.find(file => file.url === joinUrl(base, names.setupExe))
  if (!setupEntry) throw new Error(`输出 latest.yml files 未列出 setup exe（${joinUrl(base, names.setupExe)}）`)
  if (setupEntry.sha512 !== setupSha512) {
    throw new Error(`latest.yml sha512 与 ${names.setupExe} 实际字节不一致（文件 ${setupEntry.sha512}，实际 ${setupSha512}）`)
  }
  if (setupEntry.size !== setupBytes.size) {
    throw new Error(`latest.yml size 与 ${names.setupExe} 实际字节不一致（文件 ${setupEntry.size}，实际 ${setupBytes.size}）`)
  }

  const manifestRaw = JSON.parse(await readFile(join(outDir, names.manifest), 'utf8'))
  if (manifestRaw.tag_name !== `v${parsed.version}`) {
    throw new Error(`manifest.json tag_name（${manifestRaw.tag_name}）与 latest.yml 版本（v${parsed.version}）不一致`)
  }
  const assets = Array.isArray(manifestRaw.assets) ? manifestRaw.assets : []
  const zipAsset = assets.find(asset => asset?.name === names.zip)
  if (!zipAsset) throw new Error(`manifest.json 未列出 zip 资产：${names.zip}`)
  if (zipAsset.browser_download_url !== joinUrl(base, names.zip)) {
    throw new Error(`manifest.json zip 资产 URL 未指向镜像：${zipAsset.browser_download_url}`)
  }
  const zipPath = join(outDir, names.zip)
  if (!(await pathExists(zipPath))) throw new Error(`输出目录缺少 zip 资产：${names.zip}`)
  const zipSize = (await stat(zipPath)).size
  if (zipAsset.size !== zipSize) {
    throw new Error(`manifest.json zip size（${zipAsset.size}）与实际字节（${zipSize}）不一致`)
  }
  if (!assets.some(asset => asset?.name === names.checksums)) {
    throw new Error(`manifest.json 未列出校验和资产：${names.checksums}`)
  }
  for (const asset of assets) {
    const assetPath = join(outDir, asset.name)
    if (!(await pathExists(assetPath))) throw new Error(`manifest.json 列出的资产缺失：${asset.name}`)
  }

  // 复制文件与源逐字节一致（校验和与源一致）
  for (const name of [names.setupExe, names.zip, names.checksums, names.setupBlockmap]) {
    const source = join(releaseDir, name)
    if (!(await pathExists(source))) continue
    const sourceHash = await hashFile(source, 'sha256')
    const outHash = await hashFile(join(outDir, name), 'sha256')
    if (sourceHash !== outHash) {
      throw new Error(`复制产物 ${name} 与源目录字节不一致（sha256 源 ${sourceHash}，输出 ${outHash}）`)
    }
  }

  // SHA256SUMS 内部一致：zip 行校验和＝输出 zip 实际 sha256（发布物自洽）
  const sumsText = await readFile(join(outDir, names.checksums), 'utf8')
  const sumsMatch = new RegExp(`^([0-9a-fA-F]{64})[ \t]+\\*?${names.zip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(sumsText)
  if (!sumsMatch) throw new Error(`${names.checksums} 未列出 ${names.zip} 的校验和行`)
  const zipSha256 = await hashFile(zipPath, 'sha256')
  if (sumsMatch[1].toLowerCase() !== zipSha256) {
    throw new Error(`${names.checksums} 的 ${names.zip} 校验和（${sumsMatch[1]}）与实际（${zipSha256}）不一致`)
  }
  return undefined
}
