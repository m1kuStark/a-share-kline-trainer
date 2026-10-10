// MIG-01 导出页入口：读取工具服务注入的 window.__V127_INFO__（端口/录像库名），
// 扫描同源 IndexedDB → 渲染清单 → 导出合并包。与控制台兜底脚本共用 export-core。
import {
  buildMigrationBundle,
  collectMigrationItems,
  discoverTrainerDbNames,
  downloadMigrationBundle,
  listIndexedDbNames,
  openExistingDatabase,
  trainerDbNameFor,
  type MigrationItemSummary,
  type MigrationScanOutcome,
} from './export-core'

interface V127PageInfo {
  port: number
  namespace: string | null
  namespaceSource: 'sqlite-cache-meta' | 'none'
  dataDir: string | null
  databasePath: string | null
}

declare global {
  interface Window { __V127_INFO__: V127PageInfo | null }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`页面缺少元素 #${id}`)
  return node as T
}

function showStatus(text: string, kind: 'ok' | 'err'): void {
  const box = el<HTMLDivElement>('status')
  box.style.display = 'block'
  box.className = `status ${kind}`
  box.textContent = text
}

const SOURCE_LABELS: Record<MigrationItemSummary['source'], string> = {
  'local-compact': '本机录像',
  'local-legacy': '本机录像·旧格式',
  'local-legacy-raw': '本机录像·原样入包',
  imported: '导入的分享录像',
  'imported-raw': '导入的分享·原样入包',
}

function renderList(scan: MigrationScanOutcome): void {
  const body = el<HTMLTableSectionElement>('list-body')
  body.textContent = ''
  for (const row of scan.summaries) {
    const tr = document.createElement('tr')
    const source = document.createElement('td')
    const tag = document.createElement('span')
    tag.className = `tag ${row.source}`
    tag.textContent = SOURCE_LABELS[row.source]
    source.appendChild(tag)
    const session = document.createElement('td')
    session.textContent = row.sessionId.length > 18 ? `${row.sessionId.slice(0, 8)}…${row.sessionId.slice(-6)}` : row.sessionId
    session.title = row.sessionId
    const key = document.createElement('td')
    key.textContent = row.trainingKey ?? '（无）'
    const count = document.createElement('td')
    count.textContent = String(row.eventCount)
    const state = document.createElement('td')
    state.textContent = row.note ?? '可迁移'
    if (row.note) state.className = 'note'
    tr.append(source, session, key, count, state)
    body.appendChild(tr)
  }
  if (scan.failures.length) {
    const failures = el<HTMLParagraphElement>('list-failures')
    failures.style.display = 'block'
    failures.textContent = `另有 ${scan.failures.length} 场因存储损坏无法导出（不会静默丢弃，如实列出）：\n` +
      scan.failures.map(f => `· ${f.sessionId}：${f.reason}`).join('\n')
  }
  el('list').style.display = 'block'
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function runScan(dbNames: { main: string; imports: string }): Promise<MigrationScanOutcome | null> {
  const main = await openExistingDatabase(dbNames.main)
  if (!main) return null
  const imports = await openExistingDatabase(dbNames.imports)
  try {
    return await collectMigrationItems(main, imports)
  } finally {
    main.db.close()
    imports?.db.close()
  }
}

async function resolveDbNames(): Promise<{ names: { main: string; imports: string } | null; discovered: { main: string; imports: string }[] }> {
  const info = window.__V127_INFO__
  if (info?.namespace) {
    return { names: { main: trainerDbNameFor(info.namespace), imports: `${trainerDbNameFor(info.namespace)}.imports` }, discovered: [] }
  }
  const all = (await listIndexedDbNames()) ?? []
  return { names: null, discovered: discoverTrainerDbNames(all) }
}

function detectRows(info: V127PageInfo | null, extra: Array<[string, string]> = []): void {
  const dl = el<HTMLDListElement>('detect-info')
  dl.textContent = ''
  const rows: Array<[string, string]> = [
    ['当前地址（必须与旧训练器一致）', location.origin],
    ['旧训练器数据目录', info?.dataDir ?? '（未检测到）'],
    ['训练库文件', info?.databasePath ?? '（未检测到）'],
    ['录像库名', info?.namespace ? `trainer-recordings.${info.namespace}` : '（未能从训练库读取，见下方选择）'],
    ...extra,
  ]
  for (const [term, value] of rows) {
    const dt = document.createElement('dt')
    dt.textContent = term
    const dd = document.createElement('dd')
    dd.textContent = value
    dl.append(dt, dd)
  }
}

async function bootstrap(): Promise<void> {
  const info = window.__V127_INFO__
  const { names, discovered } = await resolveDbNames()

  if (!names && discovered.length !== 1) {
    detectRows(info, discovered.length > 1
      ? [['发现多个录像库', `${discovered.length} 个（见下方选择，来源＝本浏览器该地址下的 IndexedDB）`]]
      : [])
    if (discovered.length > 1) {
      const wrap = el<HTMLDivElement>('detect-choice')
      wrap.style.display = 'block'
      const radios = el<HTMLDivElement>('db-radios')
      radios.textContent = ''
      for (const candidate of discovered) {
        const label = document.createElement('label')
        const input = document.createElement('input')
        input.type = 'radio'
        input.name = 'v127-db'
        input.value = candidate.main
        label.append(input, document.createTextNode(candidate.main))
        radios.appendChild(label)
      }
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = '使用选中的录像库'
      button.addEventListener('click', async () => {
        const checked = radios.querySelector<HTMLInputElement>('input:checked')
        if (!checked) { showStatus('请先选择一个录像库。', 'err'); return }
        await proceed({ main: checked.value, imports: `${checked.value}.imports` })
      })
      wrap.appendChild(button)
      return
    }
    el('detect-none').style.display = 'block'
    return
  }

  const chosen = names ?? discovered[0]!
  await proceed(chosen)
}

let lastScan: MigrationScanOutcome | null = null

async function proceed(dbNames: { main: string; imports: string }): Promise<void> {
  const info = window.__V127_INFO__
  const scan = await runScan(dbNames)
  if (!scan) {
    detectRows(info, [['录像库', `${dbNames.main}（存在但打开失败）`]])
    el('detect-none').style.display = 'block'
    return
  }
  lastScan = scan
  detectRows(info, [[
    '扫描结果',
    `本机 ${scan.summaries.filter(s => s.source.startsWith('local')).length} 场 ＋ 导入 ${scan.summaries.filter(s => s.source.startsWith('imported')).length} 场` +
    (scan.failures.length ? `；损坏 ${scan.failures.length} 场` : ''),
  ]])
  renderList(scan)

  el<HTMLButtonElement>('export-btn').addEventListener('click', () => {
    if (!lastScan || !lastScan.items.length) { showStatus('没有可导出的录像。', 'err'); return }
    try {
      const bundle = buildMigrationBundle(lastScan.items)
      const text = JSON.stringify(bundle)
      const { blob, fileName } = downloadMigrationBundle(bundle)
      void sha256Hex(text).then(digest => {
        showStatus(
          `已开始下载：${fileName}（${(blob.size / 1024).toFixed(1)} KB）\n` +
          `共 ${lastScan!.items.length} 条录像；文件校验和 SHA-256：${digest}\n` +
          '若浏览器没有弹出下载，请检查下载设置后重试。完成导入后可点击下方「完成并关闭工具」。',
          'ok',
        )
      })
      el('done').style.display = 'block'
    } catch (error) {
      showStatus(`导出失败：${error instanceof Error ? error.message : String(error)}`, 'err')
    }
  })

  el<HTMLButtonElement>('sqlite-btn').addEventListener('click', async () => {
    showStatus('正在打包 SQLite 训练库…', 'ok')
    try {
      const response = await fetch('/pack-sqlite', { method: 'POST' })
      const result = await response.json() as { ok?: boolean; folder?: string; error?: string }
      if (!response.ok || !result.ok) throw new Error(result.error ?? `HTTP ${response.status}`)
      showStatus(`SQLite 训练库已复制到：${result.folder}\n该文件夹在旧版本程序文件夹下，可整体拷走。默认升级（新版本解压到旧文件夹）无需此步。`, 'ok')
    } catch (error) {
      showStatus(`打包失败：${error instanceof Error ? error.message : String(error)}`, 'err')
    }
  })

  el<HTMLButtonElement>('shutdown-btn').addEventListener('click', async () => {
    try { await fetch('/shutdown', { method: 'POST' }) } catch { /* 服务已退出 */ }
    showStatus('工具已退出，可以关闭本页面。', 'ok')
  })
}

void bootstrap().catch(error => {
  showStatus(`初始化失败：${error instanceof Error ? error.message : String(error)}`, 'err')
})
