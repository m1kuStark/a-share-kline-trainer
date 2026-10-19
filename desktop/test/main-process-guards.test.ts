// P0-4（PORT-UPD-01）主进程异常兜底与网络换线源码契约。
// 矩阵行：UPD-NET-ROBUST-PROCESS-WIDE（planned → 本文件提供绑定面）。
// main.ts 的 uncaughtException/unhandledRejection 兜底属 Electron 粘合层（import
// electron 的文件无法在 vitest 直接加载），按既有「主进程粘合源码契约」先例
// （desktop-updates.test.ts 的 PACK-04 契约段）以源码正则锁定注册存在与不退出语义；
// port-conflict.ts 的网络换线同样以源码契约锁定（行为级由 port-conflict-network.test.ts
// 真实 http 用例承担）。CRLF 工作树兼容：契约正则一律用 \s 或 [\s\S] 而非字面 \n。
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

async function readSource(relative: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('UPD-NET-ROBUST-PROCESS-WIDE: main.ts 主进程异常兜底（源码契约）', () => {
  it('registers uncaughtException and unhandledRejection handlers that log and keep the process alive', async () => {
    const source = await readSource('../src/main.ts')
    // 两类兜底都必须注册：缺任一＝对应异常回落 Electron 默认弹窗（用户真机崩溃形态）
    expect(source).toMatch(/process\.on\(\s*['"]uncaughtException['"]/)
    expect(source).toMatch(/process\.on\(\s*['"]unhandledRejection['"]/)
    // 兜底＝完整记录后不退出进程：处理体内不得调用任何退出动作（proposed_default）；
    // 正则兼容单参数无括号箭头函数（error => {...}）与括号形式
    const uncaught = /process\.on\(\s*['"]uncaughtException['"][\s\S]*?=>\s*\{([\s\S]*?)\r?\n\}/.exec(source)
    expect(uncaught, 'uncaughtException 处理体可定位').not.toBeNull()
    expect(uncaught![1]).not.toMatch(/process\.exit|app\.exit|app\.quit/)
    // GAP1-DIAG（2026-10-19）：日志收口经 mainLog（tee＝console 透传＋<dataDir>/logs/main.log
    // 落盘；console 透传由 diag-log.test.ts 的 tee 用例独立锁定），不再直呼 console.error。
    expect(uncaught![1]).toMatch(/mainLog\.error|console\.error/)
    const rejection = /process\.on\(\s*['"]unhandledRejection['"][\s\S]*?=>\s*\{([\s\S]*?)\r?\n\}/.exec(source)
    expect(rejection, 'unhandledRejection 处理体可定位').not.toBeNull()
    expect(rejection![1]).not.toMatch(/process\.exit|app\.exit|app\.quit/)
    expect(rejection![1]).toMatch(/mainLog\.error|console\.error/)
  })
})

// UPD-QUIT-TYPEERROR-GUARD（2026-10-11 用户真机截图第三形态，2026-10-12 拍板）：
// 更新退出瞬间主进程弹 TypeError: Cannot read properties of undefined (reading
// 'message')。P0-4 兜底未拦的机理：Electron 默认崩溃窗（lib/browser/init.ts）本身是
// 一个 uncaughtException 监听器，listenerCount>1 即自禁——我方兜底注册后正常存活期的
// 任何进程级异常都不可能再弹该窗；弹窗＝异常落入 JS 兜底失效的窗口（teardown 撕裂期
// 或注册前）。故根治面＝退出/启动路径我方代码零无守卫 .message 读取＋兜底 handler 自身
// 永不直接解引用 error＋注册时机压到模块体第一条语句（ESM import 无法前移）。
describe('UPD-QUIT-TYPEERROR-GUARD: 退出路径 undefined error 形态守卫（源码契约）', () => {
  it('no unguarded error-message read: every error.message access in main.ts is undefined-safe or guarded', async () => {
    const source = await readSource('../src/main.ts')
    // 崩溃形态逐字锁定：无守卫的 (error as Error).message 直读——catch 到 undefined error
    // 即复现用户截图的 TypeError（CONFLICT_DIALOG.message 是函数属性，非 error 对象读取）。
    expect(source).not.toMatch(/\(error as Error\)\.message/)
    // 全量审计面：main.ts 里每个含 .message 读取的行，其本行或紧邻上一行必须出现守卫形态
    // （instanceof Error 三元 / ?. 可选链），或是与 error 无关的函数属性（CONFLICT_DIALOG）。
    const lines = source.split(/\r?\n/)
    const hits: Array<{ index: number, line: string }> = []
    lines.forEach((line, index) => {
      if (/\.message/.test(line)) hits.push({ index, line })
    })
    expect(hits.length).toBeGreaterThan(0) // 审计面非空：文件内确有读取点
    for (const hit of hits) {
      const context = `${lines[hit.index - 1] ?? ''}\n${hit.line}`
      expect(
        /instanceof Error|CONFLICT_DIALOG|\?\.message/.test(context),
        `发现无守卫的 .message 读取点（第 ${hit.index + 1} 行）：${hit.line.trim()}`,
      ).toBe(true)
    }
  })

  it('uncaught fallback handlers never dereference the error object directly: formatting goes through the guarded helper', async () => {
    const source = await readSource('../src/main.ts')
    // handler 自身抛错＝Electron 对 handler 内异常仍走默认崩溃路径（已知逃逸通道）：
    // 处理体只准守卫过的格式化助手＋console.error，不得直接触碰 error 的属性。
    expect(source).toMatch(/function formatUnknownError\(error: unknown\): string/)
    for (const name of ['uncaughtException', 'unhandledRejection'] as const) {
      const body = new RegExp(`process\\.on\\(\\s*['"]${name}['"][\\s\\S]*?=>\\s*\\{([\\s\\S]*?)\\r?\\n\\}`).exec(source)
      expect(body, `${name} 处理体可定位`).not.toBeNull()
      expect(body![1]).toContain(`formatUnknownError(${name === 'uncaughtException' ? 'error' : 'reason'})`)
      // GAP1-DIAG（2026-10-19）：日志收口经 mainLog（tee；console 透传由 diag-log.test.ts 锁定）
      expect(body![1]).toMatch(/mainLog\.error|console\.error/)
      expect(body![1]).not.toMatch(/process\.exit|app\.exit|app\.quit/)
      expect(body![1]).not.toMatch(/\.(stack|message)\b/)
    }
  })

  it('handler registration is the earliest module-body statement: ahead of consts, ipc registration and boot branches', async () => {
    const source = await readSource('../src/main.ts')
    const onIndex = source.search(/process\.on\(\s*['"]uncaughtException['"]/)
    expect(onIndex).toBeGreaterThanOrEqual(0)
    // ESM import 先于一切模块体语句（注册无法前移到 import 前）——可做的最早点＝模块体
    // 第一段语句；晚于任何顶层语句（含 const 定义、IPC 注册副作用、单实例分支）都意味着
    // 该语句抛错时兜底尚未生效（用户形态的注册前窗口）。
    for (const marker of [
      'const DEV_WINDOW_URL',
      'registerArchiveIpc(',
      'registerMigrationIpc(',
      'app.requestSingleInstanceLock',
      'app.whenReady',
    ]) {
      const markerIndex = source.indexOf(marker)
      expect(markerIndex, `兜底注册必须先于 ${marker}`).toBeGreaterThan(onIndex)
    }
  })

  it('quitAndInstall call site catches synchronous adapter throws and falls back to plain quit', async () => {
    const source = await readSource('../src/main.ts')
    // 适配器/底层（electron-updater 等）同步抛错不得逃逸出 exit 分支：逃逸＝异步链上的
    // 未捕获异常（teardown 窗口内即崩溃弹窗形态）或退出悬挂。就地记录＋app.quit() 兜底。
    const guarded = /try\s*\{\s*\r?\n\s*updateAdapterRef\?\.quitAndInstall\(true, true\)\s*\r?\n\s*\}\s*catch\s*\(error\)\s*\{[\s\S]*?app\.quit\(\)/.exec(source)
    expect(guarded, 'quitAndInstall 调用点必须 try/catch 包裹且 catch 内回落 app.quit').not.toBeNull()
  })
})

describe('UPD-NET-ROBUST-PROCESS-WIDE: port-conflict.ts 网络换线（源码契约）', () => {
  it('probes health via the safe-http native layer and no longer calls global fetch', async () => {
    const source = await readSource('../src/port-conflict.ts')
    expect(source, '不得再出现全局 fetch 调用（undici 崩溃源）').not.toMatch(/\bfetch\(/)
    expect(source, '探测实现须引用 safe-http 原生网络层产物').toMatch(/server\/dist\/update\/safe-http\.js/)
    expect(source, '保持 launcher redirect 拒绝语义（redirects: \'error\'）').toMatch(/redirects:\s*['"]error['"]/)
  })
})
