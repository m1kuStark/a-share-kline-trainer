import { readFile as readBytes } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

// 日线数据更新前端契约：源码正则断言（与 frontend-contract.test.ts 同风格）。
// 覆盖：启动检查/60s 节流/可见页 60s 廉价重判（隐藏暂停、回前台恢复）/隐藏不轮询/
// running 轮询上限、顶栏控件状态机（freshness 驱动：current 才绿色、unknown 不绿色、
// stale 醒目＋通达信盘后指引、常驻手动重新读取入口）、开始训练守卫、训练页固定尺寸
// 小按钮、监听器 onUnmounted 配对、双主题配色。

// Git worktrees on Windows may checkout CRLF; source contracts compare normalized text.
const readFile = async (path: URL, _encoding: 'utf8') => (await readBytes(path, 'utf8')).replace(/\r\n/g, '\n')

const storePath = new URL('../../web/src/dataStatus.ts', import.meta.url)
const apiPath = new URL('../../web/src/api.ts', import.meta.url)
const appPath = new URL('../../web/src/App.vue', import.meta.url)
const launcherPath = new URL('../../web/src/views/Launcher.vue', import.meta.url)
const trainingPath = new URL('../../web/src/views/Training.vue', import.meta.url)
const stylesPath = new URL('../../web/src/styles.css', import.meta.url)

describe('日线数据更新前端契约（R1）', () => {
  it('api 层暴露 fetchDataStatus/postDataRefresh，命中 /api/data/status 与 /api/data/refresh', async () => {
    const source = await readFile(apiPath, 'utf8')
    expect(source).toMatch(/export function fetchDataStatus\(\): Promise<DataStatus>/)
    expect(source).toMatch(/export function postDataRefresh\(\): Promise/)
    expect(source).toMatch(/request\('\/api\/data\/status'\)/)
    expect(source).toMatch(/request\('\/api\/data\/refresh', \{ method: 'POST' \}\)/)
    // 契约字段：state/needsUpdate/lastResult/revisionWarning 必须建模
    expect(source).toMatch(/needsUpdate: boolean/)
    expect(source).toMatch(/lastResult: DataRefreshResult \| null/)
    expect(source).toMatch(/revisionWarning: string \| null/)
    // DATA-05：freshness 三态与日历元信息必须建模
    expect(source).toMatch(/export type DataFreshnessState = 'current' \| 'stale' \| 'unknown'/)
    expect(source).toMatch(/freshness: DataFreshness/)
    expect(source).toMatch(/calendar: DataCalendarInfo \| null/)
  })

  it('应用启动时自动检查一次数据状态（App onMounted → force 检查）', async () => {
    const app = await readFile(appPath, 'utf8')
    const store = await readFile(storePath, 'utf8')
    expect(app).toMatch(/onMounted\(async \(\) => \{[\s\S]{0,200}checkDataStatus\(\{ force: true \}\)/)
    // force 绕过节流的实现必须存在于 store
    expect(store).toMatch(/export async function checkDataStatus\(options\?: \{ force\?: boolean \}\): Promise<void>/)
    expect(store).toMatch(/if \(!options\?\.force && Date\.now\(\) - lastCheckStartedAt < DATA_CHECK_THROTTLE_MS\) return/)
  })

  it('前台激活 60s 节流：常量 60_000 且 onDataActive 走节流检查', async () => {
    const store = await readFile(storePath, 'utf8')
    expect(store).toMatch(/export const DATA_CHECK_THROTTLE_MS = 60_000/)
    expect(store).toMatch(/export function onDataActive\(\): void/)
    expect(store).toMatch(/void checkDataStatus\(\)/)
  })

  it('页面隐藏时不检查也不轮询（visibilityState 守卫）', async () => {
    const store = await readFile(storePath, 'utf8')
    // 检查入口与轮询单步都要有隐藏守卫
    expect(store).toMatch(/function isHidden\(\): boolean \{[\s\S]{0,120}document\.visibilityState === 'hidden'/)
    expect(store).toMatch(/export async function checkDataStatus[\s\S]{0,200}if \(isHidden\(\)\) return/)
    expect(store).toMatch(/async function pollOnce[\s\S]{0,200}if \(isHidden\(\)\) return/)
  })

  it('state=running 时以约 1s 间隔轮询直到非 running，上限 120s', async () => {
    const store = await readFile(storePath, 'utf8')
    expect(store).toMatch(/const DATA_POLL_INTERVAL_MS = 1_000/)
    expect(store).toMatch(/const DATA_POLL_TIMEOUT_MS = 120_000/)
    expect(store).toMatch(/if \(result\.state === 'running'\) startPolling\(\)/)
    expect(store).toMatch(/if \(Date\.now\(\) >= pollDeadline\) \{ dataPolling\.value = false; return \}/)
  })

  it('DATA-05 可见页 60s 廉价重判：只 GET 重算 freshness，隐藏暂停、回前台恢复、卸载清理', async () => {
    const store = await readFile(storePath, 'utf8')
    // 周期复用 60s 节流常量；定时器回调内再次校验可见性
    expect(store).toMatch(/export function startStatusTicker\(\): void \{/)
    expect(store).toMatch(/statusTicker = setInterval\(\(\) => \{[\s\S]{0,80}void checkDataStatus\(\)[\s\S]{0,20}\}, DATA_CHECK_THROTTLE_MS\)/)
    expect(store).toMatch(/export function stopStatusTicker\(\): void \{[\s\S]{0,80}clearInterval\(statusTicker\)/)
    // 隐藏时不启动也不触发
    expect(store).toMatch(/if \(statusTicker !== undefined \|\| isHidden\(\)\) return/)
    // 回前台由 onDataActive 恢复定时器；卸载清理包含 stopStatusTicker
    expect(store).toMatch(/export function onDataActive\(\): void \{[\s\S]{0,80}startStatusTicker\(\)/)
    expect(store).toMatch(/export function cancelDataWatchers\(\): void \{[\s\S]{0,200}stopStatusTicker\(\)/)
  })

  it('手动更新走 POST refresh（绕过节流）并进入同样的轮询，409 中文 message 行内透出', async () => {
    const store = await readFile(storePath, 'utf8')
    expect(store).toMatch(/export async function refreshDataNow\(\): Promise<void>/)
    expect(store).toMatch(/const started = await postDataRefresh\(\)/)
    expect(store).toMatch(/if \(started\.state === 'running'\) \{[\s\S]{0,60}startPolling\(\)/)
    expect(store).toMatch(/dataRefreshError\.value = error instanceof Error \? error\.message : '更新失败：无法连接本地服务'/)
  })

  it('状态机由 freshness 驱动（DATA-05）：current 绿色、stale 醒目＋通达信盘后指引、running/failed/unavailable 保留', async () => {
    const app = await readFile(appPath, 'utf8')
    // 绿色"已最新"只对应官方日历判定的 current；needsUpdate 不再驱动界面断言
    expect(app).toMatch(/if \(freshness\.state === 'current'\) return 'ok'/)
    expect(app).toMatch(/if \(freshness\.state === 'stale'\) return 'attention'/)
    expect(app).toMatch(/return 'unknown'/)
    expect(app).toMatch(/class="data-update-btn attention shake"/)
    expect(app).toMatch(/dataWidgetState === 'running'" class="data-update-btn running" disabled/)
    expect(app).toMatch(/dataWidgetState === 'failed'" class="data-update-btn failed"/)
    expect(app).toMatch(/更新失败 · 点击重试/)
    expect(app).toMatch(/dataWidgetState === 'unavailable'" class="data-update-btn unavailable"/)
    expect(app).toMatch(/未检测到通达信数据/)
    // stale 指引：先去通达信完成盘后下载，再回来重新读取本地日线（不暗示联网）
    expect(app).toMatch(/:title="attentionTitle"/)
    expect(app).toMatch(/请先在通达信完成盘后数据下载，再点击重新读取本地日线（不联网）/)
    // 醒目按钮旁附小字数据截止日
    expect(app).toMatch(/dataWidgetState === 'attention'" class="data-status-note">截止 \{\{ dataCutoffText \}\}/)
  })

  it('unknown 不显示绿色最新：中性"数据截至…最新交易日待确认"，无绿点', async () => {
    const app = await readFile(appPath, 'utf8')
    const unknownBranch = app.match(/<span v-else-if="dataWidgetState === 'unknown'"[\s\S]*?<\/span>/)?.[0] ?? ''
    expect(unknownBranch).toContain('class="data-status-unknown"')
    expect(unknownBranch).toContain('数据截至 {{ dataCutoffText }}，最新交易日待确认')
    expect(unknownBranch).not.toContain('connection-dot')
  })

  it('常驻手动入口：ok/unknown 状态始终提供"重新读取"（仅本地扫描，不联网）', async () => {
    const app = await readFile(appPath, 'utf8')
    expect(app).toMatch(/const showManualReread = computed\(\(\) => dataWidgetState\.value === 'ok' \|\| dataWidgetState\.value === 'unknown'\)/)
    expect(app).toMatch(/<button v-if="showManualReread" class="data-reread-btn" title="重新扫描本地通达信日线文件（不联网）" @click="updateData">重新读取<\/button>/)
  })

  it('已最新（freshness current）时醒目按钮不渲染，只显示绿点＋"数据已最新"一行小字', async () => {
    const app = await readFile(appPath, 'utf8')
    // ok 分支只渲染 span（无 button），且不再渲染其它 data-update-btn（v-else-if 链互斥）
    expect(app).toMatch(/<span v-if="dataWidgetState === 'ok'" class="data-status-ok" role="status">/)
    expect(app).toMatch(/数据已最新 · 截止 \{\{ dataCutoffText \}\}/)
    const okBranch = app.match(/<span v-if="dataWidgetState === 'ok'"[\s\S]*?<\/span>\n            (?=<button v-else-if="dataWidgetState === 'running'")/)?.[0] ?? ''
    expect(okBranch).not.toMatch(/<button/)
  })

  it('摇晃动画：keyframes translateX 小幅＋入场 3 次＋12s 重触发＋prefers-reduced-motion 降级', async () => {
    const styles = await readFile(stylesPath, 'utf8')
    const app = await readFile(appPath, 'utf8')
    expect(styles).toMatch(/@keyframes data-shake \{[\s\S]*?translateX\(-3px\)[\s\S]*?translateX\(3px\)/)
    expect(styles).toMatch(/\.data-update-btn\.shake \{ animation: data-shake 0\.3s ease-in-out 3; \}/)
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.data-update-btn\.shake \{ animation: none; \} \}/)
    // 12s 重触发：watch attention 状态挂 12_000ms 定时器换 key 重播
    expect(app).toMatch(/setInterval\(\(\) => \{ shakeTick\.value\+\+ \}, 12_000\)/)
    expect(app).toMatch(/:key="shakeTick"/)
  })

  it('开始训练守卫在 Launcher 提交路径最前端：needsUpdate 弹确认框，弹窗双按钮语义正确', async () => {
    const launcher = await readFile(launcherPath, 'utf8')
    // 守卫位于 submit 最前端（仅在重入检查之后）
    expect(launcher).toMatch(/async function submit\(\): Promise<void> \{\n  if \(submitting\.value\) return\n  \/\/ 守卫加在提交路径最前端[\s\S]{0,160}if \(dataStatus\.value\?\.needsUpdate && !dataUpdating\.value\) \{\n    showDataConfirm\.value = true\n    return\n  \}\n  await performCreate\(\)/)
    expect(launcher).toMatch(/function confirmUpdateFirst\(\): void \{[\s\S]{0,80}void refreshDataNow\(\)/)
    expect(launcher).toMatch(/function confirmStartAnyway\(\): void \{[\s\S]{0,80}void performCreate\(\)/)
    // 弹窗复用 settle-mask/settle-panel 模态风格，标题与按钮文案按口径
    expect(launcher).toMatch(/class="settle-panel data-confirm-panel"/)
    expect(launcher).toMatch(/建议先更新日线数据/)
    expect(launcher).toMatch(/>先更新数据</)
    expect(launcher).toMatch(/>仍要开始训练</)
    // 正文含本地数据截止日；未建立基线（sourceMaxDate 为空）时不得显示"截止 未知"，改用未扫描口径
    expect(launcher).toMatch(/本地日线数据截止 <strong>\{\{ dataCutoff \}\}<\/strong>/)
    expect(launcher).toMatch(/v-if="dataStatus\?\.sourceMaxDate"/)
    expect(launcher).toMatch(/尚未完成首次数据扫描/)
  })

  it('训练页操作栏小更新按钮：固定 48px 尺寸类、随 running 禁用、终态轻提示不弹模态', async () => {
    const training = await readFile(trainingPath, 'utf8')
    const styles = await readFile(stylesPath, 'utf8')
    expect(training).toMatch(/class="ghost-button data-refresh-btn"/)
    expect(training).toMatch(/:disabled="dataUpdating"/)
    expect(training).toMatch(/'flash-ok': miniFlash === 'ok', 'flash-fail': miniFlash === 'fail'/)
    // 固定尺寸：48px 宽＋flex 基准，不参与伸缩、不改变栏高
    expect(styles).toMatch(/\.data-refresh-btn \{ width: 48px; flex: 0 0 48px;/)
    // 轻提示：watch 全局终态序号 → 按钮 ✓/! 闪烁，定时回收，无模态
    expect(training).toMatch(/watch\(dataOutcomeSeq, \(\) => \{/)
    expect(training).toMatch(/miniFlashTimer = setTimeout\(\(\) => \{ miniFlash\.value = null \}, 2600\)/)
    expect(training).not.toMatch(/settle-mask[\s\S]{0,80}data-refresh/)
  })

  it('revisionWarning 非空时在顶栏渲染默认折叠的可展开警示（橙色，details/summary）', async () => {
    const app = await readFile(appPath, 'utf8')
    const styles = await readFile(stylesPath, 'utf8')
    expect(app).toMatch(/<details v-if="dataStatus\?\.revisionWarning" class="revision-warning">/)
    expect(app).toMatch(/<summary title="数据修订警示（点击展开）">/)
    expect(styles).toMatch(/\.revision-warning summary \{[^}]*list-style: none/)
    expect(styles).toMatch(/body\.dark \.revision-warning summary \{ color: #d9a04c; \}/)
  })

  it('监听器与定时器 onUnmounted 成对移除：focus/visibilitychange/cancelDataWatchers/shake 定时器', async () => {
    const app = await readFile(appPath, 'utf8')
    expect(app).toMatch(/window\.addEventListener\('focus', onDataFocus\)/)
    expect(app).toMatch(/window\.removeEventListener\('focus', onDataFocus\)/)
    expect(app).toMatch(/document\.addEventListener\('visibilitychange', onDataVisibilityChange\)/)
    expect(app).toMatch(/document\.removeEventListener\('visibilitychange', onDataVisibilityChange\)/)
    // DATA-05：隐藏停止 60s 重判计时，回前台经 onDataActive 恢复
    expect(app).toMatch(/function onDataVisibilityChange\(\): void \{[\s\S]{0,120}else stopStatusTicker\(\)/)
    expect(app).toMatch(/onUnmounted\(\(\) => \{[\s\S]{0,300}cancelDataWatchers\(\)[\s\S]{0,160}clearInterval\(shakeTimer\)/)
    // store 轮询清理入口存在
    const store = await readFile(storePath, 'utf8')
    expect(store).toMatch(/export function cancelDataWatchers\(\): void \{[\s\S]{0,160}clearTimeout\(pollTimer\)/)
  })

  it('双主题可读：各状态按钮在浅色与深色主题下都有配色定义', async () => {
    const styles = await readFile(stylesPath, 'utf8')
    for (const rule of ['.data-update-btn.attention', '.data-update-btn.failed', '.data-update-btn.unavailable', '.data-update-btn.running', '.data-refresh-btn.flash-ok', '.data-refresh-btn.flash-fail']) {
      expect(styles).toMatch(new RegExp(`${rule.replace(/\./g, '\\.')} \\{`))
      expect(styles).toMatch(new RegExp(`body\\.dark ${rule.replace(/\./g, '\\.')} \\{`))
    }
  })
})
