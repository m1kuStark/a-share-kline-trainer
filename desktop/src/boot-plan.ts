// PACK-02 单实例启动分支决策（DESKTOP-SINGLE-INSTANCE）。
// 纯函数：锁检查结果 → 启动分支。口径＝PACK-02 派发简报决策①——第二实例在进入任何
// 启动分支（内嵌服务/开发窗口）之前退出；首实例聚焦由 main.ts 的 second-instance 处理。
export interface InstanceBootInput {
  /** app.requestSingleInstanceLock() 是否获锁 */
  hasLock: boolean
  /** DESKTOP_DEV_URL 开发窗口模式地址（不内嵌服务）；null＝正常内嵌形态 */
  devWindowUrl: string | null
}

export type BootPlan =
  | { kind: 'quit' }
  | { kind: 'boot'; mode: 'dev-window'; url: string }
  | { kind: 'boot'; mode: 'embedded' }

export function planInstanceBoot(input: InstanceBootInput): BootPlan {
  if (!input.hasLock) return { kind: 'quit' }
  if (input.devWindowUrl) return { kind: 'boot', mode: 'dev-window', url: input.devWindowUrl }
  return { kind: 'boot', mode: 'embedded' }
}
