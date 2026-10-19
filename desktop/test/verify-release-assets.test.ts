// GAP2-RELCHECK 任务2：发布后双源核对（GitHub Release × 镜像 feed）单测（TDD）。
// 背景（2026-10-19 复盘缺口 G2）：v1.3.1 人工上传误删资产、v1.3.0 曾长期 draft——
// 上传后缺一道机器核对闸。被测＝desktop/scripts/verify-release-assets-lib.mjs 纯逻辑层
// （fetch 全注入，零网络零凭证；CLI 壳 desktop/scripts/verify-release-assets.mjs 只做
// 参数解析＋真实 fetch 接线）。
// oracle 独立性：fixture 的 sha256/sha512/size 全部测试侧 node:crypto 独立计算；
// 期望资产集（7 资产）来自发布手册 §三的上传清单口径，非实现回显。
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  parseVerifyArgs,
  parseSha256SumsText,
  verifyReleaseAssets,
} from '../scripts/verify-release-assets-lib.mjs'

const GITHUB_API = 'https://api-github.test'
const DOWNLOAD_HOST = 'https://github-download.test'
const REPO = 'm1kuStark/a-share-kline-trainer'
const MIRROR_BASE = 'https://mirror.test/feed'

const VERSION = '1.3.0'
const TAG = `v${VERSION}`
const SETUP_NAME = `kline-trainer-desktop-setup-v${VERSION}-windows-x64.exe`
const BLOCKMAP_NAME = `${SETUP_NAME}.blockmap`
const ZIP_NAME = `kline-trainer-v${VERSION}-windows-x64.zip`

const enc = new TextEncoder()
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const sha512B64 = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')

/** 确定性伪随机字节（测试侧独立构造） */
function deterministicBytes(total: number, seed: number): Uint8Array {
  const buffer = new Uint8Array(total)
  let state = seed >>> 0 || 1
  for (let i = 0; i < total; i++) {
    state = (state * 1103515245 + 12345) >>> 0
    buffer[i] = state >>> 24
  }
  return buffer
}

/** 测试侧手写 latest.yml（形状＝release-desktop-lib.mjs renderLatestYml 冻结形状） */
function buildLatestYml(version: string, setupName: string, setupBytes: Uint8Array): string {
  const digest = sha512B64(setupBytes)
  return [
    `version: ${version}`,
    `path: ${setupName}`,
    `sha512: ${digest}`,
    `releaseDate: '2026-10-18T00:00:00.000Z'`,
    'files:',
    `  - url: ${setupName}`,
    `    sha512: ${digest}`,
    `    size: ${setupBytes.length}`,
    '',
  ].join('\n')
}

/** 校验和文本（`<hex>  <name>` 行、按名排序——与 zip/desktop 流水线同格式） */
function buildSums(items: { name: string; bytes: Uint8Array }[]): string {
  return [...items]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map(item => `${sha256Hex(item.bytes)}  ${item.name}\n`)
    .join('')
}

/** 完全自洽的 v1.3.0 发布 fixture（7 资产，口径＝发布手册 §三上传清单） */
function makeScenario() {
  const bytes = new Map<string, Uint8Array>([
    [SETUP_NAME, deterministicBytes(1000, 11)],
    [BLOCKMAP_NAME, deterministicBytes(300, 22)],
    ['migrate-v127.zip', deterministicBytes(400, 33)],
    [ZIP_NAME, deterministicBytes(5000, 44)],
  ])
  const latestYmlText = buildLatestYml(VERSION, SETUP_NAME, bytes.get(SETUP_NAME)!)
  bytes.set('latest.yml', enc.encode(latestYmlText))
  bytes.set('SHA256SUMS-desktop.txt', enc.encode(buildSums([
    { name: SETUP_NAME, bytes: bytes.get(SETUP_NAME)! },
    { name: 'latest.yml', bytes: bytes.get('latest.yml')! },
    { name: BLOCKMAP_NAME, bytes: bytes.get(BLOCKMAP_NAME)! },
    { name: 'migrate-v127.zip', bytes: bytes.get('migrate-v127.zip')! },
  ])))
  bytes.set('SHA256SUMS', enc.encode(buildSums([{ name: ZIP_NAME, bytes: bytes.get(ZIP_NAME)! }])))

  const assets = [...bytes.entries()].map(([name, data]) => ({
    name,
    size: data.length,
    browser_download_url: `${DOWNLOAD_HOST}/${REPO}/releases/download/${TAG}/${name}`,
  }))
  const releaseJson = { tag_name: TAG, name: TAG, draft: false, prerelease: false, assets }
  const latestJson = { tag_name: TAG }
  const mirrorLatestYml = latestYmlText
  const mirrorManifestJson = JSON.stringify({
    tag_name: TAG,
    assets: [...bytes.keys()].map(name => ({ name, browser_download_url: `${MIRROR_BASE}/${name}`, size: bytes.get(name)!.length })),
  })
  return { bytes, releaseJson, latestJson, mirrorLatestYml, mirrorManifestJson }
}

interface NetOpts {
  releaseJson?: object
  latestJson?: object
  networkFail?: RegExp[]
  httpFail?: RegExp[]
  textOverride?: (url: string) => string | undefined
  bytesOverride?: (name: string) => Uint8Array | undefined
}

function makeNet(scenario: ReturnType<typeof makeScenario>, opts: NetOpts = {}) {
  const fetchJson = async (url: string) => {
    if (opts.networkFail?.some(re => re.test(url))) throw new Error('simulated network failure')
    if (url === `${GITHUB_API}/repos/${REPO}/releases/tags/${TAG}`) return { status: 200, json: opts.releaseJson ?? scenario.releaseJson }
    if (url === `${GITHUB_API}/repos/${REPO}/releases/latest`) return { status: 200, json: opts.latestJson ?? scenario.latestJson }
    return { status: 404, json: { message: 'Not Found' } }
  }
  const fetchText = async (url: string) => {
    if (opts.networkFail?.some(re => re.test(url))) throw new Error('simulated network failure')
    if (opts.httpFail?.some(re => re.test(url))) return { status: 404, text: 'Not Found' }
    const override = opts.textOverride?.(url)
    if (override !== undefined) return { status: 200, text: override }
    if (url.startsWith(`${DOWNLOAD_HOST}/`)) {
      const name = url.split('/').pop()!
      const data = scenario.bytes.get(name)
      if (!data) return { status: 404, text: 'Not Found' }
      return { status: 200, text: new TextDecoder().decode(data) }
    }
    if (url === `${MIRROR_BASE}/latest.yml`) return { status: 200, text: scenario.mirrorLatestYml }
    if (url === `${MIRROR_BASE}/manifest.json`) return { status: 200, text: scenario.mirrorManifestJson }
    return { status: 404, text: '' }
  }
  const fetchBytes = async (url: string) => {
    if (opts.networkFail?.some(re => re.test(url))) throw new Error('simulated network failure')
    const name = url.split('/').pop()!
    const override = opts.bytesOverride?.(name)
    if (override !== undefined) return override
    const data = scenario.bytes.get(name)
    if (!data) throw new Error(`no fixture bytes for ${url}`)
    return data
  }
  return { fetchJson, fetchText, fetchBytes }
}

async function run(net: ReturnType<typeof makeNet>, extra: Record<string, unknown> = {}) {
  return verifyReleaseAssets({
    tag: TAG,
    githubApiBase: GITHUB_API,
    repo: REPO,
    mirrorBase: MIRROR_BASE,
    ...net,
    ...extra,
  })
}

const codesOf = (result: { defects: { code: string; detail: string }[] }) => result.defects.map(defect => defect.code)
const findDefect = (result: { defects: { code: string; detail: string }[] }, code: string) =>
  result.defects.find(defect => defect.code === code)

// ===== 参数解析 =====
describe('VERIFY-RELEASE-ASSETS: parseVerifyArgs (fail-closed CLI contract)', () => {
  it('parses --tag with optional --expect-latest / --deep / --min-assets and rejects everything else', () => {
    expect(parseVerifyArgs(['--tag', 'v1.3.0'])).toEqual({ tag: 'v1.3.0', expectLatest: false, deep: false, minAssets: null })
    expect(parseVerifyArgs(['--tag', 'v1.3.1', '--expect-latest', '--deep'])).toEqual({ tag: 'v1.3.1', expectLatest: true, deep: true, minAssets: null })
    expect(parseVerifyArgs(['--tag', 'v1.3.0', '--min-assets', '7']).minAssets).toBe(7)
    expect(() => parseVerifyArgs([])).toThrow(/--tag/)
    expect(() => parseVerifyArgs(['--tag', '1.3.0'])).toThrow(/tag/)
    expect(() => parseVerifyArgs(['--tag', 'v1.3'])).toThrow(/tag/)
    expect(() => parseVerifyArgs(['--tag', 'v1.3.0', '--bogus'])).toThrow(/未知|bogus/)
    expect(() => parseVerifyArgs(['--tag', 'v1.3.0', '--min-assets', 'x'])).toThrow()
    expect(() => parseVerifyArgs(['--tag', 'v1.3.0', '--min-assets', '-1'])).toThrow()
  })
})

describe('VERIFY-RELEASE-ASSETS: parseSha256SumsText accepts the pipeline line formats only', () => {
  const hex = 'a'.repeat(64)
  it('parses two-space and space-star lines and rejects malformed ones', () => {
    expect(parseSha256SumsText(`${hex}  name.exe\n`)).toEqual([{ name: 'name.exe', sha256Hex: hex }])
    expect(parseSha256SumsText(`${hex} *name.exe\n${'b'.repeat(64)}  other.zip\n`)).toEqual([
      { name: 'name.exe', sha256Hex: hex },
      { name: 'other.zip', sha256Hex: 'b'.repeat(64) },
    ])
    expect(() => parseSha256SumsText('garbage\n')).toThrow()
    expect(() => parseSha256SumsText(`${'g'.repeat(64)}  name\n`)).toThrow()
    expect(() => parseSha256SumsText(`${hex}  \n`)).toThrow()
  })
})

// ===== 全绿主路径 =====
describe('VERIFY-RELEASE-ASSETS: consistent release passes all checks', () => {
  it('reports 7/7 assets, latest pointer match, mirror consistency and zero defects', async () => {
    const scenario = makeScenario()
    const result = await run(makeNet(scenario), { expectLatest: true })
    expect(result.ok).toBe(true)
    expect(result.defects).toEqual([])
    expect(result.summary.assetCount).toBe(7)
    expect(result.summary.expectedCount).toBe(7)
    expect(result.summary.prerelease).toBe(false)
    expect(result.summary.draft).toBe(false)
    expect(result.summary.mirrorStatus).toBe('checked')
    expect(result.lines.some(line => line.includes('prerelease=false'))).toBe(true)
  })

  it('reports prerelease=true as a fact without failing when --expect-latest is absent', async () => {
    const scenario = makeScenario()
    const releaseJson = { ...scenario.releaseJson, prerelease: true }
    const result = await run(makeNet(scenario, { releaseJson }))
    expect(result.ok).toBe(true)
    expect(result.summary.prerelease).toBe(true)
  })

  it('mirror serving a different version than the tag is informational only without --expect-latest', async () => {
    const scenario = makeScenario()
    const olderYml = buildLatestYml('1.2.9', `kline-trainer-desktop-setup-v1.2.9-windows-x64.exe`, deterministicBytes(50, 7))
    const olderManifest = JSON.stringify({ tag_name: 'v1.2.9', assets: [] })
    const net = makeNet(scenario, {
      textOverride: url => {
        if (url === `${MIRROR_BASE}/latest.yml`) return olderYml
        if (url === `${MIRROR_BASE}/manifest.json`) return olderManifest
        return undefined
      },
    })
    const result = await run(net)
    expect(result.ok).toBe(true)
    expect(codesOf(result)).not.toContain('mirror-version')
  })
})

// ===== 三类必测失败场景（任务卡验收：缺资产 / 指针错 / 校验和缺）＋扩展 =====
describe('VERIFY-RELEASE-ASSETS: fail-closed defect detection', () => {
  it('missing asset (migrate-v127.zip deleted from the release) is reported by name from two derivation paths', async () => {
    const scenario = makeScenario()
    const releaseJson = {
      ...scenario.releaseJson,
      assets: scenario.releaseJson.assets.filter((asset: { name: string }) => asset.name !== 'migrate-v127.zip'),
    }
    const result = await run(makeNet(scenario, { releaseJson }))
    expect(result.ok).toBe(false)
    const codes = codesOf(result)
    expect(codes).toContain('asset-missing')
    expect(codes).toContain('checksums-ref-missing')
    expect(findDefect(result, 'asset-missing')!.detail).toContain('migrate-v127.zip')
  })

  it('missing checksums asset (SHA256SUMS-desktop.txt absent) fails with checksums-missing', async () => {
    const scenario = makeScenario()
    const releaseJson = {
      ...scenario.releaseJson,
      assets: scenario.releaseJson.assets.filter((asset: { name: string }) => asset.name !== 'SHA256SUMS-desktop.txt'),
    }
    const result = await run(makeNet(scenario, { releaseJson }))
    expect(result.ok).toBe(false)
    const codes = codesOf(result)
    expect(codes).toContain('checksums-missing')
    expect(codes).toContain('asset-missing')
  })

  it('wrong latest pointer under --expect-latest fails with latest-pointer naming both tags', async () => {
    const scenario = makeScenario()
    const result = await run(makeNet(scenario, { latestJson: { tag_name: 'v0.0.9' } }), { expectLatest: true })
    expect(result.ok).toBe(false)
    const defect = findDefect(result, 'latest-pointer')
    expect(defect).toBeDefined()
    expect(defect!.detail).toContain('v0.0.9')
    expect(defect!.detail).toContain(TAG)
  })

  it('latest pointer fetch failure under --expect-latest is a defect, not a silent skip (fail-closed)', async () => {
    const scenario = makeScenario()
    const net = makeNet(scenario, { networkFail: [/\/releases\/latest$/] })
    const result = await run(net, { expectLatest: true })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('latest-pointer-fetch')
  })

  it('release not found by tag (404) and network failure are both defects', async () => {
    const scenario = makeScenario()
    const notFound = await run(makeNet(scenario, { networkFail: [new RegExp(`/releases/tags/${TAG}$`)] }))
    expect(notFound.ok).toBe(false)
    expect(codesOf(notFound)).toContain('release-fetch')
  })

  it('release fetch failure reports the fetch defect without cascading asset-missing noise', async () => {
    // 线上实证（2026-10-19 匿名限额 403）：release 载荷没拿到时，下游 latest.yml/校验和
    // 检查会对着空资产表误报「缺失」，掩盖真正的故障源（拉取失败）。修复口径：Release
    // 载荷缺失时跳过资产级核对，只报 release-fetch/release-missing——噪声即误导。
    const scenario = makeScenario()
    const result = await run(makeNet(scenario, { networkFail: [new RegExp(`/releases/tags/${TAG}$`)] }))
    expect(result.ok).toBe(false)
    const codes = codesOf(result)
    expect(codes).toContain('release-fetch')
    expect(codes).not.toContain('latest-yml-missing')
    expect(codes).not.toContain('checksums-missing')
    expect(codes).not.toContain('asset-missing')
  })

  it('stray extra asset (e.g. retired portable exe) violates the name-set equality as asset-extra', async () => {
    const scenario = makeScenario()
    const strayName = `kline-trainer-desktop-v${VERSION}-windows-x64.exe`
    const releaseJson = {
      ...scenario.releaseJson,
      assets: [
        ...scenario.releaseJson.assets,
        { name: strayName, size: 5, browser_download_url: `${DOWNLOAD_HOST}/${REPO}/releases/download/${TAG}/${strayName}` },
      ],
    }
    const result = await run(makeNet(scenario, { releaseJson }))
    expect(result.ok).toBe(false)
    const defect = findDefect(result, 'asset-extra')
    expect(defect).toBeDefined()
    expect(defect!.detail).toContain(strayName)
  })

  it('minAssets threshold is honored (parameterizable count gate)', async () => {
    const scenario = makeScenario()
    const strict = await run(makeNet(scenario), { minAssets: 8 })
    expect(strict.ok).toBe(false)
    expect(codesOf(strict)).toContain('asset-count')
    const loose = await run(makeNet(scenario), { minAssets: 6 })
    expect(loose.ok).toBe(true)
  })

  it('latest.yml version mismatch with the tag is a defect', async () => {
    const scenario = makeScenario()
    const wrongVersion = buildLatestYml('9.9.9', SETUP_NAME, scenario.bytes.get(SETUP_NAME)!)
    const result = await run(makeNet(scenario, { textOverride: url => url.endsWith('/latest.yml') && url.startsWith(DOWNLOAD_HOST) ? wrongVersion : undefined }))
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('latest-yml-version')
  })

  it('latest.yml files size disagreeing with the API asset size is a defect', async () => {
    const scenario = makeScenario()
    const setupBytes = scenario.bytes.get(SETUP_NAME)!
    const sizeLie = buildLatestYml(VERSION, SETUP_NAME, setupBytes).replace(`size: ${setupBytes.length}`, 'size: 999999')
    const result = await run(makeNet(scenario, { textOverride: url => url.endsWith('/latest.yml') && url.startsWith(DOWNLOAD_HOST) ? sizeLie : undefined }))
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('latest-yml-size')
  })

  it('latest.yml sha512 that is not valid base64 sha512 (64 decoded bytes) is a defect', async () => {
    const scenario = makeScenario()
    const setupBytes = scenario.bytes.get(SETUP_NAME)!
    const badDigest = buildLatestYml(VERSION, SETUP_NAME, setupBytes).replaceAll(sha512B64(setupBytes), '!!!not-base64!!!')
    const result = await run(makeNet(scenario, { textOverride: url => url.endsWith('/latest.yml') && url.startsWith(DOWNLOAD_HOST) ? badDigest : undefined }))
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('latest-yml-sha512')
  })
})

// ===== 镜像 feed 段（任务指令：空串/不可达→如实 skipped；可达但坏→缺陷） =====
describe('VERIFY-RELEASE-ASSETS: mirror feed segment degradation and defects', () => {
  it('empty mirror base degrades the segment to disabled without any defect', async () => {
    const scenario = makeScenario()
    const net = makeNet(scenario)
    const result = await verifyReleaseAssets({ tag: TAG, githubApiBase: GITHUB_API, repo: REPO, mirrorBase: '', ...net })
    expect(result.ok).toBe(true)
    expect(result.summary.mirrorStatus).toBe('disabled')
  })

  it('unreachable mirror (network error) degrades the segment to skipped with a reason, not a defect', async () => {
    const scenario = makeScenario()
    const net = makeNet(scenario, { networkFail: [/^https:\/\/mirror\.test\//] })
    const result = await run(net)
    expect(result.ok).toBe(true)
    expect(result.summary.mirrorStatus).toBe('skipped')
    expect(result.summary.mirrorReason).toBeTruthy()
  })

  it('reachable mirror missing the feed files (404) is a defect (mirror-feed)', async () => {
    const scenario = makeScenario()
    const net = makeNet(scenario, { httpFail: [/^https:\/\/mirror\.test\//] })
    const result = await run(net)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('mirror-feed')
  })

  it('mirror latest.yml and manifest.json disagreeing on version is a defect (mirror-consistency)', async () => {
    const scenario = makeScenario()
    const net = makeNet(scenario, {
      textOverride: url => url === `${MIRROR_BASE}/manifest.json`
        ? JSON.stringify({ tag_name: 'v9.9.9', assets: [] })
        : undefined,
    })
    const result = await run(net)
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('mirror-consistency')
  })

  it('mirror serving a stale version under --expect-latest is a defect (mirror-version)', async () => {
    const scenario = makeScenario()
    const olderYml = buildLatestYml('1.2.9', `kline-trainer-desktop-setup-v1.2.9-windows-x64.exe`, deterministicBytes(50, 7))
    const olderManifest = JSON.stringify({ tag_name: 'v1.2.9', assets: [] })
    const net = makeNet(scenario, {
      textOverride: url => {
        if (url === `${MIRROR_BASE}/latest.yml`) return olderYml
        if (url === `${MIRROR_BASE}/manifest.json`) return olderManifest
        return undefined
      },
    })
    const result = await run(net, { expectLatest: true })
    expect(result.ok).toBe(false)
    expect(codesOf(result)).toContain('mirror-version')
  })
})

// ===== --deep 字节级核对 =====
describe('VERIFY-RELEASE-ASSETS: --deep byte-level verification of checksummed assets', () => {
  it('passes when downloaded bytes match every checksums entry, and catches tampered bytes and size lies', async () => {
    const scenario = makeScenario()
    const green = await run(makeNet(scenario), { deep: true })
    expect(green.ok).toBe(true)

    const tampered = await run(makeNet(scenario, {
      bytesOverride: name => name === SETUP_NAME ? deterministicBytes(1000, 999) : undefined,
    }), { deep: true })
    expect(tampered.ok).toBe(false)
    expect(codesOf(tampered)).toContain('deep-sha256')
    expect(findDefect(tampered, 'deep-sha256')!.detail).toContain(SETUP_NAME)

    // API size 撒谎（migrate zip 实际 400 字节，声明 1）：元数据级无独立 size 源拦不住，deep 必须拦
    const releaseJson = {
      ...scenario.releaseJson,
      assets: scenario.releaseJson.assets.map((asset: { name: string; size: number; browser_download_url: string }) =>
        asset.name === 'migrate-v127.zip' ? { ...asset, size: 1 } : asset),
    }
    const sizeLie = await run(makeNet(scenario, { releaseJson }), { deep: true })
    expect(sizeLie.ok).toBe(false)
    expect(codesOf(sizeLie)).toContain('deep-size')
  })

  it('deep verifies latest.yml sha512 against the downloaded setup exe bytes (metadata level cannot)', async () => {
    // latest.yml 的 sha512 撒谎（合法 base64 但内容错）：元数据级只验形态拦不住，--deep 须对实际字节。
    // fixture 自洽改造：换撒谎版 latest.yml 后同步重建 SHA256SUMS-desktop.txt 与 release 资产表，
    // 保证唯一缺陷源＝sha512 谎言（排除 deep-sha256/deep-size 误触发）。
    const scenario = makeScenario()
    const setupBytes = scenario.bytes.get(SETUP_NAME)!
    const lyingDigest = sha512B64(deterministicBytes(64, 5150))
    const lyingYml = buildLatestYml(VERSION, SETUP_NAME, setupBytes).replaceAll(sha512B64(setupBytes), lyingDigest)
    scenario.bytes.set('latest.yml', enc.encode(lyingYml))
    scenario.bytes.set('SHA256SUMS-desktop.txt', enc.encode(buildSums([
      { name: SETUP_NAME, bytes: setupBytes },
      { name: 'latest.yml', bytes: scenario.bytes.get('latest.yml')! },
      { name: BLOCKMAP_NAME, bytes: scenario.bytes.get(BLOCKMAP_NAME)! },
      { name: 'migrate-v127.zip', bytes: scenario.bytes.get('migrate-v127.zip')! },
    ])))
    scenario.releaseJson = {
      ...scenario.releaseJson,
      assets: [...scenario.bytes.entries()].map(([name, data]) => ({
        name,
        size: data.length,
        browser_download_url: `${DOWNLOAD_HOST}/${REPO}/releases/download/${TAG}/${name}`,
      })),
    }
    scenario.mirrorLatestYml = lyingYml
    const result = await run(makeNet(scenario), { deep: true })
    expect(result.ok).toBe(false)
    const codes = codesOf(result)
    expect(codes).toContain('deep-sha512')
    expect(codes).not.toContain('deep-sha256')
    expect(codes).not.toContain('deep-size')
  })
})
