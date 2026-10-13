// MIG-ONECLICK-01 导入侧·录像导入注入脚本（browser iife，由 build.mjs 打包为
// dist/migrate-v127/import-recordings.js，随工具暂存到数据目录；桌面主进程在窗口加载
// 完成后经 webContents.executeJavaScript 执行——主进程无法直写渲染端 IndexedDB，
// 导入必须发生在页面上下文）。
// 保真关键（与导出页同一纪律）：校验/转换/落库代码直接 import 仓库正源——与新版页面
// 「导入录制」完全同一链（fetchEnv→configureRecordingNamespace→bulkImportRecordingFiles
// →validateCompactRecording→imports.save），不经手抄。脚本自身负责页内进度呈现（overlay）。
import { bulkImportRecordingFiles } from '../../../web/src/recording/bundle'
import { configureRecordingNamespace, importRecording, listRecordingLibrary } from '../../../web/src/recording/recordingRepository'

interface OneClickImportOutcome {
  ok: boolean
  imported?: number
  skipped?: number
  failed?: number
  error?: string
}

/** 页内进度条（fixed overlay；重复调用只更新文本） */
function mountOverlay(): (text: string) => void {
  let node = document.getElementById('v127-oneclick-overlay')
  if (!node) {
    node = document.createElement('div')
    node.id = 'v127-oneclick-overlay'
    node.setAttribute('role', 'status')
    node.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:440px;'
      + 'padding:10px 14px;border-radius:8px;background:#1f6978;color:#fff;'
      + 'font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);'
      + 'white-space:pre-wrap;word-break:break-all;'
    document.body.appendChild(node)
  }
  const target = node
  return text => { target.textContent = text }
}

async function importRecordings(bundleText: string): Promise<OneClickImportOutcome> {
  const show = mountOverlay()
  try {
    show('v1.2.7 迁移：正在准备导入训练录像…')
    // 与 App.vue reloadEnv 同链获取录像库命名空间（安装隔离；主进程不知晓该值）
    const response = await fetch('/api/env')
    if (!response.ok) throw new Error(`无法读取应用信息（HTTP ${response.status}）`)
    const env = await response.json() as { recordingNamespace?: unknown }
    const namespace = typeof env.recordingNamespace === 'string' ? env.recordingNamespace : ''
    if (!namespace) throw new Error('应用未提供录像库名（recordingNamespace），无法导入')
    configureRecordingNamespace(namespace)
    show('v1.2.7 迁移：正在读取录像合并包…')
    const file = new File([bundleText], 'v1.2.7-训练录像迁移.trainer-recordings.json', { type: 'application/json' })
    show('v1.2.7 迁移：正在逐条导入录像（重复自动跳过，不会覆盖既有录像）…')
    const outcome = await bulkImportRecordingFiles([file], {
      list: () => listRecordingLibrary(),
      import: (recording, fileName) => importRecording(recording, fileName),
    })
    const imported = outcome.imported.length
    const skipped = outcome.skipped.length
    const failed = outcome.failed.length
    const firstFailure = failed > 0 ? `；首条失败：${outcome.failed[0]!.label}——${outcome.failed[0]!.reason}` : ''
    show(failed > 0
      ? `v1.2.7 录像迁移完成：成功 ${imported} / 跳过 ${skipped} / 失败 ${failed}${firstFailure}`
      : `v1.2.7 录像迁移完成：成功 ${imported} 条、跳过 ${skipped} 条。可在「训练录像」页查看回放。`)
    return { ok: true, imported, skipped, failed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    show(`v1.2.7 录像迁移失败：${message}（下次启动训练器时会自动重试）`)
    return { ok: false, error: message }
  }
}

declare global {
  interface Window {
    /** 桌面主进程一键迁移注入的入口（bundle 文本→导入结果；由注入包装脚本调用） */
    __v127OneClickImport?: (bundleText: string) => Promise<OneClickImportOutcome>
  }
}

window.__v127OneClickImport = importRecordings
