// 设置页迁移入口的源级锁定（历经两次拍板，方向相反，注意演进）：
// ① 2026-10-13（MIG-ONECLICK-SETTINGS-PANEL-REMOVED）：取消设置页「从 v1.2.7 迁移」独立分栏
//    ——当时迁移收敛到外置一键工具。独立分栏退役的约束至今有效。
// ② 2026-10-25（MIG-INLINE-01，用户三拍板确认）：迁移能力内置回 v1.3.2——首启弹一次可跳过，
//    设置页「数据目录」分栏内常驻入口按钮（open-migration 事件 → App 级 MigrationInlineWizard），
//    desktopMigration 桥探测决定按钮可见性（浏览器形态隐藏）。
// 本测试同时锁定两代约束：无独立 migration 分栏；常驻入口与桥探测必须在。
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../../web/src/components/TrainingSettings.vue', import.meta.url), 'utf8')

describe('MIG-INLINE-01 设置页入口（独立分栏退役仍有效）', () => {
  it('无独立 migration 分栏；数据目录分栏内有「从 v1.2.7 迁移老数据」常驻入口与桥探测', () => {
    // 观测面活性：读到的确是设置页源码（其余分栏仍在）
    expect(source).toContain('关于与更新')
    expect(source).toContain('数据目录')
    // ①独立分栏退役仍在（不得出现 migration 作为分栏值）
    expect(source).not.toContain("=== 'migration'")
    expect(source).not.toContain("activeSection = 'migration'")
    // ②MIG-INLINE-01 常驻入口：数据分栏按钮 → open-migration 事件（向导挂在 App 级）
    expect(source).toContain('从 v1.2.7 迁移老数据')
    expect(source).toContain("'open-migration'")
    // ③桥探测在（桌面形态才有入口）
    expect(source).toContain('desktopMigrationInlineAvailable')
  })
})
