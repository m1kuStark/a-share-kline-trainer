// MIG-01 控制台兜底（方案 C）：用户在旧训练器页面 F12 → Console 粘贴整段执行。
// 前提＝旧训练器正在运行且该页面就打开着（同源直接读 IndexedDB）；
// 录像库名从 /api/env 的 recordingNamespace 读取（与页面运行时完全同源）。
// 只读：不写不改不删任何旧数据；产物＝浏览器下载一个 REC-BULK 合并包。
import {
  buildMigrationBundle,
  collectMigrationItems,
  downloadMigrationBundle,
  openExistingDatabase,
  trainerDbNameFor,
} from './export-core'

function log(text: string): void {
  console.log(`[录像迁移] ${text}`)
}

async function run(): Promise<void> {
  const response = await fetch('/api/env')
  if (!response.ok) throw new Error(`读取 /api/env 失败（HTTP ${response.status}）——请确认本页面就是正在运行的旧训练器页面`)
  const env = await response.json() as { recordingNamespace?: string }
  if (!env.recordingNamespace) throw new Error('/api/env 未返回 recordingNamespace，无法定位录像库')
  const dbName = trainerDbNameFor(env.recordingNamespace)
  const main = await openExistingDatabase(dbName)
  if (!main) throw new Error(`未找到录像库 ${dbName}——本浏览器地址下没有旧录像，请确认用的是当时的浏览器`)
  const imports = await openExistingDatabase(`${dbName}.imports`)
  try {
    log(`读取录像库 ${dbName}（版本 ${main.version}）…`)
    const scan = await collectMigrationItems(main, imports)
    if (!scan.items.length) {
      log('录像库为空，没有可导出的训练录像。')
      return
    }
    const bundle = buildMigrationBundle(scan.items)
    const { blob, fileName } = downloadMigrationBundle(bundle)
    log(`已触发下载：${fileName}（${(blob.size / 1024).toFixed(1)} KB，共 ${scan.items.length} 条录像）。`)
    for (const row of scan.summaries) {
      log(`· ${row.sessionId} 事件 ${row.eventCount}${row.note ? `（${row.note}）` : ''}`)
    }
    if (scan.failures.length) {
      console.warn(`[录像迁移] ${scan.failures.length} 场存储损坏无法导出：`)
      for (const failure of scan.failures) console.warn(`[录像迁移] · ${failure.sessionId}：${failure.reason}`)
    }
    log('下一步：打开 v1.3.0 →「训练录像」→「导入录制」，选择刚下载的合并包文件。')
  } finally {
    main.db.close()
    imports?.db.close()
  }
}

void run().catch(error => {
  console.error(`[录像迁移] 导出失败：${error instanceof Error ? error.message : String(error)}`)
})
