import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  TDX_APPLY_POLL_ATTEMPTS, TDX_APPLY_POLL_INTERVAL_MS, runTdxApplyFlow,
  type TdxApplyFlowHooks,
} from '../../web/src/appSettings'

// M5-01 前端接线契约（源形状断言，沿用 training-rules-frontend 模式）：
// 应用偏好客户端/偏好 store、dataStatus 自动检查门闩（手动路径保留）、
// 设置面板应用偏好与数据目录两区块、服务端两个待注册模块的入口函数。
// 注册契约（集成阶段）：server/src/api.ts 各加一行 registerAppSettingsRoutes(app, database) 与
// registerTdxPathSettingsRoutes(app, config, { dataDir: dirname(config.databasePath) })。

const appSettingsPath = new URL('../../web/src/appSettings.ts', import.meta.url)
const dataStatusPath = new URL('../../web/src/dataStatus.ts', import.meta.url)
const panelPath = new URL('../../web/src/components/TrainingSettings.vue', import.meta.url)
const serverAppPath = new URL('../../server/src/settings/app.ts', import.meta.url)
const serverTdxPath = new URL('../../server/src/settings/tdx-path.ts', import.meta.url)

describe('M5-01 应用偏好接线', () => {
  it('appSettings.ts：两命名空间端点、偏好 store 与尽力预取齐备', async () => {
    const source = await readFile(appSettingsPath, 'utf8')
    expect(source).toMatch(/export function fetchAppSettings\(\): Promise<AppSettingsView> \{\s*return request\('\/api\/settings\/app'\)/)
    expect(source).toMatch(/method: 'PUT',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ autoDataCheck \}\)/s)
    expect(source).toMatch(/export const appAutoDataCheck = ref\(true\)/)
    expect(source).toMatch(/export function ensureAppSettingsLoaded\(\): Promise<void>/)
    // 预取失败静默保持缺省 true（＝现状），不冒充已读取
    expect(source).toMatch(/\.catch\(\(\) => \{/)
    // TDX 数据目录查看与校验端点（保存端点经 TDX-RECONNECT-01 升级为受控重启编排，
    // 旧的「仅保存＋提示手动重启」客户端语义退役；V1.2.6 dataDir 分栏的 restartRequired 不受影响）
    expect(source).toMatch(/return request\('\/api\/settings\/tdx-path'\)/)
    expect(source).toMatch(/'\/api\/settings\/tdx-path\/validate'/)
    expect(source).not.toMatch(/TdxPathSaveResult/)
    expect(source).not.toMatch(/putTdxPath/)
  })

  it('dataStatus.ts：自动路径按偏好门闩，手动路径显式绕过', async () => {
    const source = await readFile(dataStatusPath, 'utf8')
    expect(source).toMatch(/import \{ appAutoDataCheck, ensureAppSettingsLoaded \} from '\.\/appSettings'/)
    // checkDataStatus：非 manual 调用先预取偏好，关闭时直接跳过
    expect(source).toMatch(/options\?: \{ force\?: boolean; manual\?: boolean \}/)
    expect(source).toMatch(/if \(!options\?\.manual\) \{\s*void ensureAppSettingsLoaded\(\)\s*if \(!appAutoDataCheck\.value\) return\s*\}/s)
    // 60s 重判定时器同样受门闩
    expect(source).toMatch(/startStatusTicker[\s\S]*?if \(!appAutoDataCheck\.value\) \{\s*void ensureAppSettingsLoaded\(\)\s*return\s*\}/)
    // 手动刷新流程显式 manual，绕过门闩；running 轮询不受影响
    expect(source).toMatch(/checkDataStatus\(\{ force: true, manual: true \}\)/)
    // 手动更新入口本体不受偏好影响（不出现早退）
    expect(source).not.toMatch(/export async function refreshDataNow[\s\S]{0,400}appAutoDataCheck/)
  })

  it('设置面板：应用偏好开关与数据目录区块齐备，失败可恢复、重启提示明确', async () => {
    const source = await readFile(panelPath, 'utf8')
    expect(source).toMatch(/from '\.\.\/appSettings'/)
    expect(source).toMatch(/aria-label="自动检查日线数据"/)
    expect(source).toMatch(/@change="onAutoDataCheckChange"/)
    // 失败还原开关，不假称保存
    expect(source).toMatch(/autoDataCheckForm\.value = previous/)
    // 数据目录：当前生效/已保存展示、校验、保存、离线提示与重启语义
    // V1.2.6：标签页改含两个子区块——训练数据目录（自定义历史数据保存位置）＋ 通达信目录
    expect(source).toMatch(/aria-label="数据目录"/)
    expect(source).toMatch(/<h4 class="settings-subsection">训练数据目录<\/h4>/)
    expect(source).toMatch(/aria-label="历史训练数据保存目录"/)
    expect(source).toMatch(/saveDataDir/)
    expect(source).toMatch(/重启训练器后生效/)
    expect(source).toMatch(/各版本安装目录相互独立/)
    expect(source).toMatch(/离线导入回放仍可用/)
    expect(source).toMatch(/检查此路径/)
    expect(source).toMatch(/保存数据目录/)
    // TDX-RECONNECT-01：分栏保存不再提示手动重启应用——保存即走受控重启生效
    expect(source).not.toMatch(/重启应用后生效/)
    // journey 返修：静态文案不得包含『已保存』子串（弹层级 not.toContainText('已保存') 负向断言依赖）
    expect(source).toMatch(/保存失败不会改动之前的选择/)
    expect(source).not.toMatch(/保存失败不会改动已保存的选择/)
    // 校验结果展示问题清单与权息/名称/基准
    expect(source).toMatch(/tdxCheck\.problems/)
    expect(source).toMatch(/基准指数/)
  })

  it('服务端两模块暴露注册入口，等集成阶段在 api.ts 一行接线', async () => {
    const serverApp = await readFile(serverAppPath, 'utf8')
    const serverTdx = await readFile(serverTdxPath, 'utf8')
    expect(serverApp).toMatch(/export function registerAppSettingsRoutes\(app: FastifyInstance, database: DatabaseSync\): void/)
    expect(serverTdx).toMatch(/export function registerTdxPathSettingsRoutes\(\s*app: FastifyInstance,\s*config: AppConfig,\s*options: RegisterTdxPathSettingsOptions,\s*\): void/)
    // 两模块均不读环境变量、不热切换 config.tdxRoot（保存后重启生效的边界写在模块头注）
    expect(serverTdx).toMatch(/restartRequired: true/)
    expect(serverTdx).toMatch(/dataDir/)
  })
})

// ===== TDX-RECONNECT-01：设置分栏保存→受控重启立即生效（与首配向导同语义） =====
// 矩阵行 TDX-SETTINGS-APPLY-RESTART（EARS）：设置页「数据目录（通达信）」分栏校验并保存新根
// 后，系统以与首配向导相同的受控重启语义立即生效（保存→服务受控重启→前端轮询到 ready→
// 自动刷新连接状态与数据状态），不要求用户手动重启应用；受控重启未达 ready 时呈现失败原因
// 与已保存选择的回滚状态。oracle：用户原话 2026-10-13＋App.vue saveAndApplyWizard 既有行为。
// runTdxApplyFlow 是编排的单一实现（可执行 L2）；分栏源形状接线为 L1 补充。

interface StatusFrame { phase: string; reason: string | null; done: boolean }

function recordingHooks(overrides?: Partial<TdxApplyFlowHooks> & {
  applyAvailable?: boolean
  applyReason?: string
  statuses?: StatusFrame[]
  saveError?: Error
}): TdxApplyFlowHooks & {
  savedRoots: string[]
  applied: Array<{ root: string; attemptId: string }>
  statusCallsLog: number[]
  waits: number[]
} {
  const record = {
    savedRoots: [] as string[],
    applied: [] as Array<{ root: string; attemptId: string }>,
    statusCallsLog: [] as number[],
    waits: [] as number[],
  }
  const statuses = overrides?.statuses ?? []
  const hooks: TdxApplyFlowHooks = {
    saveChoice: overrides?.saveChoice ?? (async (root: string) => {
      record.savedRoots.push(root)
      if (overrides?.saveError) throw overrides.saveError
      return { apply: { available: overrides?.applyAvailable ?? true, reason: overrides?.applyReason } }
    }),
    applyChoice: overrides?.applyChoice ?? (async (root: string, attemptId: string) => {
      record.applied.push({ root, attemptId })
    }),
    fetchStatus: overrides?.fetchStatus ?? (async () => {
      const frame = statuses[Math.min(record.statusCallsLog.length, statuses.length - 1)]
      record.statusCallsLog.push(1)
      return frame ?? { phase: 'running', reason: null, done: false }
    }),
    wait: overrides?.wait ?? (async (ms: number) => {
      record.waits.push(ms)
    }),
    newAttemptId: overrides?.newAttemptId ?? (() => 'attempt-fixed'),
  }
  return Object.assign(hooks, record)
}

describe('TDX-RECONNECT-01 runTdxApplyFlow（分栏保存→生效编排，与向导同语义）', () => {
  it('保存受理不可用（apply.available=false）时仅保存并带回原因，不发起受控重启', async () => {
    const hooks = recordingHooks({ applyAvailable: false, applyReason: '当前为手动/开发运行方式，保存的目录将在下次启动服务时生效' })
    const outcome = await runTdxApplyFlow('D:\\new_tdx', hooks)
    expect(outcome).toEqual({ kind: 'saved-only', reason: '当前为手动/开发运行方式，保存的目录将在下次启动服务时生效' })
    expect(hooks.savedRoots).toEqual(['D:\\new_tdx'])
    expect(hooks.applied).toEqual([])
  })

  it('保存成功后受理受控重启，轮询到 done+ready 返回 ready（status 拉取失败不中断）', async () => {
    let statusCalls = 0
    const hooks = recordingHooks({
      fetchStatus: async () => {
        statusCalls++
        // 第二次拉取模拟服务排空窗口的瞬时失败：与向导一致按无结论继续轮询
        if (statusCalls === 2) throw new Error('connect ECONNREFUSED')
        if (statusCalls === 4) return { phase: 'ready', reason: null, done: true }
        return { phase: 'starting', reason: null, done: false }
      },
    })
    const outcome = await runTdxApplyFlow('D:\\new_tdx', hooks)
    expect(outcome).toEqual({ kind: 'ready' })
    expect(hooks.applied).toEqual([{ root: 'D:\\new_tdx', attemptId: 'attempt-fixed' }])
    // 等待节奏与向导一致（700ms×轮次）
    expect(hooks.waits.every(ms => ms === TDX_APPLY_POLL_INTERVAL_MS)).toBe(true)
    expect(TDX_APPLY_POLL_ATTEMPTS).toBe(120)
  })

  it('done 但非 ready（如 rolled-back）返回 restart-failed 并透传 phase 与原因（回滚状态可呈现）', async () => {
    const hooks = recordingHooks({
      statuses: [{ phase: 'rolled-back', reason: '已确认恢复旧配置完成：rolled-back（终态，迟到观测不回退）', done: true }],
    })
    const outcome = await runTdxApplyFlow('D:\\new_tdx', hooks)
    expect(outcome).toEqual({
      kind: 'restart-failed',
      phase: 'rolled-back',
      reason: '已确认恢复旧配置完成：rolled-back（终态，迟到观测不回退）',
    })
  })

  it('轮询上限与向导同款 120 次后如实返回 timeout，不假装成功', async () => {
    const hooks = recordingHooks({ statuses: [{ phase: 'starting', reason: null, done: false }] })
    const outcome = await runTdxApplyFlow('D:\\new_tdx', hooks)
    expect(outcome).toEqual({ kind: 'timeout' })
    expect(hooks.statusCallsLog.length).toBe(TDX_APPLY_POLL_ATTEMPTS)
    expect(hooks.waits.length).toBe(TDX_APPLY_POLL_ATTEMPTS)
  })

  it('保存本身失败（复验 400 等）返回 error 并透传服务端 message，不发起重启', async () => {
    const hooks = recordingHooks({ saveError: new Error('候选未通过复验（root="D:\\bad"，recognized=false，readable=false），未保存新选择') })
    const outcome = await runTdxApplyFlow('D:\\bad', hooks)
    expect(outcome).toEqual({ kind: 'error', message: '候选未通过复验（root="D:\\bad"，recognized=false，readable=false），未保存新选择' })
    expect(hooks.applied).toEqual([])
  })
})

describe('TDX-RECONNECT-01 设置分栏接线（源形状）', () => {
  it('TrainingSettings.vue 保存走 runTdxApplyFlow 受控重启链，不要求手动重启应用', async () => {
    const source = await readFile(panelPath, 'utf8')
    // 编排单一实现：分栏保存调共享编排（内部 save-choice→apply→restart-status 轮询）
    expect(source).toMatch(/runTdxApplyFlow/)
    // ready 后自动刷新：数据状态（manual 路径，不受自动检查偏好门闩）＋通知父级刷新连接状态
    expect(source).toMatch(/checkDataStatus\(\{ force: true, manual: true \}\)/)
    expect(source).toMatch(/emit\('tdx-connected'\)/)
    // 失败语义对齐向导：回滚说明与超时如实呈现，不静默
    expect(source).toMatch(/保存的选择已回滚/)
    expect(source).toMatch(/重启确认超时/)
    expect(source).toMatch(/已切换到新的通达信目录/)
    // 旧的「仅保存」客户端调用退役
    expect(source).not.toMatch(/putTdxPath/)
  })

  it('App.vue 监听 tdx-connected 后刷新连接状态（reloadEnv）', async () => {
    const source = await readFile(new URL('../../web/src/App.vue', import.meta.url), 'utf8')
    expect(source).toMatch(/@tdx-connected="onTdxConnected"/)
    expect(source).toMatch(/async function onTdxConnected\(\): Promise<void>[\s\S]{0,120}reloadEnv/)
  })
})
