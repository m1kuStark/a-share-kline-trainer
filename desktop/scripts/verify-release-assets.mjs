// 注：无 shebang——本脚本仅经 `node desktop/scripts/verify-release-assets.mjs` 调用
// （repo 惯例）；核对逻辑全在 verify-release-assets-lib.mjs（fetch 注入、零网络单测）。
// GAP2-RELCHECK（2026-10-19 复盘缺口 G2）：发布后双源核对 CLI——
//   a. GitHub API（匿名只读，公开仓库；绝不携带 Authorization 头、绝不打印任何 token）；
//   b. 国内镜像 feed（CN_MIRROR_BASE 同源常量：server/dist 编译产物 import，沿
//      desktop/src/cn-feed.ts 先例；空串/不可达→镜像段如实降级 skipped＋原因）。
// 用法：node desktop/scripts/verify-release-assets.mjs --tag v1.3.0 [--expect-latest] [--deep] [--min-assets N]
// 退出码：0＝核对全绿；1＝发现缺陷或无法核实（fail-closed）。
// 依据：v1.3.1 人工上传误删资产、v1.3.0 曾长期 draft（2026-10-19 复盘）——
// 上传后的人工自查（手册 §三第 3 步）升级为机器核对。
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CN_MIRROR_BASE } from '../../server/dist/update/manifest.js'
import { parseVerifyArgs, verifyReleaseAssets, VERIFY_REPO } from './verify-release-assets-lib.mjs'

const GITHUB_API_BASE = 'https://api.github.com'
const USER_AGENT = 'a-share-kline-trainer-release-verifier (anonymous read-only)'
const FETCH_TIMEOUT_MS = 30_000

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    // 匿名只读请求：不带任何 Authorization 头（公开仓库匿名即可），绝不打印 token
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      redirect: 'follow',
    })
  } finally {
    clearTimeout(timer)
  }
}

const fetchJson = async url => {
  const response = await fetchWithTimeout(url)
  let json = null
  try {
    json = await response.json()
  } catch {
    json = null
  }
  return { status: response.status, json }
}

const fetchText = async url => {
  const response = await fetchWithTimeout(url)
  const text = response.status === 200 ? await response.text() : ''
  return { status: response.status, text }
}

const fetchBytes = async url => {
  const response = await fetchWithTimeout(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function main() {
  const options = parseVerifyArgs(process.argv.slice(2))
  console.log('[verify-release-assets] 匿名只读核对（GitHub API × 镜像 feed），不携带任何凭证')
  console.log(`[verify-release-assets] mirror base = ${CN_MIRROR_BASE === '' ? '(空串＝镜像未上线，镜像段将 skipped)' : CN_MIRROR_BASE}`)
  const result = await verifyReleaseAssets({
    ...options,
    repo: VERIFY_REPO,
    githubApiBase: GITHUB_API_BASE,
    mirrorBase: CN_MIRROR_BASE,
    fetchJson,
    fetchText,
    fetchBytes,
  })
  for (const line of result.lines) console.log(`[verify-release-assets] ${line}`)
  if (result.defects.length === 0) {
    console.log(`[verify-release-assets] PASS：核对全绿（资产 ${result.summary.assetCount ?? '?'}/${result.summary.expectedCount ?? '?'}，缺陷 0）`)
    return 0
  }
  console.error(`[verify-release-assets] FAIL：发现 ${result.defects.length} 处缺陷（fail-closed，逐名如下）`)
  for (const defect of result.defects) console.error(`[verify-release-assets]   - [${defect.code}] ${defect.detail}`)
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => process.exit(code)).catch(error => {
    console.error(`[verify-release-assets] ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  })
}
