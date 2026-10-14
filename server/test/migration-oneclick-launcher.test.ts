// MIG-ONECLICK-LAUNCHER-CN：启动器报错中文化＋自诊断增强的形状契约与工具节点锁定。
// 用户 oracle（2026-10-15）：「迁移工具在 v1.2.7 版本训练器目录中运行后……为英文，
// 但是在 v1.3.x 目录中运行后，打印内容为中文，请将风格进行统一，并解决当前报错信息」。
// 锁定三个面：
// ① static 两个启动器 .cmd：无英文报错句式、ASCII-only（cmd 内中文在部分 Windows 构建
//   解析损坏——W3 实证），中文经 PowerShell 通道输出（launcher-print.ps1 读 UTF-8 文案
//   launcher-messages.txt；动态值如工具文件夹路径走环境变量，不内插进命令）；
// ② oneclick.cjs detectOneClickMode unknown 分支：reason 追加已检测特征清单＋父目录
//   内容摘要（前 10 项，超长截断）——用户再遇到报错时信息自足（触发链未定论的自诊断兜底）；
// ③ 冒烟（Windows 门控）：真实 cmd→powershell→文案 链在非安装目录场景退出码 1 且输出中文。
// oracle 独立性：英文黑名单取用户截图原文与旧实现实报句式；中文哨兵用「未找到」「已检测特征」
// 与临时目录随机文件名（实现措辞无法预知哨兵名）；观测面活性先置检查防 vacuous。
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import oneclick from '../../tools/migrate-v127/dist/migrate-v127/oneclick.cjs'

const detectOneClickMode = (oneclick as Record<string, unknown>).detectOneClickMode as (
  parentDir: string,
) => Promise<{ mode: string, reason?: string }>

const read = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf8')

const staticCmd = '../../tools/migrate-v127/static/一键迁移.cmd'
const staticExportCmd = '../../tools/migrate-v127/static/导出训练录像.cmd'
const staticMessages = '../../tools/migrate-v127/static/launcher-messages.txt'
const staticPrinter = '../../tools/migrate-v127/static/launcher-print.ps1'
const distDir = '../../tools/migrate-v127/dist/migrate-v127'

/** Buffer 中第一个非 ASCII 字节的偏移；全 ASCII 返回 -1 */
function firstNonAsciiOffset(buffer: Buffer): number {
  return buffer.findIndex(byte => byte > 0x7f)
}

// ===== ① 启动器 .cmd 源形状契约 =====

describe('MIG-ONECLICK-LAUNCHER-CN 启动器源形状', () => {
  it('两个启动器 cmd 不含用户可见英文报错句式（黑名单＋英文长句行泛化）', async () => {
    const knownEnglishSnippets = [
      'must sit INSIDE',            // 用户截图原文（位置不对报错）
      'Migration did not complete', // 旧版一键迁移.cmd 运行失败尾句
      'Incomplete installation',    // 旧版导出训练录像.cmd 检测失败报错
      'Migration export failed',    // 旧版导出训练录像.cmd 运行失败尾句
    ]
    // 泛化：echo 后跟长串纯 ASCII（字母数字标点空格）视为英文输出行；echo.（空行）除外
    const englishEchoLine = /^[ \t]*echo\s+[A-Za-z][A-Za-z0-9 ,.:;()&/\\'"-]{14,}\s*$/m
    for (const cmdPath of [staticCmd, staticExportCmd]) {
      const text = await read(cmdPath)
      // 观测面活性：读到的确是启动器源（检测结构仍在）
      expect(text).toContain('%~dp0')
      expect(text).toContain('chcp 65001')
      for (const snippet of knownEnglishSnippets) expect(text, `${cmdPath} 仍含英文句式 ${snippet}`).not.toContain(snippet)
      const englishLines = text.match(englishEchoLine)
      expect(englishLines, `${cmdPath} 仍有英文输出行：${englishLines?.[0] ?? ''}`).toBeNull()
    }
  })

  it('两个启动器 cmd 为 ASCII-only（cmd 内中文在部分 Windows 构建解析损坏）', async () => {
    for (const cmdPath of [staticCmd, staticExportCmd]) {
      const buffer = Buffer.from(await read(cmdPath), 'utf8')
      const offender = firstNonAsciiOffset(buffer)
      expect(offender, `${cmdPath} 含非 ASCII 字节于偏移 ${offender}`).toBe(-1)
    }
  })

  it('启动器经 PowerShell 通道输出中文（调 launcher-print.ps1＋动态值走环境变量）', async () => {
    for (const cmdPath of [staticCmd, staticExportCmd]) {
      const text = await read(cmdPath)
      expect(text).toContain('powershell -NoProfile')
      expect(text).toContain('launcher-print.ps1')
      expect(text).toContain('MIG_TOOL_DIR')
      expect(text).toContain('MIG_MSG_FILE')
    }
  })

  it('中文文案资源 launcher-messages.txt 为 UTF-8 且含报错要素（特征词＋指引＋路径占位）', async () => {
    expect(existsSync(fileURLToPath(new URL(staticMessages, import.meta.url)))).toBe(true)
    const text = await read(staticMessages)
    // UTF-8 解码后中文可读（若被写成 GBK 等编码，以下中文哨兵将乱码失配）
    expect(text).toContain('未找到')
    expect(text).toContain('migrate-v127')
    expect(text).toContain('K线训练器.exe')
    expect(text).toContain('Start.cmd')
    expect(text).toContain('{TOOL_DIR}')
  })

  it('打印器 launcher-print.ps1 为 ASCII-only 且从环境变量读动态值', async () => {
    expect(existsSync(fileURLToPath(new URL(staticPrinter, import.meta.url)))).toBe(true)
    const buffer = Buffer.from(await read(staticPrinter), 'utf8')
    const offender = firstNonAsciiOffset(buffer)
    expect(offender, `launcher-print.ps1 含非 ASCII 字节于偏移 ${offender}`).toBe(-1)
    const text = buffer.toString('utf8')
    expect(text).toContain('launcher-messages.txt')
    expect(text).toContain('MIG_TOOL_DIR')
    expect(text).toContain('UTF8')
  })

  it('dist 发布副本与 static 源逐字节同步（锁 build 忘跑）', async () => {
    for (const name of ['一键迁移.cmd', '导出训练录像.cmd', 'launcher-print.ps1', 'launcher-messages.txt', 'oneclick.cjs']) {
      const source = name === 'oneclick.cjs'
        ? await read('../../tools/migrate-v127/src/oneclick.cjs')
        : await read(`../../tools/migrate-v127/static/${name}`)
      const dist = await read(`${distDir}/${name}`)
      expect(dist, `${name} 与源不同步（是否忘跑 node tools/migrate-v127/build.mjs）`).toBe(source)
    }
  })
})

// ===== ② cjs 自诊断（detectOneClickMode unknown 分支） =====

describe('MIG-ONECLICK-LAUNCHER-CN 检测失败自诊断（detectOneClickMode unknown）', () => {
  it('unknown 分支 reason 含已检测特征清单与父目录内容摘要（哨兵文件名可查）', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'oneclick-launcher-selfdiag-'))
    await writeFile(join(parent, 'zz-selfdiag-marker-a.txt'), '', 'utf8')
    await writeFile(join(parent, 'zz-selfdiag-marker-b.txt'), '', 'utf8')
    await writeFile(join(parent, 'Uninstall K线训练器.exe'), '', 'utf8')
    const outcome = await detectOneClickMode(parent)
    expect(outcome.mode).toBe('unknown')
    expect(outcome.reason).toBeTruthy()
    const reason = outcome.reason!
    // 特征清单（任务卡句式）：runtime\node.exe 与 K 系 exe 两特征的检测结果
    expect(reason).toContain('已检测特征')
    expect(reason).toContain('runtime')
    expect(reason).toContain('node.exe')
    expect(reason).toContain('未找到')
    // 父目录内容摘要：哨兵文件名出现（实现措辞无法预知哨兵名）
    expect(reason).toContain('zz-selfdiag-marker-a.txt')
    expect(reason).toContain('zz-selfdiag-marker-b.txt')
    // 既有指引保留（回归锚：migrate-v127 指引词仍在）
    expect(reason).toContain('migrate-v127')
  })

  it('unknown 分支父目录超过 10 项时摘要截断并给出总项数', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'oneclick-launcher-trunc-'))
    for (let index = 1; index <= 12; index += 1) {
      await writeFile(join(parent, `zz-trunc-item-${String(index).padStart(2, '0')}.txt`), '', 'utf8')
    }
    const outcome = await detectOneClickMode(parent)
    expect(outcome.mode).toBe('unknown')
    const reason = outcome.reason!
    // 顺序无关：readdir 顺序不保证，只锁「恰好保留 10 项＋总数披露」语义
    const mentioned = reason.match(/zz-trunc-item-\d{2}\.txt/g) ?? []
    expect(mentioned.length).toBe(10)
    expect(reason).toContain('共 12 项')
  })
})

// ===== ③ 冒烟：真实 cmd→powershell→文案 链（Windows 门控；临时目录不碰用户数据） =====

describe('MIG-ONECLICK-LAUNCHER-CN 冒烟（真实启动器链）', () => {
  it.skipIf(process.platform !== 'win32')('非安装目录场景下 一键迁移.cmd 退出码 1 且输出中文报错（含位置与特征）', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'oneclick-launcher-smoke-'))
    const toolDir = join(parent, 'migrate-v127')
    await mkdir(toolDir, { recursive: true })
    for (const name of ['一键迁移.cmd', 'launcher-print.ps1', 'launcher-messages.txt']) {
      await copyFile(fileURLToPath(new URL(`../../tools/migrate-v127/static/${name}`, import.meta.url)), join(toolDir, name))
    }
    // 入口脚本源在 src/（build 时复制进 dist；同步性由 dist 同步用例锁定）
    await copyFile(fileURLToPath(new URL('../../tools/migrate-v127/src/oneclick.cjs', import.meta.url)), join(toolDir, 'oneclick.cjs'))
    const result = spawnSync('cmd.exe', ['/d', '/c', join(toolDir, '一键迁移.cmd')], {
      input: '\r\n',
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(result.status).toBe(1)
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
    // 观测面活性：确实产生了输出再断言内容（防 vacuous）
    expect(out.length).toBeGreaterThan(10)
    expect(out).toContain('[错误]')
    expect(out).toContain('未找到')
    expect(out).toContain('migrate-v127')
    expect(out).toContain(parent)
  })

  it.skipIf(process.platform !== 'win32')('非 v1.2.7 目录场景下 导出训练录像.cmd 退出码 1 且输出中文报错', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'oneclick-launcher-smoke-export-'))
    const toolDir = join(parent, 'migrate-v127')
    await mkdir(toolDir, { recursive: true })
    for (const name of ['导出训练录像.cmd', 'launcher-print.ps1', 'launcher-messages.txt']) {
      await copyFile(fileURLToPath(new URL(`../../tools/migrate-v127/static/${name}`, import.meta.url)), join(toolDir, name))
    }
    const result = spawnSync('cmd.exe', ['/d', '/c', join(toolDir, '导出训练录像.cmd')], {
      input: '\r\n',
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(result.status).toBe(1)
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(out.length).toBeGreaterThan(10)
    expect(out).toContain('[错误]')
    expect(out).toContain('未找到')
    expect(out).toContain('migrate-v127')
  })
})
