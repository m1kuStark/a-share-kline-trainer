// REC-HIST-LINK（矩阵行 REC-HIST-LINK）历史训练记录 ↔ 本机训练录像 关联呈现。
// 分层（沿 UPD-NOTIFY-01 源码契约先例——web 无组件测试基建，接线以源码契约锁定）：
//   1. 关联纯函数档：web/src/recording/historyLink.ts——trainingKey 的 id 段解析、
//      多会话同 trainingKey 取最新（S2 实证：训练 46 有 2 个同 key 会话）。
//   2. 源码契约档：History.vue 行级播放/导出按钮（无录像置灰＋title 说明）、存储模型
//      说明、批量建 Map 不逐行查库；App.vue 从历史进入回放的最小通道。
//   3. 关联键契约：useRecording trainingKeyOf 生成 `<训练id>.<createdAt>`——训练 id 为
//      库主键，取键首段数字即可定位训练。历史列表 API 不返回 createdAt（本任务红线：
//      server 只读核实不改），id 前缀关联与 RecordingLibrary loadBriefs 派生口径一致
//      （RF-05 先例），故无需扩展 server API。
// 期望文案为用户 2026-10-12 拍板口径：有录像可播可导出、无录像置灰加说明，不骗用户。
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { buildHistoryRecordingLinks, trainingIdOfKey } from '../../web/src/recording/historyLink'
import type { RecordingLibraryItem } from '../../web/src/recording/libraryTypes'

const readWebSource = async (relative: string): Promise<string> =>
  readFile(new URL(relative, import.meta.url), 'utf8')

const recording = (overrides: Partial<RecordingLibraryItem>): RecordingLibraryItem => ({
  sessionId: 'session-1',
  trainingKey: null,
  createdAt: '2026-10-12T08:00:00.000Z',
  eventCount: 3,
  source: 'local',
  ...overrides,
})

describe('REC-HIST-LINK: 关联纯函数（trainingKey 按训练 id 归桶）', () => {
  it('trainingIdOfKey: 合法键取首个点号前的数字段为训练 id，空串、非数字、零、负数与点前为空返回 null', () => {
    // createdAt 为 ISO 串（毫秒点后仍含点），首段切分不受影响
    expect(trainingIdOfKey('46.2026-10-11T08:00:00.000Z')).toBe(46)
    expect(trainingIdOfKey('1.2026-01-01T00:00:00Z')).toBe(1)
    expect(trainingIdOfKey('')).toBe(null)
    expect(trainingIdOfKey('abc.2026-01-01')).toBe(null)
    expect(trainingIdOfKey('0.2026-01-01')).toBe(null)
    expect(trainingIdOfKey('-3.2026-01-01')).toBe(null)
    expect(trainingIdOfKey('.2026-01-01')).toBe(null)
  })

  it('buildHistoryRecordingLinks: 同一训练多份录像按 createdAt 取最新，count 如实（训练 46 双会话口径）', () => {
    const older = recording({ sessionId: 's-old', trainingKey: '46.2026-10-10T08:00:00.000Z', createdAt: '2026-10-10T08:00:00.000Z' })
    const newer = recording({ sessionId: 's-new', trainingKey: '46.2026-10-10T08:00:00.000Z', createdAt: '2026-10-12T09:30:00.000Z' })
    const links = buildHistoryRecordingLinks([older, newer])
    expect(links.size).toBe(1)
    expect(links.get(46)).toMatchObject({ latest: newer, count: 2 })
  })

  it('buildHistoryRecordingLinks: 无 trainingKey 或坏键的录像不入映射，不同训练 id 各自独立（导入条目同口径）', () => {
    const legacy = recording({ sessionId: 's-null' })
    const bad = recording({ sessionId: 's-bad', trainingKey: 'x.y' })
    const first = recording({ sessionId: 's-a', trainingKey: '1.2026-01-01T00:00:00Z' })
    const second = recording({ sessionId: 's-b', trainingKey: '2.2026-02-02T00:00:00Z', source: 'imported' })
    const links = buildHistoryRecordingLinks([legacy, bad, first, second])
    expect([...links.keys()].sort((a, b) => a - b)).toEqual([1, 2])
    expect(links.get(1)).toMatchObject({ latest: first, count: 1 })
    expect(links.get(2)).toMatchObject({ latest: second, count: 1 })
  })

  it('buildHistoryRecordingLinks: 同刻时间戳按 sessionId 降序取得确定结果，秒级与毫秒级 ISO 等价', () => {
    const secondPrecision = recording({ sessionId: 's-aaa', trainingKey: '7.2026-01-01T00:00:00Z', createdAt: '2026-10-12T10:00:00Z' })
    const milliPrecision = recording({ sessionId: 's-zzz', trainingKey: '7.2026-01-01T00:00:00Z', createdAt: '2026-10-12T10:00:00.000Z' })
    const forward = buildHistoryRecordingLinks([secondPrecision, milliPrecision])
    const backward = buildHistoryRecordingLinks([milliPrecision, secondPrecision])
    // Date.parse 视两串等值（平手）→ 平手规则固定取 sessionId 较大者，输入顺序无关
    expect(forward.get(7)?.latest.sessionId).toBe('s-zzz')
    expect(backward.get(7)?.latest.sessionId).toBe('s-zzz')
    expect(forward.get(7)?.count).toBe(2)
  })
})

describe('REC-HIST-LINK: History.vue 行级播放与导出（源码契约）', () => {
  it('每行存在播放录像与导出录像按钮，无录像时 disabled 且 title 说明早于录像功能', async () => {
    const source = await readWebSource('../../web/src/views/History.vue')
    expect(source).toMatch(/class="history-row-replay"/)
    expect(source).toMatch(/class="history-row-export"/)
    expect(source).toMatch(/播放录像/)
    expect(source).toMatch(/导出录像/)
    // 用户拍板口径的置灰提示（无录像不能骗用户）
    expect(source).toContain('该训练早于录像功能，无录像')
    // disabled 绑定到该行的录像关联查询（无关联即置灰；录像库读取中同样置灰）
    expect(source).toMatch(/:disabled="[^"]*recordingLinkOf\(item\)/)
  })

  it('播放点击上抛 replay-recording 携带关联到的录像条目，行级点击不吞按钮事件', async () => {
    const source = await readWebSource('../../web/src/views/History.vue')
    expect(source).toMatch(/'replay-recording': \[item: RecordingLibraryItem\]/)
    // 行本身是 role=button（点击开成绩单），按钮必须 @click.stop 不触发行点击
    expect(source).toMatch(/history-row-replay[^>]*@click\.stop/)
    expect(source).toMatch(/history-row-export[^>]*@click\.stop/)
  })

  it('导出复用既有单条导出链路 writeRecordingFile 与 downloadRecording 输出 trainer-session 文件，不另造格式', async () => {
    const source = await readWebSource('../../web/src/views/History.vue')
    expect(source).toMatch(/import \{ writeRecordingFile \} from '\.\.\/recording\/recordingFile'/)
    expect(source).toMatch(/import \{ downloadRecording \} from '\.\.\/recording\/useRecording'/)
    expect(source).toMatch(/writeRecordingFile\(file, true\)/)
    expect(source).toMatch(/\.trainer-session\.json\.gz/)
  })

  it('录像列表一次加载经 buildHistoryRecordingLinks 建 Map，不逐行查询录像库或训练快照', async () => {
    const source = await readWebSource('../../web/src/views/History.vue')
    expect(source).toMatch(/buildHistoryRecordingLinks\(await withNamespaceRetry\(listRecordingLibrary\)\)/)
    expect(source).toMatch(/import \{ listRecordingLibrary, loadLibraryRecording \} from '\.\.\/recording\/recordingRepository'/)
    // 性能红线：行级渲染不做网络/库查询（与 RecordingLibrary 的 briefs 派生相反方向）
    expect(source).not.toMatch(/fetchTrainingSnapshot/)
  })

  it('页面呈现存储模型说明：历史在本机数据库、录像在浏览器本地录像库，条数不一致有解释', async () => {
    const source = await readWebSource('../../web/src/views/History.vue')
    expect(source).toContain('训练历史保存在本机数据库')
    expect(source).toContain('训练录像保存在浏览器')
    // 「条数对不上」的解释子句：两者分开存储＋条数不一致属正常
    expect(source).toMatch(/两者分开(保存|存储)/)
    expect(source).toMatch(/条数多于录像条数属正常现象/)
  })

  it('同一训练多份录像时按钮 title 披露取最新口径', async () => {
    const source = await readWebSource('../../web/src/views/History.vue')
    expect(source).toMatch(/份录像/)
    expect(source).toMatch(/最新/)
  })

  it('录像库不可读时不冒充无录像——呈现关联不可用说明而非逐行置灰无解释', async () => {
    const source = await readWebSource('../../web/src/views/History.vue')
    // 关联加载失败有独立错误呈现（不把读取失败静默当成零录像）
    expect(source).toMatch(/linksError/)
    // 壳层先于安装隔离初始化的短重试守卫（与 RecordingLibrary 同语义）
    expect(source).toMatch(/尚未完成安装隔离初始化/)
  })
})

describe('REC-HIST-LINK: App.vue 从历史进入回放的通道（源码契约，最小 diff）', () => {
  it('History 绑定 replay-recording 且经 openRecording 打开（直传条目不重查）', async () => {
    const source = await readWebSource('../../web/src/App.vue')
    expect(source).toMatch(/@replay-recording="replayRecordingFromHistory"/)
    expect(source).toMatch(/replayRecordingFromHistory[\s\S]{0,200}openRecording\(item\.sessionId, item\)/)
  })

  it('回放关闭返回来源视图：从历史进入回历史，默认仍回录像库', async () => {
    const source = await readWebSource('../../web/src/App.vue')
    expect(source).toMatch(/replayReturnView/)
    expect(source).toMatch(/replayReturnView\.value = 'history'/)
  })
})

describe('REC-HIST-LINK: 关联键口径（useRecording 生成格式）', () => {
  it('trainingKey 为 id 点 createdAt 拼接，首段即训练 id——id 前缀关联的前提', async () => {
    const source = await readWebSource('../../web/src/recording/useRecording.ts')
    expect(source).toMatch(/`\$\{training\.id\}\.\$\{training\.createdAt\}`/)
  })
})
