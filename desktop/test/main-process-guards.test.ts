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
    expect(uncaught![1]).toMatch(/console\.error/)
    const rejection = /process\.on\(\s*['"]unhandledRejection['"][\s\S]*?=>\s*\{([\s\S]*?)\r?\n\}/.exec(source)
    expect(rejection, 'unhandledRejection 处理体可定位').not.toBeNull()
    expect(rejection![1]).not.toMatch(/process\.exit|app\.exit|app\.quit/)
    expect(rejection![1]).toMatch(/console\.error/)
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
