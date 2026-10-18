// CN-FEED-01（矩阵行 RELEASE-CN-FEED-SYNC）：国内发布目录同步脚本纯函数层
// （desktop/scripts/sync-feed-lib.mjs）。
// oracle 独立性：sha512/sha256 期望值全部由测试侧 node:crypto 独立计算；latest.yml
// 输入 fixture 为手写（模拟 electron-builder 产出形状）；manifest.json 形状期望来自
// UPD-01 design §2.1 清单消费契约（GitHub Releases latest API 字段子集）＋发布手册资产
// 清单；镜像 base 为测试自备 fixture。真实 fs 集成档（沿 development-principles §4.2
// 真实边界条款：默认 IO 实现至少一条用例走真实文件系统）。
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLatestYml } from '../scripts/release-desktop-lib.mjs'
import {
  assertMirrorBase,
  renderCnManifestJson,
  rewriteLatestYmlForMirror,
  runCnFeedSync,
  verifyCnFeedOutput,
} from '../scripts/sync-feed-lib.mjs'

const MIRROR_BASE = 'https://cn.example/pub'
const VERSION = '1.3.1'
const SETUP_NAME = `kline-trainer-desktop-setup-v${VERSION}-windows-x64.exe`
const BLOCKMAP_NAME = `${SETUP_NAME}.blockmap`
const ZIP_NAME = `kline-trainer-v${VERSION}-windows-x64.zip`
const MIGRATE_NAME = 'migrate-v127.zip'

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const sha512Base64Of = (bytes: Uint8Array) => createHash('sha512').update(bytes).digest('base64')

/** 手写 latest.yml 输入（electron-builder 产出形状；sha512/size 由测试侧独立计算注入） */
function fixtureLatestYml(setupBytes: Uint8Array): string {
  const sha512 = sha512Base64Of(setupBytes)
  return [
    `version: ${VERSION}`,
    `path: ${SETUP_NAME}`,
    `sha512: ${sha512}`,
    `releaseDate: '2026-10-13T08:00:00.000Z'`,
    'files:',
    `  - url: ${SETUP_NAME}`,
    `    sha512: ${sha512}`,
    `    size: ${setupBytes.length}`,
    '',
  ].join('\n')
}

/** 构造一个齐备的发布产物目录（真实 fs） */
async function buildReleaseDir(): Promise<{ releaseDir: string, setupBytes: Buffer, zipBytes: Buffer }> {
  const releaseDir = await mkdtemp(join(tmpdir(), 'cnfeed-rel-'))
  const setupBytes = Buffer.from(`fake-nsis-setup-${VERSION}-` + 'x'.repeat(2048))
  const zipBytes = Buffer.from(`fake-zip-${VERSION}-` + 'z'.repeat(4096))
  await writeFile(join(releaseDir, 'latest.yml'), fixtureLatestYml(setupBytes), 'utf8')
  await writeFile(join(releaseDir, SETUP_NAME), setupBytes)
  await writeFile(join(releaseDir, BLOCKMAP_NAME), Buffer.from('blockmap-bytes'))
  await writeFile(join(releaseDir, ZIP_NAME), zipBytes)
  await writeFile(join(releaseDir, 'SHA256SUMS'), `${sha256Of(zipBytes)}  ${ZIP_NAME}\n`, 'utf8')
  await writeFile(join(releaseDir, MIGRATE_NAME), Buffer.from('migrate-bytes'))
  return { releaseDir, setupBytes, zipBytes }
}

describe('RELEASE-CN-FEED-SYNC: 镜像 base 校验', () => {
  it('assertMirrorBase 只收 http(s) 无查询无锚点 URL，尾斜杠归一', () => {
    expect(assertMirrorBase(`${MIRROR_BASE}/`)).toBe(MIRROR_BASE)
    expect(assertMirrorBase(MIRROR_BASE)).toBe(MIRROR_BASE)
    expect(() => assertMirrorBase('ftp://cn.example/pub')).toThrow()
    expect(() => assertMirrorBase(`${MIRROR_BASE}?token=1`)).toThrow()
    expect(() => assertMirrorBase(`${MIRROR_BASE}#frag`)).toThrow()
    expect(() => assertMirrorBase('')).toThrow()
  })
})

describe('RELEASE-CN-FEED-SYNC: latest.yml 镜像改写', () => {
  it('path 与 files url 改写为镜像绝对 URL，sha512/size/releaseDate 原样', () => {
    const setupBytes = Buffer.from('setup-bytes-abc')
    const input = fixtureLatestYml(setupBytes)
    const rewritten = rewriteLatestYmlForMirror(input, `${MIRROR_BASE}/`)
    const parsed = parseLatestYml(rewritten)
    expect(parsed.version).toBe(VERSION)
    expect(parsed.path).toBe(`${MIRROR_BASE}/${SETUP_NAME}`)
    expect(parsed.files[0]?.url).toBe(`${MIRROR_BASE}/${SETUP_NAME}`)
    // 校验字段与源一致（独立重算，非回显）
    expect(parsed.sha512).toBe(sha512Base64Of(setupBytes))
    expect(parsed.files[0]?.sha512).toBe(sha512Base64Of(setupBytes))
    expect(parsed.files[0]?.size).toBe(setupBytes.length)
    expect(rewritten).toContain(`releaseDate: '2026-10-13T08:00:00.000Z'`)
  })
})

describe('MIRROR-URL-FIX: latest.yml releaseNotes 注入（RELEASE-CN-FEED-SYNC 行为增强，v1.3.3）', () => {
  // desktop 链「更新内容」区来自 electron-updater UpdateInfo.releaseNotes——generic provider
  // 把 latest.yml 顶层标量原样透传（desktop/src/update-adapter.ts normalizeReleaseNotes 消费
  // string 形态）。GitHub 源的 notes 来自 Release body，镜像源此前无此字段导致「更新内容」
  // 空——改写器补 releaseNotes（值=--notes 参数；无则空串）。
  it('rewriteLatestYmlForMirror 注入 releaseNotes（notes 参数→单引号标量，缺省空串，幂等替换恰一行）', () => {
    const setupBytes = Buffer.from('setup-bytes-notes')
    const input = fixtureLatestYml(setupBytes)
    const rewritten = rewriteLatestYmlForMirror(input, MIRROR_BASE, "v1.3.3 修复'默认镜像源'不生效")
    // 单引号 YAML 标量：内部单引号加倍转义
    expect(rewritten).toContain(`releaseNotes: 'v1.3.3 修复''默认镜像源''不生效'`)
    // 行级幂等：已含 releaseNotes 的产物（本脚本输出）重跑替换为最新值，恰一行
    const rerun = rewriteLatestYmlForMirror(rewritten, MIRROR_BASE, '更新说明 v2')
    expect(rerun).toContain(`releaseNotes: '更新说明 v2'`)
    expect(rerun.match(/releaseNotes:/g)).toHaveLength(1)
    // 缺省 notes → 空串字段仍在位（字段自描述；electron-updater 归一为 null 呈现）
    expect(rewriteLatestYmlForMirror(input, MIRROR_BASE)).toContain(`releaseNotes: ''`)
    // 多行 notes 折叠为单行标量（YAML 单引号标量不含裸换行）
    expect(rewriteLatestYmlForMirror(input, MIRROR_BASE, '第一行\n第二行')).toContain(`releaseNotes: '第一行 第二行'`)
    // 既有改写义务不回归：path 仍改写为镜像绝对 URL
    expect(parseLatestYml(rewriteLatestYmlForMirror(input, MIRROR_BASE, '说明')).path).toBe(`${MIRROR_BASE}/${SETUP_NAME}`)
  })
})

describe('RELEASE-CN-FEED-SYNC: manifest.json 同形状（GitHub API 字段子集）', () => {
  it('tag_name 带版本、zip 资产按精确名、SHA256SUMS 资产在位、绝对 URL、按名排序', () => {
    const assets = [
      { name: ZIP_NAME, size: 4096 },
      { name: 'SHA256SUMS', size: 96 },
      { name: SETUP_NAME, size: 2048 },
      { name: MIGRATE_NAME, size: 128 },
    ]
    const text = renderCnManifestJson({ version: VERSION, notes: '国内镜像发布说明', mirrorBase: MIRROR_BASE, assets })
    const parsed = JSON.parse(text) as {
      tag_name: string
      name: string
      body: string
      assets: Array<{ name: string, browser_download_url: string, size: number }>
    }
    expect(parsed.tag_name).toBe(`v${VERSION}`)
    expect(parsed.body).toBe('国内镜像发布说明')
    // 资产按名排序（确定性输出）
    expect(parsed.assets.map(asset => asset.name)).toEqual([MIGRATE_NAME, 'SHA256SUMS', SETUP_NAME, ZIP_NAME].sort())
    const zipAsset = parsed.assets.find(asset => asset.name === ZIP_NAME)
    expect(zipAsset?.browser_download_url).toBe(`${MIRROR_BASE}/${ZIP_NAME}`)
    expect(zipAsset?.size).toBe(4096)
    const sumsAsset = parsed.assets.find(asset => asset.name === 'SHA256SUMS')
    expect(sumsAsset?.browser_download_url).toBe(`${MIRROR_BASE}/SHA256SUMS`)
  })
})

describe('RELEASE-CN-FEED-SYNC: runCnFeedSync 真实 fs（产出＋自校验；零凭证依赖）', () => {
  it('产出齐备的国内发布目录——latest.yml/manifest.json 改写正确、复制文件字节一致、自校验通过', async () => {
    const { releaseDir, setupBytes, zipBytes } = await buildReleaseDir()
    const staging = await mkdtemp(join(tmpdir(), 'cnfeed-stage-'))
    const outDir = join(staging, 'dist-cn-feed')
    try {
      const result = await runCnFeedSync({ releaseDir, mirrorBase: `${MIRROR_BASE}/`, notes: '镜像发布', outDir })
      expect(result.outDir).toBe(outDir)
      // 产物齐备：两个生成文件＋五个复制文件
      const files = (await readdir(outDir)).sort()
      expect(files).toEqual(['SHA256SUMS', 'latest.yml', 'manifest.json', MIGRATE_NAME, SETUP_NAME, BLOCKMAP_NAME, ZIP_NAME].sort())
      // latest.yml 改写正确（独立重算 sha512）；MIRROR-URL-FIX：notes 写入 releaseNotes 字段
      const outYmlRaw = await readFile(join(outDir, 'latest.yml'), 'utf8')
      const outYml = parseLatestYml(outYmlRaw)
      expect(outYml.path).toBe(`${MIRROR_BASE}/${SETUP_NAME}`)
      expect(outYml.files[0]?.sha512).toBe(sha512Base64Of(setupBytes))
      expect(outYmlRaw).toContain(`releaseNotes: '镜像发布'`)
      // manifest.json 形状（zip 资产按精确名＋绝对 URL）
      const outManifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')) as {
        tag_name: string
        assets: Array<{ name: string, browser_download_url: string, size: number }>
      }
      expect(outManifest.tag_name).toBe(`v${VERSION}`)
      const zipAsset = outManifest.assets.find(asset => asset.name === ZIP_NAME)
      expect(zipAsset).toEqual({ name: ZIP_NAME, browser_download_url: `${MIRROR_BASE}/${ZIP_NAME}`, size: zipBytes.length })
      // 复制文件与源逐字节一致（校验和与源一致）
      expect(sha256Of(await readFile(join(outDir, SETUP_NAME)))).toBe(sha256Of(setupBytes))
      expect(sha256Of(await readFile(join(outDir, ZIP_NAME)))).toBe(sha256Of(zipBytes))
      // 自校验独立可复跑通过
      await expect(verifyCnFeedOutput({ releaseDir, outDir, mirrorBase: MIRROR_BASE })).resolves.toBeUndefined()
      // 幂等：对同一输入重复跑（输出目录已是本脚本产物）不 throw
      await expect(runCnFeedSync({ releaseDir, mirrorBase: MIRROR_BASE, outDir })).resolves.toBeTruthy()
    } finally {
      await rm(releaseDir, { recursive: true, force: true })
      await rm(staging, { recursive: true, force: true })
    }
  })

  it('fail-closed——缺必备产物（SHA256SUMS）即 throw 并点名缺失，不产出', async () => {
    const { releaseDir } = await buildReleaseDir()
    const staging = await mkdtemp(join(tmpdir(), 'cnfeed-miss-'))
    const outDir = join(staging, 'dist-cn-feed')
    try {
      await rm(join(releaseDir, 'SHA256SUMS'))
      await expect(runCnFeedSync({ releaseDir, mirrorBase: MIRROR_BASE, outDir })).rejects.toThrow(/SHA256SUMS/)
      await expect(readdir(outDir)).rejects.toThrow()
    } finally {
      await rm(releaseDir, { recursive: true, force: true })
      await rm(staging, { recursive: true, force: true })
    }
  })

  it('自校验拒绝被篡改的产物——setup exe 字节被改后 sha512 与 latest.yml 不符', async () => {
    const { releaseDir } = await buildReleaseDir()
    const staging = await mkdtemp(join(tmpdir(), 'cnfeed-tamper-'))
    const outDir = join(staging, 'dist-cn-feed')
    try {
      await runCnFeedSync({ releaseDir, mirrorBase: MIRROR_BASE, outDir })
      // 篡改输出 setup exe（追加一字节）
      const setupPath = join(outDir, SETUP_NAME)
      const original = await readFile(setupPath)
      await writeFile(setupPath, Buffer.concat([original, Buffer.from('!')]))
      await expect(verifyCnFeedOutput({ releaseDir, outDir, mirrorBase: MIRROR_BASE })).rejects.toThrow(/sha512|一致/)
    } finally {
      await rm(releaseDir, { recursive: true, force: true })
      await rm(staging, { recursive: true, force: true })
    }
  })

  it('输出目录已存在且非本脚本产物（无 latest.yml）→ 拒绝执行不覆盖', async () => {
    const { releaseDir } = await buildReleaseDir()
    const staging = await mkdtemp(join(tmpdir(), 'cnfeed-occupied-'))
    const outDir = join(staging, 'dist-cn-feed')
    try {
      await mkdir(outDir)
      await writeFile(join(outDir, 'user-file.txt'), '占位')
      await expect(runCnFeedSync({ releaseDir, mirrorBase: MIRROR_BASE, outDir })).rejects.toThrow(/输出目录|dist-cn-feed/)
      expect(await readFile(join(outDir, 'user-file.txt'), 'utf8')).toBe('占位')
    } finally {
      await rm(releaseDir, { recursive: true, force: true })
      await rm(staging, { recursive: true, force: true })
    }
  })
})
