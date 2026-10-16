// INSTALL-01（2026-10-11 用户拍板，矩阵行 INSTALL-NSIS-ASSISTED）发布管线单测：
//   release-desktop.mjs 编排源码契约——便携产物退役：electron-builder 仅 nsis 目标、
//   latest.yml 不再追加便携条目（extendLatestYmlWithPortable 已随调用点删除——原
//   PORT-UPD-01 便携条目扩展行为整体退役，锁行为两段用例随之退役，双向留痕见任务收尾报告；
//   便携 exe 的运行时自更新模块 portable-updater.ts 本体保留一个版本周期防回滚）。
// UIUX-release（2026-10-16 用户拍板 v1.2.7 弃用）：PORT-UPD-01 的 migrate-v127.zip 写入器/
//   目录收集两段用例随产物退役移除（buildStoredZip/collectMigrateZipEntries 已从
//   release-desktop.mjs 删除；server UPD-01 zip 读取器由 server 侧自身用例覆盖）。
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('INSTALL-01: release-desktop.mjs orchestration (source contract)', () => {
  it('builds the nsis target only and no longer extends latest.yml with a portable entry', async () => {
    const source = await readFile(join(repoRoot, 'desktop', 'scripts', 'release-desktop.mjs'), 'utf8')
    // electron-builder 双目标收敛为单目标：--win nsis（portable 不再出现在构建参数）
    expect(source).toMatch(/'--win',\s*'nsis'/)
    expect(source).not.toMatch(/'--win',\s*'nsis',\s*'portable'/)
    // 便携条目扩展函数与调用已删除（死代码清理；运行时便携更新器读不到条目＝fail-closed 拒装，符合拍板）
    expect(source).not.toMatch(/extendLatestYmlWithPortable/)
    // 便携产物 fail-closed 存在性检查已退役：脚本不得再因缺便携 exe 而失败
    expect(source).not.toMatch(/portable exe missing/)
  })

  it('UIUX-release：migrate-v127 产物已退役——脚本不再产出/引用迁移 zip 与其构建输入', async () => {
    const source = await readFile(join(repoRoot, 'desktop', 'scripts', 'release-desktop.mjs'), 'utf8')
    expect(source).not.toMatch(/migrate-v127\.zip/)
    expect(source).not.toMatch(/buildStoredZip/)
    expect(source).not.toMatch(/collectMigrateZipEntries/)
    expect(source).not.toMatch(/tools\/migrate-v127/)
  })
})
