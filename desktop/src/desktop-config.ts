// PACK-01 桌面主进程·纯函数配置层（不 import electron，vitest 可直接测）。
// 口径来源＝scripts/release/launcher.cjs 冻结语义：
//   - env 覆盖优先于默认（TRAINER_DB / TRAINER_DATA_DIR / TDX_ROOT / PORT / TRAINER_CONTROL_TOKEN）
//   - 绝对路径强制（相对值报错不猜，同 server/src/config.ts explicitAbsolutePath 口径）
//   - 默认 dataDir＝便携包根 data（zip 形态 V1.2.6 起同一语义）
//   - 隔离运行 env 注入清单与 launcher spawn 对齐（server 隔离模式三绝对路径全部给足）
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'

export interface DesktopRuntimeConfig {
  port: number
  dataDir: string
  databasePath: string
  staticDirectory: string
  tdxRoot: string | null
  controlToken: string
}

/** 与 server/src/config.ts 同口径：显式给定的路径必须是绝对路径，否则报错不猜。 */
function absoluteEnvPath(env: NodeJS.ProcessEnv, name: 'TRAINER_DB' | 'TRAINER_DATA_DIR'): string | null {
  const value = env[name]?.trim()
  if (!value) return null
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path when set, got: ${value}`)
  return resolve(value)
}

function resolveTdxRoot(env: NodeJS.ProcessEnv): string | null {
  const value = env.TDX_ROOT?.trim()
  if (!value) return null
  if (!isAbsolute(value)) throw new Error(`TDX_ROOT must be an absolute path when set, got: ${value}`)
  return resolve(value)
}

function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT?.trim()
  if (!raw) return 8787
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer in 0..65535 when set, got: ${raw}`)
  }
  return port
}

/** 解析桌面运行配置：env 显式值 > 便携默认（exe 同级 data/、app 包内 web/dist、端口 8787）。 */
export function resolveDesktopConfig(env: NodeJS.ProcessEnv, paths: { exeDir: string; appRoot: string }): DesktopRuntimeConfig {
  const dataDir = absoluteEnvPath(env, 'TRAINER_DATA_DIR') ?? join(paths.exeDir, 'data')
  const databasePath = absoluteEnvPath(env, 'TRAINER_DB') ?? join(dataDir, 'trainer.sqlite')
  return {
    port: resolvePort(env),
    dataDir,
    databasePath,
    staticDirectory: env.TRAINER_STATIC_DIR?.trim() || join(paths.appRoot, 'web', 'dist'),
    tdxRoot: resolveTdxRoot(env),
    controlToken: env.TRAINER_CONTROL_TOKEN?.trim() || `ctr-${randomUUID()}`,
  }
}

/**
 * 组装隔离运行 env（launcher-parity）：TRAINER_RUN_ID 置位即进入 server 隔离模式，
 * 该模式强制 TRAINER_DB/TRAINER_STATIC_DIR/TRAINER_READY_FILE 三绝对路径，全部给足。
 * ready 文件路径仅满足隔离校验契约；桌面进程内启动不跨进程等待该文件（端口经返回值获得）。
 */
export function buildServerEnv(config: DesktopRuntimeConfig, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...base,
    TRAINER_RUN_ID: `run-${randomUUID()}`,
    TRAINER_DB: config.databasePath,
    TRAINER_DATA_DIR: config.dataDir,
    TRAINER_STATIC_DIR: config.staticDirectory,
    TRAINER_READY_FILE: join(config.dataDir, 'ready.json'),
    TDX_ROOT: config.tdxRoot ?? '',
    TRAINER_CONTROL_TOKEN: config.controlToken,
    HOST: '127.0.0.1',
    PORT: String(config.port),
    OPEN_BROWSER: '0',
  }
}

/** 窗口加载地址：与 launcher baseURL 约定一致（127.0.0.1 回环）。 */
export function buildAppUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}
