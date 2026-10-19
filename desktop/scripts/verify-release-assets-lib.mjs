// GAP2-RELCHECK（2026-10-19 复盘缺口 G2）：发布后双源核对·纯逻辑层。
// desktop/scripts/verify-release-assets.mjs 消费；desktop/test/verify-release-assets.test.ts
// 以注入 fetch 的 fixture 锁契约（零网络零凭证）。
// 背景：v1.3.1 人工上传曾误删资产、v1.3.0 曾长期 draft——上传后缺一道机器核对闸。
// 期望资产集推导（对表基准，全部来自该 Release 自身声明）：SHA256SUMS-desktop.txt 内容
// ＋SHA256SUMS（zip 链，存在才计）内容＋latest.yml files/path 条目＋setup exe（tag 推导命名
// 契约）＋migrate-v127.zip＋元数据资产自身；数量阈值 --min-assets 可参数化（缺省＝期望集大小）。
// fail-closed：任一不符即缺陷（exit 1 由 CLI 壳决定）；镜像段例外＝常量空串/网络不可达→
// 如实降级 skipped＋原因（任务指令），但镜像可达而 feed 坏（404/解析失败）＝缺陷不放过。
// 注：无 shebang——repo 惯例＝可测代码放无 shebang 的文件（vitest/esbuild 解析约束）。
import { createHash } from 'node:crypto'
import { desktopArtifactNames, parseLatestYml } from './release-desktop-lib.mjs'

export const VERIFY_REPO = 'm1kuStark/a-share-kline-trainer'
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/
const SUMS_LINE_PATTERN = /^([0-9a-f]{64})[ \t]+\*?(\S+)$/
const SHA512_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

const basename = url => String(url).split('/').pop()

/** sha512 合法性：base64 字符集且解码恰为 64 字节（sha512 定长） */
function isValidSha512Base64(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (!SHA512_BASE64_PATTERN.test(value)) return false
  return Buffer.from(value, 'base64').length === 64
}

/**
 * CLI 参数解析（fail-closed）：--tag vX.Y.Z 必填；--expect-latest / --deep 布尔开关；
 * --min-assets N 可选数量阈值（非负整数；缺省＝期望集大小）。未知参数即 throw 不猜。
 */
export function parseVerifyArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('parseVerifyArgs 需要 argv 数组')
  const parsed = { tag: null, expectLatest: false, deep: false, minAssets: null }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--tag') {
      parsed.tag = argv[++index]
    } else if (arg === '--expect-latest') {
      parsed.expectLatest = true
    } else if (arg === '--deep') {
      parsed.deep = true
    } else if (arg === '--min-assets') {
      const raw = argv[++index]
      const value = Number(raw)
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`--min-assets 需要非负整数，收到：${JSON.stringify(raw)}`)
      }
      parsed.minAssets = value
    } else {
      throw new Error(`未知参数：${arg}（用法：--tag vX.Y.Z [--expect-latest] [--deep] [--min-assets N]）`)
    }
  }
  if (typeof parsed.tag !== 'string' || !TAG_PATTERN.test(parsed.tag)) {
    throw new Error(`--tag 必须是 vX.Y.Z 形态（如 v1.3.0），收到：${JSON.stringify(parsed.tag)}`)
  }
  return parsed
}

/**
 * 校验和文本解析（desktop 与 zip 流水线同格式：`<64位小写hex>  <文件名>` 逐行；
 * 容忍 GNU sha256sum -b 的 `<hex> *<name>` 星号形态；空行跳过；任一行非法即 throw）。
 */
export function parseSha256SumsText(text) {
  if (typeof text !== 'string') throw new Error('校验和内容必须是字符串')
  const entries = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    const match = SUMS_LINE_PATTERN.exec(line)
    if (!match) throw new Error(`校验和行格式非法（期望 \`${'<64位hex>'.padEnd(0)}  <文件名>\`）：${line}`)
    entries.push({ name: match[2], sha256Hex: match[1] })
  }
  if (entries.length === 0) throw new Error('校验和文件为空')
  return entries
}

/**
 * 发布后双源核对主逻辑（全注入：fetchJson/fetchText/fetchBytes 由调用方提供，
 * 测试注入 fixture、CLI 注入真实 fetch——绝不携带任何凭证）。
 * 返回 { ok, defects: [{code, detail}], lines, summary }；ok＝defects 为空。
 * 网络错误分类：GitHub 源拉不到＝缺陷（无法核实即不放过）；镜像源网络错误＝skipped＋原因
 * （任务指令的降级口径），镜像可达但 feed 文件缺失/损坏＝缺陷。
 */
export async function verifyReleaseAssets({
  tag,
  expectLatest = false,
  deep = false,
  minAssets = null,
  repo = VERIFY_REPO,
  githubApiBase = 'https://api.github.com',
  mirrorBase = '',
  fetchJson,
  fetchText,
  fetchBytes,
}) {
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) {
    throw new Error(`tag 必须是 vX.Y.Z 形态，收到：${JSON.stringify(tag)}`)
  }
  if (typeof fetchJson !== 'function') throw new Error('verifyReleaseAssets 需要 fetchJson 注入')
  if (typeof fetchText !== 'function') throw new Error('verifyReleaseAssets 需要 fetchText 注入')
  if (deep && typeof fetchBytes !== 'function') throw new Error('--deep 需要 fetchBytes 注入')

  const version = tag.slice(1)
  const defects = []
  const lines = []
  const summary = { assetCount: null, expectedCount: null, prerelease: null, draft: null, mirrorStatus: 'disabled', mirrorReason: null }
  const pushDefect = (code, detail) => defects.push({ code, detail })
  const baseUrl = `${githubApiBase.replace(/\/+$/, '')}/repos/${repo}/releases`

  lines.push(`repo=${repo} tag=${tag}${expectLatest ? '（--expect-latest）' : ''}${deep ? '（--deep 字节级）' : ''}`)

  // ① 按 tag 拉 Release（匿名只读）
  let release = null
  try {
    const { status, json } = await fetchJson(`${baseUrl}/tags/${tag}`)
    if (status === 404) {
      pushDefect('release-missing', `GitHub Release ${tag} 不存在（untagged/未发布/被误删）`)
    } else if (status !== 200) {
      pushDefect('release-fetch', `拉取 ${tag} Release 失败：HTTP ${status}${json?.message ? `（${json.message}）` : ''}`)
    } else if (json && typeof json === 'object') {
      release = json
    } else {
      pushDefect('release-fetch', `拉取 ${tag} Release 返回非对象载荷`)
    }
  } catch (error) {
    pushDefect('release-fetch', `拉取 ${tag} Release 网络错误：${messageOf(error)}`)
  }

  let assets = []
  if (release) {
    if (release.tag_name !== tag) {
      pushDefect('tag-mismatch', `Release.tag_name=${JSON.stringify(release.tag_name)} 与请求 tag=${tag} 不一致`)
    }
    summary.draft = release.draft === true
    summary.prerelease = release.prerelease === true
    lines.push(`release: draft=${summary.draft} prerelease=${summary.prerelease}`)
    if (summary.draft) {
      lines.push('警告: 该 Release 仍为 draft（对外不可见，electron-updater 的 /releases/latest 取不到它）')
    }
    assets = Array.isArray(release.assets) ? release.assets : []
    summary.assetCount = assets.length
  }
  const assetByName = new Map(assets.map(asset => [asset?.name, asset]))

  // ② latest.yml：版本/文件名/size 与实际一致、sha512 合法 base64（--deep 才下字节）
  let latestParsed = null
  const latestYmlAsset = assetByName.get('latest.yml')
  if (!latestYmlAsset) {
    pushDefect('asset-missing', 'latest.yml（更新源元数据资产）缺失于 Release')
    pushDefect('latest-yml-missing', 'Release 缺少 latest.yml 资产，无法核验更新源元数据')
  } else {
    try {
      const { status, text } = await fetchText(latestYmlAsset.browser_download_url)
      if (status !== 200) {
        pushDefect('latest-yml-missing', `下载 latest.yml 资产失败：HTTP ${status}`)
      } else {
        try {
          latestParsed = parseLatestYml(text)
        } catch (error) {
          pushDefect('latest-yml-invalid', `latest.yml 解析失败：${messageOf(error)}`)
        }
      }
    } catch (error) {
      pushDefect('latest-yml-missing', `下载 latest.yml 资产网络错误：${messageOf(error)}`)
    }
  }
  if (latestParsed) {
    if (latestParsed.version !== version) {
      pushDefect('latest-yml-version', `latest.yml version=${latestParsed.version} 与 tag 推导版本 ${version} 不一致`)
    } else {
      lines.push(`latest.yml: version=${latestParsed.version} 与 tag 一致`)
    }
    if (!isValidSha512Base64(latestParsed.sha512)) {
      pushDefect('latest-yml-sha512', `latest.yml 顶层 sha512 不是合法 base64（解码须为 64 字节）：${latestParsed.sha512}`)
    }
    for (const file of latestParsed.files) {
      if (!isValidSha512Base64(file.sha512)) {
        pushDefect('latest-yml-sha512', `latest.yml files[${file.url}].sha512 不是合法 base64（解码须为 64 字节）`)
      }
      const name = basename(file.url)
      const asset = assetByName.get(name)
      if (!asset) {
        pushDefect('asset-missing', `${name}（latest.yml files 列出）缺失于 Release`)
        continue
      }
      if (Number.isInteger(file.size) && asset.size !== file.size) {
        pushDefect('latest-yml-size', `latest.yml files[${name}] size=${file.size} 与 Release 资产 size=${asset.size} 不一致`)
      }
    }
  }

  // ③ 校验和资产（desktop 必备；zip 链 SHA256SUMS 存在才核对）——列出的资产逐条对表
  const sumsReferences = []
  const desktopSumsAsset = assetByName.get('SHA256SUMS-desktop.txt')
  if (!desktopSumsAsset) {
    pushDefect('asset-missing', 'SHA256SUMS-desktop.txt（desktop 校验和资产）缺失于 Release')
    pushDefect('checksums-missing', 'Release 缺少 SHA256SUMS-desktop.txt，无法核验 desktop 产物校验和')
  } else {
    try {
      const { status, text } = await fetchText(desktopSumsAsset.browser_download_url)
      if (status !== 200) {
        pushDefect('checksums-missing', `下载 SHA256SUMS-desktop.txt 失败：HTTP ${status}`)
      } else {
        try {
          const entries = parseSha256SumsText(text)
          lines.push(`SHA256SUMS-desktop.txt: ${entries.length} 条校验和，逐条对表 Release 资产`)
          for (const entry of entries) sumsReferences.push({ ...entry, from: 'SHA256SUMS-desktop.txt' })
        } catch (error) {
          pushDefect('checksums-invalid', `SHA256SUMS-desktop.txt 解析失败：${messageOf(error)}`)
        }
      }
    } catch (error) {
      pushDefect('checksums-missing', `下载 SHA256SUMS-desktop.txt 网络错误：${messageOf(error)}`)
    }
  }

  let zipSumsPresent = false
  const zipSumsAsset = assetByName.get('SHA256SUMS')
  if (zipSumsAsset) {
    zipSumsPresent = true
    try {
      const { status, text } = await fetchText(zipSumsAsset.browser_download_url)
      if (status !== 200) {
        pushDefect('checksums-invalid', `下载 SHA256SUMS 失败：HTTP ${status}`)
      } else {
        try {
          for (const entry of parseSha256SumsText(text)) sumsReferences.push({ ...entry, from: 'SHA256SUMS' })
        } catch (error) {
          pushDefect('checksums-invalid', `SHA256SUMS 解析失败：${messageOf(error)}`)
        }
      }
    } catch (error) {
      pushDefect('checksums-invalid', `下载 SHA256SUMS 网络错误：${messageOf(error)}`)
    }
  }
  for (const reference of sumsReferences) {
    if (!assetByName.has(reference.name)) {
      pushDefect('checksums-ref-missing', `${reference.from} 列出的资产 ${reference.name} 缺失于 Release`)
    }
  }

  // ④ 期望资产集（对表基准）＋数量/名称集合核对（多余资产也是缺陷——误传/残留形态）
  const expected = new Set()
  const names = desktopArtifactNames(version)
  expected.add(names.setupExe)
  expected.add('migrate-v127.zip')
  if (latestParsed) {
    for (const file of latestParsed.files) expected.add(basename(file.url))
    if (latestParsed.path) expected.add(basename(latestParsed.path))
  }
  for (const reference of sumsReferences) expected.add(reference.name)
  expected.add('latest.yml')
  if (desktopSumsAsset) expected.add('SHA256SUMS-desktop.txt')
  if (zipSumsPresent) expected.add('SHA256SUMS')
  summary.expectedCount = expected.size

  if (release) {
    const actualNames = assets.map(asset => asset?.name).filter(name => typeof name === 'string')
    for (const name of expected) {
      if (!assetByName.has(name)) {
        pushDefect('asset-missing', `${name}（期望资产集成员）缺失于 Release（期望集共 ${expected.size} 资产）`)
      }
    }
    for (const name of actualNames) {
      if (!expected.has(name)) {
        pushDefect('asset-extra', `${name} 不在期望资产集内（多余资产——疑似误传/残留产物混入）`)
      }
    }
    const threshold = minAssets ?? expected.size
    if (actualNames.length < threshold) {
      pushDefect('asset-count', `Release 资产数 ${actualNames.length} 低于阈值 ${threshold}（期望集大小 ${expected.size}）`)
    }
    lines.push(`assets: 实际 ${actualNames.length} / 期望 ${expected.size}（数量阈值 ${threshold}）`)
    for (const name of [...expected].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const asset = assetByName.get(name)
      lines.push(`  ${asset ? 'ok     ' : 'MISSING'}  ${name}${asset ? `（${asset.size} B）` : ''}`)
    }
  }

  // ⑤ --expect-latest：/releases/latest 指针必须指向本 tag（v1.3.0 长期 draft 事故形态）
  if (expectLatest) {
    try {
      const { status, json } = await fetchJson(`${baseUrl}/latest`)
      if (status !== 200) {
        pushDefect('latest-pointer-fetch', `/releases/latest 拉取失败：HTTP ${status}`)
      } else if (!json || json.tag_name !== tag) {
        pushDefect('latest-pointer', `/releases/latest 指向 ${json?.tag_name ?? '(空)'}，期望 ${tag}`)
      } else {
        lines.push(`latest 指针: /releases/latest -> ${tag}（与 --expect-latest 一致）`)
      }
    } catch (error) {
      pushDefect('latest-pointer-fetch', `/releases/latest 网络错误：${messageOf(error)}`)
    }
  }

  // ⑥ 镜像 feed 段：空串＝未上线 disabled；网络不可达＝skipped＋原因（任务指令降级口径）；
  //    可达但 feed 缺失/损坏＝缺陷；--expect-latest 时镜像版本必须跟上本次发布。
  const trimmedMirrorBase = typeof mirrorBase === 'string' ? mirrorBase.trim() : ''
  if (trimmedMirrorBase === '') {
    lines.push('镜像核对: skipped（CN_MIRROR_BASE 为空串＝镜像未上线，行为安全退化）')
  } else {
    let mirrorVersion = null
    try {
      const { status, text } = await fetchText(`${trimmedMirrorBase}/latest.yml`)
      if (status !== 200) {
        pushDefect('mirror-feed', `镜像 ${trimmedMirrorBase}/latest.yml HTTP ${status}（镜像可达但 feed 文件缺失）`)
      } else {
        try {
          mirrorVersion = parseLatestYml(text).version
        } catch (error) {
          pushDefect('mirror-feed', `镜像 latest.yml 解析失败：${messageOf(error)}`)
        }
      }
    } catch (error) {
      summary.mirrorStatus = 'skipped'
      summary.mirrorReason = `镜像 latest.yml 不可达：${messageOf(error)}`
      lines.push(`镜像核对: skipped（${summary.mirrorReason}）`)
    }
    if (summary.mirrorStatus !== 'skipped') {
      summary.mirrorStatus = 'checked'
      let mirrorManifestTag = null
      try {
        const { status, text } = await fetchText(`${trimmedMirrorBase}/manifest.json`)
        if (status !== 200) {
          pushDefect('mirror-feed', `镜像 ${trimmedMirrorBase}/manifest.json HTTP ${status}（镜像可达但 feed 文件缺失）`)
        } else {
          try {
            const parsedManifest = JSON.parse(text)
            mirrorManifestTag = parsedManifest?.tag_name ?? null
            if (typeof mirrorManifestTag !== 'string') throw new Error('manifest.json 缺少 tag_name 字段')
          } catch (error) {
            pushDefect('mirror-feed', `镜像 manifest.json 解析失败：${messageOf(error)}`)
          }
        }
      } catch (error) {
        pushDefect('mirror-feed', `镜像 manifest.json 不可达：${messageOf(error)}`)
      }
      if (mirrorVersion !== null && mirrorManifestTag !== null) {
        if (mirrorManifestTag !== `v${mirrorVersion}`) {
          pushDefect('mirror-consistency', `镜像 manifest.json tag_name=${mirrorManifestTag} 与镜像 latest.yml version=${mirrorVersion} 不一致`)
        }
        if (expectLatest) {
          if (mirrorVersion !== version) {
            pushDefect('mirror-version', `镜像 latest.yml version=${mirrorVersion} ≠ --expect-latest 期望 ${version}（镜像未同步本次发布？走 sync-feed.mjs 后重核）`)
          } else {
            lines.push(`镜像核对: latest.yml=${mirrorVersion} manifest=${mirrorManifestTag}，与期望 latest 一致`)
          }
        } else {
          lines.push(`镜像核对: latest.yml=${mirrorVersion} manifest=${mirrorManifestTag}（未加 --expect-latest：信息报告，不判缺陷）`)
        }
      }
    }
  }

  // ⑦ --deep：字节级核对（下载校验和覆盖的每个资产，sha256 与 size 双对表）
  if (deep && sumsReferences.length > 0) {
    for (const reference of sumsReferences) {
      const asset = assetByName.get(reference.name)
      if (!asset) continue // 缺失已由 ③④ 报过，不重复下载
      try {
        const bytes = await fetchBytes(asset.browser_download_url)
        const actualHex = createHash('sha256').update(bytes).digest('hex')
        if (actualHex !== reference.sha256Hex) {
          pushDefect('deep-sha256', `${reference.name} 实际字节 sha256=${actualHex} ≠ ${reference.from} 记录值 ${reference.sha256Hex}`)
        }
        if (bytes.length !== asset.size) {
          pushDefect('deep-size', `${reference.name} 实际字节 ${bytes.length} ≠ Release 资产 size ${asset.size}`)
        }
      } catch (error) {
        pushDefect('deep-fetch', `${reference.name} 下载失败：${messageOf(error)}`)
      }
    }
    lines.push(`deep: 已对 ${sumsReferences.length} 个校验和资产做字节级 sha256/size 核对`)
  }

  return { ok: defects.length === 0, defects, lines, summary }
}
