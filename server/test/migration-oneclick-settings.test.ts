// MIG-ONECLICK-SETTINGS-PANEL-REMOVED：设置页「从 v1.2.7 迁移」分栏退役的源级锁定。
// 用户拍板（2026-10-13 第五轮任务 3）：「v1.3.x 的设置界面……单独的老版本数据迁移栏，
// 直接取消掉」。迁移入口收敛到一键工具后，TrainingSettings 不得再呈现该分栏；
// desktopMigration IPC 的渲染端调用点（分栏按钮）随之消失（IPC 底层去留见验证记录论证）。
// 源级断言依据：分栏渲染由 nav 按钮文本＋activeSection==='migration'＋DesktopMigrationApi
// 三者构成，三者从源中移除后该分栏不可达；正面断言（设置页其余分栏仍在）防 vacuous。
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../../web/src/components/TrainingSettings.vue', import.meta.url), 'utf8')

describe('MIG-ONECLICK-SETTINGS-PANEL-REMOVED（设置分栏退役）', () => {
  it('设置页源不再包含从 v1.2.7 迁移分栏、desktopMigration 通道与 migration 分栏值', () => {
    // 观测面活性：读到的确是设置页源码（其余分栏仍在）
    expect(source).toContain('关于与更新')
    expect(source).toContain('数据目录')
    // 分栏入口与其全部实现痕迹退役
    expect(source).not.toContain('从 v1.2.7 迁移')
    expect(source).not.toContain('desktopMigration')
    expect(source.toLowerCase()).not.toContain('migration')
  })
})
