// GAP1-DIAG 设置页「复制诊断信息」前端纯逻辑（web/src/diagnosticsFlow.ts）。
// 独立 oracle 原则：期望文案/数值全部来自 GAP1-DIAG 开工简报冻结的 proposed_default
// （反馈文案、3 秒停留、失败前缀），非实现回显；取数方式沿用 updater-ui.test.ts 的
// 「读取 web 源码＋ts.transpile 提取执行」模式——测的是真实导出，不在测试里复制实现。
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/** 执行 web/src/diagnosticsFlow.ts 真实模块（CommonJS 转译；该模块不得有 Vue/浏览器依赖） */
async function loadDiagnosticsFlowModule(): Promise<Record<string, unknown>> {
  const source = await readFile(new URL('../../web/src/diagnosticsFlow.ts', import.meta.url), 'utf8')
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
  const exports_: Record<string, unknown> = {}
  new Function('exports', 'require', js)(exports_, (name: string): unknown => {
    throw new Error(`意外的依赖引用：${name}（diagnosticsFlow.ts 必须零依赖纯函数）`)
  })
  return exports_
}

describe('GAP1-DIAG: diagnosticsFlow 纯呈现逻辑（DESKTOP-DIAG-CLIPBOARD web 侧）', () => {
  it('detectDesktopDiagnostics accepts only the copyDiagnostics function shape (fail-closed)', async () => {
    const mod = await loadDiagnosticsFlowModule()
    const detect = mod.detectDesktopDiagnostics as (source: unknown) => unknown
    // fail-closed：无桥/坏形状一律 null（纯浏览器形态按钮不渲染的判定基础）
    expect(detect(undefined)).toBe(null)
    expect(detect(null)).toBe(null)
    expect(detect('desktopDiagnostics')).toBe(null)
    expect(detect({})).toBe(null)
    expect(detect({ copyDiagnostics: 'not-a-function' })).toBe(null)
    const good = { copyDiagnostics: async () => ({ ok: true as const }) }
    expect(detect(good)).toBe(good)
  })

  it('freezes the proposed_default copy feedback constants', async () => {
    const mod = await loadDiagnosticsFlowModule()
    expect(mod.DIAG_COPY_DONE_TEXT).toBe('已复制，可粘贴到问题反馈')
    expect(mod.DIAG_FEEDBACK_MS).toBe(3000)
    expect(mod.DIAG_COPY_FAILED_PREFIX).toBe('复制失败：')
  })
})
