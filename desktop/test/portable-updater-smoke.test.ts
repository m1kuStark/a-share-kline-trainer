// PORT-UPD-01 替换脚本真实 spawn 冒烟（Windows）：临时目录内以假 exe（.cmd）走完整
// 「等待旧进程退出→旧 exe 改 .old→staging 移入→删 .old→启动新 exe」链路；
// 回滚分支（staging 缺失→旧 exe 复位）与超时分支（旧进程未退→零触碰）行为验证。
// oracle：脚本退出码＋文件字节＋启动侧效标记（launched.flag），全部测试侧独立持有。
import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderReplaceScript } from '../src/portable-updater.js'

function runScript(scriptPath: string): Promise<{ code: number | null }> {
  return new Promise(resolve => {
    const child = spawn('cmd.exe', ['/d', '/s', '/c', scriptPath], { windowsHide: true })
    child.once('close', code => resolve({ code }))
  })
}

/** 一个已退出的进程 pid（tasklist 查不到 → 脚本立即进入替换段） */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true })
  const pid = child.pid
  await new Promise<void>(resolve => child.once('exit', () => resolve()))
  return pid ?? 0
}

/** 可执行的新「exe」：.cmd 写启动标记后退出（start "" /B 可拉起） */
function newExeBatch(markerPath: string): string {
  return `@echo off\r\ntype nul > "${markerPath}"\r\nexit /b 0\r\n`
}

describe('PORT-UPD-01 替换脚本·真实 spawn 冒烟（win32）', () => {
  it('替换成功：旧 exe→.old→staging 就位→.old 清除→新 exe 启动（exit 0）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-smoke-'))
    try {
      const exePath = join(root, 'trainer-app.cmd')
      const stagingDir = join(root, 'data', 'update-staging')
      const stagingExe = join(stagingDir, 'kline-trainer-desktop-v9.9.9-windows-x64.cmd')
      const marker = join(root, 'launched.flag')
      await mkdir(stagingDir, { recursive: true })
      await writeFile(exePath, '@echo off\r\nexit /b 0\r\n')
      await writeFile(stagingExe, newExeBatch(marker))
      const scriptPath = join(stagingDir, 'update-replace.cmd')
      await writeFile(scriptPath, renderReplaceScript({
        exePath, stagingExe,
        oldExe: `${exePath}.old`,
        logPath: join(stagingDir, 'replace.log'),
        pid: await deadPid(),
      }), 'utf8')

      const { code } = await runScript(scriptPath)
      expect(code).toBe(0)
      // 新字节就位；.old 已清；新「exe」真实启动过
      expect(await readFile(exePath, 'utf8')).toBe(newExeBatch(marker))
      await expect(readFile(`${exePath}.old`)).rejects.toThrow()
      expect(await readFile(marker, 'utf8')).toBe('')
      expect((await readFile(join(stagingDir, 'replace.log'), 'utf8')).length).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('替换失败回滚：staging 缺失 → 旧 exe 原样复位（exit 4，无 .old 残留）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-smoke-'))
    try {
      const exePath = join(root, 'trainer-app.cmd')
      const stagingDir = join(root, 'data', 'update-staging')
      const stagingExe = join(stagingDir, 'missing-new-exe.cmd')
      await mkdir(stagingDir, { recursive: true })
      const oldBytes = '@echo off\r\nrem OLD EXE\r\nexit /b 0\r\n'
      await writeFile(exePath, oldBytes)
      const scriptPath = join(stagingDir, 'update-replace.cmd')
      await writeFile(scriptPath, renderReplaceScript({
        exePath, stagingExe,
        oldExe: `${exePath}.old`,
        logPath: join(stagingDir, 'replace.log'),
        pid: await deadPid(),
      }), 'utf8')

      const { code } = await runScript(scriptPath)
      expect(code).toBe(4)
      expect(await readFile(exePath, 'utf8')).toBe(oldBytes)
      await expect(readFile(`${exePath}.old`)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('旧进程未退出（超时）→ 零触碰（exit 2，exe 字节不变）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'portable-smoke-'))
    let blocker: ReturnType<typeof spawn> | null = null
    try {
      const exePath = join(root, 'trainer-app.cmd')
      const stagingDir = join(root, 'data', 'update-staging')
      const stagingExe = join(stagingDir, 'new.cmd')
      await mkdir(stagingDir, { recursive: true })
      const oldBytes = '@echo off\r\nrem OLD EXE\r\nexit /b 0\r\n'
      await writeFile(exePath, oldBytes)
      await writeFile(stagingExe, newExeBatch(join(root, 'launched.flag')))
      // 活进程：~10s 的 ping 占位（tasklist 可见其 pid）
      blocker = spawn('cmd.exe', ['/d', '/c', 'ping -n 10 127.0.0.1 >nul'], { windowsHide: true })
      const scriptPath = join(stagingDir, 'update-replace.cmd')
      await writeFile(scriptPath, renderReplaceScript({
        exePath, stagingExe,
        oldExe: `${exePath}.old`,
        logPath: join(stagingDir, 'replace.log'),
        pid: blocker.pid ?? -1,
        maxTries: 1,
      }), 'utf8')

      const { code } = await runScript(scriptPath)
      expect(code).toBe(2)
      expect(await readFile(exePath, 'utf8')).toBe(oldBytes)
      expect(await readFile(stagingExe, 'utf8')).toContain('@echo off')
    } finally {
      blocker?.kill()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
