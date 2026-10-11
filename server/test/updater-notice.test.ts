// UPD-NOTIFY-01（矩阵行 UPD-BOOT-AUTO-CHECK）渲染端接线源码契约：
// App.vue（事件订阅＋通知状态＋打开设置跳分栏）/ Launcher.vue（首页左上角提示按钮）/
// TrainingSettings.vue（initialSection 直入分栏＋boot 检查结果作为初值）。
// 分层如实（沿 UPD-VERSION-EXPOSE / UPD-UI-APPLY-FLOW 的源码契约先例）：web 侧无组件
// 测试基建，事件解析纯函数（parseUpdateNoticeEvent）位于 App.vue 不可被 server vitest
// import，故以源码契约锁关键接线；期望文案为手写 oracle（用户原话口径：新版本可更新、
// 跳转关于与更新），非实现回显。
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const readWebSource = async (relative: string): Promise<string> =>
  readFile(new URL(relative, import.meta.url), 'utf8')

describe('UPD-BOOT-AUTO-CHECK: App.vue 事件订阅与设置跳转接线（源码契约）', () => {
  it('App.vue 订阅桌面更新事件并解析 boot 通知，只在有通知时向 Launcher 传入', async () => {
    const source = await readWebSource('../../web/src/App.vue')
    // 订阅既有 onUpdateEvent 事件面（无新 IPC 面），解析守卫只认 update-available-notice
    expect(source).toMatch(/desktopUpdates\?\.onUpdateEvent|desktopUpdates[\s\S]{0,60}onUpdateEvent/)
    expect(source).toContain('update-available-notice')
    expect(source).toMatch(/parseUpdateNoticeEvent/)
    // 订阅在挂载期建立、卸载期退订（不残留监听）
    expect(source).toMatch(/desktopNoticeUnsubscribe/)
    // Launcher 只在存在未处理通知时收到（handled 后传 null——按钮随之消失）
    expect(source).toMatch(/:update-notice=/)
    expect(source).toMatch(/updateNoticeHandled/)
  })

  it('App.vue 处理首页提示点击——打开设置弹层并直入关于与更新分栏', async () => {
    const source = await readWebSource('../../web/src/App.vue')
    expect(source).toMatch(/openUpdateSettings|@open-update-settings/)
    expect(source).toMatch(/requestedSettingsSection\.value = 'about'/)
    // 手动设置入口（齿轮）不受跳转影响：仍打开默认分栏
    expect(source).toMatch(/requestedSettingsSection\.value = 'defaults'/)
    // 分栏期望经 props 下传给 TrainingSettings
    expect(source).toMatch(/:initial-section="requestedSettingsSection"/)
  })
})

describe('UPD-BOOT-AUTO-CHECK: Launcher.vue 首页左上角更新提示按钮（源码契约）', () => {
  it('launcher 头部存在提示按钮——有未处理通知才渲染，点击上抛跳转事件', async () => {
    const source = await readWebSource('../../web/src/views/Launcher.vue')
    // 位置：launcher-head 内（首页左上角第一屏可见）
    const headStart = source.indexOf('class="launcher-head"')
    expect(headStart).toBeGreaterThan(-1)
    const headBlock = source.slice(headStart, headStart + 900)
    expect(headBlock).toMatch(/v-if="updateNotice"/)
    expect(headBlock).toMatch(/openUpdateSettings|open-update-settings/)
    // 文案口径（用户原话：提示用户版本更新）：新版本 vX.Y.Z 可更新
    expect(headBlock).toMatch(/新版本 v\{\{ updateNotice\.latestVersion \}\} 可更新/)
    // prop 声明（App 传入；无通知为 null → 按钮不存在，零打扰）
    expect(source).toMatch(/updateNotice\??:/)
  })
})

describe('UPD-BOOT-AUTO-CHECK: TrainingSettings.vue 直入分栏与初值呈现（源码契约）', () => {
  it('initialSection prop 决定打开时的分栏，缺省仍为默认设置', async () => {
    const source = await readWebSource('../../web/src/components/TrainingSettings.vue')
    expect(source).toMatch(/defineProps<\{[\s\S]{0,400}initialSection\??:[\s\S]{0,200}'about'/)
    expect(source).toMatch(/activeSection = ref<[^>]+>\(props\.initialSection \?\? 'defaults'\)/)
    // 打开即 about 时也要走 enterAboutSection（版本号加载/进行中更新恢复）
    expect(source).toMatch(/watch\(activeSection[\s\S]{0,160}\{ immediate: true \}\)/)
  })

  it('boot 检查结果作为 about 分栏初值——打开即呈现发现新版本与下载并更新', async () => {
    const source = await readWebSource('../../web/src/components/TrainingSettings.vue')
    expect(source).toMatch(/seededUpdateNotice\??:/)
    // 仅 desktop 通道消费种子（http 通道服务端未知 boot 检查，不得预置可用态）
    expect(source).toMatch(/initialSection === 'about'[\s\S]{0,200}updateChannel === 'desktop'/)
    expect(source).toMatch(/checkPhase\.value = 'available'/)
  })

  it('既有关于与更新呈现面零改动——三态/下载并更新/更新内容仍在', async () => {
    const source = await readWebSource('../../web/src/components/TrainingSettings.vue')
    expect(source).toContain('发现新版本 {{ versionLabel(updateAvailableInfo.latestVersion) }}')
    expect(source).toContain('下载并更新')
    expect(source).toContain('update-release-notes')
    expect(source).toContain("fetch('/api/update/check')")
  })
})
