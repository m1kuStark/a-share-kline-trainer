import type { FastifyInstance } from 'fastify'
import { HttpError } from '../train/engine.js'
import { inspectTdxCandidate, type TdxCandidateCheck } from '../tdx/inspect.js'
import { readSavedTdxChoice, saveTdxChoice, type SavedTdxChoice } from '../setup/saved-choice.js'
import type { AppConfig } from '../config.js'

// M5-01：TDX 路径设置 API：GET/PUT /api/settings/tdx-path、POST /api/settings/tdx-path/validate。
// 设置面板「数据目录（通达信）」区服务端半片：查看当前生效根与已保存选择、按需校验任一路径、
// 原子保存新选择。只复用已合入基线的 SETUP 契约，不发明新存储：
//   inspectTdxCandidate（recognized/readable/problems，路径不存在等返回问题清单而非抛错）、
//   saveTdxChoice（保存前复验＋随机临时文件 rename 原子替换，复验失败保留旧选择——路径错误可恢复）。
// 与 SETUP-01 first-use 接线的分工：本模块只写 dataDir/saved-tdx-choice.json，不热切换本进程
// config.tdxRoot，也不触发重启；重启生效由启动器/受控控制桥（集成阶段）完成，PUT 响应
// restartRequired:true 供 UI 提示「重启后生效」。env/explicit-config/saved-choice/auto-discovered
// 的来源优先级解析仍在启动侧（config.ts + 启动器），本模块不读环境变量、不改优先级合同。
// 无 TDX 也可读写（这正是该设置的用途），离线导入回放路径不受影响。
// 注册由集成人在 api.ts 完成一行（api.ts 本轮集成人单写；经统一注册自动进入业务 admission
// 门闩 draining 503）：
//   registerTdxPathSettingsRoutes(app, config, { dataDir: dirname(config.databasePath) })

export interface TdxPathSettingsView {
  /** 本进程启动时解析并生效的根（null＝未找到，离线可用） */
  effectiveRoot: string | null
  /** 已保存选择（null＝尚未保存过） */
  savedChoice: SavedTdxChoice | null
}

export interface TdxPathSaveView {
  saved: SavedTdxChoice
  /** 保存不改变当前进程；重启（启动器/控制桥）后才应用新根 */
  effectiveRoot: string | null
  restartRequired: true
}

export interface RegisterTdxPathSettingsOptions {
  /** 保存文件所在目录（推荐 dirname(config.databasePath)，由集成注册处显式传入） */
  dataDir: string
  /** 检查注入点（测试合成；缺省真实 inspectTdxCandidate） */
  inspect?: (root: string) => Promise<TdxCandidateCheck>
}

/** 严格校验：必须恰好是 { root: 非空字符串 }。非对象/数组/null/缺字段/多字段/空白 400 零写。 */
export function parseTdxPathPut(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '请求体必须是对象')
  }
  const keys = Object.keys(body as Record<string, unknown>)
  if (keys.length !== 1 || keys[0] !== 'root') {
    throw new HttpError(400, '必须恰好提供 root 字符串字段（通达信安装根目录）')
  }
  const root = (body as Record<string, unknown>).root
  if (typeof root !== 'string' || root.trim() === '') {
    throw new HttpError(400, 'root 必须是非空字符串（通达信安装根目录）')
  }
  return root
}

export function registerTdxPathSettingsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  options: RegisterTdxPathSettingsOptions,
): void {
  const inspector = options.inspect ?? inspectTdxCandidate

  app.get('/api/settings/tdx-path', async (): Promise<TdxPathSettingsView> => ({
    effectiveRoot: config.tdxRoot,
    savedChoice: await readSavedTdxChoice(options.dataDir),
  }))

  // 只读校验：无论好坏都 200 返回完整检查结果（问题清单驱动设置面板提示），不落盘
  app.post('/api/settings/tdx-path/validate', async request => {
    const root = parseTdxPathPut(request.body)
    let check: TdxCandidateCheck
    try {
      check = await inspector(root)
    } catch (error) {
      // 检查器意外失败：结构化 503 可行动报错，不把故障伪装成坏路径
      throw new HttpError(503, `路径检查失败：${error instanceof Error ? error.message : '未知错误'}；可重试或改用其他路径`)
    }
    return { check }
  })

  app.put('/api/settings/tdx-path', async request => {
    const root = parseTdxPathPut(request.body)
    let saved: SavedTdxChoice
    try {
      saved = await saveTdxChoice(options.dataDir, root, inspector)
    } catch (error) {
      // 复验失败：可行动错误（含 problems），旧选择由 saved-choice.ts 原子语义原样保留
      throw new HttpError(400, error instanceof Error ? error.message : '保存失败，未更改已保存选择')
    }
    return { saved, effectiveRoot: config.tdxRoot, restartRequired: true } satisfies TdxPathSaveView
  })
}
